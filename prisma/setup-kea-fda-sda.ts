/**
 * Lays out the KEA FDA / SDA Test Series from its published timetable.
 *
 * Creates, where missing:
 *
 *   - the KEA FDA / SDA exam and its subjects — its own exam, because it is
 *     marked differently from KAS and tests subjects KAS does not have;
 *   - the series, priced by `set-pricing.ts` like every other;
 *   - its fifteen tests: eleven sectional papers, then two Sundays of
 *     full-length mocks, Paper 1 in the morning and Paper 2 in the afternoon.
 *
 * The timetable below is the source of truth for each test's title, date and
 * order, so a rerun brings a changed date into line. Content is never touched:
 * attached questions, a test's status, and anything an admin has edited since —
 * duration, instructions — are left as they are.
 *
 * Tests are created unpublished. A paper reaches students only once an admin
 * attaches its questions, which `hide-empty-tests.ts` then publishes — the rule
 * the KAS series follow too.
 *
 *   npm run db:fda-sda -- --dry-run
 *
 * Run with: npm run db:fda-sda
 */
import { PrismaClient } from '@prisma/client';

import {
  FDA_SDA_EXAM_SLUG,
  FDA_SDA_SERIES_SLUG,
  FDA_SDA_TEST_PREFIX,
} from '../src/lib/enums';
import { FDA_SDA_MARKING, markingSchemeText } from '../src/lib/marking';

const db = new PrismaClient();
const DRY_RUN = process.argv.includes('--dry-run');

/** Every paper, sectional or mock: 100 questions in two hours. */
const QUESTIONS_PER_TEST = 100;
const DURATION_MINUTES = 120;

/**
 * The subjects, in syllabus order.
 *
 * The two full-length entries are for filing a whole mixed paper, as KAS has:
 * the importer applies one subject to everything it brings in, and a mock
 * covers all of them.
 */
const SUBJECTS = [
  { slug: 'history-and-culture', name: 'History and Culture' },
  { slug: 'geography', name: 'Geography' },
  { slug: 'constitution-polity-governance', name: 'Constitution, Polity and Governance' },
  { slug: 'economy', name: 'Economy' },
  { slug: 'general-science', name: 'General Science' },
  { slug: 'environment-ecology', name: 'Environment and Ecology' },
  { slug: 'quantitative-aptitude-reasoning', name: 'Quantitative Aptitude and Reasoning' },
  { slug: 'current-affairs-general-awareness', name: 'Current Affairs and General Awareness' },
  { slug: 'general-kannada', name: 'General Kannada' },
  { slug: 'general-english', name: 'General English' },
  { slug: 'computer-knowledge', name: 'Computer Knowledge' },
  { slug: 'full-length-paper-1', name: 'Full Length Paper 1', sortOrder: 101 },
  { slug: 'full-length-paper-2', name: 'Full Length Paper 2', sortOrder: 102 },
] as const;

interface Row {
  test: number;
  /** IST calendar date, as printed. */
  date: string;
  day: string;
  title: string;
  /** Subject slug for a sectional paper; the full-length subject for a mock. */
  subject: string;
  /** Set on the mocks: which paper of the day. */
  paper?: 1 | 2;
  session?: 'Morning' | 'Afternoon';
}

/** As printed in AVK_Envisions_KEA_FDA_SDA_Test_Series_Timetable_2026. */
const TIMETABLE: Row[] = [
  { test: 1, date: '2026-11-10', day: 'Tuesday', title: 'History and Culture', subject: 'history-and-culture' },
  { test: 2, date: '2026-11-14', day: 'Saturday', title: 'Geography', subject: 'geography' },
  {
    test: 3,
    date: '2026-11-18',
    day: 'Wednesday',
    title: 'Constitution, Polity and Governance',
    subject: 'constitution-polity-governance',
  },
  { test: 4, date: '2026-11-22', day: 'Sunday', title: 'Economy', subject: 'economy' },
  { test: 5, date: '2026-11-26', day: 'Thursday', title: 'General Science', subject: 'general-science' },
  { test: 6, date: '2026-11-30', day: 'Monday', title: 'Environment and Ecology', subject: 'environment-ecology' },
  {
    test: 7,
    date: '2026-12-04',
    day: 'Friday',
    title: 'Quantitative Aptitude and Reasoning',
    subject: 'quantitative-aptitude-reasoning',
  },
  {
    test: 8,
    date: '2026-12-08',
    day: 'Tuesday',
    title: 'Current Affairs and General Awareness',
    subject: 'current-affairs-general-awareness',
  },
  { test: 9, date: '2026-12-10', day: 'Thursday', title: 'General Kannada', subject: 'general-kannada' },
  { test: 10, date: '2026-12-12', day: 'Saturday', title: 'General English', subject: 'general-english' },
  { test: 11, date: '2026-12-14', day: 'Monday', title: 'Computer Knowledge', subject: 'computer-knowledge' },
  {
    test: 12,
    date: '2026-12-20',
    day: 'Sunday',
    title: 'Full-Length Mock Test 1 — Paper 1',
    subject: 'full-length-paper-1',
    paper: 1,
    session: 'Morning',
  },
  {
    test: 13,
    date: '2026-12-20',
    day: 'Sunday',
    title: 'Full-Length Mock Test 1 — Paper 2',
    subject: 'full-length-paper-2',
    paper: 2,
    session: 'Afternoon',
  },
  {
    test: 14,
    date: '2026-12-27',
    day: 'Sunday',
    title: 'Full-Length Mock Test 2 — Paper 1',
    subject: 'full-length-paper-1',
    paper: 1,
    session: 'Morning',
  },
  {
    test: 15,
    date: '2026-12-27',
    day: 'Sunday',
    title: 'Full-Length Mock Test 2 — Paper 2',
    subject: 'full-length-paper-2',
    paper: 2,
    session: 'Afternoon',
  },
];

/**
 * The moment a paper's date begins, as the KAS series store it.
 *
 * Midnight UTC, which is 5:30 AM in India, so a paper opens early on its own
 * day rather than at the stroke of midnight — and both papers of a Sunday open
 * together, as the KAS full-length simulations do, with the session named in
 * the description.
 */
function dateOf(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}

const INSTRUCTIONS = [
  'This paper follows the KEA FDA / SDA examination pattern.',
  '',
  `• ${QUESTIONS_PER_TEST} questions, 2 hours. Each question carries ${FDA_SDA_MARKING.marks} mark, for a total of ${QUESTIONS_PER_TEST * FDA_SDA_MARKING.marks}.`,
  `• ${FDA_SDA_MARKING.negativeMarks} marks are deducted for every incorrect answer. Unanswered questions carry no penalty.`,
  '• You may move freely between questions and mark any question for review.',
  '• Your answers save automatically. If your connection drops, resume and continue where you left off.',
  '• The timer runs on our servers, so closing the tab does not pause it. The paper is submitted automatically when time expires.',
].join('\n');

const FEATURES = [
  '11 sectional tests, one for each subject',
  '4 full-length mock tests: Paper 1 and Paper 2 on two Sundays',
  `${QUESTIONS_PER_TEST} questions, ${QUESTIONS_PER_TEST} marks and 2 hours per test`,
  `+${FDA_SDA_MARKING.marks} for a correct answer, −${FDA_SDA_MARKING.negativeMarks} for a wrong one`,
  'Questions based on recently conducted KEA examinations',
  'Score, solutions and analysis the moment you submit',
];

async function main() {
  console.log(`\nLaying out the KEA FDA / SDA Test Series${DRY_RUN ? ' (dry run)' : ''}...\n`);

  // A misprinted weekday is the cheapest sign the table was copied wrong.
  for (const row of TIMETABLE) {
    const printed = new Intl.DateTimeFormat('en-IN', { weekday: 'long', timeZone: 'Asia/Kolkata' }).format(
      dateOf(row.date),
    );
    if (printed !== row.day) {
      throw new Error(`Test ${row.test}: ${row.date} is a ${printed}, but the timetable says ${row.day}.`);
    }
    console.log(
      `  ${String(row.test).padStart(2)} ${row.date} ${row.day.padEnd(9)} ${row.title}` +
        (row.session ? `  (${row.session.toLowerCase()} session)` : ''),
    );
  }

  if (DRY_RUN) {
    console.log('\n  Nothing written.\n');
    return;
  }

  // --- Exam ----------------------------------------------------------------
  const exam =
    (await db.exam.findUnique({ where: { slug: FDA_SDA_EXAM_SLUG }, select: { id: true } })) ??
    (await db.exam.create({
      data: {
        slug: FDA_SDA_EXAM_SLUG,
        name: 'KEA FDA / SDA',
        shortName: 'FDA-SDA',
        category: 'STATE',
        description:
          'First Division Assistant and Second Division Assistant recruitment, conducted by the Karnataka Examinations Authority.',
        highlightsJson: JSON.stringify([
          { label: 'Papers', value: 'Paper 1 and Paper 2' },
          { label: 'Each paper', value: `${QUESTIONS_PER_TEST} questions · 2 hours` },
          {
            label: 'Marking',
            value: `+${FDA_SDA_MARKING.marks}, −${FDA_SDA_MARKING.negativeMarks}`,
          },
        ]),
        colorHex: '#6d28d9',
        isActive: true,
        sortOrder: 6,
      },
      select: { id: true },
    }));

  // --- Subjects ------------------------------------------------------------
  const subjectId = new Map<string, string>();
  for (const [index, subject] of SUBJECTS.entries()) {
    const row = await db.subject.upsert({
      where: { examId_slug: { examId: exam.id, slug: subject.slug } },
      create: {
        examId: exam.id,
        slug: subject.slug,
        name: subject.name,
        sortOrder: 'sortOrder' in subject ? subject.sortOrder : index + 1,
      },
      update: { name: subject.name, deletedAt: null },
      select: { id: true },
    });
    subjectId.set(subject.slug, row.id);
  }

  // --- Series --------------------------------------------------------------
  const existingSeries = await db.testSeries.findUnique({
    where: { slug: FDA_SDA_SERIES_SLUG },
    select: { id: true },
  });

  const series =
    existingSeries ??
    (await db.testSeries.create({
      data: {
        examId: exam.id,
        slug: FDA_SDA_SERIES_SLUG,
        name: 'KEA FDA / SDA Test Series',
        tagline:
          '11 sectional tests and 4 full-length mock tests, with questions based on recently conducted KEA examinations.',
        description:
          'A complete run-up to the KEA FDA and SDA examinations: one sectional test for each subject from 10 November, ' +
          'then two Sundays of full-length mocks — Paper 1 in the morning and Paper 2 in the afternoon — ' +
          'and a final revision window from 28 to 31 December.',
        track: 'KEA_FDA_SDA',
        difficulty: 'MIXED',
        iconName: 'Landmark',
        accentHex: '#6d28d9',
        // The live price is set by set-pricing.ts on every deploy; this is
        // only so the row is never briefly free between the two scripts.
        priceInPaise: 19900,
        accessDurationDays: 0,
        featuresJson: JSON.stringify(FEATURES),
        startDate: dateOf(TIMETABLE[0]!.date),
        endDate: dateOf('2026-12-31'),
        status: 'PUBLISHED',
        isFeatured: true,
        sortOrder: 0,
        seoTitle: 'KEA FDA / SDA Test Series 2026',
        seoDescription:
          'Prepare for KEA FDA and SDA 2026 with 11 sectional tests and 4 full-length mock tests in the real exam pattern — 100 questions, 2 hours, +1 / −0.25 marking.',
      },
      select: { id: true },
    }));

  // --- Tests ---------------------------------------------------------------
  let created = 0;
  let rescheduled = 0;
  let withContent = 0;

  for (const row of TIMETABLE) {
    const slug = `${FDA_SDA_TEST_PREFIX}${row.test}`;

    const schedule = {
      testSeriesId: series.id,
      title: row.title,
      description: row.session
        ? `${row.day} · ${row.session} session`
        : `${row.day} · Sectional test`,
      category: row.paper ? 'FULL_MOCK' : 'SECTIONAL',
      paperNumber: row.paper ?? null,
      subjectId: subjectId.get(row.subject) ?? null,
      startDate: dateOf(row.date),
      sortOrder: row.test,
    };

    const existing = await db.test.findUnique({
      where: { slug },
      select: { id: true, totalQuestions: true, instructions: true },
    });

    if (existing) {
      await db.test.update({
        where: { id: existing.id },
        data: {
          ...schedule,
          // Filled once, and then left to the admin.
          ...(existing.instructions?.trim() ? {} : { instructions: INSTRUCTIONS }),
        },
      });
      if (existing.totalQuestions > 0) withContent += 1;
      rescheduled += 1;
      continue;
    }

    await db.test.create({
      data: {
        ...schedule,
        examId: exam.id,
        slug,
        instructions: INSTRUCTIONS,
        accessType: 'PAID',
        // Draft until it has questions, so a test appears to students only
        // when there is something behind it.
        status: 'DRAFT',
        mode: 'EXAM',
        durationMinutes: DURATION_MINUTES,
        maxAttempts: 2,
        totalQuestions: 0,
        totalMarks: QUESTIONS_PER_TEST * FDA_SDA_MARKING.marks,
        passingMarks: Math.round(QUESTIONS_PER_TEST * FDA_SDA_MARKING.marks * 0.35),
        negativeMarkingEnabled: true,
        defaultNegativeRatio: FDA_SDA_MARKING.negativeMarks / FDA_SDA_MARKING.marks,
        showResultImmediately: true,
      },
    });
    created += 1;
  }

  console.log(
    `\n  Exam, ${SUBJECTS.length} subjects and the series are in place.` +
      `\n  ${created} test(s) created, ${rescheduled} rescheduled (${withContent} already have questions).` +
      `\n  Marking: ${markingSchemeText(FDA_SDA_MARKING)}` +
      `\n  Add questions at /admin/kea-fda-sda.\n`,
  );
}

main()
  .catch((error) => {
    console.error('\nFailed:\n', error?.message ?? error);
    process.exitCode = 1;
  })
  .finally(async () => db.$disconnect());
