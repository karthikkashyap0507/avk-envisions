/**
 * Recovers the previous-year questions from the analysis PDFs and attaches
 * them to their tests.
 *
 * The analysis documents are revision material, but each item in them carries
 * the full question: stem, four options and the keyed answer. This extracts
 * those, creates them as real questions, and fills both the full-length paper
 * and the subject-wise drills cut from it.
 *
 * Only questions the parser read cleanly are imported. Anything with a missing
 * option, an unreadable key, or a garbled stem is counted and skipped — a
 * wrongly keyed question marks a student down for being right, which is worse
 * than a paper that is still being prepared.
 *
 * Safe to re-run: questions are matched on a deterministic external id, so a
 * second run refreshes them rather than creating duplicates.
 *
 * Run with: npm run db:import:pyq
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { PrismaClient } from '@prisma/client';
import { extractText, getDocumentProxy } from 'unpdf';

import { MARKS_PER_QUESTION, NEGATIVE_MARKS_PER_QUESTION } from '../src/lib/marking';
import { parsePyqAnalysis, type ParsedPyqQuestion } from '../src/server/services/pyq-analysis-parser';
import { synopsisDir } from '../src/server/services/synopsis-service';

const db = new PrismaClient();

const DRY_RUN = process.argv.includes('--dry-run');

/**
 * Subject headings as printed in the documents, mapped to catalogue subjects.
 *
 * Matched on a substring of the uppercased heading, longest first, so
 * "MEDIEVAL HISTORY" and "MODERN HISTORY" both reach History without needing
 * an entry each.
 */
const SUBJECT_HINTS: [RegExp, string][] = [
  [/CSAT|MENTAL|APTITUDE|REASONING|COMPREHENSION/, 'Mental Ability'],
  [/ENVIRONMENT|ECOLOG|BIODIVERS|CLIMATE/, 'Environment'],
  [/SCIENCE|TECHNOLOG|SPACE|BIOTECH|PHYSICS|CHEMISTRY|BIOLOGY/, 'Science & Technology'],
  [/ECONOM|BUDGET|BANKING|FISCAL|MONETARY/, 'Indian Economy'],
  [/GEOGRAPH|CLIMAT|RIVER|SOIL|MONSOON/, 'Geography'],
  [/POLIT|CONSTITUT|GOVERNANCE|PARLIAMENT|JUDICI/, 'Indian Polity'],
  [/HISTOR|FREEDOM|ANCIENT|MEDIEVAL|MODERN|CULTURE|ART/, 'History'],
  [/CURRENT|AFFAIR|SPORTS|AWARD|SUMMIT|SCHEME/, 'Current Affairs'],
];

function subjectFor(parsed: ParsedPyqQuestion): string | null {
  const label = `${parsed.subject ?? ''} ${parsed.topic ?? ''}`.toUpperCase();
  for (const [re, name] of SUBJECT_HINTS) if (re.test(label)) return name;
  return null;
}

async function textOf(fileName: string): Promise<string> {
  const buf = new Uint8Array(await readFile(path.join(synopsisDir(), fileName)));
  const { text } = await extractText(await getDocumentProxy(buf), { mergePages: true });
  return String(text);
}

async function main() {
  console.log(`\nImporting previous-year questions${DRY_RUN ? ' (dry run)' : ''}...\n`);

  const admin = await db.user.findFirst({ where: { role: 'ADMIN' }, select: { id: true } });
  if (!admin) throw new Error('No admin account. Run the base seed first.');

  const papers = await db.test.findMany({
    where: { paperNumber: { not: null }, synopsisFileName: { not: null }, deletedAt: null },
    orderBy: { slug: 'asc' },
    select: {
      id: true,
      slug: true,
      examId: true,
      synopsisFileName: true,
      testSeriesId: true,
    },
  });

  // This exam's subjects only: KEA FDA / SDA shares names such as "Geography".
  const subjects = await db.subject.findMany({
    where: { exam: { slug: 'kas' } },
    select: { id: true, name: true },
  });
  const subjectId = new Map(subjects.map((s) => [s.name, s.id]));

  let created = 0;
  let refreshed = 0;
  let skipped = 0;

  for (const paper of papers) {
    // 2011 is rebuilt from its own refreshed documents by `db:import:2011`.
    // Running this over it would replace those with the older analysis text,
    // which is exactly what that script exists to undo.
    if (paper.slug.startsWith('kas-pyq-2011')) {
      console.log(`  --  ${paper.slug.padEnd(30)} owned by db:import:2011, skipped`);
      continue;
    }

    const { questions } = parsePyqAnalysis(await textOf(paper.synopsisFileName!));
    const usable = questions.filter((q) => q.warnings.length === 0 && q.correctIndex !== null);
    skipped += questions.length - usable.length;

    if (usable.length === 0) {
      console.log(`  --  ${paper.slug.padEnd(30)} nothing usable, left as it was`);
      continue;
    }

    // Subject-wise tests for this year, so each question can join its drill.
    const seriesSlugBase = paper.slug.replace(/-paper-[12]$/, '');
    const subjectTests = await db.test.findMany({
      where: { slug: { startsWith: `${seriesSlugBase}-subject-` }, deletedAt: null },
      select: { id: true, slug: true, subjectId: true },
    });
    const testForSubject = new Map(subjectTests.map((t) => [t.subjectId, t.id]));

    const questionIds: string[] = [];
    const bySubject = new Map<string, string[]>();

    for (const q of usable) {
      // Deterministic, so a re-run updates the same row rather than adding one.
      // `code` is the unique key on Question, so it doubles as the import id.
      const code = `${paper.slug}-q${q.number}`.toUpperCase();
      const subjectName = subjectFor(q);
      const sid = subjectName ? subjectId.get(subjectName) : undefined;

      if (DRY_RUN) {
        questionIds.push(code);
        if (sid) bySubject.set(sid, [...(bySubject.get(sid) ?? []), code]);
        continue;
      }

      const existing = await db.question.findUnique({ where: { code }, select: { id: true } });

      const data = {
        examId: paper.examId,
        subjectId: sid ?? subjects[0]!.id,
        type: 'SINGLE_CORRECT',
        status: 'PUBLISHED',
        difficulty: 'MEDIUM',
        body: q.stem,
        explanation: q.explanation,
        marks: MARKS_PER_QUESTION,
        negativeMarks: NEGATIVE_MARKS_PER_QUESTION,
        source: 'KAS previous year paper',
        code,
        createdById: admin.id,
      };

      let questionId: string;
      if (existing) {
        await db.question.update({ where: { id: existing.id }, data });
        await db.questionOption.deleteMany({ where: { questionId: existing.id } });
        questionId = existing.id;
        refreshed += 1;
      } else {
        const made = await db.question.create({ data, select: { id: true } });
        questionId = made.id;
        created += 1;
      }

      await db.questionOption.createMany({
        data: q.options.map((o, i) => ({
          questionId,
          label: String.fromCharCode(65 + i),
          body: o.text,
          isCorrect: i === q.correctIndex,
          sortOrder: i,
        })),
      });

      questionIds.push(questionId);
      if (sid) bySubject.set(sid, [...(bySubject.get(sid) ?? []), questionId]);
    }

    if (DRY_RUN) {
      console.log(
        `  --  ${paper.slug.padEnd(30)} would import ${usable.length}, skip ${questions.length - usable.length}`,
      );
      continue;
    }

    // --- Attach to the full-length paper ------------------------------------
    // Deduplicated: two parsed items can resolve to the same question when a
    // number repeats in the document, and (testId, questionId) is unique.
    const paperQuestionIds = [...new Set(questionIds)];

    await db.testQuestion.deleteMany({ where: { testId: paper.id } });
    await db.testQuestion.createMany({
      data: paperQuestionIds.map((qid, i) => ({
        testId: paper.id,
        questionId: qid,
        sortOrder: i + 1,
        marks: MARKS_PER_QUESTION,
        negativeMarks: NEGATIVE_MARKS_PER_QUESTION,
      })),
    });
    await db.test.update({
      where: { id: paper.id },
      data: {
        totalQuestions: paperQuestionIds.length,
        totalMarks: paperQuestionIds.length * MARKS_PER_QUESTION,
        passingMarks: Math.round(paperQuestionIds.length * MARKS_PER_QUESTION * 0.35),
      },
    });

    // --- And to each subject drill -----------------------------------------
    // Paper II adds to what Paper I already placed, so the drill holds both.
    for (const [sid, ids] of bySubject) {
      const testId = testForSubject.get(sid);
      if (!testId) continue;

      if (paper.slug.endsWith('-paper-1')) {
        await db.testQuestion.deleteMany({ where: { testId } });
      }

      // Paper II appends to what Paper I placed, so the drill may already hold
      // some of these. SQLite has no skipDuplicates, and (testId, questionId)
      // is unique, so anything already attached is filtered out here.
      const alreadyIn = new Set(
        (
          await db.testQuestion.findMany({ where: { testId }, select: { questionId: true } })
        ).map((r) => r.questionId),
      );
      const fresh = [...new Set(ids)].filter((qid) => !alreadyIn.has(qid));
      if (fresh.length === 0) continue;

      const offset = alreadyIn.size;

      await db.testQuestion.createMany({
        data: fresh.map((qid, i) => ({
          testId,
          questionId: qid,
          sortOrder: offset + i + 1,
          marks: MARKS_PER_QUESTION,
          negativeMarks: NEGATIVE_MARKS_PER_QUESTION,
        })),
      });

      const total = await db.testQuestion.count({ where: { testId } });
      await db.test.update({
        where: { id: testId },
        data: {
          totalQuestions: total,
          totalMarks: total * MARKS_PER_QUESTION,
          durationMinutes: Math.max(10, Math.round(total * 1.2)),
        },
      });
    }

    console.log(
      `  ok  ${paper.slug.padEnd(30)} ${usable.length} imported, ` +
        `${questions.length - usable.length} skipped, ${bySubject.size} subject drills filled`,
    );
  }

  console.log(
    `\n  ${created} created, ${refreshed} refreshed, ${skipped} skipped as unreliable.\n`,
  );

  if (!DRY_RUN) {
    const ready = await db.test.count({
      where: { slug: { startsWith: 'kas-pyq-' }, totalQuestions: { gt: 0 }, deletedAt: null },
    });
    console.log(`  previous-year tests now attemptable: ${ready}\n`);
  }
}

main()
  .catch((error) => {
    console.error('\nImport failed:\n', error?.message ?? error);
    process.exitCode = 1;
  })
  .finally(async () => db.$disconnect());
