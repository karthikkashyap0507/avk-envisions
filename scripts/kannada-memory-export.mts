/**
 * Lists every sentence in the question bank that the Kannada translation
 * memory does not have yet, for `translator/pretranslate.py` to translate.
 *
 *   npx tsx --tsconfig tsconfig.json scripts/kannada-memory-export.mts out.json
 *
 * Why this exists: the server that runs the site is a 2-vCPU machine, and the
 * engine there manages a few sentences a minute alongside the website. The
 * bank as it stands is translated once on a bigger machine instead, and the
 * result ships as `prisma/data/kannada-memory.jsonl.gz`, which every deploy
 * loads. The server's engine is then left with only what is genuinely new.
 *
 * Sentences come from the same splitter the site uses, normalised the same
 * way, so each one is exactly the key the site will look up.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';

import { PrismaClient } from '@prisma/client';

import { planHtml, planPlainText, sentencesOf } from '../src/server/translation/segments';

const db = new PrismaClient();
const MEMORY_FILE = 'prisma/data/kannada-memory.jsonl.gz';
const normalise = (s: string) => s.replace(/\s+/g, ' ').trim();

async function main() {
  const out = process.argv[2];
  if (!out) throw new Error('Usage: kannada-memory-export.mts <out.json>');

  const known = new Set<string>();
  if (existsSync(MEMORY_FILE)) {
    for (const line of gunzipSync(readFileSync(MEMORY_FILE)).toString('utf8').split('\n')) {
      if (line.trim()) known.add((JSON.parse(line) as { s: string }).s);
    }
  }
  for (const row of await db.translationMemory.findMany({ where: { language: 'kn' }, select: { source: true } })) {
    known.add(row.source);
  }

  const questions = await db.question.findMany({
    where: { deletedAt: null },
    select: { body: true, passage: true, explanation: true, detailedSolution: true, options: { select: { body: true } } },
  });
  const tests = await db.test.findMany({
    where: { deletedAt: null },
    select: { title: true, description: true, instructions: true },
  });

  // Question stems first: they are what makes a paper sittable in Kannada.
  const ordered: string[] = [];
  const seen = new Set<string>();
  const add = (sentences: string[]) => {
    for (const raw of sentences) {
      const s = normalise(raw);
      if (s && !seen.has(s) && !known.has(s)) {
        seen.add(s);
        ordered.push(s);
      }
    }
  };
  for (const q of questions) {
    add([q.body, q.passage ?? '', ...q.options.map((o) => o.body)].flatMap((t) => sentencesOf(planPlainText(t))));
  }
  for (const t of tests) {
    add([t.title, t.description ?? '', t.instructions ?? ''].flatMap((x) => sentencesOf(planPlainText(x))));
  }
  for (const q of questions) {
    add([
      ...(q.explanation ? sentencesOf(planPlainText(q.explanation)) : []),
      ...(q.detailedSolution ? sentencesOf(planHtml(q.detailedSolution)) : []),
    ]);
  }

  writeFileSync(out, JSON.stringify(ordered), 'utf8');
  console.log(`${ordered.length} sentences to translate (${known.size} already known) -> ${out}`);
  await db.$disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
