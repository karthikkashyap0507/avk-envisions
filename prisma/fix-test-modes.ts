/**
 * Settles any test `mode` the validator no longer accepts.
 *
 * `mode` is a plain string column with no constraint behind it, so a value
 * from an earlier vocabulary survives in the database indefinitely. Saving a
 * KAS-50 day paper failed with
 *
 *   Invalid enum value. Expected 'EXAM' | 'PRACTICE', received 'TIMED'
 *
 * because the builder has no mode field: it loads whatever is stored, carries
 * it invisibly through the form and posts it back on save. There was nothing
 * an admin could change to get past it.
 *
 * Everything that is not already PRACTICE becomes EXAM, which is what these
 * papers were doing anyway — `revealAnswers` is true only for PRACTICE, so a
 * paper stored as TIMED already ran as an exam. Nothing about how a test
 * behaves changes here; the stored word catches up with the behaviour.
 *
 *   npm run db:fix-modes -- --dry-run
 *
 * Run with: npm run db:fix-modes
 */
import { PrismaClient } from '@prisma/client';

const db = new PrismaClient();
const DRY_RUN = process.argv.includes('--dry-run');

/** The only values the validator accepts. */
const VALID = ['EXAM', 'PRACTICE'];

async function main() {
  const rows = await db.$queryRawUnsafe<{ id: string; slug: string; mode: string }[]>(
    `SELECT id, slug, mode FROM tests WHERE mode NOT IN ('EXAM', 'PRACTICE')`,
  );

  console.log(`\n${rows.length} test(s) hold a mode outside ${VALID.join(' / ')}.\n`);

  for (const row of rows) {
    console.log(`  ${row.slug.padEnd(40)} ${row.mode} → EXAM`);
  }

  if (rows.length === 0) {
    console.log('  Nothing to change.\n');
    return;
  }

  if (DRY_RUN) {
    console.log('\nDry run: nothing was written.\n');
    return;
  }

  // PRACTICE is never assigned here. A paper that should reveal answers as it
  // goes is a deliberate choice, and guessing it from a stale value would
  // quietly turn an exam into an open-book one.
  const result = await db.$executeRawUnsafe(
    `UPDATE tests SET mode = 'EXAM' WHERE mode NOT IN ('EXAM', 'PRACTICE')`,
  );

  console.log(`\nSettled ${result} test(s) to EXAM.\n`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => db.$disconnect());
