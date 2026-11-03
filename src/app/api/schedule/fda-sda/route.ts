import type { ReadableStream as NodeWebStream } from 'node:stream/web';
import { createReadStream, existsSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';

/**
 * GET /api/schedule/fda-sda — streams the KEA FDA / SDA timetable.
 *
 * Open to everyone, unlike the paper analyses. The timetable is what tells
 * someone whether the series is worth buying, so putting it behind the paywall
 * would hide the reason to buy.
 *
 * Served `inline` so the browser renders it rather than downloading it. That
 * matches the analysis documents and, as there, it discourages saving without
 * preventing it — anything a browser can render, it can keep.
 */
export const dynamic = 'force-dynamic';

/** Committed with the app: it is small and changes only when the plan does. */
function schedulePath(): string {
  return path.resolve('prisma/assets/kea-fda-sda-schedule.pdf');
}

export async function GET() {
  const full = schedulePath();

  if (!existsSync(full)) {
    return new Response('The schedule is not available right now.', { status: 404 });
  }

  const info = await stat(full);

  return new Response(
    Readable.toWeb(createReadStream(full)) as NodeWebStream as ReadableStream,
    {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Length': String(info.size),
        'Content-Disposition': 'inline; filename="kea-fda-sda-schedule.pdf"',
        // Public and cacheable: it is the same file for every visitor and it
        // is not behind any entitlement.
        'Cache-Control': 'public, max-age=3600',
      },
    },
  );
}
