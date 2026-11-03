/**
 * Rebuilds the subject papers that held the wrong questions.
 *
 * Two faults produced six wrong papers, and neither was a bad upload:
 *
 *   seed-catalogue attached every question coded "KAS-PYQ-2024" to the
 *   December Polity drill — 191 August plus 195 December questions from both
 *   full-length papers — so it advertised 372 and was mostly not Polity. That
 *   ran on every deploy, so clearing it in the admin never held.
 *
 *   Separately, all 391 of those questions carry subjectId "Indian Polity"
 *   whatever they are about, because the analysis PDFs they came from have no
 *   subject headings for the classifier to read. That is why the five August
 *   subject drills held one question each: only the handful of stragglers
 *   landed anywhere near the right place.
 *
 * The fix is to fill each subject drill from its own subject PDF, which is the
 * only document that actually states which questions belong to that subject.
 *
 * Questions are DETACHED from a drill, never deleted. A drill is a cut of the
 * full-length paper, so a question leaving the drill must stay on the paper a
 * student sits.
 *
 *   npx tsx prisma/rebuild-subject-papers.ts --dry-run
 *
 * Safe to re-run: questions are keyed on a deterministic code, so a second run
 * refreshes them rather than duplicating.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { PrismaClient } from '@prisma/client';

import { MARKS_PER_QUESTION, NEGATIVE_MARKS_PER_QUESTION } from '../src/lib/marking';

const db = new PrismaClient();
const DRY_RUN = process.argv.includes('--dry-run');

/**
 * The questions, already read out of the subject PDFs.
 *
 * Parsed here rather than on the VM: the source documents live in .drive,
 * which is not committed — 21 MB of PDFs the server has no other use for —
 * so a script that parsed them at deploy time would find nothing and
 * silently leave every drill empty. This file is 87 KB and is exactly what
 * the parser produced, checked before it was written.
 */
interface ExportedPaper {
  slug: string;
  subject: string;
  questions: {
    code: string;
    body: string;
    explanation: string | null;
    options: string[];
    correctIndex: number;
  }[];
}

/**
 * Drills with no usable source, emptied rather than left showing questions
 * that do not belong to them.
 *
 * Their PDFs are cover pages — 726 and 1,281 characters, no questions inside —
 * so there is nothing to import. They are refilled when a real document
 * arrives.
 */
const EMPTY: string[] = [
  'kas-pyq-2024-december-subject-indian-polity',
  'kas-pyq-2020-subject-current-affairs',
];

async function loadPapers(): Promise<ExportedPaper[]> {
  const file = path.join(__dirname, 'data', '2024-august-subject-papers.json');
  return JSON.parse(await readFile(file, 'utf8')) as ExportedPaper[];
}

async function main() {
  console.log(`\nRebuilding subject papers${DRY_RUN ? ' (dry run)' : ''}\n`);

  const admin = await db.user.findFirst({ where: { role: 'ADMIN' }, select: { id: true } });
  if (!admin) throw new Error('No admin account. Run the base seed first.');

  // KAS only: these are KAS previous-year drills, and KEA FDA / SDA has a
  // "Geography" too — matched across exams by name, it could be picked.
  const subjects = await db.subject.findMany({
    where: { deletedAt: null, exam: { slug: 'kas' } },
    select: { id: true, name: true },
  });
  const subjectId = new Map(subjects.map((s) => [s.name, s.id]));

  // --- The drills with nothing to put in them ------------------------------
  for (const slug of EMPTY) {
    const test = await db.test.findFirst({
      where: { slug, deletedAt: null },
      select: { id: true, totalQuestions: true },
    });
    if (!test) {
      console.log(`  --  ${slug}  not found`);
      continue;
    }
    if (test.totalQuestions === 0) {
      console.log(`  --  ${slug}  already empty`);
      continue;
    }

    console.log(
      `  ${DRY_RUN ? 'would empty ' : 'emptied     '}${String(test.totalQuestions).padStart(4)} -> ${'0'.padStart(4)}  ${slug}`,
    );
    if (!DRY_RUN) {
      await db.testQuestion.deleteMany({ where: { testId: test.id } });
      await db.test.update({ where: { id: test.id }, data: { totalQuestions: 0, totalMarks: 0 } });
    }
  }

  // --- The drills rebuilt from their own subject documents -----------------
  for (const paper of await loadPapers()) {
    const test = await db.test.findFirst({
      where: { slug: paper.slug, deletedAt: null },
      select: { id: true, examId: true, totalQuestions: true },
    });

    if (!test) {
      console.log(`  --  ${paper.slug}  not found`);
      continue;
    }

    const sid = subjectId.get(paper.subject);
    if (!sid) {
      console.log(`  --  ${paper.slug}  subject "${paper.subject}" missing from the catalogue`);
      continue;
    }

    console.log(
      `  ${DRY_RUN ? 'would fill  ' : 'filled      '}${String(test.totalQuestions).padStart(4)} -> ${String(paper.questions.length).padStart(4)}  ${paper.slug}`,
    );

    if (DRY_RUN) continue;

    const questionIds: string[] = [];

    for (const q of paper.questions) {
      const data = {
        examId: test.examId,
        subjectId: sid,
        type: 'SINGLE_CORRECT' as const,
        status: 'PUBLISHED' as const,
        difficulty: 'MEDIUM' as const,
        body: q.body,
        explanation: q.explanation,
        marks: MARKS_PER_QUESTION,
        negativeMarks: NEGATIVE_MARKS_PER_QUESTION,
        createdById: admin.id,
      };

      // The code is deterministic, so a re-run refreshes the same row.
      const existing = await db.question.findUnique({
        where: { code: q.code },
        select: { id: true },
      });

      let questionId: string;
      if (existing) {
        await db.question.update({ where: { id: existing.id }, data });
        // Options are replaced wholesale: editing in place would leave a stale
        // option behind whenever a document is revised.
        await db.questionOption.deleteMany({ where: { questionId: existing.id } });
        questionId = existing.id;
      } else {
        const made = await db.question.create({
          data: { ...data, code: q.code },
          select: { id: true },
        });
        questionId = made.id;
      }

      await db.questionOption.createMany({
        data: q.options.map((body, index) => ({
          questionId,
          label: String.fromCharCode(65 + index),
          body,
          isCorrect: index === q.correctIndex,
          sortOrder: index,
        })),
      });

      questionIds.push(questionId);
    }

    // Detach whatever was there, then attach this subject's questions.
    await db.testQuestion.deleteMany({ where: { testId: test.id } });
    await db.testQuestion.createMany({
      data: questionIds.map((questionId, index) => ({
        testId: test.id,
        questionId,
        sortOrder: index + 1,
        marks: MARKS_PER_QUESTION,
        negativeMarks: NEGATIVE_MARKS_PER_QUESTION,
      })),
    });

    await db.test.update({
      where: { id: test.id },
      data: {
        totalQuestions: questionIds.length,
        totalMarks: questionIds.length * MARKS_PER_QUESTION,
      },
    });
  }

  console.log(
    '\n  Drills were detached, not deleted — every question stays in the bank\n' +
      '  and on the full-length paper it came from.\n',
  );
}

main()
  .catch((error) => {
    console.error('\nFailed:\n', error?.message ?? error);
    process.exitCode = 1;
  })
  .finally(async () => db.$disconnect());
