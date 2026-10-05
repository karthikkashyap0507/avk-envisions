/**
 * Lists every sentence in the analysis PDFs that the Kannada translation
 * memory does not have yet, for `translator/pretranslate.py` to translate.
 *
 *   python translator/pdf_kannada.py extract <in.pdf> <dir>/<name>.json   (each PDF)
 *   npx tsx --tsconfig tsconfig.json scripts/kannada-doc-sentences.mts <dir> out.json
 *
 * The same reason as scripts/kannada-memory-export.mts: the server's engine
 * manages a few sentences a minute, and the analysis documents hold tens of
 * thousands. They are translated once on a bigger machine and shipped in
 * prisma/data/kannada-memory.jsonl.gz, so the server only has to assemble
 * each Kannada PDF from sentences it already has.
 *
 * Paragraphs are planned by the same code the site uses, so every sentence
 * here is exactly a key the site will look up. Most frequent first: the
 * headings and phrases every document repeats are worth the most.
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';

import { PrismaClient } from '@prisma/client';

import { planBlock } from '../src/server/translation/document-plan';
import { sentencesOf } from '../src/server/translation/segments';

const db = new PrismaClient();
const MEMORY_FILE = 'prisma/data/kannada-memory.jsonl.gz';
const normalise = (s: string) => s.replace(/\s+/g, ' ').trim();

interface Extraction {
  pages: { blocks: { text: string }[] }[];
}

async function main() {
  const [dir, out] = process.argv.slice(2);
  if (!dir || !out) throw new Error('Usage: kannada-doc-sentences.mts <extractions dir> <out.json>');

  const known = new Set<string>();
  if (existsSync(MEMORY_FILE)) {
    for (const line of gunzipSync(readFileSync(MEMORY_FILE)).toString('utf8').split('\n')) {
      if (line.trim()) known.add((JSON.parse(line) as { s: string }).s);
    }
  }
  for (const row of await db.translationMemory.findMany({ where: { language: 'kn' }, select: { source: true } })) {
    known.add(row.source);
  }

  const counts = new Map<string, number>();
  let documents = 0;
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
    const extraction = JSON.parse(readFileSync(path.join(dir, file), 'utf8')) as Extraction;
    documents += 1;
    for (const page of extraction.pages) {
      for (const block of page.blocks) {
        for (const raw of sentencesOf(planBlock(block.text) ?? [])) {
          const s = normalise(raw);
          if (s) counts.set(s, (counts.get(s) ?? 0) + 1);
        }
      }
    }
  }

  const all = [...counts.keys()];
  const todo = all.filter((s) => !known.has(s)).sort((a, b) => counts.get(b)! - counts.get(a)!);
  writeFileSync(out, JSON.stringify(todo), 'utf8');
  console.log(
    `${documents} documents, ${all.length} distinct sentences, ${all.length - todo.length} already known, ${todo.length} to translate -> ${out}`,
  );
  await db.$disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
