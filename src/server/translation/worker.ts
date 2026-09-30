import 'server-only';

import { serverEnv } from '@/lib/env';
import { logger } from '@/server/logger';

import { EngineUnavailableError } from './engine-client';
import {
  findBacklog,
  translateQuestions,
  translateTest,
  type Backlog,
  type TranslationPart,
} from './translation-service';

/**
 * The one place translations are made, one small job at a time.
 *
 * Two sources of work, in strict priority:
 *
 *   1. Requests - a student opened a test in Kannada and something is not
 *      ready. The question on their screen can be pushed to the very front.
 *   2. The backlog - everything published without a current translation,
 *      worked through while nobody is waiting, so most tests are ready before
 *      anyone asks. New and edited questions join it on the next scan.
 *
 * One job at a time on purpose: the engine uses the cores it is given, and on
 * the 2-vCPU server the website needs the rest.
 */

type Kind = TranslationPart | 'test';
type Key = `${Kind}:${string}`;

/**
 * Questions per job: small, so a request never waits long behind one. A
 * solution can run to dozens of sentences, so those go one question at a time.
 */
const JOB_SIZE: Record<Kind, number> = { stem: 4, solution: 1, test: 1 };
const IDLE_MS = 5 * 60_000;
const ENGINE_DOWN_MS = 30_000;
/** How stale the backlog may get while there is still work in it. */
const BACKLOG_REFRESH_MS = 30 * 60_000;

class TranslationWorker {
  /**
   * Two lanes. Question text and test titles are what a student needs while
   * sitting a paper; solutions are only read afterwards. A long solution must
   * never make someone wait for the question on their screen, so the first
   * lane is always emptied before the second is touched.
   */
  private urgent: Key[] = [];
  private urgentSolutions: Key[] = [];
  private backlog: Backlog | null = null;
  private backlogAt = 0;
  private wakeUp: (() => void) | null = null;
  private started = false;

  private lastError: string | null = null;
  private lastDoneAt: number | null = null;

  /** Ask for these to be translated before the backlog. `front` jumps the queue. */
  request(keys: Key[], options: { front?: boolean } = {}) {
    if (keys.length === 0) return;
    const solutions = keys.filter((key) => key.startsWith('solution:'));
    const others = keys.filter((key) => !key.startsWith('solution:'));
    this.urgent = this.enqueue(this.urgent, others, options.front);
    this.urgentSolutions = this.enqueue(this.urgentSolutions, solutions, options.front);
    this.wake();
  }

  private enqueue(queue: Key[], keys: Key[], front = false): Key[] {
    if (keys.length === 0) return queue;
    const rest = queue.filter((key) => !keys.includes(key));
    const fresh = keys.filter((key) => !queue.includes(key));
    return front ? [...keys, ...rest] : [...queue, ...fresh];
  }

  status() {
    return {
      queued: this.urgent.length + this.urgentSolutions.length,
      backlog: this.backlog
        ? this.backlog.tests.length + this.backlog.stems.length + this.backlog.solutions.length
        : null,
      lastDoneAt: this.lastDoneAt ? new Date(this.lastDoneAt).toISOString() : null,
      lastError: this.lastError,
    };
  }

  start() {
    if (this.started) return;
    this.started = true;
    void this.loop();
  }

  private wake() {
    const wake = this.wakeUp;
    this.wakeUp = null;
    wake?.();
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.wakeUp = null;
        resolve();
      }, ms);
      this.wakeUp = () => {
        clearTimeout(timer);
        resolve();
      };
    });
  }

  /** The next run of same-kind keys: question text first, then solutions. */
  private takeUrgent(): { kind: Kind; ids: string[] } | null {
    const queue = this.urgent.length > 0 ? this.urgent : this.urgentSolutions;
    const first = queue[0];
    if (!first) return null;
    const kind = first.slice(0, first.indexOf(':')) as Kind;
    const ids: string[] = [];
    while (queue.length > 0 && ids.length < JOB_SIZE[kind] && queue[0]!.startsWith(`${kind}:`)) {
      ids.push(queue.shift()!.slice(kind.length + 1));
    }
    return { kind, ids };
  }

  private async takeBacklog(): Promise<{ kind: Kind; ids: string[] } | null> {
    if (serverEnv().TRANSLATION_BACKGROUND === 'off') return null;

    const empty = !this.backlog || this.backlog.tests.length + this.backlog.stems.length + this.backlog.solutions.length === 0;
    const age = Date.now() - this.backlogAt;
    if (!this.backlog || (empty && age > IDLE_MS) || age > BACKLOG_REFRESH_MS) {
      this.backlog = await findBacklog();
      this.backlogAt = Date.now();
    }

    const { tests, stems, solutions } = this.backlog;
    if (tests.length > 0) return { kind: 'test', ids: tests.splice(0, JOB_SIZE.test) };
    if (stems.length > 0) return { kind: 'stem', ids: stems.splice(0, JOB_SIZE.stem) };
    if (solutions.length > 0) return { kind: 'solution', ids: solutions.splice(0, JOB_SIZE.solution) };
    return null;
  }

  private async loop() {
    for (;;) {
      let job: { kind: Kind; ids: string[] } | null = null;
      let fromRequest = false;
      try {
        // No check that the engine is up first: a job whose sentences are all
        // in the translation memory completes without it. One that needs the
        // engine while it is down throws, and is retried after a pause.
        job = this.takeUrgent();
        fromRequest = job !== null;
        job ??= await this.takeBacklog();
        if (!job) {
          await this.sleep(IDLE_MS);
          continue;
        }

        const started = Date.now();
        if (job.kind === 'test') {
          for (const id of job.ids) await translateTest(id);
        } else {
          await translateQuestions(job.ids, job.kind);
        }
        this.lastDoneAt = Date.now();
        this.lastError = null;
        logger.debug({ kind: job.kind, count: job.ids.length, ms: Date.now() - started }, 'Translated');
      } catch (error) {
        this.lastError = (error as Error).message;
        if (job && fromRequest) {
          // Put a student's request back where it was rather than dropping it.
          const back = job.ids.map((id) => `${job!.kind}:${id}` as Key);
          if (job.kind === 'solution') this.urgentSolutions = [...back, ...this.urgentSolutions];
          else this.urgent = [...back, ...this.urgent];
        }
        if (error instanceof EngineUnavailableError) {
          await this.sleep(ENGINE_DOWN_MS / 2);
        } else {
          logger.error({ error, job }, 'Translation job failed');
          await this.sleep(5_000);
        }
      }
    }
  }
}

// One worker per server process, surviving hot reloads in development.
const holder = globalThis as unknown as { __avkTranslationWorker?: TranslationWorker };

export function translationWorker(): TranslationWorker {
  holder.__avkTranslationWorker ??= new TranslationWorker();
  return holder.__avkTranslationWorker;
}

/** Called once at server start, from instrumentation. */
export function startTranslationWorker() {
  translationWorker().start();
}

export type { Key as TranslationKey };
