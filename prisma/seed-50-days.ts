/**
 * Creates the "50 Questions · 50 Days" challenge.
 *
 * Fifty papers, one per day, each 50 questions. Built from the ordinary series
 * and test models so every existing tool works on it unchanged — the admin
 * edits these papers, attaches questions, uploads an analysis PDF and reorders
 * them exactly as for any other test.
 *
 * Safe to re-run. Papers already carrying questions are left alone, so a rerun
 * after content has been added does not wipe it; only dates and titles are kept
 * in step.
 *
 *   npm run db:50days -- --dry-run
 *   npm run db:50days -- --start 2026-09-15
 *
 * Run with: npm run db:50days
 */
import { PrismaClient } from '@prisma/client';

import { MARKS_PER_QUESTION, NEGATIVE_MARKS_PER_QUESTION } from '../src/lib/marking';
import { DAILY_CHALLENGE_SLUG, DAILY_CHALLENGE_TEST_PREFIX } from '../src/lib/enums';

const db = new PrismaClient();
const DRY_RUN = process.argv.includes('--dry-run');

/**
 * How many day-papers to lay out.
 *
 * One by default. The public page only lists days that actually have questions,
 * so creating all fifty up front buys nothing and leaves forty-nine empty
 * drafts cluttering the admin console. Add more as the content is written:
 *
 *   npm run db:50days -- --days 10
 */
function dayCount(): number {
  const flag = process.argv.indexOf('--days');
  if (flag === -1) return 1;

  const value = Number(process.argv[flag + 1]);
  if (!Number.isInteger(value) || value < 1 || value > 50) {
    throw new Error('--days needs a whole number from 1 to 50');
  }
  return value;
}
const QUESTIONS_PER_DAY = 50;
const MINUTES_PER_DAY = 60;

/** Day one, from `--start YYYY-MM-DD`, else tomorrow. */
function startDate(): Date {
  const flag = process.argv.indexOf('--start');
  if (flag !== -1) {
    const value = process.argv[flag + 1];
    const parsed = value ? new Date(`${value}T00:00:00`) : null;
    if (parsed && !Number.isNaN(parsed.getTime())) return parsed;
    throw new Error('--start needs a date like 2026-09-15');
  }

  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(0, 0, 0, 0);
  return tomorrow;
}

async function main() {
  const day1 = startDate();
  const DAYS = dayCount();
  console.log(
    `\nSetting up 50 Questions · 50 Days${DRY_RUN ? ' (dry run)' : ''}` +
      `\n  day 1 opens ${day1.toDateString()}\n`,
  );

  // KAS by slug: with a second exam, "the first exam" is no longer KAS by
  // definition, and nor is the first subject.
  const exam = await db.exam.findFirst({ where: { slug: 'kas' }, select: { id: true } });
  const subject = exam
    ? await db.subject.findFirst({ where: { examId: exam.id }, select: { id: true } })
    : null;
  if (!exam || !subject) throw new Error('No exam or subject. Run the base seed first.');

  const series = await db.testSeries.upsert({
    where: { slug: DAILY_CHALLENGE_SLUG },
    create: {
      examId: exam.id,
      slug: DAILY_CHALLENGE_SLUG,
      name: 'KAS 50 Questions · 50 Days',
      description:
        'One 50-question paper every day for fifty days. Full syllabus coverage, ' +
        'answers and explanations the moment you finish, and your streak tracked throughout.',
      track: 'DAILY_CHALLENGE',
      priceInPaise: 0,
      status: 'PUBLISHED',
      difficulty: 'MIXED',
      sortOrder: 1,
    },
    // Price and status are left alone on re-run: whoever set them meant it.
    update: { track: 'DAILY_CHALLENGE', name: 'KAS 50 Questions · 50 Days' },
    select: { id: true },
  });

  let created = 0;
  let dated = 0;
  let skipped = 0;

  for (let day = 1; day <= DAYS; day++) {
    const slug = `${DAILY_CHALLENGE_TEST_PREFIX}${String(day).padStart(2, '0')}`;
    const opensAt = new Date(day1);
    opensAt.setDate(opensAt.getDate() + (day - 1));

    const existing = await db.test.findFirst({
      where: { slug },
      select: { id: true, totalQuestions: true },
    });

    if (DRY_RUN) {
      console.log(
        `  ${existing ? 'exists' : 'create'}  ${slug}  opens ${opensAt.toDateString()}`,
      );
      continue;
    }

    if (existing) {
      // Content is not touched — a rerun must not undo the work of attaching
      // questions. Only the schedule is brought back into line.
      await db.test.update({
        where: { id: existing.id },
        data: { startDate: opensAt, testSeriesId: series.id },
      });
      if (existing.totalQuestions > 0) skipped += 1;
      dated += 1;
      continue;
    }

    await db.test.create({
      data: {
        examId: exam.id,
        subjectId: subject.id,
        testSeriesId: series.id,
        slug,
        title: `Day ${day} — 50 Questions`,
        description: `Day ${day} of the fifty-day challenge.`,
        category: 'PRACTICE',
        accessType: 'FREE',
        // Drafts until they have questions: a published paper with nothing in
        // it is the one thing worse than a paper that is not there yet.
        status: 'DRAFT',
        mode: 'TIMED',
        durationMinutes: MINUTES_PER_DAY,
        totalQuestions: 0,
        totalMarks: QUESTIONS_PER_DAY * MARKS_PER_QUESTION,
        passingMarks: Math.round(QUESTIONS_PER_DAY * MARKS_PER_QUESTION * 0.35),
        negativeMarkingEnabled: true,
        defaultNegativeRatio: NEGATIVE_MARKS_PER_QUESTION / MARKS_PER_QUESTION,
        startDate: opensAt,
        sortOrder: day,
      },
    });
    created += 1;
  }

  if (DRY_RUN) {
    console.log(`\n  ${DAYS} days would be set up. Nothing written.\n`);
    return;
  }

  console.log(
    `\n  ${created} created, ${dated} rescheduled (${skipped} already have questions).` +
      `\n  Add questions at /admin/questions, then publish each day.\n`,
  );
}

main()
  .catch((error) => {
    console.error('\nFailed:\n', error?.message ?? error);
    process.exitCode = 1;
  })
  .finally(async () => db.$disconnect());
