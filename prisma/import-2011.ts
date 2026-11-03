/**
 * Replaces the 2011 papers with the refreshed documents.
 *
 * The 2011 content on the site came from two places over time — a hand
 * transcription of Paper I and an early analysis document for Paper II. Both
 * are superseded by the corrected papers supplied separately, so this removes
 * what is there and rebuilds from the new source rather than merging: a merge
 * would leave whichever questions the new documents happen not to cover sitting
 * alongside them, with no way to tell which is which.
 *
 * The two complete papers fill the full-length tests. The subject-wise files
 * are what decide which subject a question belongs to, because the complete
 * papers carry no subject headings of their own — a question is matched to a
 * subject by finding its text in that subject's file.
 *
 * Attempts already recorded against the old questions are preserved. Those
 * questions are detached from the tests and left in place rather than deleted,
 * so a student's result page still resolves.
 *
 *   npm run db:import:2011 -- --dry-run
 *
 * Run with: npm run db:import:2011
 */
import { execFile } from 'node:child_process';
import { copyFile, mkdir, readFile, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import { PrismaClient } from '@prisma/client';
import { extractText, getDocumentProxy } from 'unpdf';

import { KAS_2011_SOURCES } from './data/kas-2011-sources';
import { MARKS_PER_QUESTION, NEGATIVE_MARKS_PER_QUESTION } from '../src/lib/marking';
import { parsePyqAnalysis } from '../src/server/services/pyq-analysis-parser';
import { synopsisDir } from '../src/server/services/synopsis-service';

const db = new PrismaClient();
const run = promisify(execFile);
const DRY_RUN = process.argv.includes('--dry-run');

const SERIES = 'kas-pyq-2011';

/** Catalogue subject → the slug of that subject's drill. */
const SUBJECT_SLUG: Record<string, string> = {
  'Current Affairs': 'current-affairs',
  'Indian Economy': 'indian-economy',
  Geography: 'geography',
  History: 'history',
  'Indian Polity': 'indian-polity',
  'Mental Ability': 'mental-ability',
  Environment: 'environment',
  'Science & Technology': 'science-technology',
};

/** Which test each supplied document is the analysis for. */
function testSlugFor(source: { paperNumber: number; subject: string | null }): string | null {
  if (source.subject === null) return `${SERIES}-paper-${source.paperNumber}`;
  const slug = SUBJECT_SLUG[source.subject];
  return slug ? `${SERIES}-subject-${slug}` : null;
}

function cacheDir(): string {
  return path.join(path.dirname(synopsisDir()), 'kas-2011');
}

/** Fetches a document, reusing a cached copy, and refuses anything not a PDF. */
async function fetchDoc(fileId: string, name: string): Promise<string | null> {
  const dir = cacheDir();
  await mkdir(dir, { recursive: true });
  const dest = path.join(dir, name);

  const cached = await stat(dest).catch(() => null);
  if (cached && cached.size > 1000) return dest;

  await run('curl', [
    '-sL',
    '--max-time',
    '600',
    `https://drive.google.com/uc?export=download&id=${fileId}`,
    '-o',
    dest,
  ]);

  const head = await readFile(dest).catch(() => null);
  if (head && head.subarray(0, 5).toString('latin1') === '%PDF-') return dest;

  await unlink(dest).catch(() => {});
  return null;
}

async function textOf(file: string): Promise<string> {
  const { text } = await extractText(
    await getDocumentProxy(new Uint8Array(await readFile(file))),
    { mergePages: true },
  );
  return String(text);
}

/** First few words, normalised — enough to recognise the same question again. */
function fingerprint(stem: string): string {
  return stem
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .slice(0, 8)
    .join(' ');
}

async function main() {
  console.log(`\nRebuilding the 2011 papers${DRY_RUN ? ' (dry run)' : ''}...\n`);

  const admin = await db.user.findFirst({ where: { role: 'ADMIN' }, select: { id: true } });
  if (!admin) throw new Error('No admin account. Run the base seed first.');

  const series = await db.testSeries.findFirst({
    where: { slug: SERIES, deletedAt: null },
    select: { id: true, examId: true },
  });
  if (!series) throw new Error(`Series ${SERIES} not found. Run the catalogue seed first.`);

  // This exam's subjects only: KEA FDA / SDA shares names such as "Geography".
  const subjects = await db.subject.findMany({
    where: { examId: series.examId },
    select: { id: true, name: true },
  });
  const subjectId = new Map(subjects.map((s) => [s.name, s.id]));

  // --- Read every supplied document ---------------------------------------
  const subjectOf = new Map<string, string>(); // fingerprint -> subject name
  const complete = new Map<number, ReturnType<typeof parsePyqAnalysis>['questions']>();

  for (const source of KAS_2011_SOURCES) {
    const file = await fetchDoc(source.driveFileId, source.name);
    if (!file) {
      console.log(`  !!  ${source.name} could not be downloaded`);
      continue;
    }

    const { questions } = parsePyqAnalysis(await textOf(file));
    const usable = questions.filter((q) => q.warnings.length === 0 && q.correctIndex !== null);

    if (source.subject) {
      for (const q of usable) subjectOf.set(fingerprint(q.stem), source.subject);
      console.log(
        `  --  ${source.name.padEnd(36)} ${usable.length} questions tagged ${source.subject}`,
      );
    } else {
      complete.set(source.paperNumber, usable);
      console.log(
        `  --  ${source.name.padEnd(36)} ${usable.length} of ${questions.length} usable (Paper ${source.paperNumber})`,
      );
    }
  }

  if (complete.size === 0) {
    console.log('\n  No complete paper could be read. Nothing was changed.\n');
    process.exitCode = 1;
    return;
  }

  if (DRY_RUN) {
    let total = 0;
    for (const [paper, qs] of complete) {
      const tagged = qs.filter((q) => subjectOf.has(fingerprint(q.stem))).length;
      console.log(`\n  Paper ${paper}: would import ${qs.length}, ${tagged} with a subject`);
      total += qs.length;
    }
    console.log(`\n  ${total} questions in total. Nothing written.\n`);
    return;
  }

  // --- Detach the old questions --------------------------------------------
  //
  // Detached, not deleted. Anything with a recorded attempt has to survive so
  // the student's result page still resolves; the rest are harmless orphans
  // that no test points at.
  const oldTests = await db.test.findMany({
    where: { slug: { startsWith: `${SERIES}-` }, deletedAt: null },
    select: { id: true, slug: true },
  });

  for (const t of oldTests) {
    await db.testQuestion.deleteMany({ where: { testId: t.id } });
    await db.test.update({
      where: { id: t.id },
      data: { totalQuestions: 0, totalMarks: 0 },
    });
  }
  console.log(`\n  cleared ${oldTests.length} existing 2011 tests\n`);

  // --- Rebuild --------------------------------------------------------------
  let created = 0;
  const bySubject = new Map<string, string[]>();

  for (const [paperNumber, questions] of [...complete].sort((a, b) => a[0] - b[0])) {
    const test = oldTests.find((t) => t.slug === `${SERIES}-paper-${paperNumber}`);
    if (!test) {
      console.log(`  !!  no test for Paper ${paperNumber}`);
      continue;
    }

    const ids: string[] = [];

    for (const q of questions) {
      const code = `${SERIES}-PAPER-${paperNumber}-Q${q.number}`.toUpperCase();
      const subjectName = subjectOf.get(fingerprint(q.stem));
      const sid = subjectName ? subjectId.get(subjectName) : undefined;

      const data = {
        examId: series.examId,
        subjectId: sid ?? subjects[0]!.id,
        type: 'SINGLE_CORRECT',
        status: 'PUBLISHED',
        difficulty: 'MEDIUM',
        body: q.stem,
        explanation: q.explanation,
        marks: MARKS_PER_QUESTION,
        negativeMarks: NEGATIVE_MARKS_PER_QUESTION,
        source: 'KAS 2011 previous year paper',
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
      created += 1;

      await db.questionOption.createMany({
        data: q.options.map((o, i) => ({
          questionId,
          label: String.fromCharCode(65 + i),
          body: o.text,
          isCorrect: i === q.correctIndex,
          sortOrder: i,
        })),
      });

      ids.push(questionId);
      if (sid) bySubject.set(sid, [...(bySubject.get(sid) ?? []), questionId]);
    }

    const unique = [...new Set(ids)];
    await db.testQuestion.createMany({
      data: unique.map((qid, i) => ({
        testId: test.id,
        questionId: qid,
        sortOrder: i + 1,
        marks: MARKS_PER_QUESTION,
        negativeMarks: NEGATIVE_MARKS_PER_QUESTION,
      })),
    });
    await db.test.update({
      where: { id: test.id },
      data: {
        totalQuestions: unique.length,
        totalMarks: unique.length * MARKS_PER_QUESTION,
        passingMarks: Math.round(unique.length * MARKS_PER_QUESTION * 0.35),
      },
    });

    console.log(`  ok  Paper ${paperNumber}: ${unique.length} questions`);
  }

  // --- Subject drills -------------------------------------------------------
  for (const [sid, ids] of bySubject) {
    const test = await db.test.findFirst({
      where: { slug: { startsWith: `${SERIES}-subject-` }, subjectId: sid, deletedAt: null },
      select: { id: true, slug: true },
    });
    if (!test) continue;

    const unique = [...new Set(ids)];
    await db.testQuestion.createMany({
      data: unique.map((qid, i) => ({
        testId: test.id,
        questionId: qid,
        sortOrder: i + 1,
        marks: MARKS_PER_QUESTION,
        negativeMarks: NEGATIVE_MARKS_PER_QUESTION,
      })),
    });
    await db.test.update({
      where: { id: test.id },
      data: {
        totalQuestions: unique.length,
        totalMarks: unique.length * MARKS_PER_QUESTION,
        durationMinutes: Math.max(10, Math.round(unique.length * 1.2)),
      },
    });
    console.log(`  ok  ${test.slug.padEnd(40)} ${unique.length} questions`);
  }

  // --- Install these documents as the analysis PDFs ------------------------
  //
  // They are the same files: each carries the question, the answer and the
  // commentary. Leaving the previous archive's copies in place would show a
  // student an analysis of a paper that is no longer the one they sat.
  const target = synopsisDir();
  await mkdir(target, { recursive: true });
  let installed = 0;

  for (const source of KAS_2011_SOURCES) {
    const slug = testSlugFor(source);
    if (!slug) continue;

    const cached = path.join(cacheDir(), source.name);
    if (!(await stat(cached).catch(() => null))) continue;

    const fileName = `${slug}.pdf`;
    await copyFile(cached, path.join(target, fileName));

    const changed = await db.test.updateMany({
      where: { slug, deletedAt: null },
      data: { synopsisFileName: fileName },
    });
    if (changed.count > 0) installed += 1;

    // The series-level fallback follows Paper I.
    if (source.subject === null && source.paperNumber === 1) {
      await db.testSeries.updateMany({
        where: { slug: SERIES },
        data: { synopsisFileName: fileName },
      });
    }
  }

  console.log(`  ${installed} analysis documents replaced.`);

  console.log(`\n  ${created} questions written for 2011.\n`);
}

main()
  .catch((error) => {
    console.error('\nFailed:\n', error?.message ?? error);
    process.exitCode = 1;
  })
  .finally(async () => db.$disconnect());
