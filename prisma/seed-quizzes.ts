/**
 * Creates the quiz series, and a starter quiz if there is none.
 *
 * A quiz is an ordinary test with category QUIZ, so nothing here is special —
 * it exists so `/quiz` and `/admin/quiz` have somewhere to put things on a
 * fresh database, rather than an admin having to build the series by hand
 * before their first quiz.
 *
 * Safe to re-run: an existing series and existing quizzes are left alone.
 *
 *   npx tsx prisma/seed-quizzes.ts
 */
import { PrismaClient } from '@prisma/client';

import { QUIZ_SERIES_SLUG } from '../src/lib/enums';
import { MARKS_PER_QUESTION } from '../src/lib/marking';

const db = new PrismaClient();
const DRY_RUN = process.argv.includes('--dry-run');

async function main() {
  console.log(`\nSetting up quizzes${DRY_RUN ? ' (dry run)' : ''}\n`);

  // KAS by slug: with a second exam, "the first exam" is not KAS by definition.
  const exam = await db.exam.findFirst({ where: { slug: 'kas' }, select: { id: true } });
  if (!exam) throw new Error('No exam. Run the base seed first.');

  let series = await db.testSeries.findFirst({
    where: { slug: QUIZ_SERIES_SLUG },
    select: { id: true },
  });

  if (!series) {
    console.log(`  ${DRY_RUN ? 'would create' : 'created'}  series ${QUIZ_SERIES_SLUG}`);
    if (!DRY_RUN) {
      series = await db.testSeries.create({
        data: {
          examId: exam.id,
          slug: QUIZ_SERIES_SLUG,
          name: 'AVK Quizzes',
          tagline: 'Short quizzes to test yourself between papers',
          description:
            'Quick quizzes drawn from their own question set — separate from the test ' +
            'series, and free to attempt as often as you like.',
          track: 'FREE_SERIES',
          priceInPaise: 0,
          status: 'PUBLISHED',
          difficulty: 'MIXED',
          sortOrder: 90,
        },
        select: { id: true },
      });
    }
  } else {
    console.log(`  --  series ${QUIZ_SERIES_SLUG} already exists`);
  }

  if (DRY_RUN || !series) return;

  const existing = await db.test.count({ where: { category: 'QUIZ', deletedAt: null } });
  if (existing > 0) {
    console.log(`  --  ${existing} quiz(zes) already exist; nothing else to do`);
    return;
  }

  // An empty first quiz, ready for questions. Left as a draft: it appears in
  // the admin immediately, and reaches students only once it has questions and
  // someone publishes it.
  const subject = await db.subject.findFirst({ where: { examId: exam.id }, select: { id: true } });
  await db.test.create({
    data: {
      examId: exam.id,
      subjectId: subject?.id,
      testSeriesId: series.id,
      slug: 'quiz-1',
      title: 'Quiz 1',
      description: 'A short quiz to start with. Add questions and publish it.',
      category: 'QUIZ',
      accessType: 'FREE',
      status: 'DRAFT',
      durationMinutes: 10,
      totalQuestions: 0,
      totalMarks: 10 * MARKS_PER_QUESTION,
      // Unlimited: a quiz is for practice, not ranking.
      maxAttempts: 0,
      showResultImmediately: true,
    },
  });
  console.log('  created  quiz-1 (draft, no questions yet)');
}

main()
  .catch((error) => {
    console.error('\nFailed:\n', error?.message ?? error);
    process.exitCode = 1;
  })
  .finally(async () => db.$disconnect());
