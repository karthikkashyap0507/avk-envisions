import { errors } from '@/lib/api';
import { route } from '@/server/api-handler';
import { requireAdmin } from '@/server/auth/guards';
import { db } from '@/server/db';
import { documentState, type DocumentState } from '@/server/translation/document-translation';
import { translationWorker } from '@/server/translation/worker';

type KannadaCopyState = DocumentState & { preview?: string };

/**
 * GET /api/admin/synopsis/kannada?kind=test|series&id=… — how far one
 * analysis PDF's Kannada copy has got, for the admin list beside it.
 *
 * Named by its test or series rather than by file name, so nothing a caller
 * sends is ever used as a path. Asking about one that is not ready puts it at
 * the front of the queue: an admin looking at it is waiting for it.
 */
export const GET = route<KannadaCopyState>(async ({ request }) => {
  await requireAdmin();

  const url = new URL(request.url);
  const kind = url.searchParams.get('kind') ?? 'test';
  const id = url.searchParams.get('id') ?? '';
  if (!id || (kind !== 'test' && kind !== 'series')) throw errors.badRequest('Name a test or a series.');

  const target =
    kind === 'series'
      ? await db.testSeries.findFirst({ where: { id, deletedAt: null }, select: { slug: true, synopsisFileName: true } })
      : await db.test.findFirst({ where: { id, deletedAt: null }, select: { slug: true, synopsisFileName: true } });
  if (!target) throw errors.notFound(kind === 'series' ? 'Series' : 'Test');
  if (!target.synopsisFileName) return { data: { state: 'missing' as const } };

  const state = await documentState(target.synopsisFileName);
  if (state.state === 'pending') translationWorker().request([`doc:${target.synopsisFileName}`]);

  // The document itself: the student page around it redirects an admin away.
  return {
    data: {
      ...state,
      preview: kind === 'series' ? `/api/synopsis/${target.slug}?lang=kn` : `/api/synopsis/test/${id}?lang=kn`,
    },
  };
});
