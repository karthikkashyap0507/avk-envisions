/**
 * Replaces Free Test 1 with the supplied premium synopsis paper.
 *
 * The source is the "25 Most Probable Questions" synopsis: each item carries a
 * heading, four statements, four options, a keyed answer, an explanation and a
 * core-concept briefing. The document doubles as the analysis PDF a student
 * reads afterwards, so the same file is installed as the test's synopsis.
 *
 * Existing questions are detached rather than deleted — anything with a
 * recorded attempt has to survive so a student's result page still resolves.
 *
 *   npm run db:free-test-1 -- --dry-run
 *
 * Run with: npm run db:free-test-1
 */
import { copyFile, mkdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

import { PrismaClient } from '@prisma/client';
import { extractText, getDocumentProxy } from 'unpdf';

import { MARKS_PER_QUESTION, NEGATIVE_MARKS_PER_QUESTION } from '../src/lib/marking';
import { synopsisDir } from '../src/server/services/synopsis-service';

const db = new PrismaClient();
const DRY_RUN = process.argv.includes('--dry-run');

/** Which free test to fill, from `--test`. Defaults to the first. */
function testSlug(): string {
  const flag = process.argv.indexOf('--test');
  const value = flag === -1 ? null : process.argv[flag + 1];
  return value && /^kas-free-\d+$/.test(value) ? value : 'kas-free-1';
}

const TEST_SLUG = testSlug();

/** The PDF, from `--file` or the default drop location. */
function sourceFile(): string {
  const flag = process.argv.indexOf('--file');
  if (flag !== -1 && process.argv[flag + 1]) return path.resolve(process.argv[flag + 1]!);
  return path.resolve('.drive/free-test-1.pdf');
}

/**
 * Subject headings the document uses, in its own order.
 *
 * The paper is arranged Current Affairs → Polity → History → Geography →
 * Economy, and each heading is printed alone on its line.
 */
const SUBJECT_HEADINGS: Record<string, string> = {
  'CURRENT AFFAIRS': 'Current Affairs',
  POLITY: 'Indian Polity',
  HISTORY: 'History',
  GEOGRAPHY: 'Geography',
  ECONOMY: 'Indian Economy',
};

/**
 * Questions the source document itself marks as needing review, by number.
 */
const REVIEW_NOTES: Record<number, string> = {
  25:
    'Source flags this: statement 3 states the formula for Primary Deficit ' +
    '(Fiscal Deficit − Interest Payments), not Revenue Deficit. The key marks it ' +
    'correct. Verify before this counts towards a student’s score.',
};

interface Parsed {
  number: number;
  heading: string;
  stem: string;
  options: string[];
  correctIndex: number | null;
  explanation: string;
  subject: string;
}

/** `1. India-France Innovation Roadmap 2030` — a numbered question heading. */
const HEADING = /^(\d{1,2})\.\s+(.{4,120})$/;
/** `A. 1 and 2 only` or `(A) 1 and 2 only` — both papers are in use. */
const OPTION = /^\(?([A-D])[).]\s+(.+)$/;
/** `ANSWER: B. 1, 2 and 3 only` or `ANSWER: C` */
const ANSWER = /^ANSWER:\s*([A-D])\b/i;

/**
 * Whether the line after `index` begins a question stem.
 *
 * This is what tells a question heading apart from a numbered statement, since
 * the two are written identically.
 */
const STEM_OPENER = /^(Consider the following|Which of the|How many of the|Study the following|With reference to|Arrange the following|Match the following)/i;

function nextOpensStem(lines: string[], index: number): boolean {
  const line = lines[index] ?? '';
  const next = lines[index + 1] ?? '';

  // Two layouts are in use. Paper 1 prints a short title and the stem beneath
  // it; Paper 2 puts the stem straight after the number. Accepting only the
  // first read nothing at all from Paper 2.
  const titleThenStem = STEM_OPENER.test(next);
  const numberThenStem = STEM_OPENER.test(line.replace(/^\d{1,2}\.\s+/, ''));

  return titleThenStem || numberThenStem;
}

/** Page furniture that would otherwise land inside a question. */
const FURNITURE =
  /^(AVK Envisions|AVK ENVISIONS|Page \d+|\d+$|SECTION FLOW|REVISION FORMAT|25 MOST PROBABLE|PAPER 1 •)/;

function parse(text: string): Parsed[] {
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && !FURNITURE.test(line));

  const found: Parsed[] = [];
  let current: Parsed | null = null;
  // Tracked separately from `found.length`: a question is only pushed once its
  // options parse, so counting completed ones made the next heading's number
  // fail to match and stalled the parse after the first question.
  let expected = 1;
  let subject = 'Current Affairs';
  let mode: 'STEM' | 'OPTIONS' | 'ANSWER' | 'AFTER' = 'STEM';

  const push = () => {
    if (current && current.options.length >= 2) found.push(current);
  };

  for (const [index, line] of lines.entries()) {
    const asSubject = SUBJECT_HEADINGS[line.toUpperCase()];
    if (asSubject) {
      subject = asSubject;
      continue;
    }

    const heading = HEADING.exec(line);
    // A question heading and a numbered statement look identical — both are
    // "N. text". What separates them is what comes next: a heading is followed
    // by the stem ("Consider the following statements…"), a statement is not.
    // Matching on the number alone read statement 1 of each question as the
    // start of a new one and truncated the paper to five questions.
    const opensQuestion =
      heading !== null && Number(heading[1]) === expected && nextOpensStem(lines, index);

    if (opensQuestion && heading) {
      push();
      expected += 1;
      current = {
        number: Number(heading[1]),
        heading: heading[2]!.trim(),
        stem: '',
        options: [],
        correctIndex: null,
        explanation: '',
        subject,
      };
      mode = 'STEM';
      continue;
    }

    if (!current) {
      if (heading && Number(heading[1]) === 1 && nextOpensStem(lines, index)) {
        expected = 2;
        current = {
          number: 1,
          heading: heading[2]!.trim(),
          stem: '',
          options: [],
          correctIndex: null,
          explanation: '',
          subject,
        };
        mode = 'STEM';
      }
      continue;
    }

    // `ANSWER: B …` on one line, or a bare `ANSWER` with the key beneath it.
    // Paper 2 uses the second form, so matching only the first read every one
    // of its questions with no key and discarded all twenty.
    if (/^ANSWER\s*:?\s*$/i.test(line)) {
      mode = 'ANSWER';
      continue;
    }

    if (mode === 'ANSWER') {
      const bare = /^\(?([A-D])[).]?\s/.exec(line) ?? /^\(?([A-D])\)?$/.exec(line);
      if (bare) current.correctIndex = bare[1]!.toUpperCase().charCodeAt(0) - 65;
      mode = 'AFTER';
      continue;
    }

    const answer = ANSWER.exec(line);
    if (answer) {
      current.correctIndex = answer[1]!.toUpperCase().charCodeAt(0) - 65;
      mode = 'AFTER';
      continue;
    }

    const option = OPTION.exec(line);
    if (option && (mode === 'STEM' || mode === 'OPTIONS')) {
      const index = option[1]!.charCodeAt(0) - 65;
      if (index === current.options.length) {
        current.options.push(option[2]!.trim());
        mode = 'OPTIONS';
        continue;
      }
    }

    if (mode === 'STEM') {
      current.stem += (current.stem ? '\n' : '') + line;
    } else if (mode === 'AFTER') {
      // Everything after the key is commentary; the explanation is the useful
      // part and the rest is briefing a student reads in the PDF itself.
      if (/^(EXPLANATION)$/i.test(line)) continue;
      if (/^(CORE CONCEPT|KPSC RELEVANCE|IMPORTANT SOURCE CHECK)/i.test(line)) {
        mode = 'OPTIONS'; // stop collecting; nothing more is wanted
        continue;
      }
      current.explanation += (current.explanation ? ' ' : '') + line;
    }
  }

  push();
  return found;
}

async function main() {
  const file = sourceFile();
  console.log(`\nImporting Free Test 1${DRY_RUN ? ' (dry run)' : ''}\n  from ${file}\n`);

  if (!(await stat(file).catch(() => null))) {
    throw new Error(`No file at ${file}. Pass --file <path>.`);
  }

  const { text } = await extractText(
    await getDocumentProxy(new Uint8Array(await readFile(file))),
    { mergePages: true },
  );

  const questions = parse(String(text));
  const usable = questions.filter((q) => q.correctIndex !== null && q.options.length === 4);

  console.log(`  parsed ${questions.length}, usable ${usable.length}`);
  for (const q of usable) {
    console.log(
      `   ${String(q.number).padStart(2)}. [${q.subject}] ${q.heading.slice(0, 46)} → ${String.fromCharCode(65 + q.correctIndex!)}`,
    );
  }

  if (usable.length < 10) {
    throw new Error('Too few questions parsed — the document layout is not what this expects.');
  }
  if (DRY_RUN) {
    console.log('\n  Nothing written.\n');
    return;
  }

  const admin = await db.user.findFirst({ where: { role: 'ADMIN' }, select: { id: true } });
  const test = await db.test.findFirst({
    where: { slug: TEST_SLUG, deletedAt: null },
    select: { id: true, examId: true },
  });
  if (!admin || !test) throw new Error('Admin or free test 1 is missing. Run the seeds first.');

  // This exam's subjects only: KEA FDA / SDA shares names such as "Geography".
  const subjects = await db.subject.findMany({
    where: { examId: test.examId },
    select: { id: true, name: true },
  });
  const subjectId = new Map(subjects.map((s) => [s.name, s.id]));

  // Detached, not deleted: a question with a recorded attempt must survive.
  await db.testQuestion.deleteMany({ where: { testId: test.id } });

  const ids: string[] = [];
  for (const q of usable) {
    const code = `KAS-FREE-1-Q${q.number}`;
    const body = `${q.heading}\n${q.stem}`.trim();

    const data = {
      examId: test.examId,
      subjectId: subjectId.get(q.subject) ?? subjects[0]!.id,
      type: 'SINGLE_CORRECT',
      status: 'PUBLISHED',
      difficulty: 'MEDIUM',
      body,
      explanation: q.explanation || null,
      marks: MARKS_PER_QUESTION,
      negativeMarks: NEGATIVE_MARKS_PER_QUESTION,
      source: 'AVK Envisions KAS Prelims 2026 — Paper 1 Premium Synopsis',
      // The source document flags its own fiscal-deficit item: statement 3 there
      // gives the formula for the *primary* deficit, not the revenue deficit, so
      // a student who correctly rejects it is marked wrong. Carried through as a
      // review note rather than silently published or silently altered — the key
      // is the content team's to decide, but they should see it.
      reviewNote: REVIEW_NOTES[q.number] ?? null,
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
      data: q.options.map((text, i) => ({
        questionId,
        label: String.fromCharCode(65 + i),
        body: text,
        isCorrect: i === q.correctIndex,
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

  // The synopsis document is this same PDF: it carries the answer and the
  // briefing for every question, which is exactly what a student wants after
  // finishing the paper.
  const dir = synopsisDir();
  await mkdir(dir, { recursive: true });
  const synopsisName = `${TEST_SLUG}.pdf`;
  await copyFile(file, path.join(dir, synopsisName));

  await db.test.update({
    where: { id: test.id },
    data: {
      // Title and subtitle follow the schedule's own naming, so the series
      // page reads consistently whichever paper is imported.
      description: '25 Most Probable Questions',
      totalQuestions: ids.length,
      totalMarks: ids.length * MARKS_PER_QUESTION,
      passingMarks: Math.round(ids.length * MARKS_PER_QUESTION * 0.35),
      // Left as configured. Deriving it from the question count made Test 2
      // read 23 minutes because one question failed to parse, which is a
      // parsing accident rather than a decision about how long the paper runs.
      accessType: 'FREE',
      status: 'PUBLISHED',
      synopsisFileName: synopsisName,
    },
  });

  console.log(`\n  ${ids.length} questions written, synopsis installed as ${synopsisName}.\n`);
}

main()
  .catch((error) => {
    console.error('\nFailed:\n', error?.message ?? error);
    process.exitCode = 1;
  })
  .finally(async () => db.$disconnect());
