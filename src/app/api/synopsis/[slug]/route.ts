import type { ReadableStream as NodeWebStream } from 'node:stream/web';
import { Readable } from 'node:stream';

import { requireUser } from '@/server/auth/guards';
import { checkSynopsisAccess, openSynopsis } from '@/server/services/synopsis-service';
import { openKannadaDocument } from '@/server/translation/document-translation';

/**
 * GET /api/synopsis/[slug] — streams a paper's analysis PDF.
 *
 * Access is re-checked on every request rather than trusted from the page that
 * linked here: the URL is guessable, so the check has to live at the point the
 * bytes are served.
 *
 * The response is `inline` and marked no-store. That stops the browser
 * treating it as a download and stops intermediaries caching a document that
 * is behind a paywall — but note it does not, and cannot, prevent a determined
 * viewer from saving the file. Anything a browser can render, it can keep.
 *
 * `?lang=kn` serves the Kannada copy instead, under exactly the same checks.
 * There is no Kannada copy to serve until it is complete and current, and the
 * page only offers the switch when there is one.
 */
export const dynamic = 'force-dynamic';

export async function GET(request: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;

  let user;
  try {
    user = await requireUser();
  } catch {
    return new Response('Sign in to view this document.', { status: 401 });
  }

  const access = await checkSynopsisAccess(slug, user);

  if (access.state !== 'AVAILABLE') {
    const message =
      access.state === 'NOT_PUBLISHED'
        ? 'No analysis has been published for this paper yet.'
        : access.state === 'PURCHASE_REQUIRED'
          ? 'This analysis is part of the paid paper.'
          : 'Attempt the paper before opening its analysis.';
    return new Response(message, { status: 403 });
  }

  const kannada = new URL(request.url).searchParams.get('lang') === 'kn';
  const opened = kannada ? await openKannadaDocument(access.fileName) : await openSynopsis(access.fileName);
  if (!opened) {
    return new Response('The Kannada version of this analysis is not available.', { status: 404 });
  }
  const { stream, size } = opened;

  return new Response(Readable.toWeb(stream) as NodeWebStream as ReadableStream, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Length': String(size),
      // `inline` with a generic name: the viewer shows it, and a save keeps a
      // name that does not advertise the original document.
      'Content-Disposition': `inline; filename="${kannada ? 'analysis-kannada.pdf' : 'analysis.pdf'}"`,
      'Cache-Control': 'private, no-store, max-age=0',
      'X-Content-Type-Options': 'nosniff',
      // Only this site may frame it.
      'Content-Security-Policy': "frame-ancestors 'self'",
    },
  });
}
