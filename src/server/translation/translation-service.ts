import 'server-only';

import { createHash } from 'crypto';

import { db } from '@/server/db';
import { logger } from '@/server/logger';

import { ENGINE_BATCH, ENGINE_NAME, translateSentences } from './engine-client';
import { planHtml, planPlainText, render, sentencesOf, type HtmlPiece, type Piece } from './segments';

/**
 * Kannada versions of questions and tests, made from the English on demand.
 *
 * Admins only ever write English. Each question is translated once by the
 * local engine and stored, fingerprinted by the English it came from: when an
 * admin edits the question the fingerprint no longer matches, the stored
 * translation is treated as missing, and it is made again. Nothing here is
 * ever shown in place of the English unless it is current.
 *
 * A question has two parts, translated and stored separately:
 *   - its stem (question, passage, options), shown while a test is running;
 *   - its solution (explanation and detailed solution), shown only after the
 *     test is submitted - so an attempt in progress never needs it.
 */

export const KANNADA = 'kn';
export type TranslationPart = 'stem' | 'solution';

const ENTITY: Record<TranslationPart, string> = { stem: 'QUESTION_STEM', solution: 'QUESTION_SOLUTION' };
const TEST_ENTITY = 'TEST';

/** Bump to retranslate everything after a change to how text is split. */
const FORMAT_VERSION = 1;

export interface StemTranslation {
  body: string;
  passage: string | null;
  /** Keyed by option id. */
  options: Record<string, string>;
}

export interface SolutionTranslation {
  explanation: string | null;
  detailedSolution: string | null;
}

export interface TestTranslation {
  title: string;
  description: string | null;
  instructions: string | null;
}

interface QuestionSource {
  id: string;
  body: string;
  passage: string | null;
  explanation: string | null;
  detailedSolution: string | null;
  options: { id: string; body: string }[];
}

const QUESTION_SOURCE = {
  id: true,
  body: true,
  passage: true,
  explanation: true,
  detailedSolution: true,
  // `sortOrder` is selected as well as ordered by: across more than a few
  // hundred questions Prisma splits this query into chunks, and merging them
  // back needs the ordering field - without it the query engine panics.
  options: { orderBy: { sortOrder: 'asc' as const }, select: { id: true, body: true, sortOrder: true } },
};

function fingerprint(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export function questionHash(question: QuestionSource, part: TranslationPart): string {
  return part === 'stem'
    ? fingerprint({
        v: FORMAT_VERSION,
        body: question.body,
        passage: question.passage,
        options: question.options.map((o) => [o.id, o.body]),
      })
    : fingerprint({ v: FORMAT_VERSION, explanation: question.explanation, detailed: question.detailedSolution });
}

function hasSolution(question: QuestionSource): boolean {
  return Boolean(question.explanation?.trim() || question.detailedSolution?.trim());
}

// ---------------------------------------------------------------------------
// Sentence memory
// ---------------------------------------------------------------------------

function normalise(sentence: string): string {
  return sentence.replace(/\s+/g, ' ').trim();
}

/** Real Kannada came back, not an echo of the English or an empty string. */
function looksKannada(text: string): boolean {
  return /[ಀ-೿]/.test(text);
}

/**
 * Translations for these sentences, reusing every one already made.
 *
 * Keyed by the normalised sentence, and complete whenever it returns: a
 * sentence the engine answered without any Kannada keeps its English and is
 * not stored, so it is asked for again next time instead of being cached as
 * permanently "translated". Throws only if the engine is unreachable.
 */
async function translateWithMemory(sentences: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(sentences.map(normalise))].filter(Boolean);
  const keyOf = new Map(unique.map((s) => [fingerprint(s), s]));
  const known = new Map<string, string>();

  const keys = [...keyOf.keys()];
  for (let i = 0; i < keys.length; i += 400) {
    const rows = await db.translationMemory.findMany({
      where: { language: KANNADA, sourceHash: { in: keys.slice(i, i + 400) } },
      select: { sourceHash: true, target: true },
    });
    for (const row of rows) known.set(keyOf.get(row.sourceHash)!, row.target);
  }

  // One small batch at a time, each remembered the moment it comes back. On
  // the capped server a long solution is minutes of work; if the engine
  // stops part-way, every sentence already translated is kept, and the next
  // attempt starts where this one ended instead of from the beginning.
  const missing = unique.filter((s) => !known.has(s));
  for (let start = 0; start < missing.length; start += ENGINE_BATCH) {
    const batch = missing.slice(start, start + ENGINE_BATCH);
    const translated = await translateSentences(batch);
    for (const [i, source] of batch.entries()) {
      const target = translated[i]?.trim() ?? '';
      if (!looksKannada(target)) {
        // The engine answered but not in Kannada - a bare name or a code, or
        // a sentence it could not handle. Keep the English for this question
        // so it completes, but do not remember it as translated.
        known.set(source, source);
        continue;
      }
      known.set(source, target);
      await db.translationMemory
        .upsert({
          where: { language_sourceHash: { language: KANNADA, sourceHash: fingerprint(source) } },
          create: { language: KANNADA, sourceHash: fingerprint(source), source, target, engine: ENGINE_NAME },
          update: {},
        })
        .catch((error) => logger.warn({ error }, 'Could not store a translated sentence'));
    }
  }

  return known;
}

// ---------------------------------------------------------------------------
// Questions
// ---------------------------------------------------------------------------

interface StemPlan {
  body: HtmlPiece[];
  passage: HtmlPiece[] | null;
  options: { id: string; plan: HtmlPiece[] }[];
}
interface SolutionPlan {
  explanation: HtmlPiece[] | null;
  detailedSolution: HtmlPiece[] | null;
}

function planStem(question: QuestionSource): StemPlan {
  return {
    body: planPlainText(question.body),
    passage: question.passage ? planPlainText(question.passage) : null,
    options: question.options.map((o) => ({ id: o.id, plan: planPlainText(o.body) })),
  };
}

function planSolution(question: QuestionSource): SolutionPlan {
  return {
    explanation: question.explanation ? planPlainText(question.explanation) : null,
    detailedSolution: question.detailedSolution ? planHtml(question.detailedSolution) : null,
  };
}

function allPieces(plan: StemPlan | SolutionPlan): HtmlPiece[][] {
  if ('body' in plan) return [plan.body, ...(plan.passage ? [plan.passage] : []), ...plan.options.map((o) => o.plan)];
  return [plan.explanation, plan.detailedSolution].filter((p): p is HtmlPiece[] => p !== null);
}

/**
 * Translate these questions' stems or solutions, where they are not already
 * current. Returns how many were stored.
 *
 * A question is stored only when every one of its sentences was translated:
 * half a question in Kannada and half in English is worse than asking again.
 * Throws EngineUnavailableError if the engine is down.
 */
export async function translateQuestions(questionIds: string[], part: TranslationPart): Promise<number> {
  if (questionIds.length === 0) return 0;

  const [questions, existing] = await Promise.all([
    db.question.findMany({ where: { id: { in: questionIds }, deletedAt: null }, select: QUESTION_SOURCE }),
    db.contentTranslation.findMany({
      where: { entityType: ENTITY[part], language: KANNADA, entityId: { in: questionIds } },
      select: { entityId: true, sourceHash: true },
    }),
  ]);
  const current = new Map(existing.map((row) => [row.entityId, row.sourceHash]));

  const todo = questions.filter(
    (q) => (part === 'stem' || hasSolution(q)) && current.get(q.id) !== questionHash(q, part),
  );
  if (todo.length === 0) return 0;

  const plans = todo.map((q) => ({ q, plan: part === 'stem' ? planStem(q) : planSolution(q) }));
  const memory = await translateWithMemory(plans.flatMap(({ plan }) => allPieces(plan).flatMap(sentencesOf)));
  const lookup = (sentence: string) => memory.get(normalise(sentence));

  let stored = 0;
  for (const { q, plan } of plans) {
    const complete = allPieces(plan).every((pieces) => sentencesOf(pieces).every((s) => lookup(s) !== undefined));
    if (!complete) continue;

    const payload: StemTranslation | SolutionTranslation =
      'body' in plan
        ? {
            body: render(plan.body, lookup),
            passage: plan.passage ? render(plan.passage, lookup) : null,
            options: Object.fromEntries(plan.options.map((o) => [o.id, render(o.plan, lookup)])),
          }
        : {
            explanation: plan.explanation ? render(plan.explanation, lookup) : null,
            detailedSolution: plan.detailedSolution ? render(plan.detailedSolution, lookup) : null,
          };

    const sourceHash = questionHash(q, part);
    await db.contentTranslation.upsert({
      where: { entityType_entityId_language: { entityType: ENTITY[part], entityId: q.id, language: KANNADA } },
      create: {
        entityType: ENTITY[part],
        entityId: q.id,
        language: KANNADA,
        sourceHash,
        payloadJson: JSON.stringify(payload),
        engine: ENGINE_NAME,
      },
      update: { sourceHash, payloadJson: JSON.stringify(payload), engine: ENGINE_NAME },
    });
    stored += 1;
  }
  return stored;
}

export interface QuestionTranslations {
  stems: Record<string, StemTranslation>;
  solutions: Record<string, SolutionTranslation>;
  /** Question ids whose requested parts are not ready yet. */
  pending: { stem: string[]; solution: string[] };
}

/**
 * The current Kannada for these questions: only translations made from the
 * English as it is now. Anything missing or stale is listed as pending.
 */
export async function readQuestionTranslations(
  questionIds: string[],
  parts: TranslationPart[],
): Promise<QuestionTranslations> {
  const result: QuestionTranslations = { stems: {}, solutions: {}, pending: { stem: [], solution: [] } };
  if (questionIds.length === 0) return result;

  const [questions, rows] = await Promise.all([
    db.question.findMany({ where: { id: { in: questionIds } }, select: QUESTION_SOURCE }),
    db.contentTranslation.findMany({
      where: {
        language: KANNADA,
        entityId: { in: questionIds },
        entityType: { in: parts.map((p) => ENTITY[p]) },
      },
      select: { entityType: true, entityId: true, sourceHash: true, payloadJson: true },
    }),
  ]);
  const stored = new Map(rows.map((row) => [`${row.entityType}:${row.entityId}`, row]));

  for (const question of questions) {
    for (const part of parts) {
      if (part === 'solution' && !hasSolution(question)) continue;
      const row = stored.get(`${ENTITY[part]}:${question.id}`);
      if (row && row.sourceHash === questionHash(question, part)) {
        const payload = JSON.parse(row.payloadJson);
        if (part === 'stem') result.stems[question.id] = payload as StemTranslation;
        else result.solutions[question.id] = payload as SolutionTranslation;
      } else {
        result.pending[part].push(question.id);
      }
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// A test's own text: title, description, instructions
// ---------------------------------------------------------------------------

interface TestSource {
  id: string;
  title: string;
  description: string | null;
  instructions: string | null;
}

function testHash(test: TestSource): string {
  return fingerprint({ v: FORMAT_VERSION, t: test.title, d: test.description, i: test.instructions });
}

export async function translateTest(testId: string): Promise<boolean> {
  const test = await db.test.findUnique({
    where: { id: testId },
    select: { id: true, title: true, description: true, instructions: true },
  });
  if (!test) return false;

  const existing = await db.contentTranslation.findUnique({
    where: { entityType_entityId_language: { entityType: TEST_ENTITY, entityId: testId, language: KANNADA } },
    select: { sourceHash: true },
  });
  if (existing?.sourceHash === testHash(test)) return false;

  const plans = {
    title: planPlainText(test.title),
    description: test.description ? planPlainText(test.description) : null,
    instructions: test.instructions ? planPlainText(test.instructions) : null,
  };
  const pieces = [plans.title, plans.description, plans.instructions].filter((p): p is Piece[] => p !== null);
  const memory = await translateWithMemory(pieces.flatMap(sentencesOf));
  const lookup = (sentence: string) => memory.get(normalise(sentence));
  if (!pieces.every((p) => sentencesOf(p).every((s) => lookup(s) !== undefined))) return false;

  const payload: TestTranslation = {
    title: render(plans.title, lookup),
    description: plans.description ? render(plans.description, lookup) : null,
    instructions: plans.instructions ? render(plans.instructions, lookup) : null,
  };
  await db.contentTranslation.upsert({
    where: { entityType_entityId_language: { entityType: TEST_ENTITY, entityId: testId, language: KANNADA } },
    create: {
      entityType: TEST_ENTITY,
      entityId: testId,
      language: KANNADA,
      sourceHash: testHash(test),
      payloadJson: JSON.stringify(payload),
      engine: ENGINE_NAME,
    },
    update: { sourceHash: testHash(test), payloadJson: JSON.stringify(payload), engine: ENGINE_NAME },
  });
  return true;
}

/** The current Kannada for a test's own text, or null if not ready. */
export async function readTestTranslation(testId: string): Promise<TestTranslation | null> {
  const [test, row] = await Promise.all([
    db.test.findUnique({ where: { id: testId }, select: { id: true, title: true, description: true, instructions: true } }),
    db.contentTranslation.findUnique({
      where: { entityType_entityId_language: { entityType: TEST_ENTITY, entityId: testId, language: KANNADA } },
      select: { sourceHash: true, payloadJson: true },
    }),
  ]);
  if (!test || !row || row.sourceHash !== testHash(test)) return null;
  return JSON.parse(row.payloadJson) as TestTranslation;
}

// ---------------------------------------------------------------------------
// The backlog: what the background worker should translate next
// ---------------------------------------------------------------------------

export interface Backlog {
  tests: string[];
  stems: string[];
  solutions: string[];
  /** Published questions, and how many of them have a solution to translate. */
  totals: { questions: number; withSolution: number };
}

/**
 * Everything published that has no current Kannada yet.
 *
 * Questions in published tests come first - those are what students open -
 * and stems before solutions, since a paper can be sat once its stems are
 * done but a solution is only read afterwards.
 */
export async function findBacklog(): Promise<Backlog> {
  const [tests, questions, rows] = await Promise.all([
    db.test.findMany({
      where: { deletedAt: null, status: 'PUBLISHED' },
      select: {
        id: true,
        title: true,
        description: true,
        instructions: true,
        questions: { select: { questionId: true } },
      },
      orderBy: { updatedAt: 'desc' },
    }),
    db.question.findMany({ where: { deletedAt: null, status: 'PUBLISHED' }, select: QUESTION_SOURCE }),
    db.contentTranslation.findMany({
      where: { language: KANNADA },
      select: { entityType: true, entityId: true, sourceHash: true },
    }),
  ]);

  const stored = new Map(rows.map((row) => [`${row.entityType}:${row.entityId}`, row.sourceHash]));
  const inTests = new Set(tests.flatMap((t) => t.questions.map((q) => q.questionId)));
  const ordered = [
    ...questions.filter((q) => inTests.has(q.id)),
    ...questions.filter((q) => !inTests.has(q.id)),
  ];

  return {
    totals: { questions: questions.length, withSolution: questions.filter(hasSolution).length },
    tests: tests.filter((t) => stored.get(`${TEST_ENTITY}:${t.id}`) !== testHash(t)).map((t) => t.id),
    stems: ordered.filter((q) => stored.get(`${ENTITY.stem}:${q.id}`) !== questionHash(q, 'stem')).map((q) => q.id),
    solutions: ordered
      .filter((q) => hasSolution(q) && stored.get(`${ENTITY.solution}:${q.id}`) !== questionHash(q, 'solution'))
      .map((q) => q.id),
  };
}

/** For the admin panel: how much of the published bank reads in Kannada. */
export async function translationCoverage(): Promise<{
  questions: number;
  stems: number;
  withSolution: number;
  solutions: number;
}> {
  const { totals, stems, solutions } = await findBacklog();
  return {
    questions: totals.questions,
    stems: totals.questions - stems.length,
    withSolution: totals.withSolution,
    solutions: totals.withSolution - solutions.length,
  };
}
