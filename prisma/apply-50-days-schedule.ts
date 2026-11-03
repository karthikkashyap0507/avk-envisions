/**
 * Puts the published KAS 50 Days timetable onto the day papers.
 *
 * The papers were laid out by seed-50-days.ts as "Day N — 50 Questions" on
 * consecutive dates from whenever it was run. The real schedule has a fixed
 * start, a subject and key focus per day, and a paper number — all of which
 * the /50-days page already renders but nothing was setting.
 *
 * Only the timetable is touched: dates, titles, subject, paper number and the
 * briefing text. Questions already attached are left exactly as they are, so
 * this is safe to re-run after content has been written.
 *
 *   npx tsx prisma/apply-50-days-schedule.ts --dry-run
 *
 * Run with: npx tsx prisma/apply-50-days-schedule.ts
 */
import { PrismaClient } from '@prisma/client';

import { KAS_50_DAYS } from '../src/lib/data/kas-50-days-schedule';
import { DAILY_CHALLENGE_SLUG, DAILY_CHALLENGE_TEST_PREFIX } from '../src/lib/enums';
import { MARKS_PER_QUESTION, NEGATIVE_MARKS_PER_QUESTION } from '../src/lib/marking';

const db = new PrismaClient();
const DRY_RUN = process.argv.includes('--dry-run');

/** Days 41-50 are full papers. The rest are the daily fifty. */
function plannedQuestions(day: number): number {
  return day >= 41 ? 100 : 50;
}

/** A full paper runs the real two hours; a daily set is an hour. */
function durationMinutes(day: number): number {
  return day >= 41 ? 120 : 60;
}

async function main() {
  console.log(`\nApplying the KAS 50 Days timetable${DRY_RUN ? ' (dry run)' : ''}\n`);

  const series = await db.testSeries.findFirst({
    where: { slug: DAILY_CHALLENGE_SLUG },
    select: { id: true },
  });
  if (!series) {
    console.log(`  ${DAILY_CHALLENGE_SLUG} does not exist yet; run seed-50-days first.`);
    return;
  }

  // The KAS exam by slug, not "the first exam": there is more than one now.
  const exam = await db.exam.findFirst({ where: { slug: 'kas' }, select: { id: true } });
  if (!exam) throw new Error('No exam. Run the base seed first.');

  // Subjects are matched by name, so a rename in the catalogue would silently
  // leave days unbanded. Fail loudly instead. KAS subjects only: KEA FDA / SDA
  // has a "Geography" too, and matching across exams could pick that one.
  const subjects = await db.subject.findMany({
    where: { deletedAt: null, examId: exam.id },
    select: { id: true, name: true },
  });
  const subjectId = new Map(subjects.map((s) => [s.name, s.id]));

  const wanted = [...new Set(KAS_50_DAYS.map((d) => d.subject).filter(Boolean))] as string[];
  const missing = wanted.filter((name) => !subjectId.has(name));
  if (missing.length > 0) {
    throw new Error(
      `These subjects are in the timetable but not the catalogue: ${missing.join(', ')}`,
    );
  }

  // Days 37-50 have no single subject. They still need one to satisfy the
  // schema, so they take the first — the page reads `paperNumber` and the
  // title for those rows, not the subject.
  const fallbackSubjectId = subjects[0]!.id;

  let updated = 0;
  let created = 0;
  let withContent = 0;

  for (const day of KAS_50_DAYS) {
    const slug = `${DAILY_CHALLENGE_TEST_PREFIX}${String(day.day).padStart(2, '0')}`;
    // Parsed as UTC, not local. `new Date('2026-09-10T00:00:00')` is local
    // midnight, which in IST is 18:30 the previous day once stored — so every
    // paper unlocked a day early and the timetable read 9 Sep for day 1.
    const opensAt = new Date(`${day.date}T00:00:00Z`);
    const sid = day.subject ? subjectId.get(day.subject)! : fallbackSubjectId;

    const existing = await db.test.findFirst({
      where: { slug },
      select: { id: true, totalQuestions: true, startDate: true, title: true },
    });

    if (DRY_RUN) {
      const was = existing?.startDate
        ? existing.startDate.toISOString().slice(0, 10)
        : '—';
      console.log(
        `  ${existing ? 'update' : 'create'}  day ${String(day.day).padStart(2)}  ` +
          `${was} -> ${day.date}  P${day.paper}  ${day.focus.slice(0, 44)}`,
      );
      if (existing && existing.totalQuestions > 0) withContent += 1;
      continue;
    }

    const shared = {
      title: `Day ${day.day} — ${day.focus}`,
      description: day.topics,
      instructions: day.topics,
      startDate: opensAt,
      paperNumber: day.paper,
      subjectId: sid,
      durationMinutes: durationMinutes(day.day),
      testSeriesId: series.id,
    };

    if (existing) {
      // Content is deliberately untouched: totalQuestions reflects what is
      // actually attached, and overwriting it with the plan would make an
      // empty paper claim fifty questions.
      await db.test.update({ where: { id: existing.id }, data: shared });
      if (existing.totalQuestions > 0) withContent += 1;
      updated += 1;
    } else {
      await db.test.create({
        data: {
          ...shared,
          examId: exam.id,
          slug,
          category: 'PRACTICE',
          accessType: 'FREE',
          // Drafts until they have questions — hide-empty-tests.ts publishes
          // each one the moment its questions land.
          status: 'DRAFT',
          totalQuestions: 0,
          totalMarks: plannedQuestions(day.day) * MARKS_PER_QUESTION,
          negativeMarkingEnabled: true,
          defaultNegativeRatio: NEGATIVE_MARKS_PER_QUESTION / MARKS_PER_QUESTION,
          maxAttempts: 2,
        },
      });
      created += 1;
    }
  }

  if (DRY_RUN) {
    console.log(`\n  ${withContent} day(s) already have questions; their content is kept.`);
    return;
  }

  console.log(
    `\n  ${created} created, ${updated} re-dated.` +
      `\n  ${withContent} day(s) already had questions; their content was kept.` +
      `\n  Day 1 opens ${KAS_50_DAYS[0]!.date}, day 50 on ${KAS_50_DAYS[49]!.date}.\n`,
  );
}

main()
  .catch((error) => {
    console.error('\nFailed:\n', error?.message ?? error);
    process.exitCode = 1;
  })
  .finally(async () => db.$disconnect());
