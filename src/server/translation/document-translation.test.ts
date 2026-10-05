import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The Kannada copies of analysis PDFs, with the PDF tool and the engine
 * replaced by fakes that record what they are asked. What matters: a copy is
 * offered only when complete and made from the English as it is now, the
 * work goes in small steps, and nothing translated is lost on the way.
 */

vi.mock('server-only', () => ({}));
vi.mock('@/server/logger', () => ({ logger: { warn: vi.fn(), error: vi.fn(), debug: vi.fn(), info: vi.fn() } }));

const dir = mkdtempSync(path.join(tmpdir(), 'avk-kn-docs-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

vi.mock('@/server/services/synopsis-service', () => ({
  synopsisDir: () => dir,
  resolveSynopsisPath: (name: string) => path.join(dir, path.basename(name)),
}));

const referenced = { tests: [] as { synopsisFileName: string }[], series: [] as { synopsisFileName: string }[] };
vi.mock('@/server/db', () => ({
  db: {
    test: { findMany: async () => referenced.tests },
    testSeries: { findMany: async () => referenced.series },
  },
}));

vi.mock('./engine-client', () => ({ ENGINE_NAME: 'test-engine' }));

/** The sentence memory, and an engine that translates by tagging. */
const memory = new Map<string, string>();
const engine = { calls: [] as string[][], down: false };
vi.mock('./translation-service', () => ({
  normalise: (s: string) => s.replace(/\s+/g, ' ').trim(),
  looksKannada: (s: string) => /[ಀ-೿]/.test(s),
  rememberedTranslations: async (sentences: string[]) =>
    new Map(sentences.filter((s) => memory.has(s)).map((s) => [s, memory.get(s)!])),
  translateWithMemory: async (sentences: string[]) => {
    if (engine.down) throw new Error('engine down');
    engine.calls.push(sentences);
    for (const s of sentences) memory.set(s, `ಕ ${s}`);
    return new Map(sentences.map((s) => [s, `ಕ ${s}`]));
  },
}));

/** Paragraphs each fake PDF "contains", by file name. */
const contents = new Map<string, string[]>();
const tool = { calls: [] as string[][], lastTranslations: {} as Record<string, string> };
vi.mock('./pdf-tool', () => ({
  PDF_FORMAT: 1,
  PdfToolUnavailableError: class extends Error {},
  runPdfTool: async (args: string[]) => {
    tool.calls.push(args);
    if (args[0] === 'extract') {
      const texts = contents.get(path.basename(args[1]!)) ?? [];
      writeFileSync(
        args[2]!,
        JSON.stringify({ format: 1, pages: [{ index: 0, blocks: texts.map((text, n) => ({ id: `0-${n}`, text })) }] }),
      );
    } else {
      const request = JSON.parse(readFileSync(args[2]!, 'utf8')) as { translations: Record<string, string> };
      tool.lastTranslations = request.translations;
      writeFileSync(args[3]!, `%PDF-kannada ${JSON.stringify(request.translations)}`);
      writeFileSync(args[4]!, JSON.stringify({ blocks: Object.keys(request.translations).length, overflow: [] }));
    }
  },
}));

const docs = await import('./document-translation');

function upload(name: string, paragraphs: string[], bytes = paragraphs.join('|')) {
  contents.set(name, paragraphs);
  writeFileSync(path.join(dir, name), `%PDF-1.7 ${bytes}`);
}

async function finish(name: string): Promise<number> {
  let steps = 0;
  while ((await docs.translateDocumentStep(name, 2)) === 'more') {
    steps += 1;
    if (steps > 50) throw new Error('never finished');
  }
  return steps;
}

const PARAGRAPHS = [
  'ANSWER',
  '(1) A, C,D, B',
  'This tests the budget. Compare the sizes.',
  '• Revenue receipt → non-debt receipt',
  'AVK ENVISIONS',
];

beforeEach(() => {
  // Every test starts with no English files and no copies.
  for (const entry of readdirSync(dir)) rmSync(path.join(dir, entry), { recursive: true, force: true });
  contents.clear();
  memory.clear();
  engine.calls = [];
  engine.down = false;
  tool.calls = [];
  tool.lastTranslations = {};
  referenced.tests = [];
  referenced.series = [];
});

describe('translateDocumentStep', () => {
  it('works in small steps, and offers the copy only when it is complete', async () => {
    upload('paper.pdf', PARAGRAPHS);

    expect(await docs.translateDocumentStep('paper.pdf', 2)).toBe('more');
    expect(engine.calls).toEqual([['This tests the budget.', 'Compare the sizes.']]);
    // Half done is not done.
    expect(await docs.kannadaDocumentPath('paper.pdf')).toBeNull();
    expect(await docs.documentState('paper.pdf')).toMatchObject({ state: 'pending', done: 2, total: 4 });

    await finish('paper.pdf');
    const copy = await docs.kannadaDocumentPath('paper.pdf');
    expect(copy).toBe(path.join(dir, 'kn', 'paper.pdf'));
    expect(readFileSync(copy!, 'utf8')).toMatch(/^%PDF-kannada/);
    expect(await docs.documentState('paper.pdf')).toEqual({ state: 'ready' });
  });

  it('sends the PDF tool Kannada only for what changes: headings fixed, codes and the brand left alone', async () => {
    upload('paper.pdf', PARAGRAPHS);
    await finish('paper.pdf');
    expect(tool.lastTranslations).toEqual({
      '0-0': 'ಉತ್ತರ',
      '0-2': 'ಕ This tests the budget. ಕ Compare the sizes.',
      '0-3': '• ಕ Revenue receipt → ಕ non-debt receipt',
    });
  });

  it('reads the PDF once, however many steps it takes', async () => {
    upload('paper.pdf', PARAGRAPHS);
    await finish('paper.pdf');
    expect(tool.calls.filter((c) => c[0] === 'extract')).toHaveLength(1);
    expect(tool.calls.filter((c) => c[0] === 'render')).toHaveLength(1);
  });

  it('asks the engine nothing for sentences the memory already has', async () => {
    memory.set('This tests the budget.', 'ಬಜೆಟ್');
    memory.set('Compare the sizes.', 'ಹೋಲಿಸಿ');
    memory.set('Revenue receipt', 'ಆದಾಯ');
    memory.set('non-debt receipt', 'ಸಾಲೇತರ');
    upload('paper.pdf', PARAGRAPHS);
    expect(await docs.translateDocumentStep('paper.pdf')).toBe('ready');
    expect(engine.calls).toEqual([]);
  });

  it('keeps what was translated when the engine stops, and goes on from there', async () => {
    upload('paper.pdf', PARAGRAPHS);
    await docs.translateDocumentStep('paper.pdf', 2);
    engine.down = true;
    await expect(docs.translateDocumentStep('paper.pdf', 2)).rejects.toThrow();
    expect(await docs.kannadaDocumentPath('paper.pdf')).toBeNull();

    engine.down = false;
    engine.calls = [];
    await finish('paper.pdf');
    expect(engine.calls.flat()).not.toContain('This tests the budget.');
    expect(await docs.hasKannadaDocument('paper.pdf')).toBe(true);
  });

  it('treats a replaced English file as a new document', async () => {
    upload('paper.pdf', PARAGRAPHS);
    await finish('paper.pdf');

    upload('paper.pdf', ['QUESTION', 'A corrected sentence.'], 'new bytes');
    expect(await docs.kannadaDocumentPath('paper.pdf')).toBeNull();
    await finish('paper.pdf');
    expect(tool.lastTranslations).toEqual({ '0-0': 'ಪ್ರಶ್ನೆ', '0-1': 'ಕ A corrected sentence.' });
    expect(await docs.hasKannadaDocument('paper.pdf')).toBe(true);
  });

  it('does not remake a copy when only the timestamp moved', async () => {
    upload('paper.pdf', PARAGRAPHS);
    await finish('paper.pdf');
    tool.calls = [];

    const later = new Date(Date.now() + 60_000);
    utimesSync(path.join(dir, 'paper.pdf'), later, later);
    expect(await docs.hasKannadaDocument('paper.pdf')).toBe(false);
    expect(await docs.translateDocumentStep('paper.pdf')).toBe('ready');
    expect(tool.calls).toEqual([]);
    expect(await docs.hasKannadaDocument('paper.pdf')).toBe(true);
  });

  it('reports a missing English file, and forgets a removed one', async () => {
    expect(await docs.translateDocumentStep('nowhere.pdf')).toBe('missing');

    upload('paper.pdf', PARAGRAPHS);
    await finish('paper.pdf');
    await docs.removeKannadaDocument('paper.pdf');
    expect(existsSync(path.join(dir, 'kn', 'paper.pdf'))).toBe(false);
    expect(await docs.hasKannadaDocument('paper.pdf')).toBe(false);
  });
});

describe('the backlog', () => {
  it('lists referenced documents without a current copy, smallest first', async () => {
    upload('big.pdf', ['A long paper.'], 'x'.repeat(5000));
    upload('small.pdf', ['A short paper.'], 'x');
    upload('done.pdf', ['QUESTION']);
    await finish('done.pdf');
    referenced.tests = [{ synopsisFileName: 'big.pdf' }, { synopsisFileName: 'done.pdf' }, { synopsisFileName: 'gone.pdf' }];
    referenced.series = [{ synopsisFileName: 'small.pdf' }, { synopsisFileName: 'big.pdf' }];

    expect(await docs.findDocumentBacklog()).toEqual(['small.pdf', 'big.pdf']);
    expect(await docs.documentCoverage()).toEqual({ total: 3, ready: 1 });
  });
});
