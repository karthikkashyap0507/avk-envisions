/**
 * Catalogue seed — the four course tracks students choose between.
 *
 *   1. FREE_SERIES  — scheduled sectional tests, free
 *   2. PAID_SERIES  — full-length tests with All India ranking
 *   3. PYQ          — previous year papers, year-wise (Paper 1 / Paper 2)
 *   4. CHAPTERWISE  — practice by standard reference book, subject-wise
 *
 * This seeds the *structure* only. Tests are created with their real question
 * count, which is zero until questions are attached — the catalogue UI shows
 * those as "content being added" rather than offering a Start button that would
 * fail. The one exception is the 2024 December Polity paper, which is wired to
 * the five real PYQ questions already in the bank.
 *
 * Run with: npm run db:seed:catalogue
 */
import { PrismaClient } from '@prisma/client';

import { KAS_2026_SCHEDULE } from './data/kas-2026-schedule';
import {
  MARKS_PER_QUESTION,
  NEGATIVE_MARKS_PER_QUESTION,
  totalMarksFor,
} from '../src/lib/marking';
import { FULL_LENGTH_SUBJECTS } from '../src/lib/enums';

const db = new PrismaClient();

/** The admin account that owns all seeded content. */
function adminEmail() {
  return (process.env.SEED_ADMIN_EMAIL ?? 'admin@avkvisions.com').toLowerCase();
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** The ten subjects a KAS Prelims paper is broken into, and their typical weight. */
const KAS_SUBJECTS: { name: string; questions: number; icon: string; color: string }[] = [
  // Indian and Karnataka history are taught and tested together, so they are a
  // single subject. General Studies was dropped: it overlapped Current Affairs
  // without describing a distinct body of questions.
  { name: 'History', questions: 24, icon: 'Landmark', color: '#b45309' },
  { name: 'Indian Economy', questions: 15, icon: 'IndianRupee', color: '#15803d' },
  { name: 'Geography', questions: 13, icon: 'Globe2', color: '#0891b2' },
  { name: 'Indian Polity', questions: 12, icon: 'Scale', color: '#4338ca' },
  { name: 'Current Affairs', questions: 12, icon: 'Newspaper', color: '#be123c' },
  { name: 'Science & Technology', questions: 8, icon: 'Atom', color: '#7c3aed' },
  { name: 'Environment', questions: 6, icon: 'Leaf', color: '#16a34a' },
  { name: 'Mental Ability', questions: 5, icon: 'Brain', color: '#db2777' },
];

/** Subjects folded into another, or dropped, after the catalogue was first seeded. */
/** Minutes for one free sampler test. */
/**
 * Everything on the platform is free.
 *
 * Prices, the early-bird ladder and the PAID access type are all set to zero
 * here rather than removed, so restoring paid access later is a matter of
 * changing these values back rather than rebuilding the commerce path. The
 * checkout, entitlement and webhook code is untouched and still works; there
 * is simply nothing priced above zero for it to sell.
 */
const EVERYTHING_IS_FREE = true;

/**
 * One free sampler test: how many questions, and how long for.
 *
 * The duration is derived rather than stated separately, at the same 1.2
 * minutes a question the real paper allows — a hundred questions in two hours.
 * Kept as two independent constants they drifted, and the page ended up
 * offering 25 questions in 25 minutes.
 */
const FREE_TEST_QUESTIONS = 25;
const MINUTES_PER_QUESTION = 1.2;
const FREE_TEST_MINUTES = Math.round(FREE_TEST_QUESTIONS * MINUTES_PER_QUESTION);

/**
 * The free tier samples the first two tests of the published timetable.
 *
 * Ten were seeded previously and eight of them never got questions, so the
 * catalogue advertised empty papers. Two that are actually full is a better
 * offer than ten that are not.
 */
/**
 * The ten free sampler tests.
 *
 * Their own list rather than a slice of the paid timetable: that timetable is
 * named by subject — Polity, History, CSAT — and taking ten of it named the
 * free tests after paid papers they do not contain. These are numbered
 * samplers, alternating Paper 1 and Paper 2 as the real exam does, and the
 * `.slice(0, 2)` that used to stand here is why only two of the ten were ever
 * created.
 */
const FREE_SERIES_SCHEDULE = Array.from({ length: 10 }, (_, index) => {
  const no = index + 1;
  const paperNumber = no % 2 === 1 ? 1 : 2;
  return {
    no,
    name: `Free Test ${no} – Paper ${paperNumber}`,
    paperNumber,
    subject: undefined as string | undefined,
    syllabus: '25 Most Probable Questions',
  };
});

const RETIRED_SUBJECTS: { slug: string; mergeIntoSlug?: string }[] = [
  { slug: 'indian-history', mergeIntoSlug: 'history' },
  { slug: 'karnataka-history', mergeIntoSlug: 'history' },
  { slug: 'general-studies' },
];

/** Previous-year papers KPSC has actually conducted. */
const PYQ_YEARS: { year: number; session?: string; papers: number[]; free?: boolean }[] = [
  // 2011 is the free sample: a complete, genuine KAS paper a student can
  // attempt end to end before paying for anything.
  { year: 2011, papers: [1, 2], free: true },
  // Years follow the Drive folder names, which AVK confirmed twice, rather
  // than the cover headings inside the documents — those read 2014 and 2015
  // for the folders named 2015 and 2017, and are a typo in the source PDFs.
  // Flagged rather than silently reconciled: if a cover is right and a folder
  // wrong, a student practises a paper labelled with the wrong year.
  { year: 2015, papers: [1, 2] },
  { year: 2017, papers: [1, 2] },
  { year: 2020, papers: [1, 2] },
  { year: 2024, session: 'August', papers: [1, 2] },
  { year: 2024, session: 'December', papers: [1, 2] },
];

/** Standard reference books the chapterwise track is organised around. */
const CHAPTERWISE_TRACKS = [
  {
    name: 'Polity',
    source: 'Laxmikanth',
    icon: 'Scale',
    color: '#4338ca',
    blurb: 'Chapterwise questions from Indian Polity by M. Laxmikanth.',
  },
  {
    name: 'History',
    source: 'Spectrum',
    icon: 'Castle',
    color: '#be123c',
    blurb: 'Chapterwise questions from Spectrum Modern India.',
  },
  {
    name: 'Geography',
    source: '11th & 12th NCERT',
    icon: 'Globe2',
    color: '#15803d',
    blurb: 'Chapterwise questions from NCERT Geography (11th & 12th).',
  },
  {
    name: 'Environment',
    source: 'Shankar IAS',
    icon: 'Leaf',
    color: '#7c3aed',
    blurb: 'Chapterwise questions from Environment by Shankar IAS.',
  },
  {
    name: 'Economy',
    source: 'Budget & Survey',
    icon: 'IndianRupee',
    color: '#ea580c',
    blurb: 'Chapterwise questions from the Union Budget and Economic Survey.',
  },
];

/** Phase 1 of the free series, as scheduled in the course plan. */

/** Standard instructions for a full 100-question, 2-hour paper. */
const FULL_PAPER_INSTRUCTIONS = [
  'This paper follows the actual KAS Prelims pattern.',
  '',
  `• 100 questions, 2 hours. Each question carries ${MARKS_PER_QUESTION} marks, for a total of ${totalMarksFor(100)}.`,
  `• ${NEGATIVE_MARKS_PER_QUESTION} marks are deducted for every incorrect answer. Unanswered questions carry no penalty.`,
  '• You may move freely between questions and mark any question for review.',
  '• Your answers save automatically. If your connection drops, resume and continue where you left off.',
  '• The timer runs on our servers, so closing the tab does not pause it. The paper is submitted automatically when time expires.',
].join('\n');

async function main() {
  if (!(process.env.DATABASE_URL ?? '').startsWith('file:') && process.env.ALLOW_REMOTE_SEED !== '1') {
    throw new Error('Refusing to seed a non-file database. Set ALLOW_REMOTE_SEED=1 if intended.');
  }

  console.log('\nSeeding catalogue tracks...\n');

  const exam = await db.exam.findUnique({ where: { slug: 'kas' }, select: { id: true } });
  if (!exam) throw new Error('KAS exam not found — run `npm run db:seed:kas` first.');

  const author = await db.user.findUnique({
    where: { emailNormal: adminEmail() },
    select: { id: true },
  });
  if (!author) throw new Error('Admin account missing — run `npm run db:seed` first.');

  const examId = exam.id;
  const authorId = author.id;

  // --- Subjects ----------------------------------------------------------
  const subjectIds = new Map<string, string>();
  for (const [index, subject] of KAS_SUBJECTS.entries()) {
    const record = await db.subject.upsert({
      where: { examId_slug: { examId, slug: slugify(subject.name) } },
      update: { colorHex: subject.color },
      create: {
        examId,
        name: subject.name,
        slug: slugify(subject.name),
        colorHex: subject.color,
        sortOrder: index + 1,
      },
      select: { id: true },
    });
    subjectIds.set(subject.name, record.id);
  }
  console.log(`  ok  ${KAS_SUBJECTS.length} subjects`);

  // Filing subjects for a whole full-length paper. Kept out of KAS_SUBJECTS on
  // purpose: every entry there gets a subject drill built for each PYQ year
  // below, and "Full Length Paper 1 — 2015" is not a drill anyone should see.
  // Placed after the real subjects in every dropdown.
  for (const [index, subject] of FULL_LENGTH_SUBJECTS.entries()) {
    await db.subject.upsert({
      where: { examId_slug: { examId, slug: subject.slug } },
      update: { name: subject.name, sortOrder: 101 + index, isActive: true, deletedAt: null },
      create: {
        examId,
        name: subject.name,
        slug: subject.slug,
        colorHex: '#475569',
        sortOrder: 101 + index,
      },
    });
  }
  console.log(`  ok  ${FULL_LENGTH_SUBJECTS.length} full-length paper subjects`);

  // --- Retire merged / dropped subjects -----------------------------------
  // The catalogue was first seeded with separate Indian and Karnataka history
  // subjects and a General Studies subject. Re-running must converge an
  // existing database rather than leave orphaned subjects on the site, so
  // questions are moved to the surviving subject *before* anything is deleted
  // — a subject delete would otherwise take real questions with it.
  for (const retired of RETIRED_SUBJECTS) {
    const old = await db.subject.findFirst({
      where: { examId, slug: retired.slug },
      select: { id: true, name: true },
    });
    if (!old) continue;

    let targetId: string | null = null;
    if (retired.mergeIntoSlug) {
      targetId =
        (
          await db.subject.findFirst({
            where: { examId, slug: retired.mergeIntoSlug },
            select: { id: true },
          })
        )?.id ?? null;

      if (!targetId) {
        throw new Error(
          `Cannot merge "${retired.slug}": target subject "${retired.mergeIntoSlug}" does not exist.`,
        );
      }
    }

    // A subject being dropped outright has nowhere to put its content, and
    // `Question.subjectId` is not nullable. Rather than delete real questions
    // to satisfy a config change, leave the subject in place and say so.
    if (!targetId) {
      const [questions, chapters] = await Promise.all([
        db.question.count({ where: { subjectId: old.id } }),
        db.chapter.count({ where: { subjectId: old.id } }),
      ]);
      if (questions > 0 || chapters > 0) {
        console.log(
          `  !!  "${old.name}" still holds ${questions} question(s) and ${chapters} chapter(s).` +
            ` Left in place — move them to another subject first, then re-run.`,
        );
        continue;
      }
    }

    const moved = targetId
      ? await db.question.updateMany({ where: { subjectId: old.id }, data: { subjectId: targetId } })
      : { count: 0 };
    if (targetId) {
      await db.chapter.updateMany({ where: { subjectId: old.id }, data: { subjectId: targetId } });
    }

    // Subject-wise tests for a retired subject have no meaning; their questions
    // live on in the full-length paper and the surviving subject's test.
    const staleTests = await db.test.findMany({
      where: { subjectId: old.id },
      select: { id: true, slug: true },
    });
    for (const test of staleTests) {
      const attempts = await db.testAttempt.count({ where: { testId: test.id } });
      if (attempts > 0) {
        // Somebody sat this paper. Detach it rather than destroy their result.
        await db.test.update({
          where: { id: test.id },
          data: { ...(targetId ? { subjectId: targetId } : {}), status: 'ARCHIVED' },
        });
        continue;
      }
      await db.testQuestion.deleteMany({ where: { testId: test.id } });
      await db.test.delete({ where: { id: test.id } });
    }

    await db.subject.delete({ where: { id: old.id } });
    console.log(
      `  ok  retired "${old.name}"${retired.mergeIntoSlug ? ` into ${retired.mergeIntoSlug}` : ''}` +
        ` (${moved.count} questions moved, ${staleTests.length} tests cleared)`,
    );
  }

  /** Creates a test, refreshing its metadata but never touching its questions. */
  async function upsertTest(input: {
    slug: string;
    title: string;
    seriesId: string;
    category: string;
    accessType: string;
    durationMinutes: number;
    description?: string;
    instructions?: string;
    paperNumber?: number;
    subjectId?: string;
    maxAttempts?: number;
    startDate?: Date | null;
    sortOrder?: number;
  }) {
    return db.test.upsert({
      where: { slug: input.slug },
      // Rules and placement are refreshed on every run so a configuration
      // change here actually reaches existing rows; questions are never touched.
      update: {
        title: input.title,
        testSeriesId: input.seriesId,
        status: 'PUBLISHED',
        // Refreshed deliberately: these carry the marking scheme, and a
        // correction to it has to reach papers that already exist.
        instructions: input.instructions ?? FULL_PAPER_INSTRUCTIONS,
        description: input.description,
        maxAttempts: input.maxAttempts ?? 0,
        accessType: input.accessType,
        durationMinutes: input.durationMinutes,
        paperNumber: input.paperNumber,
        subjectId: input.subjectId,
        startDate: input.startDate,
        sortOrder: input.sortOrder ?? 0,
      },
      create: {
        examId,
        testSeriesId: input.seriesId,
        title: input.title,
        slug: input.slug,
        description: input.description,
        instructions: input.instructions ?? FULL_PAPER_INSTRUCTIONS,
        category: input.category,
        mode: 'EXAM',
        durationMinutes: input.durationMinutes,
        accessType: input.accessType,
        // Retakes are capped at two, per the course rules.
        maxAttempts: input.maxAttempts ?? 0,
        negativeMarkingEnabled: true,
        defaultNegativeRatio: 0.25,
        paperNumber: input.paperNumber,
        subjectId: input.subjectId,
        startDate: input.startDate,
        sortOrder: input.sortOrder ?? 0,
        randomizeOptions: false,
        showResultImmediately: true,
        status: 'PUBLISHED',
        publishedAt: new Date(),
        createdById: authorId,
      },
      select: { id: true },
    });
  }

  /**
   * Removes tests and series that a schedule change has orphaned.
   *
   * Nobody's history is destroyed: anything with a recorded attempt is
   * archived instead of deleted, so a student's result page keeps working even
   * though the test no longer appears in the catalogue.
   */
  async function retire(label: string, where: object) {
    const doomed = await db.test.findMany({ where, select: { id: true } });
    let removed = 0;
    let archived = 0;

    for (const test of doomed) {
      const attempts = await db.testAttempt.count({ where: { testId: test.id } });
      if (attempts > 0) {
        await db.test.update({ where: { id: test.id }, data: { status: 'ARCHIVED' } });
        archived += 1;
        continue;
      }
      await db.testQuestion.deleteMany({ where: { testId: test.id } });
      await db.testSection.deleteMany({ where: { testId: test.id } });
      await db.test.delete({ where: { id: test.id } });
      removed += 1;
    }

    if (removed || archived) {
      console.log(`  ok  retired ${label}: ${removed} removed, ${archived} archived`);
    }
  }

  // The free and paid series were re-slugged when the real 21-test timetable
  // replaced the placeholder schedule. Clear the old rows so the catalogue does
  // not show both.
  await retire('placeholder free tests', {
    slug: { startsWith: 'kas-free-' },
    NOT: { slug: { in: KAS_2026_SCHEDULE.map((t) => `kas-free-${t.no}`) } },
  });
  await retire('placeholder mock tests', { slug: { startsWith: 'kas-paid-full-mock-' } });

  // 2014 was published briefly while the document cover headings were taken
  // as authoritative; the folder names are.
  await retire('2014 paper tests', { slug: { startsWith: 'kas-pyq-2014' } });
  await db.testSeries.deleteMany({
    where: { slug: 'kas-pyq-2014', tests: { none: {} } },
  });

  /**
   * When a scheduled test opens.
   *
   * The timetable runs sessions at 10:00 and 14:00 India time (UTC+5:30), so
   * those are converted to UTC here rather than storing a bare date — a test
   * that unlocks at "midnight" would otherwise open at 05:30 IST.
   */
  function unlockAt(date: string, session: 'MORNING' | 'AFTERNOON'): Date {
    const utcHour = session === 'MORNING' ? '04:30' : '08:30';
    return new Date(`${date}T${utcHour}:00.000Z`);
  }

  // --- 1. Free test series ----------------------------------------------
  const free = await db.testSeries.upsert({
    where: { slug: 'kas-prelims-free-test-series' },
    update: { track: 'FREE_SERIES', priceInPaise: 0, status: 'PUBLISHED' },
    create: {
      examId,
      name: 'KPSC KAS Prelims — Free Test Series',
      slug: 'kas-prelims-free-test-series',
      track: 'FREE_SERIES',
      iconName: 'ClipboardCheck',
      accentHex: '#15803d',
      tagline: 'Attempt free tests and evaluate your preparation level.',
      description:
        'A scheduled sectional test series covering the full KAS Prelims syllabus. Tests unlock on their scheduled date and are attempted in one sitting, exactly as in the real examination.',
      difficulty: 'MIXED',
      priceInPaise: 0,
      comparePriceInPaise: 0,
      accessDurationDays: 0,
      status: 'PUBLISHED',
      isFeatured: true,
      sortOrder: 1,
      featuresJson: JSON.stringify([
        'Sectional tests across the entire prelims syllabus',
        'Attempt on schedule, exactly like the real exam',
        'Detailed solutions and a synopsis after each test',
        'Performance report with subject-level accuracy',
        'Completely free',
      ]),
    },
    select: { id: true },
  });

  // Ten sampler tests. A paper already carrying questions keeps its own title
  // — an imported paper names itself, and the seed should not rename work an
  // admin has done.
  for (const entry of FREE_SERIES_SCHEDULE) {
    const slug = `kas-free-${entry.no}`;

    // A paper that already holds questions keeps the title it was given. An
    // import names a paper after the document it came from, and re-running the
    // seed should not rename work somebody has already done.
    const existing = await db.test.findFirst({
      where: { slug },
      select: { title: true, totalQuestions: true },
    });
    const keepTitle = existing !== null && existing.totalQuestions > 0;

    await upsertTest({
      slug,
      title: keepTitle ? existing.title : entry.name,
      sortOrder: entry.no,
      seriesId: free.id,
      category: entry.paperNumber === null ? 'SECTIONAL' : 'FULL_MOCK',
      accessType: 'FREE',
      // 20 questions in 25 minutes: a sample of the paid paper, not a
      // shortened version of the real exam.
      durationMinutes: FREE_TEST_MINUTES,
      // Explicitly null, not omitted: these tests were previously scheduled,
      // and `undefined` would leave those dates in place. The free tests are a
      // sampler a visitor works through whenever they like; only the paid
      // series follows the published examination timetable.
      startDate: null,
      subjectId: entry.subject ? subjectIds.get(entry.subject) : undefined,
      description: entry.syllabus,
    });
  }
  // Anything beyond the ten-test sampler is retired, so shrinking the free
  // tier actually removes the extra rows rather than leaving them published.
  await retire('surplus free tests', {
    slug: { startsWith: 'kas-free-' },
    NOT: { slug: { in: FREE_SERIES_SCHEDULE.map((t) => `kas-free-${t.no}`) } },
  });

  console.log(
    `  ok  free series + ${FREE_SERIES_SCHEDULE.length} tests (${FREE_TEST_QUESTIONS} questions, ${FREE_TEST_MINUTES} min)`,
  );

  // --- 2. Paid test series ----------------------------------------------
  const paid = await db.testSeries.upsert({
    where: { slug: 'kas-prelims-paid-test-series' },
    update: {
      track: 'PAID_SERIES',
      status: 'PUBLISHED',
      // Price is left alone on a series that already exists. `set-pricing.ts`
      // owns it, and re-seeding used to reset every series to free — after
      // which `hide-empty-tests.ts` saw a free series whose papers were still
      // being written and drafted it. So running the seed silently took the
      // paid series off sale and put "Coming Soon" on the pricing page.
    },
    create: {
      examId,
      name: 'KPSC KAS Prelims — Paid Test Series',
      slug: 'kas-prelims-paid-test-series',
      track: 'PAID_SERIES',
      iconName: 'ClipboardList',
      accentHex: '#ea580c',
      tagline: 'Full-length tests with detailed analysis and All India Ranking.',
      description:
        'Full-length mock tests modelled on the KAS Prelims pattern, each followed by a complete performance report: All India rank, percentile, subject and topic breakdowns, and a solution for every question.',
      difficulty: 'MIXED',
      // Published ladder: 199 for the first 50, 299 to 100, 399 thereafter.
      priceInPaise: 0,
      comparePriceInPaise: 0,
      tier1PriceInPaise: null,
      tier1Limit: null,
      tier2PriceInPaise: null,
      tier2Limit: null,
      accessDurationDays: 0,
      status: 'PUBLISHED',
      isFeatured: true,
      sortOrder: 2,
      featuresJson: JSON.stringify([
        'Full-length tests in the exact prelims pattern',
        'All India Ranking and percentile after every test',
        'Subject, chapter and topic level analysis',
        'Detailed solution for every question',
        'Compare each attempt against your own history',
      ]),
    },
    select: { id: true },
  });

  for (const entry of KAS_2026_SCHEDULE) {
    await upsertTest({
      slug: `kas-paid-${entry.no}`,
      title: entry.name,
      sortOrder: entry.no,
      seriesId: paid.id,
      category: entry.paperNumber === null ? 'SECTIONAL' : 'FULL_MOCK',
      accessType: 'FREE',
      durationMinutes: 120,
      paperNumber: entry.paperNumber ?? undefined,
      subjectId: entry.subject ? subjectIds.get(entry.subject) : undefined,
      // Explicitly null: the schedule is published as a study plan rather than
      // a lock, so a buyer can sit any paper whenever they are ready. Omitting
      // this would leave previously written dates in place.
      startDate: null,
      description: entry.syllabus,
    });
  }
  // Papers left behind when the timetable shortens. The published schedule
  // dropped from twelve tests to eleven — the standalone Current Affairs test
  // is now folded into every subject test — and kas-paid-12 would otherwise
  // stay on the site, dated and buyable, with nothing behind it.
  //
  // Soft-deleted rather than erased: if a paper already carries questions, an
  // admin wrote them, and they stay recoverable.
  const stale = await db.test.findMany({
    where: {
      testSeriesId: paid.id,
      deletedAt: null,
      slug: { startsWith: 'kas-paid-' },
      NOT: { slug: { in: KAS_2026_SCHEDULE.map((t) => `kas-paid-${t.no}`) } },
    },
    select: { id: true, slug: true, totalQuestions: true },
  });

  for (const test of stale) {
    await db.test.update({ where: { id: test.id }, data: { deletedAt: new Date() } });
    console.log(
      `  --  retired ${test.slug} (${test.totalQuestions} question(s)); no longer in the timetable`,
    );
  }

  console.log(`  ok  paid series + ${KAS_2026_SCHEDULE.length} scheduled tests (100 questions, 2 h)`);

  // --- 3. Previous year papers ------------------------------------------
  let pyqTests = 0;

  for (const [index, entry] of PYQ_YEARS.entries()) {
    const label = entry.session ? `${entry.session} ${entry.year}` : `${entry.year}`;
    const slug = entry.session
      ? `kas-pyq-${entry.year}-${slugify(entry.session)}`
      : `kas-pyq-${entry.year}`;

    const price = 0;
    const comparePrice = 0;
    const accessType = 'FREE';
    const tier1 = null;
    const tier2 = null;

    const series = await db.testSeries.upsert({
      where: { slug },
      update: {
        track: 'PYQ',
        examYear: entry.year,
        sessionLabel: entry.session ?? null,
        status: 'PUBLISHED',
        // Refreshed every run so a pricing change here reaches existing rows.
        priceInPaise: price,
        comparePriceInPaise: comparePrice,
        tier1PriceInPaise: tier1,
        tier1Limit: tier1 === null ? null : 50,
        tier2PriceInPaise: tier2,
        tier2Limit: tier2 === null ? null : 100,
      },
      create: {
        examId,
        name: `${label} KAS Prelims`,
        slug,
        track: 'PYQ',
        examYear: entry.year,
        sessionLabel: entry.session ?? null,
        iconName: 'CalendarDays',
        tagline: `Attempt the full-length ${label} paper or practise it subject by subject.`,
        description: `The complete ${label} KAS Preliminary examination, reproduced in the real exam format with the actual timing and marking scheme. Attempt the full paper end to end, or drill a single subject using only the questions from that subject in this paper.`,
        difficulty: 'MIXED',
        priceInPaise: price,
        comparePriceInPaise: comparePrice,
        tier1PriceInPaise: tier1,
        tier1Limit: tier1 === null ? null : 50,
        tier2PriceInPaise: tier2,
        tier2Limit: tier2 === null ? null : 100,
        accessDurationDays: 365,
        status: 'PUBLISHED',
        sortOrder: index + 1,
        featuresJson: JSON.stringify([
          'Genuine previous-year paper, reproduced verbatim',
          'Real exam timing and marking scheme',
          'Full-length attempt plus subject-wise practice',
          'Detailed solution for every question',
        ]),
      },
      select: { id: true },
    });

    // Full-length papers
    for (const paper of entry.papers) {
      await upsertTest({
        slug: `${slug}-paper-${paper}`,
        title: `${label} Full-Length PYQ Test — Paper ${paper}`,
        seriesId: series.id,
        category: 'PREVIOUS_YEAR',
        accessType,
        durationMinutes: 120,
        paperNumber: paper,
        description: `Complete ${label} KAS Prelims Paper ${paper}.`,
      });
      pyqTests += 1;
    }

    // Subject-wise practice drawn from the same paper
    for (const subject of KAS_SUBJECTS) {
      await upsertTest({
        slug: `${slug}-subject-${slugify(subject.name)}`,
        title: `${subject.name} — ${label}`,
        seriesId: series.id,
        category: 'TOPIC',
        accessType,
        // Sized to the subject's share of the paper, at roughly 1.2 min/question.
        durationMinutes: Math.max(10, Math.round(subject.questions * 1.2)),
        subjectId: subjectIds.get(subject.name),
        // Capped at two like every other test, per the course rules. Raise this
        // to 0 (unlimited) if subject drills should be freely repeatable.
        maxAttempts: 0,
        description: `Only the ${subject.name} questions from the ${label} paper.`,
        instructions: [
          `This test contains only the ${subject.name} questions from the ${label} KAS Prelims paper.`,
          '',
          `• Each question carries ${MARKS_PER_QUESTION} marks, with ${NEGATIVE_MARKS_PER_QUESTION} deducted for an incorrect answer.`,
          '• Unanswered questions carry no penalty.',
          '• Your answers save automatically as you go.',
        ].join('\n'),
      });
      pyqTests += 1;
    }
  }
  console.log(`  ok  ${PYQ_YEARS.length} PYQ papers + ${pyqTests} tests`);

  // --- 4. Chapterwise ----------------------------------------------------
  for (const [index, track] of CHAPTERWISE_TRACKS.entries()) {
    await db.testSeries.upsert({
      where: { slug: `chapterwise-${slugify(track.name)}` },
      update: {
        track: 'CHAPTERWISE',
        status: 'PUBLISHED',
        // As above: `set-pricing.ts` owns the price, and re-seeding must not
        // reset a series that is already on sale.
      },
      create: {
        examId,
        name: `${track.name} (${track.source})`,
        slug: `chapterwise-${slugify(track.name)}`,
        track: 'CHAPTERWISE',
        iconName: track.icon,
        accentHex: track.color,
        tagline: track.blurb,
        description: `${track.blurb} Work through the book chapter by chapter, with a test for each chapter and a running record of which chapters you have actually mastered.`,
        difficulty: 'INTERMEDIATE',
        priceInPaise: 0,
        comparePriceInPaise: 0,
        accessDurationDays: 0,
        status: 'PUBLISHED',
        sortOrder: index + 1,
        featuresJson: JSON.stringify([
          `Questions mapped to every chapter of ${track.source}`,
          'Attempt a chapter at a time, at your own pace',
          'Chapter-level mastery tracking',
          'Detailed solution for every question',
        ]),
      },
    });
  }
  console.log(`  ok  ${CHAPTERWISE_TRACKS.length} chapterwise subjects`);

  // The 2024 December Polity paper used to be force-filled here, with every
  // question whose code began "KAS-PYQ-2024". That matched both full-length
  // papers of both sittings — 191 August plus 195 December — so a subject
  // paper meant to hold the Polity questions of one sitting advertised 372,
  // and the questions in it were mostly not Polity at all.
  //
  // Because this runs on every deploy it also put them back each time, so
  // clearing the paper in the admin never held. The subject papers are filled
  // by importing their own PDFs, which is the only thing that knows which
  // questions actually belong to which subject.

  // Hide what has nothing behind it.
  //
  // Publishing structure before content exists is right for a fresh install and
  // wrong for a live site: a student browsing the catalogue met more empty tests
  // than full ones, and a series advertising twelve papers that all lead nowhere
  // reads as abandoned rather than forthcoming. Every row stays in place, so a
  // test republishes the moment it has questions.
  const hidden = await db.test.updateMany({
    where: { deletedAt: null, status: 'PUBLISHED', totalQuestions: 0 },
    data: { status: 'DRAFT' },
  });

  const published = await db.testSeries.findMany({
    where: { deletedAt: null, status: 'PUBLISHED' },
    select: {
      id: true,
      tests: { where: { deletedAt: null }, select: { totalQuestions: true } },
    },
  });
  const hollow = published.filter(
    (series) =>
      series.tests.length === 0 || series.tests.every((test) => test.totalQuestions === 0),
  );
  if (hollow.length > 0) {
    await db.testSeries.updateMany({
      where: { id: { in: hollow.map((s) => s.id) } },
      data: { status: 'DRAFT' },
    });
  }

  console.log(
    `\n  ${hidden.count} test(s) hidden until they have questions` +
      `${hollow.length > 0 ? `, along with ${hollow.length} empty series` : ''}.`,
  );
  console.log('\nDone. View at /courses\n');
}

main()
  .catch((error) => {
    console.error('\nCatalogue seed failed:\n', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
