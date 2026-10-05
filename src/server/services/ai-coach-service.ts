import 'server-only';

import { AppError } from '@/lib/api';
import { serverEnv } from '@/lib/env';
import { db } from '@/server/db';
import { logger } from '@/server/logger';
import { getAiProvider, isAiEnabled, type ChatMessage } from '@/server/ai/provider';

import { getAnalyticsOverview, getScoreTrend, getSubjectPerformance, getTopicVerdicts } from './analytics-service';
import { coachAnswer, type CoachRecord } from './coach-engine';

/**
 * AVK AI Coach.
 *
 * The coach is grounded in the student's own record: their accuracy, their
 * weakest topics, how many tests they have actually done. That grounding is the
 * whole point — a generic study-tips chatbot is worthless, and one that invents
 * statistics about a student is actively harmful. The system prompt is
 * explicit that it must not fabricate figures beyond the ones supplied.
 *
 * With no AI model connected, the coach answers from its own built-in answers
 * (coach-engine.ts) instead of refusing: the same record, every figure from
 * it, with hand-written advice around them. Those cost nothing, so there is
 * no monthly allowance for them.
 */

/** Monthly request cap for students with no paid plan. */
const FREE_TIER_MONTHLY_LIMIT = 5;

const SYSTEM_PROMPT = `You are AVK AI Coach, a study advisor for students preparing for Indian competitive examinations (KAS, KCET, JEE, NEET, UPSC).

You will be given a factual summary of this specific student's performance. Ground every piece of advice in those figures.

Rules you must follow:
- Never invent statistics, ranks, scores or topic names that are not in the summary. If you do not have a figure, say so plainly.
- If the summary shows very little data, say the data is thin and recommend attempting more questions before drawing conclusions. Do not guess at weaknesses.
- Be specific and actionable. "Revise thermodynamics" is weak; "your accuracy on Thermodynamics is 38% across 14 questions — work the First Law problems before attempting another full mock" is useful.
- Be concise. Aim for under 200 words unless the student asks for a detailed plan.
- Never claim to have access to anything beyond the supplied summary.
- You are not a medical or mental-health professional. If a student raises distress, acknowledge it briefly and suggest they speak to someone they trust; do not attempt counselling.
- Use plain text. No markdown headings.`;

/** Builds the factual grounding block handed to the model. */
async function buildContext(userId: string): Promise<string> {
  const [overview, subjects, verdicts] = await Promise.all([
    getAnalyticsOverview(userId),
    getSubjectPerformance(userId),
    getTopicVerdicts(userId),
  ]);

  if (overview.questionsAnswered === 0) {
    return 'STUDENT RECORD: This student has not answered any questions yet. There is no performance data at all.';
  }

  const lines = [
    'STUDENT RECORD (the only facts you may cite):',
    `- Questions answered: ${overview.questionsAnswered} (${overview.correct} correct, ${overview.incorrect} incorrect)`,
    `- Overall accuracy: ${overview.accuracy}%`,
    `- Average time per question: ${Math.round(overview.avgTimeSeconds)} seconds`,
    `- Tests completed: ${overview.testsCompleted}`,
    `- Practice sessions: ${overview.practiceSessions}`,
  ];

  if (subjects.length > 0) {
    lines.push('- Subject accuracy:');
    for (const subject of subjects) {
      lines.push(
        `    ${subject.name}: ${subject.accuracy}% over ${subject.total} questions${subject.isReliable ? '' : ' (too few to be reliable)'}`,
      );
    }
  }

  if (verdicts.weak.length > 0) {
    lines.push('- Weakest topics (enough data to be confident):');
    for (const topic of verdicts.weak.slice(0, 5)) {
      lines.push(`    ${topic.name}: ${topic.accuracy}% over ${topic.total} questions`);
    }
  } else {
    lines.push(
      `- Weak topics: none identified yet. ${verdicts.pendingCount} topics have been seen but none has reached the ${verdicts.minAnswers}-question threshold needed to judge.`,
    );
  }

  if (verdicts.strong.length > 0) {
    lines.push(
      `- Strong topics: ${verdicts.strong.slice(0, 5).map((t) => `${t.name} (${t.accuracy}%)`).join(', ')}`,
    );
  }

  return lines.join('\n');
}

/** The student's record, as the built-in coach reads it. */
async function buildRecord(userId: string): Promise<CoachRecord> {
  const [overview, subjects, verdicts, trend] = await Promise.all([
    getAnalyticsOverview(userId),
    getSubjectPerformance(userId),
    getTopicVerdicts(userId),
    getScoreTrend(userId, 6),
  ]);
  return {
    questionsAnswered: overview.questionsAnswered,
    correct: overview.correct,
    accuracy: overview.accuracy,
    avgTimeSeconds: overview.avgTimeSeconds,
    testsCompleted: overview.testsCompleted,
    practiceSessions: overview.practiceSessions,
    subjects: subjects.map((s) => ({ name: s.name, total: s.total, accuracy: s.accuracy, isReliable: s.isReliable })),
    weakTopics: verdicts.weak.map((t) => ({ name: t.name, total: t.total, accuracy: t.accuracy })),
    strongTopics: verdicts.strong.map((t) => ({ name: t.name, total: t.total, accuracy: t.accuracy })),
    recentScores: trend.map((t) => ({ title: t.title, percentage: t.percentage })),
    minAnswers: verdicts.minAnswers,
  };
}

/**
 * Monthly usage allowance.
 *
 * Counted from the AIRequest log rather than a counter on the subscription, so
 * it stays correct even if a subscription is changed mid-month.
 */
export async function getAiAllowance(userId: string) {
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  // The built-in answers cost nothing: no allowance to run out of.
  if (!isAiEnabled()) {
    const used = await db.aIRequest.count({ where: { userId, createdAt: { gte: monthStart } } });
    return { used, limit: -1, remaining: -1, unlimited: true };
  }

  const [used, subscription] = await Promise.all([
    db.aIRequest.count({ where: { userId, createdAt: { gte: monthStart } } }),
    db.subscription.findFirst({
      where: { userId, status: 'ACTIVE', expiresAt: { gt: new Date() } },
      select: { plan: { select: { maxAiRequestsPerMonth: true } } },
    }),
  ]);

  const limit = subscription?.plan.maxAiRequestsPerMonth ?? FREE_TIER_MONTHLY_LIMIT;

  return {
    used,
    limit,
    remaining: Math.max(0, limit - used),
    /** A plan may grant unlimited use with -1. */
    unlimited: limit < 0,
  };
}

export interface AskCoachParams {
  userId: string;
  question: string;
  history?: ChatMessage[];
}

export async function askCoach({ userId, question, history = [] }: AskCoachParams) {
  if (!isAiEnabled()) {
    const started = Date.now();
    const answer = coachAnswer(question, await buildRecord(userId));
    await db.aIRequest
      .create({
        data: {
          userId,
          feature: 'COACH',
          provider: 'builtin',
          model: 'avk-coach',
          promptTokens: 0,
          completionTokens: 0,
          totalTokens: 0,
          latencyMs: Date.now() - started,
          status: 'SUCCESS',
          promptPreview: question.slice(0, 200),
          responsePreview: answer.slice(0, 200),
        },
      })
      .catch((error) => logger.warn({ error }, 'Could not log a coach answer'));
    return { answer, allowance: await getAiAllowance(userId) };
  }

  const allowance = await getAiAllowance(userId);
  if (!allowance.unlimited && allowance.remaining <= 0) {
    throw new AppError(
      'AI_LIMIT_REACHED',
      `You have used all ${allowance.limit} AI Coach requests for this month. Your allowance resets on the 1st.`,
    );
  }

  const context = await buildContext(userId);

  // Only the last few turns are carried, to keep the prompt bounded.
  const messages: ChatMessage[] = [
    ...history.slice(-6),
    { role: 'user', content: `${context}\n\nSTUDENT QUESTION: ${question}` },
  ];

  const started = Date.now();
  const provider = getAiProvider();

  try {
    const result = await provider.complete({ system: SYSTEM_PROMPT, messages });

    // Logged for the usage allowance and for cost visibility. Only a short
    // preview of the question is stored — the full prompt embeds the student's
    // performance record and does not need a second copy.
    await db.aIRequest.create({
      data: {
        userId,
        feature: 'COACH',
        provider: provider.name,
        model: result.model,
        promptTokens: result.inputTokens,
        completionTokens: result.outputTokens,
        totalTokens: result.inputTokens + result.outputTokens,
        latencyMs: Date.now() - started,
        status: 'SUCCESS',
        promptPreview: question.slice(0, 200),
        responsePreview: result.text.slice(0, 200),
      },
    });

    return { answer: result.text, allowance: await getAiAllowance(userId) };
  } catch (error) {
    await db.aIRequest
      .create({
        data: {
          userId,
          feature: 'COACH',
          provider: provider.name,
          model: serverEnv().AI_MODEL,
          latencyMs: Date.now() - started,
          status: 'FAILED',
          errorMessage: error instanceof Error ? error.message.slice(0, 500) : 'unknown',
        },
      })
      .catch(() => {
        // A logging failure must not mask the original error.
      });

    logger.error({ error, userId }, 'AI coach request failed');
    throw error;
  }
}

/**
 * Suggested opening questions, tailored to what the student's record can
 * actually support. With no data, the suggestions do not pretend otherwise.
 */
export async function getCoachSuggestions(userId: string): Promise<string[]> {
  const overview = await getAnalyticsOverview(userId);

  if (overview.questionsAnswered === 0) {
    return [
      'How should I start preparing for KAS Prelims?',
      'How many mock tests should I attempt each week?',
      'What is the best way to use previous year papers?',
    ];
  }

  const verdicts = await getTopicVerdicts(userId);
  const suggestions = [
    'What should I focus on this week?',
    'How can I improve my accuracy?',
  ];

  if (verdicts.weak.length > 0) {
    suggestions.unshift(`How do I improve at ${verdicts.weak[0]!.name}?`);
  }
  if (overview.avgTimeSeconds > 90) {
    suggestions.push('How do I answer questions faster without guessing?');
  }

  return suggestions.slice(0, 4);
}
