/**
 * Loads the shipped Kannada translation memory into the database.
 *
 * The question bank was translated once on a bigger machine (see
 * scripts/kannada-memory-export.mts and translator/pretranslate.py); the
 * result is prisma/data/kannada-memory.jsonl.gz, one {"s", "t"} sentence pair
 * per line. With it loaded, the site assembles Kannada for every question it
 * contains straight from the database, and the engine on the server is left
 * with only what is genuinely new.
 *
 * Runs on every deploy. Only adds: a sentence already in the memory - from an
 * earlier load, or translated on the server since - is left as it is.
 *
 *   npx tsx prisma/seed-translation-memory.ts
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';

import { PrismaClient } from '@prisma/client';

const db = new PrismaClient();
const FILE = 'prisma/data/kannada-memory.jsonl.gz';
const ENGINE = 'indictrans2-en-indic-200m-int8';

/** Must match `fingerprint` in src/server/translation/translation-service.ts. */
function fingerprint(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

async function main() {
  if (!existsSync(FILE)) {
    console.log(`  --  ${FILE} not found; nothing to load`);
    return;
  }

  const pairs = gunzipSync(readFileSync(FILE))
    .toString('utf8')
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as { s: string; t: string });

  const existing = new Set(
    (await db.translationMemory.findMany({ where: { language: 'kn' }, select: { sourceHash: true } })).map(
      (row) => row.sourceHash,
    ),
  );

  const fresh = pairs
    .map((pair) => ({ ...pair, hash: fingerprint(pair.s) }))
    .filter((pair) => !existing.has(pair.hash));

  // In chunks, each one transaction: fast on SQLite, and a failure part-way
  // leaves every earlier chunk in place for the next deploy to build on.
  for (let i = 0; i < fresh.length; i += 500) {
    const chunk = fresh.slice(i, i + 500);
    await db.$transaction(
      chunk.map((pair) =>
        db.translationMemory.upsert({
          where: { language_sourceHash: { language: 'kn', sourceHash: pair.hash } },
          create: { language: 'kn', sourceHash: pair.hash, source: pair.s, target: pair.t, engine: ENGINE },
          update: {},
        }),
      ),
    );
  }

  console.log(`  ok  translation memory: ${fresh.length} added, ${pairs.length - fresh.length} already present`);
}

main()
  .catch((error) => {
    console.error('\nFailed:\n', error?.message ?? error);
    process.exitCode = 1;
  })
  .finally(async () => db.$disconnect());
