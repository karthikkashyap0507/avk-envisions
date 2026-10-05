import 'server-only';

import { createHash } from 'crypto';
import { createReadStream, existsSync } from 'fs';
import { mkdir, readFile, rename, stat, unlink, writeFile } from 'fs/promises';
import path from 'path';

import { db } from '@/server/db';
import { logger } from '@/server/logger';
import { resolveSynopsisPath, synopsisDir } from '@/server/services/synopsis-service';

import { planBlock } from './document-plan';
import { ENGINE_NAME } from './engine-client';
import { PDF_FORMAT, runPdfTool } from './pdf-tool';
import { render, sentencesOf, type Piece } from './segments';
import { looksKannada, normalise, rememberedTranslations, translateWithMemory } from './translation-service';

/**
 * Kannada copies of the analysis PDFs.
 *
 * Admins upload each analysis in English only. Its Kannada copy is made from
 * it here, automatically: the PDF tool reads every paragraph off the pages,
 * the paragraphs are translated sentence by sentence through the same memory
 * and engine as the questions, and the tool writes the Kannada back into the
 * same design. A student is offered the Kannada copy only once it is
 * complete and made from the English file as it is now - never half a
 * document, never a stale one.
 *
 * The work goes in steps, a few sentences at a time, so the background worker
 * can put a student's waiting test first between any two of them; every
 * sentence is remembered as it is translated, so nothing is lost if the
 * server restarts mid-document.
 *
 * Copies live in a `kn` folder beside the English files - outside the web
 * root, served only through the same access checks - each with a small JSON
 * note of which English file, byte for byte, it was made from.
 */

/** Sentences translated per step: a few minutes on the capped server. */
export const STEP_SENTENCES = 8;

interface Extraction {
  format: number;
  pages: { index: number; blocks: { id: string; text: string }[] }[];
}

interface Note {
  format: number;
  source: string;
  sourceHash: string;
  sourceSize: number;
  sourceMtimeMs: number;
  engine: string;
  builtAt: string;
  paragraphs: number;
  report?: unknown;
}

export type DocumentState =
  | { state: 'ready' }
  | { state: 'pending'; done: number; total: number }
  | { state: 'missing' };

function kannadaDir(): string {
  return path.join(synopsisDir(), 'kn');
}

function workDir(): string {
  return path.join(kannadaDir(), '.work');
}

/** The Kannada copy of an English file, under the same name. */
function copyPath(fileName: string): string {
  return path.join(kannadaDir(), path.basename(fileName));
}

function notePath(fileName: string): string {
  return path.join(kannadaDir(), `${path.basename(fileName)}.json`);
}

async function readNote(fileName: string): Promise<Note | null> {
  try {
    return JSON.parse(await readFile(notePath(fileName), 'utf8')) as Note;
  } catch {
    return null;
  }
}

async function sourceInfo(fileName: string) {
  try {
    const info = await stat(resolveSynopsisPath(fileName));
    return info.size > 0 ? info : null;
  } catch {
    return null;
  }
}

/** Ready means: a copy exists, made by this version, from the English file exactly as it is on disk now. */
async function isReady(fileName: string): Promise<boolean> {
  const [note, info] = await Promise.all([readNote(fileName), sourceInfo(fileName)]);
  return Boolean(
    note &&
      info &&
      note.format === PDF_FORMAT &&
      note.sourceSize === info.size &&
      note.sourceMtimeMs === Math.round(info.mtimeMs) &&
      existsSync(copyPath(fileName)),
  );
}

/** The finished Kannada copy of this analysis, or null if there is none to offer. */
export async function kannadaDocumentPath(fileName: string | null | undefined): Promise<string | null> {
  if (!fileName) return null;
  return (await isReady(fileName)) ? copyPath(fileName) : null;
}

export async function hasKannadaDocument(fileName: string | null | undefined): Promise<boolean> {
  return (await kannadaDocumentPath(fileName)) !== null;
}

/** Progress of documents being worked on in this process, for the admin page. */
const progress = new Map<string, { done: number; total: number }>();
/**
 * Sentences the engine returned nothing for. Not remembered (that is a
 * failure, not an answer), but a document must still finish: they stay in
 * English for this process's copy.
 */
const unanswered = new Set<string>();

export async function documentState(fileName: string): Promise<DocumentState> {
  if (!(await sourceInfo(fileName))) return { state: 'missing' };
  if (await isReady(fileName)) return { state: 'ready' };
  const known = progress.get(path.basename(fileName));
  return { state: 'pending', done: known?.done ?? 0, total: known?.total ?? 0 };
}

async function fileHash(file: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

/** The PDF's paragraphs, read once per version of the file and kept until its copy is made. */
async function extract(source: string, hash: string): Promise<Extraction> {
  const cache = path.join(workDir(), `${hash}.blocks.json`);
  try {
    const cached = JSON.parse(await readFile(cache, 'utf8')) as Extraction;
    if (cached.format === PDF_FORMAT) return cached;
  } catch {
    // Not read yet.
  }
  await mkdir(workDir(), { recursive: true });
  const partial = `${cache}.part`;
  await runPdfTool(['extract', source, partial]);
  await rename(partial, cache);
  return JSON.parse(await readFile(cache, 'utf8')) as Extraction;
}

interface Plan {
  id: string;
  text: string;
  pieces: Piece[];
}

function plan(extraction: Extraction): Plan[] {
  const plans: Plan[] = [];
  for (const page of extraction.pages) {
    for (const block of page.blocks) {
      const pieces = planBlock(block.text);
      if (pieces) plans.push({ id: block.id, text: block.text, pieces });
    }
  }
  return plans;
}

/**
 * One step towards a document's Kannada copy.
 *
 *   ready    the copy is made (now or before)
 *   more     some sentences were translated; call again to continue
 *   missing  the English file is not there
 *
 * Throws EngineUnavailableError if sentences are needed and the engine is
 * down, and PdfToolUnavailableError if the PDF tool cannot run.
 */
export async function translateDocumentStep(
  fileName: string,
  budget = STEP_SENTENCES,
): Promise<'ready' | 'more' | 'missing'> {
  const info = await sourceInfo(fileName);
  if (!info) return 'missing';
  if (await isReady(fileName)) return 'ready';

  const source = resolveSynopsisPath(fileName);
  const hash = await fileHash(source);
  const note = await readNote(fileName);
  if (note && note.format === PDF_FORMAT && note.sourceHash === hash && existsSync(copyPath(fileName))) {
    // The same bytes with a new timestamp - copied back from a backup, say.
    await writeNote(fileName, { ...note, sourceSize: info.size, sourceMtimeMs: Math.round(info.mtimeMs) });
    return 'ready';
  }

  const extraction = await extract(source, hash);
  const plans = plan(extraction);
  const sentences = [...new Set(plans.flatMap((p) => sentencesOf(p.pieces)).map(normalise))].filter(Boolean);
  const known = await rememberedTranslations(sentences);
  const missing = sentences.filter((s) => !known.has(s) && !unanswered.has(s));
  progress.set(path.basename(fileName), { done: sentences.length - missing.length, total: sentences.length });

  if (missing.length > 0) {
    const batch = missing.slice(0, budget);
    await translateWithMemory(batch);
    const remembered = await rememberedTranslations(batch);
    for (const sentence of batch) if (!remembered.has(sentence)) unanswered.add(sentence);
    progress.set(path.basename(fileName), {
      done: sentences.length - missing.length + batch.length,
      total: sentences.length,
    });
    return 'more';
  }

  await build(fileName, source, info, hash, plans, known);
  progress.delete(path.basename(fileName));
  return 'ready';
}

async function writeNote(fileName: string, note: Note): Promise<void> {
  await mkdir(kannadaDir(), { recursive: true });
  const partial = `${notePath(fileName)}.part`;
  await writeFile(partial, JSON.stringify(note, null, 2), 'utf8');
  await rename(partial, notePath(fileName));
}

async function build(
  fileName: string,
  source: string,
  info: { size: number; mtimeMs: number },
  hash: string,
  plans: Plan[],
  known: Map<string, string>,
): Promise<void> {
  const lookup = (sentence: string) => known.get(normalise(sentence)) ?? sentence;
  const translations: Record<string, string> = {};
  for (const p of plans) {
    const kannada = render(p.pieces, lookup).trim();
    if (kannada && kannada !== p.text && looksKannada(kannada)) translations[p.id] = kannada;
  }

  await mkdir(workDir(), { recursive: true });
  const request = path.join(workDir(), `${hash}.translations.json`);
  const output = path.join(workDir(), `${hash}.pdf`);
  const reportFile = path.join(workDir(), `${hash}.report.json`);
  await writeFile(request, JSON.stringify({ format: PDF_FORMAT, translations }), 'utf8');
  try {
    await runPdfTool(['render', source, request, output, reportFile]);
    const report = JSON.parse(await readFile(reportFile, 'utf8')) as Record<string, unknown>;
    await rename(output, copyPath(fileName));
    await writeNote(fileName, {
      format: PDF_FORMAT,
      source: path.basename(fileName),
      sourceHash: hash,
      sourceSize: info.size,
      sourceMtimeMs: Math.round(info.mtimeMs),
      engine: ENGINE_NAME,
      builtAt: new Date().toISOString(),
      paragraphs: Object.keys(translations).length,
      report,
    });
    logger.info({ fileName, paragraphs: Object.keys(translations).length, report }, 'Kannada analysis PDF made');
  } finally {
    for (const leftover of [request, reportFile, output, path.join(workDir(), `${hash}.blocks.json`)]) {
      await unlink(leftover).catch(() => {});
    }
  }
}

/** Forget a document's Kannada copy - its English was removed. */
export async function removeKannadaDocument(fileName: string | null | undefined): Promise<void> {
  if (!fileName) return;
  await Promise.all([copyPath(fileName), notePath(fileName)].map((file) => unlink(file).catch(() => {})));
  progress.delete(path.basename(fileName));
}

/** Every analysis file a test or series points at. */
async function referencedDocuments(): Promise<string[]> {
  const [tests, series] = await Promise.all([
    db.test.findMany({ where: { deletedAt: null, synopsisFileName: { not: null } }, select: { synopsisFileName: true } }),
    db.testSeries.findMany({
      where: { deletedAt: null, synopsisFileName: { not: null } },
      select: { synopsisFileName: true },
    }),
  ]);
  return [...new Set([...tests, ...series].map((row) => row.synopsisFileName!))];
}

/** Analysis files with no current Kannada copy, smallest first so the most are ready soonest. */
export async function findDocumentBacklog(): Promise<string[]> {
  const files = await referencedDocuments();
  const waiting: { file: string; size: number }[] = [];
  for (const file of files) {
    const info = await sourceInfo(file);
    if (info && !(await isReady(file))) waiting.push({ file, size: info.size });
  }
  return waiting.sort((a, b) => a.size - b.size).map((w) => w.file);
}

/** For the admin dashboard: how many analysis PDFs have their Kannada copy. */
export async function documentCoverage(): Promise<{ total: number; ready: number }> {
  const files = await referencedDocuments();
  let total = 0;
  let ready = 0;
  for (const file of files) {
    if (!(await sourceInfo(file))) continue;
    total += 1;
    if (await isReady(file)) ready += 1;
  }
  return { total, ready };
}

/** The Kannada copy, opened for streaming - or null when there is no current one. */
export async function openKannadaDocument(fileName: string): Promise<{ stream: ReturnType<typeof createReadStream>; size: number } | null> {
  const file = await kannadaDocumentPath(fileName);
  if (!file) return null;
  try {
    const info = await stat(file);
    return { stream: createReadStream(file), size: info.size };
  } catch {
    return null;
  }
}
