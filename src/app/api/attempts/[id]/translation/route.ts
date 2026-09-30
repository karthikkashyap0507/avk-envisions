import { errors } from '@/lib/api';
import { TERMINAL_ATTEMPT_STATUSES } from '@/lib/enums';
import { attemptSnapshotSchema, parseJsonColumn } from '@/lib/json';
import { route } from '@/server/api-handler';
import { requireUser } from '@/server/auth/guards';
import { db } from '@/server/db';
import { engineAvailable } from '@/server/translation/engine-client';
import {
  KANNADA,
  readQuestionTranslations,
  readTestTranslation,
  type TranslationPart,
} from '@/server/translation/translation-service';
import { translationWorker, type TranslationKey } from '@/server/translation/worker';

/**
 * GET /api/attempts/[id]/translation?lang=kn&focus=<questionId>
 *
 * The Kannada for one attempt's paper: whatever is ready now, and how much is
 * still being translated. Anything missing is queued for the translation
 * engine - the question on the student's screen (`focus`) and the next two
 * first - and the client polls until nothing is pending.
 *
 * What it returns follows what the attempt may see. While a test is running,
 * only the questions and options: an attempt in progress is never sent a
 * solution, in any language. Solutions join once it is submitted, or in
 * practice mode, where they are shown as the student goes.
 */
export const GET = route(
  async ({ request, params }) => {
    const user = await requireUser();
    const url = new URL(request.url);
    if (url.searchParams.get('lang') !== KANNADA) throw errors.badRequest('Only Kannada is available.');
    const focus = url.searchParams.get('focus');

    const attempt = await db.testAttempt.findFirst({
      where: { id: params.id!, userId: user.id },
      select: { status: true, testId: true, snapshotJson: true },
    });
    if (!attempt) throw errors.notFound('Attempt');

    const snapshot = parseJsonColumn(attempt.snapshotJson, attemptSnapshotSchema, null as never);
    if (!snapshot) throw errors.notFound('Attempt');

    const ordered = [...snapshot.questions].sort((a, b) => a.sortOrder - b.sortOrder).map((q) => q.questionId);
    const finished = TERMINAL_ATTEMPT_STATUSES.includes(attempt.status as never);
    const withSolutions = finished || snapshot.mode === 'PRACTICE';
    const parts: TranslationPart[] = withSolutions ? ['stem', 'solution'] : ['stem'];

    const [translations, test, available] = await Promise.all([
      readQuestionTranslations(ordered, parts),
      readTestTranslation(attempt.testId),
      engineAvailable(),
    ]);

    // Queue what is missing, in paper order, with what the student is looking
    // at pulled to the front.
    const pendingStems = new Set(translations.pending.stem);
    const worker = translationWorker();
    const queued: TranslationKey[] = [
      ...ordered.filter((id) => pendingStems.has(id)).map((id) => `stem:${id}` as const),
      ...(withSolutions ? translations.pending.solution.map((id) => `solution:${id}` as const) : []),
    ];
    worker.request(queued);
    if (!test) worker.request([`test:${attempt.testId}`], { front: true });
    if (focus) {
      const at = ordered.indexOf(focus);
      const soon = at >= 0 ? ordered.slice(at, at + 3).filter((id) => pendingStems.has(id)) : [];
      worker.request(
        soon.map((id) => `stem:${id}` as const),
        { front: true },
      );
    }

    return {
      data: {
        language: KANNADA,
        engineAvailable: available,
        test,
        stems: translations.stems,
        solutions: withSolutions ? translations.solutions : {},
        pending: {
          stems: translations.pending.stem.length,
          solutions: withSolutions ? translations.pending.solution.length : 0,
        },
        total: ordered.length,
      },
      headers: { 'Cache-Control': 'no-store' },
    };
  },
  { rateLimit: 'attemptSync', rateLimitKey: ({ params }) => `translation:${params.id}` },
);
