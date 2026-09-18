import { PYQ_BUNDLE_SLUG } from '@/lib/enums';
import 'server-only';

import { cache } from 'react';

import { parseJsonColumn, stringArraySchema } from '@/lib/json';
import { db } from '@/server/db';
import {
  countEnrolledMany,
  resolvePricing,
  type SeriesPricing,
} from '@/server/services/pricing-service';

/**
 * The course catalogue — the four tracks a student chooses between.
 *
 * Question counts returned here are the *real* number of questions attached to
 * each test, never a planned figure. A test still being built reports zero, and
 * the UI renders it as "content being added" rather than offering a Start button
 * that would fail at the API. Advertising a paper that cannot be opened is
 * worse than admitting it is not ready.
 */

export type TrackKey =
  | 'FREE_SERIES'
  | 'PAID_SERIES'
  | 'PYQ'
  | 'CHAPTERWISE'
  | 'DAILY_CHALLENGE';

export interface TrackSummary {
  key: TrackKey;
  title: string;
  blurb: string;
  href: string;
  ctaLabel: string;
  iconName: string;
  /** What the track offers, as advertised on the test series page. */
  benefits: string[];
  /** Ribbon shown on the card: 'MOST USEFUL', 'MOST IMPORTANT', 'COMING SOON'. */
  ribbon: string | null;
  /** True when the track has nothing attemptable yet. */
  comingSoon: boolean;
  /** Series belonging to this track. */
  seriesCount: number;
  testCount: number;
  /** Lowest non-zero price across the track, in paise. 0 = the track is free. */
  fromPriceInPaise: number;
  earlyBirdLimit?: number | null;
  isFree: boolean;
}

/** Static presentation for each track; counts are filled from the database. */
const TRACK_META: Record<TrackKey, Omit<TrackSummary, 'seriesCount' | 'testCount' | 'fromPriceInPaise' | 'isFree'>> = {
  DAILY_CHALLENGE: {
    key: 'DAILY_CHALLENGE',
    title: 'AVK Envisions KAS-50',
    blurb: '50 Questions × 50 Days — test, analyse, revise, excel.',
    href: '/50-days',
    ctaLabel: 'Join KAS-50',
    iconName: 'CalendarDays',
    ribbon: 'Popular',
    comingSoon: false,
    benefits: [
      '50 carefully curated questions every day',
      'PYQ-based and current affairs integrated',
      'Syllabus-wise structured',
      'Detailed explanations with PYQ connections',
      'Track your progress and improve daily',
    ],
  },
  FREE_SERIES: {
    key: 'FREE_SERIES',
    title: 'Free Test Series',
    blurb: 'Attempt free tests and evaluate your preparation level.',
    href: '/courses/free-test-series',
    ctaLabel: 'Start free test',
    iconName: 'ClipboardCheck',
    ribbon: null,
    comingSoon: false,
    benefits: [
      // The count was wrong — these are full-length papers now — and naming a
      // small number was talking the free tests down rather than up.
      'Full-length papers drawn from previous-year questions',
      'Sectional tests across the syllabus',
      'Exam-like interface and timing',
      'Detailed solutions after each test',
      'Performance report with accuracy',
    ],
  },
  PAID_SERIES: {
    key: 'PAID_SERIES',
    title: 'Paid Test Series',
    blurb: 'Full-length tests with detailed analysis and All India Ranking.',
    // The series itself, not the course-details page: the card's own benefits
    // already say what the series is, so 'Explore tests' landing on another
    // description was a step that told the reader nothing new.
    href: '/test-series/kas-prelims-paid-test-series',
    ctaLabel: 'Explore tests',
    iconName: 'ClipboardList',
    ribbon: 'Most Useful',
    comingSoon: false,
    benefits: [
      '100 questions per test, just like the real exam',
      'Full-length tests in real exam pattern',
      'All India ranking in percentile',
      'Subject and topic level analysis',
      'Detailed solution for every section',
      'Complete analysis PDF for every test',
    ],
  },
  PYQ: {
    key: 'PYQ',
    title: 'Previous Year Question Papers',
    blurb: 'Experience the real exam environment by solving previous year papers.',
    href: '/pyq',
    ctaLabel: 'Solve PYQs',
    iconName: 'FileQuestion',
    ribbon: 'Most Important',
    comingSoon: false,
    benefits: [
      'Year-wise previous year questions',
      'Complete analysis to gain clarity',
      'Topic-level performance analytics',
      'Solve full-length and subject-wise tests',
      'All subject-wise tests included',
    ],
  },
  CHAPTERWISE: {
    key: 'CHAPTERWISE',
    title: 'Chapter-wise Practice',
    blurb: 'Master the syllabus one topic at a time.',
    href: '/chapterwise',
    ctaLabel: 'Explore Chapter-wise',
    iconName: 'Layers',
    ribbon: 'Coming soon',
    comingSoon: true,
    benefits: [
      'Chapterwise tests based on the standard textbooks',
      'Detailed solutions and synopsis',
      'Progress tracking by chapter and topic',
      'Improve concept clarity step by step',
    ],
  },
};

/**
 * Display order, used everywhere the tracks are listed.
 *
 * The previous year papers lead because they are what most students arrive
 * looking for, then the free series, then KAS-50 and the paid series, with
 * chapterwise last since it is still being written.
 */
const TRACK_ORDER: TrackKey[] = [
  'PYQ',
  'FREE_SERIES',
  'DAILY_CHALLENGE',
  'PAID_SERIES',
  'CHAPTERWISE',
];

/** The four widgets on the landing page and /courses. */
export const getCourseTracks = cache(async (): Promise<TrackSummary[]> => {
  const series = await db.testSeries.findMany({
    where: { status: 'PUBLISHED', deletedAt: null },
    select: {
      id: true,
      track: true,
      priceInPaise: true,
      tier1PriceInPaise: true,
      tier1Limit: true,
      tier2PriceInPaise: true,
      tier2Limit: true,
      tests: {
        where: { status: 'PUBLISHED', deletedAt: null },
        select: { totalQuestions: true },
      },
    },
  });

  const enrolments = await countEnrolledMany(series.map((s) => s.id));

  return TRACK_ORDER.map((key) => {
    const mine = series.filter((s) => s.track === key);
    const tests = mine.flatMap((s) => s.tests);

    // Quote what a buyer actually pays today, including any live early-bird
    // tier — a card advertising the regular price while checkout charges less
    // is a worse error than the reverse, but both are wrong.
    const live = mine
      .map((s) => resolvePricing(s, enrolments.get(s.id) ?? 0))
      .filter((p) => p.priceInPaise > 0);

    const cheapest = live.length > 0 ? live.reduce((a, b) => (a.priceInPaise <= b.priceInPaise ? a : b)) : null;

    return {
      ...TRACK_META[key],
      seriesCount: mine.length,
      testCount: tests.length,
      fromPriceInPaise: cheapest?.priceInPaise ?? 0,
      /** Set when an early-bird tier is running, for the "only for the first N" line. */
      earlyBirdLimit: cheapest?.activeTier ? cheapest.tierLimit : null,
      isFree: key === 'FREE_SERIES',
    };
  });
});

// ---------------------------------------------------------------------------
// Previous year papers
// ---------------------------------------------------------------------------

export interface PyqYearSummary {
  id: string;
  slug: string;
  name: string;
  examYear: number;
  sessionLabel: string | null;
  priceInPaise: number;
  comparePriceInPaise: number;
  /** True when the paper costs nothing — currently the 2011 sample. */
  isFree: boolean;
  pricing: SeriesPricing;
  fullLengthCount: number;
  subjectCount: number;
  totalQuestions: number;
}

/** The year grid on /pyq, oldest paper first so the free year leads. */
export const getPyqYears = cache(async (): Promise<PyqYearSummary[]> => {
  const series = await db.testSeries.findMany({
    // The bundle shares this track but is not an exam year — it is what the
    // years are sold as, so it must not appear among them as a card.
    where: { track: 'PYQ', status: 'PUBLISHED', deletedAt: null, slug: { not: PYQ_BUNDLE_SLUG } },
    // Oldest first, so the free 2011 paper is the first thing a visitor meets
    // and the years read as a progression rather than a reverse-chronological
    // list with the free sample buried at the bottom.
    orderBy: [{ examYear: 'asc' }, { sessionLabel: 'asc' }],
    select: {
      id: true,
      slug: true,
      name: true,
      examYear: true,
      sessionLabel: true,
      priceInPaise: true,
      comparePriceInPaise: true,
      tier1PriceInPaise: true,
      tier1Limit: true,
      tier2PriceInPaise: true,
      tier2Limit: true,
      tests: {
        where: { status: 'PUBLISHED', deletedAt: null },
        select: { paperNumber: true, subjectId: true, totalQuestions: true },
      },
    },
  });

  const enrolments = await countEnrolledMany(series.map((s) => s.id));

  return series.map((s) => ({
    id: s.id,
    slug: s.slug,
    name: s.name,
    examYear: s.examYear ?? 0,
    sessionLabel: s.sessionLabel,
    priceInPaise: s.priceInPaise,
    comparePriceInPaise: s.comparePriceInPaise,
    /** Free papers are open to everyone; every other year is locked until bought. */
    isFree: s.priceInPaise === 0,
    /** Live early-bird state — price and seats reflect real enrolments. */
    pricing: resolvePricing(s, enrolments.get(s.id) ?? 0),
    fullLengthCount: s.tests.filter((t) => t.paperNumber !== null).length,
    subjectCount: s.tests.filter((t) => t.subjectId !== null).length,
    totalQuestions: s.tests
      .filter((t) => t.paperNumber !== null)
      .reduce((sum, t) => sum + t.totalQuestions, 0),
  }));
});

export interface PyqTestRow {
  id: string;
  title: string;
  /** Whether an analysis document is published for this test. */
  hasSynopsis?: boolean;
  slug: string;
  durationMinutes: number;
  totalQuestions: number;
  totalMarks: number;
  accessType: string;
  maxAttempts: number;
  paperNumber: number | null;
  subject: { id: string; name: string; colorHex: string | null } | null;
  /** False when no questions are attached yet. */
  isReady: boolean;
}

/** One PYQ paper: its full-length tests and its subject-wise practice tests. */
export const getPyqPaper = cache(async (slug: string) => {
  const series = await db.testSeries.findFirst({
    where: { slug, track: 'PYQ', status: 'PUBLISHED', deletedAt: null },
    select: {
      id: true,
      slug: true,
      name: true,
      description: true,
      tagline: true,
      examYear: true,
      sessionLabel: true,
      priceInPaise: true,
      comparePriceInPaise: true,
      featuresJson: true,
      synopsisFileName: true,
      tests: {
        where: { status: 'PUBLISHED', deletedAt: null },
        orderBy: [{ paperNumber: 'asc' }, { title: 'asc' }],
        select: {
          id: true,
          title: true,
          slug: true,
          durationMinutes: true,
          totalQuestions: true,
          totalMarks: true,
          accessType: true,
          maxAttempts: true,
          paperNumber: true,
          synopsisFileName: true,
          subject: { select: { id: true, name: true, colorHex: true } },
        },
      },
    },
  });

  if (!series) return null;

  const rows: PyqTestRow[] = series.tests.map((t) => ({
    ...t,
    isReady: t.totalQuestions > 0,
    // A test uses its own analysis when it has one, otherwise the paper-wide
    // document — which is how one 2011 analysis serves the full paper and
    // every subject drill cut from it.
    hasSynopsis: Boolean(t.synopsisFileName ?? series.synopsisFileName),
  }));

  return {
    ...series,
    features: parseJsonColumn(series.featuresJson, stringArraySchema, []),
    /** Whether an analysis document exists. The file name itself never leaves the server. */
    hasSynopsis: Boolean(series.synopsisFileName),
    fullLength: rows.filter((t) => t.paperNumber !== null),
    subjectWise: rows.filter((t) => t.subject !== null),
  };
});

// ---------------------------------------------------------------------------
// Chapterwise
// ---------------------------------------------------------------------------

export const getChapterwiseSubjects = cache(async () => {
  // Drafts are included deliberately. These subjects are a published, priced
  // offer whose chapter tests are still being written, and the page shows them
  // locked rather than hiding the shelf entirely — a visitor should be able to
  // see what the series covers before buying it. Whether one is attemptable is
  // decided per subject below, not by hiding the row.
  const series = await db.testSeries.findMany({
    where: { track: 'CHAPTERWISE', deletedAt: null },
    orderBy: { sortOrder: 'asc' },
    select: {
      id: true,
      slug: true,
      name: true,
      tagline: true,
      description: true,
      iconName: true,
      accentHex: true,
      status: true,
      priceInPaise: true,
      comparePriceInPaise: true,
      tier1PriceInPaise: true,
      tier1Limit: true,
      featuresJson: true,
      tests: {
        where: { deletedAt: null },
        select: { totalQuestions: true },
      },
    },
  });

  return series.map((s) => ({
    ...s,
    features: parseJsonColumn(s.featuresJson, stringArraySchema, []),
    chapterCount: s.tests.length,
    /** Ready to attempt: published, and with at least one chapter test in it. */
    isReady: s.status === 'PUBLISHED' && s.tests.some((t) => t.totalQuestions > 0),
  }));
});

// ---------------------------------------------------------------------------
// A single track's series + schedule
// ---------------------------------------------------------------------------

/**
 * The scheduled test list for the free/paid series.
 *
 * `state` mirrors the course plan's vocabulary: a test is LOCKED until its
 * scheduled date, AVAILABLE once it opens, and COMPLETED after the student has
 * used up their attempts.
 */
export type ScheduleState = 'COMPLETED' | 'IN_PROGRESS' | 'AVAILABLE' | 'LOCKED' | 'COMING_SOON';

export interface ScheduleRow {
  id: string;
  title: string;
  slug: string;
  startDate: Date | null;
  durationMinutes: number;
  totalQuestions: number;
  totalMarks: number;
  maxAttempts: number;
  /** Full syllabus for this test, as printed on the timetable. */
  description: string | null;
  attemptsUsed: number;
  state: ScheduleState;
  /** Whether an analysis document is published for this test. */
  hasSynopsis: boolean;
  /** Attempt id to resume or review, when one exists. */
  attemptId: string | null;
}

export async function getTrackSeries(track: TrackKey, userId?: string) {
  const series = await db.testSeries.findMany({
    where: { track, status: 'PUBLISHED', deletedAt: null },
    orderBy: { sortOrder: 'asc' },
    select: {
      id: true,
      slug: true,
      name: true,
      tagline: true,
      description: true,
      priceInPaise: true,
      comparePriceInPaise: true,
      accessDurationDays: true,
      featuresJson: true,
      synopsisFileName: true,
      tests: {
        // Drafts are included here on purpose. A scheduled series is bought on
        // the strength of its timetable, so a buyer has to see every test that
        // is coming — hiding the unwritten ones showed "Total tests 0" for a
        // twelve-test series. Each row's own state says whether it can be
        // attempted; `state` resolves an empty test to COMING_SOON.
        where: { deletedAt: null },
        // Timetable position first. Falling back to the title sorted an
        // unscheduled series alphabetically, which put CSAT before Polity.
        orderBy: [{ sortOrder: 'asc' }, { startDate: 'asc' }, { title: 'asc' }],
        select: {
          id: true,
          title: true,
          slug: true,
          status: true,
          startDate: true,
          durationMinutes: true,
          totalQuestions: true,
          totalMarks: true,
          maxAttempts: true,
          synopsisFileName: true,
          description: true,
        },
      },
    },
  });

  // One query for every attempt the student has on any of these tests, rather
  // than a per-test lookup.
  const testIds = series.flatMap((s) => s.tests.map((t) => t.id));
  const attempts = userId && testIds.length > 0
    ? await db.testAttempt.findMany({
        where: { userId, testId: { in: testIds } },
        orderBy: { startedAt: 'desc' },
        select: { id: true, testId: true, status: true },
      })
    : [];

  const byTest = new Map<string, typeof attempts>();
  for (const attempt of attempts) {
    const list = byTest.get(attempt.testId) ?? [];
    list.push(attempt);
    byTest.set(attempt.testId, list);
  }

  const now = new Date();

  return series.map((s) => ({
    ...s,
    features: parseJsonColumn(s.featuresJson, stringArraySchema, []),
    schedule: s.tests.map((test): ScheduleRow => {
      const mine = byTest.get(test.id) ?? [];
      const live = mine.find((a) => a.status === 'IN_PROGRESS');
      const finished = mine.filter((a) => a.status !== 'IN_PROGRESS');
      const attemptsUsed = finished.length;

      const state: ScheduleState = (() => {
        if (live) return 'IN_PROGRESS';
        if (test.totalQuestions === 0) return 'COMING_SOON';
        // A test that has questions but is not published cannot be started —
        // `startAttempt` refuses it — so it must not offer a Start button.
        if (test.status !== 'PUBLISHED') return 'COMING_SOON';
        if (test.startDate && test.startDate > now) return 'LOCKED';
        if (test.maxAttempts > 0 && attemptsUsed >= test.maxAttempts) return 'COMPLETED';
        return 'AVAILABLE';
      })();

      return {
        ...test,
        attemptsUsed,
        state,
        // The test's own analysis, falling back to the series document.
        hasSynopsis: Boolean(test.synopsisFileName ?? s.synopsisFileName),
        attemptId: live?.id ?? finished[0]?.id ?? null,
      };
    }),
  }));
}
