import 'server-only';

import { serverEnv } from '@/lib/env';
import { logger } from '@/server/logger';

/**
 * Talks to the local translation engine (translator/server.py).
 *
 * The engine is an open-source model running beside the website on the same
 * machine, so there is no key and no bill - but it can be down (still loading
 * after a deploy, or not installed yet). Every call here treats that as
 * "no translation right now" rather than an error a student would see: the
 * paper stays readable in English.
 */

export const ENGINE_NAME = 'indictrans2-en-indic-200m-int8';

/** Sentences per request: small enough to answer well inside the timeout on the server. */
const BATCH = 24;
const HEALTH_TIMEOUT_MS = 2_500;
/** A batch on the 2-vCPU server can take a while; the website never waits on it. */
const TRANSLATE_TIMEOUT_MS = 180_000;

let lastHealth: { ok: boolean; at: number } | null = null;

/** Whether the engine is up, cached for a few seconds so polling is cheap. */
export async function engineAvailable(): Promise<boolean> {
  if (lastHealth && Date.now() - lastHealth.at < 5_000) return lastHealth.ok;
  let ok = false;
  try {
    const response = await fetch(`${serverEnv().TRANSLATOR_URL}/health`, {
      signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
      cache: 'no-store',
    });
    ok = response.ok && ((await response.json()) as { ok?: boolean }).ok === true;
  } catch {
    ok = false;
  }
  lastHealth = { ok, at: Date.now() };
  return ok;
}

export class EngineUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EngineUnavailableError';
  }
}

/** Translate English sentences to Kannada, in order. Throws if the engine is down. */
export async function translateSentences(sentences: string[]): Promise<string[]> {
  const results: string[] = [];
  for (let start = 0; start < sentences.length; start += BATCH) {
    const batch = sentences.slice(start, start + BATCH);
    let response: Response;
    try {
      response = await fetch(`${serverEnv().TRANSLATOR_URL}/translate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ texts: batch }),
        signal: AbortSignal.timeout(TRANSLATE_TIMEOUT_MS),
        cache: 'no-store',
      });
    } catch (error) {
      lastHealth = { ok: false, at: Date.now() };
      throw new EngineUnavailableError(`translation engine unreachable: ${(error as Error).message}`);
    }
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      logger.warn({ status: response.status, detail: detail.slice(0, 300) }, 'Translation engine refused a batch');
      throw new EngineUnavailableError(`translation engine returned ${response.status}`);
    }
    const payload = (await response.json()) as { translations?: unknown };
    const translations = payload.translations;
    if (!Array.isArray(translations) || translations.length !== batch.length) {
      throw new EngineUnavailableError('translation engine returned a malformed response');
    }
    results.push(...translations.map((t) => (typeof t === 'string' ? t : '')));
  }
  return results;
}
