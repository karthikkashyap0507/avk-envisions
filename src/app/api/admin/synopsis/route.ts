import { errors } from '@/lib/api';
import { route } from '@/server/api-handler';
import { requireAdmin } from '@/server/auth/guards';
import { db } from '@/server/db';
import {
  MAX_SYNOPSIS_BYTES,
  deleteSynopsisFile,
  isPdf,
  storeTestSynopsis,
} from '@/server/services/synopsis-service';
import { removeKannadaDocument } from '@/server/translation/document-translation';
import { translationWorker } from '@/server/translation/worker';

/**
 * Manage the question-wise analysis PDF for a paper or a series.
 *
 * These documents were installable only by running a script on the server with
 * a Drive file id committed to the repo, which put every correction and every
 * new year behind a deploy. The people who write the analysis need to replace
 * one themselves.
 *
 * The file is verified to be a real PDF by its leading bytes rather than by its
 * name or the browser's content-type, both of which the caller supplies.
 *
 * Every upload also starts its Kannada copy, at the front of the translation
 * queue; students are offered it the moment it is complete.
 */

/** Resolves the target and its current file, for either kind of owner. */
async function target(kind: string, id: string) {
  if (kind === 'series') {
    const series = await db.testSeries.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, slug: true, synopsisFileName: true },
    });
    if (!series) throw errors.notFound('Series');
    return { slug: series.slug, current: series.synopsisFileName };
  }

  const test = await db.test.findFirst({
    where: { id, deletedAt: null },
    select: { id: true, slug: true, synopsisFileName: true },
  });
  if (!test) throw errors.notFound('Test');
  return { slug: test.slug, current: test.synopsisFileName };
}

async function setFileName(kind: string, id: string, fileName: string | null) {
  // `null`, never `undefined` — undefined means "leave alone" to Prisma, so
  // clearing the column requires an explicit null.
  if (kind === 'series') {
    await db.testSeries.update({ where: { id }, data: { synopsisFileName: fileName } });
  } else {
    await db.test.update({ where: { id }, data: { synopsisFileName: fileName } });
  }
}

/** POST — upload or replace. */
export const POST = route(async ({ request }) => {
  await requireAdmin();

  const form = await request.formData().catch(() => null);
  if (!form) throw errors.badRequest('Expected a file upload.');

  const kind = String(form.get('kind') ?? 'test');
  const id = String(form.get('id') ?? '');
  if (!id) throw errors.badRequest('No test or series was named.');
  if (kind !== 'test' && kind !== 'series') throw errors.badRequest('Unknown target.');

  const file = form.get('file');
  if (!(file instanceof File)) throw errors.badRequest('No file was attached.');
  if (file.size === 0) throw errors.badRequest('That file is empty.');
  if (file.size > MAX_SYNOPSIS_BYTES) {
    throw errors.badRequest(
      `That file is ${(file.size / 1024 / 1024).toFixed(0)} MB. The limit is ${MAX_SYNOPSIS_BYTES / 1024 / 1024} MB.`,
    );
  }

  const { slug } = await target(kind, id);

  const buffer = Buffer.from(await file.arrayBuffer());
  if (!isPdf(buffer)) throw errors.badRequest('That file is not a PDF.');

  const fileName = await storeTestSynopsis(slug, buffer);
  await setFileName(kind, id, fileName);
  // A replacement keeps its name, so the old copy no longer matches and is
  // never shown; it is cleared now rather than left on disk until the new
  // one is made.
  await removeKannadaDocument(fileName);
  translationWorker().request([`doc:${fileName}`], { front: true });

  return {
    data: { fileName, sizeBytes: buffer.byteLength },
    message: 'Analysis PDF uploaded.',
  };
});

/** DELETE — remove the document and forget it. */
export const DELETE = route(async ({ request }) => {
  await requireAdmin();

  const url = new URL(request.url);
  const kind = url.searchParams.get('kind') ?? 'test';
  const id = url.searchParams.get('id') ?? '';
  if (!id) throw errors.badRequest('No test or series was named.');
  if (kind !== 'test' && kind !== 'series') throw errors.badRequest('Unknown target.');

  const { current } = await target(kind, id);

  // The row is cleared first. If the unlink fails the students still stop
  // seeing a document the admin has withdrawn, which is the point of the
  // request; an orphaned file is harmless by comparison.
  await setFileName(kind, id, null);
  if (current) {
    await deleteSynopsisFile(current);
    await removeKannadaDocument(current);
  }

  return { data: { removed: Boolean(current) }, message: 'Analysis PDF removed.' };
});
