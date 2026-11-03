import 'server-only';

import { cache } from 'react';

import { QUIZ_SERIES_SLUG, isTestOpen } from '@/lib/enums';
import { db } from '@/server/db';

/**
 * Quizzes.
 *
 * A quiz is an ordinary `Test` with category QUIZ, gathered under one series.
 * Modelling it that way means the attempt engine, the admin editor, the PDF
 * import and the result page all work on it unchanged — the only new things
 * are the two pages that list them.
 *
 * The category is also what keeps the two pools apart. Practice draws from the
 * whole published bank, so without a boundary a quiz question would surface
 * inside a mock test; a quiz question is attached only to quiz tests, and
 * `quizQuestionIds()` is what the practice pool excludes.
 */

export interface QuizSummary {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  durationMinutes: number;
  totalQuestions: number;
  /** Null when the quiz can be taken any time. */
  startDate: Date | null;
  /** Open now, and has questions to answer. */
  isOpen: boolean;
  /** How many times this student has finished it. */
  attempts: number;
  /** Their best score, where they have one. */
  bestScore: number | null;
}

/**
 * Every published quiz, newest first.
 *
 * A quiz with no questions is left out: a student who picks one and lands on
 * an empty paper has been sent somewhere pointless.
 */
export const listQuizzes = cache(async (userId: string | null): Promise<QuizSummary[]> => {
  const quizzes = await db.test.findMany({
    where: {
      category: 'QUIZ',
      status: 'PUBLISHED',
      deletedAt: null,
      totalQuestions: { gt: 0 },
    },
    orderBy: [{ startDate: 'desc' }, { createdAt: 'desc' }],
    select: {
      id: true,
      slug: true,
      title: true,
      description: true,
      durationMinutes: true,
      totalQuestions: true,
      startDate: true,
    },
  });

  if (quizzes.length === 0) return [];

  // One query for every attempt rather than one per quiz.
  const attempts = userId
    ? await db.testAttempt.findMany({
        where: {
          userId,
          testId: { in: quizzes.map((q) => q.id) },
          status: { in: ['SUBMITTED', 'EVALUATED', 'EXPIRED'] },
        },
        select: { testId: true, score: true },
      })
    : [];

  const byTest = new Map<string, { count: number; best: number | null }>();
  for (const a of attempts) {
    const seen = byTest.get(a.testId) ?? { count: 0, best: null };
    seen.count += 1;
    if (a.score !== null && (seen.best === null || a.score > seen.best)) seen.best = a.score;
    byTest.set(a.testId, seen);
  }

  return quizzes.map((quiz) => {
    const seen = byTest.get(quiz.id);
    return {
      ...quiz,
      isOpen: isTestOpen(quiz.startDate),
      attempts: seen?.count ?? 0,
      bestScore: seen?.best ?? null,
    };
  });
});

/**
 * The ids of every question that belongs to a quiz.
 *
 * Used to keep quiz material out of the practice pool. Returns an empty array
 * when there are no quizzes, which callers must read as "exclude nothing"
 * rather than "exclude everything".
 */
export const quizQuestionIds = cache(async (): Promise<string[]> => {
  const rows = await db.testQuestion.findMany({
    where: { test: { category: 'QUIZ', deletedAt: null } },
    select: { questionId: true },
  });
  return [...new Set(rows.map((r) => r.questionId))];
});

/**
 * The series every quiz hangs from, created on first use.
 *
 * A quiz needs a series for the catalogue to have somewhere to put it, and
 * asking an admin to make one before their first quiz is a step that only
 * exists to be forgotten.
 */
export async function ensureQuizSeries(): Promise<string> {
  const existing = await db.testSeries.findFirst({
    where: { slug: QUIZ_SERIES_SLUG },
    select: { id: true },
  });
  if (existing) return existing.id;

  // KAS by slug: the quizzes are KAS quizzes, and there is more than one exam.
  const exam = await db.exam.findFirstOrThrow({ where: { slug: 'kas' }, select: { id: true } });
  const created = await db.testSeries.create({
    data: {
      examId: exam.id,
      slug: QUIZ_SERIES_SLUG,
      name: 'AVK Quizzes',
      tagline: 'Short quizzes to test yourself between papers',
      description:
        'Quick quizzes drawn from their own question set — separate from the test series, ' +
        'and free to attempt as often as you like.',
      // Free, so it sits with the free series rather than inventing a track
      // that the catalogue pages would then have to learn about.
      track: 'FREE_SERIES',
      priceInPaise: 0,
      status: 'PUBLISHED',
      difficulty: 'MIXED',
      sortOrder: 90,
    },
    select: { id: true },
  });
  return created.id;
}
