/**
 * Times a paper at 1.2 minutes per question.
 *
 * That is the KAS Prelims pattern — 100 questions in 120 minutes — and it is
 * what the full-length papers already run at. The subject-wise, chapterwise
 * and free tests did not follow it: durations were fixed per subject and
 * ignored how long the paper actually was, so History ran 29 minutes whether
 * it held 35 questions or none, and the 2011 Current Affairs test gave 38
 * questions the same 14 minutes Geography got for 11.
 *
 * This replaces an earlier pass that read the rate as 1.2 SECONDS per
 * question. That put every one of these tests at the one-minute floor — a
 * 38-question paper allowing 1.6 seconds an answer, which auto-submits before
 * anyone can read the first line.
 *
 * Full-length papers are matched by the same rule and already satisfy it, so
 * they are left where they are. Tests with no questions yet keep what they
 * have: their count is unknown rather than zero, and timing them now would
 * only have to be undone when the questions land.
 *
 *   npm run db:pyq-durations -- --dry-run
 *
 * Run with: npm run db:pyq-durations
 */
import { PrismaClient } from '@prisma/client';

const db = new PrismaClient();
const DRY_RUN = process.argv.includes('--dry-run');

/** Minutes a student gets per question, from the real prelims pattern. */
const MINUTES_PER_QUESTION = 1.2;

/** No test can be shorter than this; the column is whole minutes. */
const FLOOR_MINUTES = 1;

export function durationFor(questionCount: number): number {
  return Math.max(FLOOR_MINUTES, Math.round(questionCount * MINUTES_PER_QUESTION));
}

async function main() {
  // Every paper a student drills on: the previous-year papers and their
  // subject splits, the chapterwise sets, and the free series.
  const tests = await db.test.findMany({
    where: {
      deletedAt: null,
      OR: [
        { testSeries: { slug: { startsWith: 'kas-pyq-' } } },
        { testSeries: { slug: { startsWith: 'chapterwise-' } } },
        { testSeries: { slug: 'kas-prelims-free-test-series' } },
      ],
    },
    select: { id: true, slug: true, durationMinutes: true, totalQuestions: true },
    orderBy: { slug: 'asc' },
  });

  const changes = tests
    .filter((test) => test.totalQuestions > 0)
    // A full-length paper keeps its 120 minutes. Timing it by its own count
    // would cut the ones holding 91 or 97 questions to 109 or 116, when the
    // whole point of a simulation is that it runs the length of the real
    // exam — a short paper there is a question the client has yet to add,
    // not a shorter sitting.
    .filter((test) => !/-paper-[12]$/.test(test.slug))
    .map((test) => ({ ...test, want: durationFor(test.totalQuestions) }))
    .filter((test) => test.want !== test.durationMinutes);

  const skipped = tests.filter((test) => test.totalQuestions === 0).length;

  console.log(
    `${tests.length} drill paper(s) · ${changes.length} to retime · ` +
      `${skipped} still empty, left as they are`,
  );

  for (const test of changes) {
    console.log(
      `  ${test.slug.padEnd(46)} ${String(test.durationMinutes).padStart(4)}m → ` +
        `${String(test.want).padStart(4)}m  (${test.totalQuestions} questions)`,
    );
  }

  if (DRY_RUN) {
    console.log('\nDry run: nothing was written.');
    return;
  }

  for (const test of changes) {
    await db.test.update({ where: { id: test.id }, data: { durationMinutes: test.want } });
  }

  console.log(`\nRetimed ${changes.length} tests.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => db.$disconnect());
