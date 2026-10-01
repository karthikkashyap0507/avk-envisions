import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The translation service against an in-memory stand-in for the database and
 * a fake engine that records every sentence it is asked for. What matters is
 * when the engine is called and what gets stored - never half a question,
 * never a stale translation, never the same sentence twice.
 */

vi.mock('server-only', () => ({}));
vi.mock('@/server/logger', () => ({ logger: { warn: vi.fn(), error: vi.fn(), debug: vi.fn(), info: vi.fn() } }));

type Row = Record<string, unknown>;
const store = {
  questions: [] as Row[],
  tests: [] as Row[],
  translations: [] as Row[],
  memory: [] as Row[],
};

function matches(row: Row, where: Row): boolean {
  return Object.entries(where).every(([key, condition]) => {
    if (condition && typeof condition === 'object' && !Array.isArray(condition)) {
      const c = condition as { in?: unknown[]; not?: unknown };
      if (c.in) return c.in.includes(row[key]);
      if ('not' in c) return row[key] !== c.not;
    }
    return row[key] === condition;
  });
}

vi.mock('@/server/db', () => ({
  db: {
    question: {
      findMany: async ({ where }: { where: Row }) => store.questions.filter((q) => matches(q, where)),
    },
    test: {
      findUnique: async ({ where }: { where: Row }) => store.tests.find((t) => t.id === where.id) ?? null,
      findMany: async () => store.tests,
    },
    contentTranslation: {
      findMany: async ({ where }: { where: Row }) => store.translations.filter((t) => matches(t, where)),
      findUnique: async ({ where }: { where: { entityType_entityId_language: Row } }) =>
        store.translations.find((t) => matches(t, where.entityType_entityId_language)) ?? null,
      upsert: async ({ where, create, update }: { where: { entityType_entityId_language: Row }; create: Row; update: Row }) => {
        const found = store.translations.find((t) => matches(t, where.entityType_entityId_language));
        if (found) Object.assign(found, update);
        else store.translations.push({ ...create });
      },
    },
    translationMemory: {
      findMany: async ({ where }: { where: Row }) => store.memory.filter((m) => matches(m, where)),
      upsert: async ({ where, create }: { where: { language_sourceHash: Row }; create: Row }) => {
        if (!store.memory.some((m) => matches(m, where.language_sourceHash))) store.memory.push({ ...create });
      },
    },
  },
}));

const engine = { calls: [] as string[][], down: false, refuse: new Set<string>(), failAfter: Infinity };
vi.mock('./engine-client', () => ({
  ENGINE_NAME: 'test-engine',
  ENGINE_BATCH: 4,
  EngineUnavailableError: class extends Error {},
  translateSentences: async (sentences: string[]) => {
    if (engine.down || engine.calls.length >= engine.failAfter) throw new Error('engine down');
    engine.calls.push(sentences);
    // A recognisable "translation": Kannada letters prefixed to the English.
    return sentences.map((s) => (engine.refuse.has(s) ? s : `ಕ ${s}`));
  },
}));

const { readQuestionTranslations, translateQuestions, readTestTranslation, translateTest, findBacklog } =
  await import('./translation-service');

function question(id: string, overrides: Partial<Row> = {}): Row {
  return {
    id,
    status: 'PUBLISHED',
    deletedAt: null,
    body: 'Consider the following statements:\nA. The Lok Sabha is elected.\nB. The Council is not.',
    passage: null,
    explanation: 'Statement A is correct.',
    detailedSolution: null,
    options: [
      { id: `${id}-o1`, body: 'A only' },
      { id: `${id}-o2`, body: 'A-1, B-2' },
    ],
    ...overrides,
  };
}

beforeEach(() => {
  store.questions = [];
  store.tests = [];
  store.translations = [];
  store.memory = [];
  engine.calls = [];
  engine.down = false;
  engine.refuse = new Set();
  engine.failAfter = Infinity;
});

describe('translateQuestions', () => {
  it('translates a stem, keeping markers and codes, keyed by option id', async () => {
    store.questions.push(question('q1'));
    expect(await translateQuestions(['q1'], 'stem')).toBe(1);

    const { stems, pending } = await readQuestionTranslations(['q1'], ['stem']);
    expect(pending.stem).toEqual([]);
    expect(stems.q1!.body).toBe(
      'ಕ Consider the following statements:\nA. ಕ The Lok Sabha is elected.\nB. ಕ The Council is not.',
    );
    expect(stems.q1!.options).toEqual({ 'q1-o1': 'ಕ A only', 'q1-o2': 'A-1, B-2' });
  });

  it('does nothing the second time', async () => {
    store.questions.push(question('q1'));
    await translateQuestions(['q1'], 'stem');
    engine.calls = [];
    expect(await translateQuestions(['q1'], 'stem')).toBe(0);
    expect(engine.calls).toEqual([]);
  });

  it('treats an edited question as stale, and retranslates only the new sentence', async () => {
    store.questions.push(question('q1'));
    await translateQuestions(['q1'], 'stem');

    store.questions[0]!.body = 'Consider the following statements:\nA. The Lok Sabha is elected.\nB. The Council is nominated.';
    expect((await readQuestionTranslations(['q1'], ['stem'])).pending.stem).toEqual(['q1']);

    engine.calls = [];
    await translateQuestions(['q1'], 'stem');
    expect(engine.calls.flat()).toEqual(['The Council is nominated.']);
    expect((await readQuestionTranslations(['q1'], ['stem'])).stems.q1!.body).toContain('ಕ The Council is nominated.');
  });

  it('reuses a sentence across questions instead of translating it again', async () => {
    store.questions.push(question('q1'), question('q2'));
    await translateQuestions(['q1'], 'stem');
    engine.calls = [];
    await translateQuestions(['q2'], 'stem');
    expect(engine.calls).toEqual([]);
  });

  it('keeps English for a sentence the engine could not put into Kannada, without remembering it', async () => {
    engine.refuse.add('A only');
    store.questions.push(question('q1'));
    await translateQuestions(['q1'], 'stem');
    expect((await readQuestionTranslations(['q1'], ['stem'])).stems.q1!.options['q1-o1']).toBe('A only');
    expect(store.memory.some((m) => m.source === 'A only')).toBe(false);
  });

  it('asks the engine in small batches', async () => {
    store.questions.push(question('q1', { body: 'One. Two. Three. Four. Five. Six.' }));
    await translateQuestions(['q1'], 'stem');
    expect(engine.calls.every((batch) => batch.length <= 4)).toBe(true);
  });

  it('keeps what was translated before the engine failed, and resumes from there', async () => {
    store.questions.push(question('q1', { body: 'One. Two. Three. Four. Five. Six.' }));
    engine.failAfter = 1;
    await expect(translateQuestions(['q1'], 'stem')).rejects.toThrow();
    // The question is not stored half-done, but the first batch is remembered.
    expect(store.translations).toEqual([]);
    expect(store.memory.map((m) => m.source).sort()).toEqual(['Four.', 'One.', 'Three.', 'Two.']);

    engine.failAfter = Infinity;
    engine.calls = [];
    await translateQuestions(['q1'], 'stem');
    expect(engine.calls.flat()).not.toContain('One.');
    expect((await readQuestionTranslations(['q1'], ['stem'])).pending.stem).toEqual([]);
  });

  it('stores nothing when the engine is down', async () => {
    engine.down = true;
    store.questions.push(question('q1'));
    await expect(translateQuestions(['q1'], 'stem')).rejects.toThrow();
    expect(store.translations).toEqual([]);
  });

  it('translates an HTML solution block by block, tags intact', async () => {
    store.questions.push(
      question('q1', { detailedSolution: '<h2>Conclusion</h2><p>The answer is <strong>A only</strong>.</p>' }),
    );
    await translateQuestions(['q1'], 'solution');
    const { solutions } = await readQuestionTranslations(['q1'], ['solution']);
    expect(solutions.q1!.detailedSolution).toBe('<h2>ಕ Conclusion</h2><p>ಕ The answer is A only.</p>');
    expect(solutions.q1!.explanation).toBe('ಕ Statement A is correct.');
  });
});

describe('readQuestionTranslations', () => {
  it('never returns solutions unless asked for them', async () => {
    store.questions.push(question('q1'));
    await translateQuestions(['q1'], 'stem');
    await translateQuestions(['q1'], 'solution');
    const stemOnly = await readQuestionTranslations(['q1'], ['stem']);
    expect(stemOnly.solutions).toEqual({});
    expect(stemOnly.pending.solution).toEqual([]);
  });

  it('does not list a question with no solution as pending', async () => {
    store.questions.push(question('q1', { explanation: null, detailedSolution: null }));
    expect((await readQuestionTranslations(['q1'], ['solution'])).pending.solution).toEqual([]);
  });
});

describe('tests and the backlog', () => {
  it('translates a test title and instructions, and notices an edit', async () => {
    store.tests.push({ id: 't1', title: 'Polity Test', description: null, instructions: 'Answer every question.' });
    await translateTest('t1');
    expect(await readTestTranslation('t1')).toEqual({
      title: 'ಕ Polity Test',
      description: null,
      instructions: 'ಕ Answer every question.',
    });
    store.tests[0]!.title = 'Polity Test 2';
    expect(await readTestTranslation('t1')).toBeNull();
  });

  it('lists everything without a current translation, stems before solutions', async () => {
    store.questions.push(question('q1'), question('q2'));
    store.tests.push({ id: 't1', title: 'T', description: null, instructions: null, questions: [{ questionId: 'q2' }] });
    await translateQuestions(['q1'], 'stem');
    const backlog = await findBacklog();
    expect(backlog.tests).toEqual(['t1']);
    // q2 is in a published test, so it comes first.
    expect(backlog.stems).toEqual(['q2']);
    expect(backlog.solutions).toEqual(['q2', 'q1']);
    expect(backlog.totals).toEqual({ questions: 2, withSolution: 2 });
  });
});
