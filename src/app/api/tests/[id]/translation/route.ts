import { errors } from '@/lib/api';
import { route } from '@/server/api-handler';
import { requireUser } from '@/server/auth/guards';
import { db } from '@/server/db';
import { engineAvailable } from '@/server/translation/engine-client';
import { KANNADA, readQuestionTranslations, readTestTranslation } from '@/server/translation/translation-service';
import { translationWorker } from '@/server/translation/worker';

/**
 * GET /api/tests/[id]/translation?lang=kn
 *
 * For the start screen, once a student chooses Kannada: the test's title and
 * instructions in Kannada if they are ready, and a head start on its
 * questions. Every question stem not yet translated is queued now, while the
 * student reads the instructions, so the paper is ready - or nearly - by the
 * time they press Start.
 */
export const GET = route(
  async ({ request, params }) => {
    await requireUser();
    if (new URL(request.url).searchParams.get('lang') !== KANNADA) {
      throw errors.badRequest('Only Kannada is available.');
    }

    const test = await db.test.findFirst({
      where: { id: params.id!, deletedAt: null, status: 'PUBLISHED' },
      select: { id: true, questions: { orderBy: { sortOrder: 'asc' }, select: { questionId: true, sortOrder: true } } },
    });
    if (!test) throw errors.notFound('Test');

    const questionIds = test.questions.map((q) => q.questionId);
    const [translation, stems, available] = await Promise.all([
      readTestTranslation(test.id),
      readQuestionTranslations(questionIds, ['stem']),
      engineAvailable(),
    ]);

    const worker = translationWorker();
    if (!translation) worker.request([`test:${test.id}`], { front: true });
    worker.request(stems.pending.stem.map((id) => `stem:${id}` as const));

    return {
      data: {
        language: KANNADA,
        engineAvailable: available,
        test: translation,
        questionsReady: questionIds.length - stems.pending.stem.length,
        questionsTotal: questionIds.length,
      },
      headers: { 'Cache-Control': 'no-store' },
    };
  },
  // Keyed by client, not by test: one popular test must not share a budget.
  { rateLimit: 'attemptSync' },
);
