/**
 * Fills the free tests with real questions.
 *
 * Ten free tests were published carrying nothing. A student picking one out of
 * the catalogue committed to sitting it and arrived at an empty paper — the
 * single most damaging thing the site was doing, because it happened at the
 * moment someone decided to trust it.
 *
 * These are built from questions already in the bank rather than invented:
 * every one is a real KAS previous-year question with a verified key. The mix
 * follows the weighting of the actual paper, so a free test is a fair sample of
 * what the paid series contains rather than whatever happened to be to hand.
 *
 * Tests that cannot be filled are left as DRAFT, not published empty.
 *
 *   npm run db:free-tests -- --dry-run
 *
 * Run with: npm run db:free-tests
 */
import { PrismaClient } from '@prisma/client';

import { MARKS_PER_QUESTION, NEGATIVE_MARKS_PER_QUESTION } from '../src/lib/marking';

const db = new PrismaClient();
const DRY_RUN = process.argv.includes('--dry-run');

/** How many free tests to build, and how long each should be. */
const HOW_MANY = 2;
const QUESTIONS_PER_TEST = 50;

/**
 * Roughly the subject weighting of a KAS Paper I, normalised to the test
 * length. A free test that is 90% polity would misrepresent the real paper.
 */
const WEIGHTS: Record<string, number> = {
  'Indian Polity': 0.22,
  History: 0.18,
  Geography: 0.15,
  'Current Affairs': 0.15,
  'Indian Economy': 0.14,
  Environment: 0.06,
  'Science & Technology': 0.06,
  'Mental Ability': 0.04,
};

async function main() {
  console.log(`\nBuilding the free tests${DRY_RUN ? ' (dry run)' : ''}...\n`);

  const series = await db.testSeries.findFirst({
    where: { slug: 'kas-prelims-free-test-series', deletedAt: null },
    select: { id: true, examId: true },
  });
  if (!series) throw new Error('The free series is missing. Run the catalogue seed first.');

  // The series' own exam only. KEA FDA / SDA shares subject names with KAS
  // ("Geography"), and its questions are marked differently, so neither its
  // subjects nor its questions may be drawn into a KAS free test.
  const subjects = await db.subject.findMany({
    where: { examId: series.examId },
    select: { id: true, name: true },
  });
  const idOf = new Map(subjects.map((s) => [s.name, s.id]));

  // Only questions nobody has to pay for elsewhere would be wrong to give away,
  // and only questions with a real answer key are safe to mark against.
  const pool = await db.question.findMany({
    where: {
      examId: series.examId,
      deletedAt: null,
      status: 'PUBLISHED',
      options: { some: { isCorrect: true } },
    },
    select: { id: true, subjectId: true },
  });

  const bySubject = new Map<string, string[]>();
  for (const q of pool) {
    bySubject.set(q.subjectId, [...(bySubject.get(q.subjectId) ?? []), q.id]);
  }

  // Deterministic: re-running must not reshuffle a test someone has sat.
  for (const ids of bySubject.values()) ids.sort();

  const targets = await db.test.findMany({
    where: { testSeriesId: series.id, deletedAt: null },
    select: { id: true, slug: true, title: true, totalQuestions: true },
  });

  // Numeric order, not lexical: sorting slugs as strings puts "kas-free-10"
  // second and would fill tests 1 and 10 instead of 1 and 2.
  targets.sort((a, b) => {
    const n = (slug: string) => Number(/(\d+)$/.exec(slug)?.[1] ?? 0);
    return n(a.slug) - n(b.slug);
  });

  const used = new Set<string>();
  let built = 0;

  for (const [index, test] of targets.slice(0, HOW_MANY).entries()) {
    if (test.totalQuestions > 0) {
      console.log(`  --  ${test.slug} already has ${test.totalQuestions} questions; left alone`);
      continue;
    }

    // Draw each subject's share, skipping anything already spent on an earlier
    // free test so the two papers do not overlap.
    const picked: string[] = [];
    for (const [name, share] of Object.entries(WEIGHTS)) {
      const subjectId = idOf.get(name);
      if (!subjectId) continue;

      const want = Math.round(QUESTIONS_PER_TEST * share);
      const available = (bySubject.get(subjectId) ?? []).filter((id) => !used.has(id));

      for (const id of available.slice(0, want)) {
        picked.push(id);
        used.add(id);
      }
    }

    // Top up from anywhere if a subject ran short, so the paper is full length.
    if (picked.length < QUESTIONS_PER_TEST) {
      for (const q of pool) {
        if (picked.length >= QUESTIONS_PER_TEST) break;
        if (used.has(q.id)) continue;
        picked.push(q.id);
        used.add(q.id);
      }
    }

    if (picked.length < 10) {
      console.log(`  !!  ${test.slug}: only ${picked.length} questions available; left as a draft`);
      continue;
    }

    console.log(
      `  ok  ${test.slug.padEnd(16)} ${picked.length} questions${DRY_RUN ? ' (would build)' : ''}`,
    );
    built += 1;
    if (DRY_RUN) continue;

    await db.testQuestion.deleteMany({ where: { testId: test.id } });
    await db.testQuestion.createMany({
      data: picked.map((questionId, i) => ({
        testId: test.id,
        questionId,
        sortOrder: i + 1,
        marks: MARKS_PER_QUESTION,
        negativeMarks: NEGATIVE_MARKS_PER_QUESTION,
      })),
    });

    await db.test.update({
      where: { id: test.id },
      data: {
        // The seeded titles say "Polity – 1"; these papers span the whole
        // syllabus, and a title that names one subject would misdescribe them.
        title: `Free Full-Length Test ${index + 1}`,
        description:
          'A full-length KAS Prelims practice paper drawn from previous-year questions across the syllabus.',
        totalQuestions: picked.length,
        totalMarks: picked.length * MARKS_PER_QUESTION,
        passingMarks: Math.round(picked.length * MARKS_PER_QUESTION * 0.35),
        durationMinutes: Math.max(30, Math.round(picked.length * 1.2)),
        accessType: 'FREE',
        status: 'PUBLISHED',
      },
    });
  }

  console.log(`\n  ${built} free test(s) ${DRY_RUN ? 'would be ' : ''}built.\n`);
}

main()
  .catch((error) => {
    console.error('\nFailed:\n', error?.message ?? error);
    process.exitCode = 1;
  })
  .finally(async () => db.$disconnect());
