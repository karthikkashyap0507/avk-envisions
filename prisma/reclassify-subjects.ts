/**
 * Files questions under the subject they actually belong to.
 *
 * 826 questions sit under "Indian Polity" — against 137 History and 98
 * Geography — because they were created without passing through the subject
 * classifier and took the first subject as a default. Subject analytics is not
 * broken; it is faithfully reporting that.
 *
 * Two sources are used, in order of how much they can be trusted:
 *
 *   1. The subject-wise drill a question is attached to. If a question is on
 *      the Geography drill for its year, it is a Geography question — someone
 *      decided that deliberately.
 *
 *   2. The subject heading printed in its own analysis document, where there
 *      is one. 2017 Paper 1 and both 2020 papers head every question with its
 *      subject; the 2024 and 2011 papers print none.
 *
 * Nothing is guessed from the wording of a question. Roughly 460 questions —
 * the 2024 and 2011 full-length papers — carry no subject anywhere, and they
 * are reported at the end rather than being assigned something plausible. A
 * question filed under the wrong subject quietly distorts a student's
 * analytics, which is worse than one that is honestly unclassified.
 *
 *   npx tsx prisma/reclassify-subjects.ts --dry-run
 *
 * Safe to re-run.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { PrismaClient } from '@prisma/client';
import { extractText, getDocumentProxy } from 'unpdf';

import { parsePyqAnalysis } from '../src/server/services/pyq-analysis-parser';

const db = new PrismaClient();
const DRY_RUN = process.argv.includes('--dry-run');

/** Printed headings, mapped to catalogue subjects. Longest match wins. */
const SUBJECT_HINTS: [RegExp, string][] = [
  [/CSAT|MENTAL|APTITUDE|REASONING|COMPREHENSION/, 'Mental Ability'],
  [/ENVIRONMENT|ECOLOG|BIODIVERS|CLIMATE/, 'Environment'],
  [/SCIENCE|TECHNOLOG|SPACE|BIOTECH|PHYSICS|CHEMISTRY|BIOLOGY/, 'Science & Technology'],
  [/ECONOM|BUDGET|BANKING|FISCAL|MONETARY/, 'Indian Economy'],
  [/GEOGRAPH|RIVER|SOIL|MONSOON/, 'Geography'],
  [/POLIT|CONSTITUT|GOVERNANCE|PARLIAMENT|JUDICI/, 'Indian Polity'],
  [/HISTOR|FREEDOM|ANCIENT|MEDIEVAL|MODERN|CULTURE|ART/, 'History'],
  [/CURRENT|AFFAIR|SPORTS|AWARD|SUMMIT|SCHEME|GENERAL STUDIES/, 'Current Affairs'],
];

function subjectFromHeading(heading: string | null, topic: string | null): string | null {
  const label = `${heading ?? ''} ${topic ?? ''}`.toUpperCase();
  if (!label.trim()) return null;
  for (const [pattern, name] of SUBJECT_HINTS) if (pattern.test(label)) return name;
  return null;
}

async function main() {
  console.log(`\nReclassifying question subjects${DRY_RUN ? ' (dry run)' : ''}\n`);

  // KAS subjects only: KEA FDA / SDA shares names such as "Geography", and a
  // name matched across exams could refile a KAS question under FDA.
  const subjects = await db.subject.findMany({
    where: { deletedAt: null, exam: { slug: 'kas' } },
    select: { id: true, name: true },
  });
  const idFor = new Map(subjects.map((s) => [s.name, s.id]));
  const nameFor = new Map(subjects.map((s) => [s.id, s.name]));

  /** questionId -> the subject it should have, and where that came from. */
  const decided = new Map<string, { subjectId: string; from: string }>();

  // --- 1. The subject-wise drill a question is attached to ------------------
  const onDrills = await db.testQuestion.findMany({
    where: {
      test: { slug: { contains: '-subject-' }, deletedAt: null, subjectId: { not: null } },
    },
    select: { questionId: true, test: { select: { subjectId: true } } },
  });

  const drillSubjects = new Map<string, Set<string>>();
  for (const row of onDrills) {
    const seen = drillSubjects.get(row.questionId) ?? new Set<string>();
    seen.add(row.test.subjectId!);
    drillSubjects.set(row.questionId, seen);
  }

  for (const [questionId, seen] of drillSubjects) {
    // A question on two different subjects' drills is genuinely ambiguous;
    // leave it rather than picking one.
    if (seen.size === 1) decided.set(questionId, { subjectId: [...seen][0]!, from: 'drill' });
  }
  console.log(`  ${decided.size} settled by the subject drill they sit on`);

  // --- 2. The heading printed in their own document -------------------------
  const papers = await db.test.findMany({
    where: { synopsisFileName: { not: null }, deletedAt: null },
    select: { slug: true, synopsisFileName: true },
    orderBy: { slug: 'asc' },
  });

  let fromHeadings = 0;
  for (const paper of papers) {
    let text: string;
    try {
      const bytes = new Uint8Array(await readFile(path.join('synopses', paper.synopsisFileName!)));
      const extracted = await extractText(await getDocumentProxy(bytes), { mergePages: true });
      text = String(extracted.text);
    } catch {
      continue;
    }

    const { questions } = parsePyqAnalysis(text);
    const headed = questions.filter((q) => q.subject || q.topic);
    if (headed.length === 0) continue;

    for (const parsed of headed) {
      const name = subjectFromHeading(parsed.subject, parsed.topic);
      const subjectId = name ? idFor.get(name) : undefined;
      if (!subjectId) continue;

      const code = `${paper.slug}-q${parsed.number}`.toUpperCase();
      const question = await db.question.findUnique({ where: { code }, select: { id: true } });
      if (!question) continue;

      // The drill is the stronger signal, so it is not overwritten here.
      if (decided.has(question.id)) continue;
      decided.set(question.id, { subjectId, from: paper.slug });
      fromHeadings += 1;
    }
  }
  console.log(`  ${fromHeadings} settled by the heading printed in their document`);

  // --- Apply ----------------------------------------------------------------
  const current = await db.question.findMany({
    where: { id: { in: [...decided.keys()] }, deletedAt: null },
    select: { id: true, subjectId: true },
  });

  const moves = current.filter((q) => q.subjectId !== decided.get(q.id)!.subjectId);
  const tally = new Map<string, number>();
  for (const q of moves) {
    const to = nameFor.get(decided.get(q.id)!.subjectId) ?? '?';
    tally.set(to, (tally.get(to) ?? 0) + 1);
  }

  console.log(`\n  ${moves.length} question(s) are filed under the wrong subject:`);
  for (const [name, n] of [...tally].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${String(n).padStart(4)}  ->  ${name}`);
  }

  if (!DRY_RUN) {
    for (const q of moves) {
      await db.question.update({
        where: { id: q.id },
        data: { subjectId: decided.get(q.id)!.subjectId },
      });
    }
  }

  // --- What is left over ----------------------------------------------------
  const unresolved = await db.question.count({
    where: { deletedAt: null, id: { notIn: [...decided.keys()] } },
  });
  console.log(
    `\n  ${unresolved} question(s) carry no subject anywhere — no drill and no printed\n` +
      '  heading. Left as they are rather than guessed at from their wording.\n',
  );

  const after = await db.question.groupBy({
    by: ['subjectId'],
    _count: true,
    where: { deletedAt: null },
  });
  console.log('  Questions per subject:');
  for (const row of after.sort((a, b) => b._count - a._count)) {
    console.log(`    ${String(row._count).padStart(4)}  ${nameFor.get(row.subjectId!) ?? '(none)'}`);
  }
  console.log();
}

main()
  .catch((error) => {
    console.error('\nFailed:\n', error?.message ?? error);
    process.exitCode = 1;
  })
  .finally(async () => db.$disconnect());
