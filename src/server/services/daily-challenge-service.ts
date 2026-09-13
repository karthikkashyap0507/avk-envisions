import 'server-only';

import {
  DAILY_CHALLENGE_SLUG,
  DAILY_CHALLENGE_TEST_PREFIX,
  TERMINAL_ATTEMPT_STATUSES,
} from '@/lib/enums';
import { db } from '@/server/db';

/**
 * "50 Questions · 50 Days" — one paper a day in the run-up to the exam.
 *
 * Built on the ordinary series and test models rather than a new one, so every
 * tool that already exists keeps working: the admin can edit these papers,
 * attach questions, upload an analysis PDF and reorder them exactly as for any
 * other test, and a student's attempt, result and analytics need no special
 * handling.
 *
 * A day unlocks by its test's `startDate`. Papers are never hidden once open —
 * someone who joins on day 20 can still work through days 1 to 19, because the
 * point is the fifty papers, not punishing a late start.
 */

export { DAILY_CHALLENGE_SLUG } from '@/lib/enums';

export interface ChallengeDay {
  testId: string;
  slug: string;
  dayNumber: number;
  /** The day's key focus — what the admin titles the paper. */
  title: string;
  /** The topics it covers, from the test's description. */
  topics: string | null;
  /** 1 or 2, so the page can filter by paper. */
  paperNumber: number | null;
  /** Subject name, which is what the schedule groups by. */
  subject: string | null;
  questionCount: number;
  durationMinutes: number;
  /** Null when the admin has not dated this day yet. */
  opensAt: Date | null;
  /** Open, and has questions to attempt. */
  isAvailable: boolean;
  /** The paper for today, by its own date. */
  isToday: boolean;
  hasSynopsis: boolean;
  /**
   * Whether the student may still sit this paper.
   *
   * True while the retry allowance holds, and always true where the paper is
   * set to unlimited attempts (`maxAttempts` 0), which is how these ship.
   */
  canRetake: boolean;
  /** The signed-in student's finished attempt, if any. */
  attempt: { id: string; score: number; maxScore: number; submittedAt: Date | null } | null;
}

export interface ChallengeOverview {
  id: string;
  name: string;
  description: string | null;
  isPublished: boolean;
  days: ChallengeDay[];
  /** Days with questions attached — what a student can actually sit. */
  readyCount: number;
  /** How many days the challenge is planned to run to, for the "x of 50" line. */
  plannedCount: number;
  completedCount: number;
  /** Consecutive finished days counting back from the latest available. */
  currentStreak: number;
}

/** Midnight today, in the server's zone — the unit a "day" is measured in. */
function startOfToday(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

/** The day number encoded in a slug like `kas-50-days-07`. */
function dayNumberOf(slug: string): number {
  return Number(/(\d+)$/.exec(slug)?.[1] ?? 0);
}

export async function getChallenge(userId?: string | null): Promise<ChallengeOverview | null> {
  const series = await db.testSeries.findFirst({
    where: { slug: DAILY_CHALLENGE_SLUG, deletedAt: null },
    select: {
      id: true,
      name: true,
      description: true,
      status: true,
      tests: {
        where: { deletedAt: null },
        select: {
          id: true,
          slug: true,
          title: true,
          description: true,
          paperNumber: true,
          subject: { select: { name: true } },
          status: true,
          startDate: true,
          durationMinutes: true,
          totalQuestions: true,
          maxAttempts: true,
          synopsisFileName: true,
        },
      },
    },
  });

  if (!series) return null;

  // Finished attempts only. A paper left open in another tab is not progress,
  // and counting it would inflate the streak.
  const attempts = userId
    ? await db.testAttempt.findMany({
        where: {
          userId,
          status: { in: [...TERMINAL_ATTEMPT_STATUSES] },
          test: { slug: { startsWith: DAILY_CHALLENGE_TEST_PREFIX } },
        },
        select: { id: true, testId: true, score: true, maxScore: true, submittedAt: true },
        orderBy: { submittedAt: 'desc' },
      })
    : [];

  // Keeps the most recent attempt per paper, since the list is newest first.
  const attemptFor = new Map<string, (typeof attempts)[number]>();
  // And how many have been finished, which is what the retry allowance counts.
  const attemptCount = new Map<string, number>();
  for (const attempt of attempts) {
    if (!attemptFor.has(attempt.testId)) attemptFor.set(attempt.testId, attempt);
    attemptCount.set(attempt.testId, (attemptCount.get(attempt.testId) ?? 0) + 1);
  }

  const today = startOfToday();
  const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000);

  const days: ChallengeDay[] = series.tests
    .map((test) => {
      const attempt = attemptFor.get(test.id) ?? null;
      const opensAt = test.startDate;

      // No date set means the admin has not scheduled it, which is not the same
      // as "open now" — an unscheduled paper stays shut rather than leaking the
      // whole fifty days on the first morning.
      const isOpen = opensAt !== null && opensAt <= new Date();

      return {
        testId: test.id,
        slug: test.slug,
        dayNumber: dayNumberOf(test.slug),
        title: test.title,
        topics: test.description,
        paperNumber: test.paperNumber,
        subject: test.subject?.name ?? null,
        questionCount: test.totalQuestions,
        durationMinutes: test.durationMinutes,
        opensAt,
        isAvailable: isOpen && test.status === 'PUBLISHED' && test.totalQuestions > 0,
        // Whether the student may sit it again. 0 means unlimited, which is
        // the setting these papers ship with — and the page was still offering
        // only "Result" after one attempt, so an unlimited paper could never
        // actually be retaken from here.
        canRetake:
          test.maxAttempts === 0 || (attemptCount.get(test.id) ?? 0) < test.maxAttempts,
        isToday: opensAt !== null && opensAt >= today && opensAt < tomorrow,
        hasSynopsis: Boolean(test.synopsisFileName),
        attempt: attempt
          ? {
              id: attempt.id,
              score: attempt.score,
              maxScore: attempt.maxScore,
              submittedAt: attempt.submittedAt,
            }
          : null,
      };
    })
    // Every scheduled day, whether or not its paper is written yet. The page
    // is a published timetable — a student is meant to see what falls on which
    // date well before those papers exist, and each row says for itself whether
    // it can be attempted.
    .sort((a, b) => a.dayNumber - b.dayNumber);

  // Counted backwards from the most recent open day: the streak a student cares
  // about is the run they are currently on, not their best ever.
  let currentStreak = 0;
  for (const day of [...days].reverse()) {
    if (!day.isAvailable) continue;
    if (!day.attempt) break;
    currentStreak += 1;
  }

  return {
    id: series.id,
    name: series.name,
    description: series.description,
    isPublished: series.status === 'PUBLISHED',
    days,
    // Days with a paper behind them, which is not the same as days listed.
    readyCount: days.filter((day) => day.questionCount > 0).length,
    plannedCount: series.tests.length,
    completedCount: days.filter((d) => d.attempt).length,
    currentStreak,
  };
}
