/**
 * Adds the 2024 August Paper 1 questions recovered from the rebuilt edition.
 *
 * Twenty questions of this paper are unreadable in the analysis documents:
 * most print `ANSWER Option 2` with no option list above it, so there is
 * nothing to extract. They exist in the rebuilt "Clean Vertical Professional
 * Edition", whose text was supplied directly.
 *
 * The questions recovered from it are checked in beside this script, already
 * read into stem/options/key. They were not put through the general parser:
 * that parser infers where each question begins by tracking sequence, and
 * three separate attempts to teach it this layout each cost more questions
 * elsewhere than they recovered here. The rebuilt edition captions every
 * question, so reading it needs no inference at all.
 *
 * Only whole questions are taken: a stem, four printed options and a key that
 * was read rather than guessed. Nothing is reconstructed.
 *
 *   npm run db:2024aug:paste -- --dry-run
 */
import { readFile } from 'node:fs/promises';

import { PrismaClient } from '@prisma/client';

import { MARKS_PER_QUESTION, NEGATIVE_MARKS_PER_QUESTION } from '../src/lib/marking';

const db = new PrismaClient();
const DRY_RUN = process.argv.includes('--dry-run');

const TEST_SLUG = 'kas-pyq-2024-august-paper-1';
const SOURCE = 'prisma/data/2024-august-p1-recovered.json';

interface Pasted {
  number: number;
  stem: string;
  options: string[];
  /** Zero-based index of the keyed option. */
  correct: number;
}

async function main() {
  const questions: Pasted[] = JSON.parse(await readFile(SOURCE, 'utf8'));

  const test = await db.test.findFirst({
    where: { slug: TEST_SLUG, deletedAt: null },
    select: { id: true, examId: true, subjectId: true },
  });
  const admin = await db.user.findFirst({ where: { role: 'ADMIN' }, select: { id: true } });
  if (!test || !admin) throw new Error('The paper or an admin user is missing.');

  // What the paper already holds, so this only fills the gaps.
  const existing = await db.testQuestion.findMany({
    where: { testId: test.id },
    select: { question: { select: { code: true } } },
  });
  const have = new Set(
    existing
      .map((row) => /-Q(\d+)$/.exec(row.question.code ?? '')?.[1])
      .filter((n): n is string => Boolean(n))
      .map(Number),
  );

  const adding = questions.filter((q) => !have.has(q.number)).sort((a, b) => a.number - b.number);

  console.log(`\nPaper holds ${have.size} questions.`);
  console.log(`Pasted edition supplies ${questions.length}, of which ${adding.length} are new:`);
  console.log(`  ${adding.map((q) => q.number).join(', ')}\n`);

  if (DRY_RUN) {
    console.log('  Nothing written.\n');
    return;
  }

  // This exam's own subjects, so the fallback below cannot be another exam's.
  const subjects = await db.subject.findMany({ where: { examId: test.examId }, select: { id: true } });

  for (const q of adding) {
    const code = `${TEST_SLUG}-Q${q.number}`.toUpperCase();
    const data = {
      examId: test.examId,
      subjectId: test.subjectId ?? subjects[0]!.id,
      type: 'SINGLE_CORRECT',
      status: 'PUBLISHED',
      difficulty: 'MEDIUM',
      body: q.stem,
      marks: MARKS_PER_QUESTION,
      negativeMarks: NEGATIVE_MARKS_PER_QUESTION,
      source: 'KAS 2024 August previous year paper',
      code,
      createdById: admin.id,
    };

    const found = await db.question.findUnique({ where: { code }, select: { id: true } });
    let questionId: string;
    if (found) {
      await db.question.update({ where: { id: found.id }, data });
      await db.questionOption.deleteMany({ where: { questionId: found.id } });
      questionId = found.id;
    } else {
      questionId = (await db.question.create({ data, select: { id: true } })).id;
    }

    await db.questionOption.createMany({
      data: q.options.map((body, i) => ({
        questionId,
        label: String.fromCharCode(65 + i),
        body,
        isCorrect: i === q.correct,
        sortOrder: i,
      })),
    });

    await db.testQuestion.create({
      data: {
        testId: test.id,
        questionId,
        sortOrder: q.number,
        marks: MARKS_PER_QUESTION,
        negativeMarks: NEGATIVE_MARKS_PER_QUESTION,
      },
    });
  }

  // The paper is ordered by printed number, so a late arrival sits in its own
  // place rather than at the end.
  const rows = await db.testQuestion.findMany({
    where: { testId: test.id },
    select: { id: true, question: { select: { code: true } } },
  });
  const numbered = rows
    .map((row) => ({ id: row.id, n: Number(/-Q(\d+)$/.exec(row.question.code ?? '')?.[1] ?? 0) }))
    .sort((a, b) => a.n - b.n);
  for (const [i, row] of numbered.entries()) {
    await db.testQuestion.update({ where: { id: row.id }, data: { sortOrder: i + 1 } });
  }

  await db.test.update({
    where: { id: test.id },
    data: {
      totalQuestions: numbered.length,
      totalMarks: numbered.length * MARKS_PER_QUESTION,
      passingMarks: Math.round(numbered.length * MARKS_PER_QUESTION * 0.35),
    },
  });

  console.log(`  ${adding.length} added. The paper now holds ${numbered.length} questions.\n`);
}

main()
  .catch((error) => {
    console.error('\nFailed:\n', error?.message ?? error);
    process.exitCode = 1;
  })
  .finally(async () => db.$disconnect());
