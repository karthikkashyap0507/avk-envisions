/**
 * Rebuilds 2024 August Paper 1 from both supplied documents.
 *
 * The paper exists in two revisions and neither is complete on its own. The
 * original carries the answer key for most items but omits the statement lists
 * from several; the newer one prints those statements but stalls partway and
 * mangles others. Read separately they give 72 and 50 usable questions; read
 * together, 80.
 *
 * A question is taken from whichever document parsed it cleanly, preferring the
 * newer file where both did — it is the corrected revision. Nothing is
 * combined *within* a question: a stem from one file and options from another
 * would be a question neither document actually asks.
 *
 *   npm run db:2024aug -- --dry-run
 *
 * Run with: npm run db:2024aug -- --new <path to the newer pdf>
 */
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

import { PrismaClient } from '@prisma/client';
import { extractText, getDocumentProxy } from 'unpdf';

import { MARKS_PER_QUESTION, NEGATIVE_MARKS_PER_QUESTION } from '../src/lib/marking';
import { parsePyqAnalysis, type ParsedPyqQuestion } from '../src/server/services/pyq-analysis-parser';
import { synopsisDir } from '../src/server/services/synopsis-service';

const db = new PrismaClient();
const DRY_RUN = process.argv.includes('--dry-run');

const TEST_SLUG = 'kas-pyq-2024-august-paper-1';

/** The newer document, from `--new`, else the usual drop location. */
function newerFile(): string {
  const flag = process.argv.indexOf('--new');
  if (flag !== -1 && process.argv[flag + 1]) return path.resolve(process.argv[flag + 1]!);
  return '/tmp/KAS_2024_August_Paper1.pdf';
}

/** The document already installed as this test's analysis. */
function originalFile(): string {
  return path.join(synopsisDir(), `${TEST_SLUG}.pdf`);
}

async function parseFile(file: string): Promise<ParsedPyqQuestion[]> {
  const { text } = await extractText(
    await getDocumentProxy(new Uint8Array(await readFile(file))),
    { mergePages: true },
  );
  return parsePyqAnalysis(String(text)).questions;
}

/** Usable means: every option present, and an answer that was read, not guessed. */
function usable(question: ParsedPyqQuestion): boolean {
  return question.warnings.length === 0 && question.correctIndex !== null;
}

async function main() {
  console.log(`\nRebuilding 2024 August Paper 1${DRY_RUN ? ' (dry run)' : ''}...\n`);

  const newer = newerFile();
  const original = originalFile();

  const haveNewer = Boolean(await stat(newer).catch(() => null));
  if (!haveNewer) {
    throw new Error(`No file at ${newer}. Pass --new <path>.`);
  }

  const [fromNew, fromOld] = await Promise.all([parseFile(newer), parseFile(original)]);

  // Newer first: where both read a question, the corrected revision wins.
  const chosen = new Map<number, { question: ParsedPyqQuestion; source: string }>();
  for (const q of fromOld.filter(usable)) chosen.set(q.number, { question: q, source: 'original' });
  for (const q of fromNew.filter(usable)) chosen.set(q.number, { question: q, source: 'revised' });

  const numbers = [...chosen.keys()].sort((a, b) => a - b);
  const fromRevised = numbers.filter((n) => chosen.get(n)?.source === 'revised').length;

  const missing: number[] = [];
  for (let n = 1; n <= 100; n++) if (!chosen.has(n)) missing.push(n);

  console.log(`  original document : ${fromOld.filter(usable).length} usable`);
  console.log(`  revised document  : ${fromNew.filter(usable).length} usable`);
  console.log(`  combined          : ${numbers.length} (${fromRevised} from the revision)\n`);

  if (missing.length > 0) {
    console.log(
      `  ${missing.length} question(s) neither document yields: ${missing.join(', ')}\n` +
        '  These are missing their options or their key in both files and have to be\n' +
        '  entered by hand at /admin/questions.\n',
    );
  }

  if (DRY_RUN) {
    console.log('  Nothing written.\n');
    return;
  }

  const admin = await db.user.findFirst({ where: { role: 'ADMIN' }, select: { id: true } });
  const test = await db.test.findFirst({
    where: { slug: TEST_SLUG, deletedAt: null },
    select: { id: true, examId: true, subjectId: true },
  });
  if (!admin || !test) throw new Error('Admin or the 2024 August Paper 1 test is missing.');

  // This exam's subjects only: KEA FDA / SDA shares names such as "Geography".
  const subjects = await db.subject.findMany({
    where: { examId: test.examId },
    select: { id: true, name: true },
  });

  // Detached, not deleted: a question with a recorded attempt has to survive so
  // a student's result page still resolves.
  await db.testQuestion.deleteMany({ where: { testId: test.id } });

  const ids: string[] = [];
  for (const n of numbers) {
    const { question } = chosen.get(n)!;
    const code = `${TEST_SLUG}-Q${n}`.toUpperCase();

    const data = {
      examId: test.examId,
      subjectId: test.subjectId ?? subjects[0]!.id,
      type: 'SINGLE_CORRECT',
      status: 'PUBLISHED',
      difficulty: 'MEDIUM',
      body: question.stem,
      explanation: question.explanation,
      marks: MARKS_PER_QUESTION,
      negativeMarks: NEGATIVE_MARKS_PER_QUESTION,
      source: 'KAS 2024 August previous year paper',
      code,
      createdById: admin.id,
    };

    const existing = await db.question.findUnique({ where: { code }, select: { id: true } });
    let questionId: string;
    if (existing) {
      await db.question.update({ where: { id: existing.id }, data });
      await db.questionOption.deleteMany({ where: { questionId: existing.id } });
      questionId = existing.id;
    } else {
      questionId = (await db.question.create({ data, select: { id: true } })).id;
    }

    await db.questionOption.createMany({
      data: question.options.map((option, i) => ({
        questionId,
        label: String.fromCharCode(65 + i),
        body: option.text,
        isCorrect: i === question.correctIndex,
        sortOrder: i,
      })),
    });

    ids.push(questionId);
  }

  await db.testQuestion.createMany({
    data: ids.map((questionId, i) => ({
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
      totalQuestions: ids.length,
      totalMarks: ids.length * MARKS_PER_QUESTION,
      passingMarks: Math.round(ids.length * MARKS_PER_QUESTION * 0.35),
    },
  });

  console.log(`  ${ids.length} questions written to the paper.\n`);
}

main()
  .catch((error) => {
    console.error('\nFailed:\n', error?.message ?? error);
    process.exitCode = 1;
  })
  .finally(async () => db.$disconnect());
