import { readFileSync } from 'node:fs';
import path from 'node:path';

import { requireAdmin } from '@/server/auth/guards';
import { db } from '@/server/db';

/**
 * The AVK Envisions mark, inlined as a data URI.
 *
 * Inlined rather than linked: it is on the page the moment it opens, so the
 * print dialogue can never capture the header before the logo has loaded, and
 * a PDF saved to disk and reopened still carries it. Read once and kept.
 *
 * A missing file costs the header its logo, not the export — this route is
 * how staff proof a paper, and a branding asset must never be why it fails.
 */
let logoDataUri: string | null | undefined;
function logo(): string | null {
  if (logoDataUri !== undefined) return logoDataUri;
  try {
    const file = path.join(process.cwd(), 'public', 'brand', 'avk-logo-print.jpg');
    logoDataUri = `data:image/jpeg;base64,${readFileSync(file).toString('base64')}`;
  } catch {
    logoDataUri = null;
  }
  return logoDataUri;
}

/**
 * GET /api/admin/tests/[id]/export — one paper as a printable document.
 *
 * Returns HTML rather than a generated PDF. Every browser prints to PDF, and
 * the page it produces has selectable text, real page breaks and a header —
 * which is better than anything a server-side generator would emit here, and
 * adds no dependency. Opening it and pressing print is the whole workflow.
 *
 * Admin only: it prints the answer key beside every question.
 */
export const dynamic = 'force-dynamic';

function escape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Keeps the line structure the parser preserved, safely. */
function paragraphs(text: string): string {
  return escape(text)
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => `<p>${line}</p>`)
    .join('');
}

/**
 * An <img> for a stored image, or nothing when there is none.
 *
 * Paths are made absolute against the site's own origin. A relative `/uploads/..`
 * resolves against wherever the print window was opened from, which is this
 * same origin in practice — but the printed page is also saved and re-opened
 * from disk, and from a `file://` document every relative path is broken.
 *
 * `loading="eager"` matters more than it looks: a lazily-loaded image that has
 * not entered the viewport is not painted when `window.print()` runs, so a long
 * paper printed with everything below the fold missing.
 */
function image(url: string | null | undefined, origin: string, alt: string): string {
  if (!url) return '';

  const src = /^(https?:|data:)/i.test(url)
    ? url
    : `${origin.replace(/\/$/, '')}/${url.replace(/^\//, '')}`;

  return (
    `<div class="figure">` +
    `<img src="${escape(src)}" alt="${escape(alt)}" loading="eager" decoding="sync">` +
    `</div>`
  );
}

/**
 * Written as a plain handler rather than through `route()`, which JSON-encodes
 * whatever it is given — this endpoint has to return HTML the browser will
 * render and print.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  // Caught rather than thrown: outside `route()` there is no error handler, so
  // an unauthorised request would surface as a 500 instead of being refused.
  try {
    await requireAdmin();
  } catch {
    return new Response('Not permitted.', { status: 403 });
  }

  const { id: testId } = await params;

  // Behind Caddy the request URL is the internal 127.0.0.1:3000 one, so the
  // forwarded headers are what give the address a printed page can actually
  // resolve images from.
  const forwardedHost = request.headers.get('x-forwarded-host') ?? request.headers.get('host');
  const forwardedProto = request.headers.get('x-forwarded-proto') ?? 'https';
  const origin = forwardedHost ? `${forwardedProto}://${forwardedHost}` : new URL(request.url).origin;

  const test = await db.test.findFirst({
    where: { id: testId, deletedAt: null },
    select: {
      title: true,
      slug: true,
      durationMinutes: true,
      totalQuestions: true,
      totalMarks: true,
      questions: {
        orderBy: { sortOrder: 'asc' },
        select: {
          sortOrder: true,
          marks: true,
          question: {
            select: {
              code: true,
              body: true,
              imageUrl: true,
              explanation: true,
              // No subject. Imports filed whole papers under one subject, so the
              // label printed "Indian Polity" above ancient-history questions.
              // A proof copy is better with no label than a wrong one.
              options: {
                orderBy: { sortOrder: 'asc' },
                select: { label: true, body: true, imageUrl: true, isCorrect: true },
              },
            },
          },
        },
      },
    },
  });

  if (!test) return new Response('Test not found.', { status: 404 });

  // Numbered by position, counted from one — never from `sortOrder`.
  //
  // That column is an ordering key, not a question number: it carries whatever
  // values the questions were attached with. On Polity + Current Affairs they
  // began at 102, so the printed paper opened at "102" while the admin list
  // beside it counted 1, 2, 3.
  const rows = test.questions
    .map((row, index) => {
      const q = row.question;
      const options = q.options
        .map(
          (option) =>
            `<li class="${option.isCorrect ? 'right' : ''}">` +
            `<b>${escape(option.label)}.</b> ${escape(option.body)}` +
            `${option.isCorrect ? ' <span class="key">correct</span>' : ''}` +
            `${image(option.imageUrl, origin, `Figure for option ${option.label}`)}</li>`,
        )
        .join('');

      // A question with no key is called out rather than printed as though it
      // were finished — that is exactly what someone proof-reading needs to
      // catch.
      const unkeyed = q.options.every((option) => !option.isCorrect)
        ? '<p class="warn">No correct option is set.</p>'
        : '';

      return `
        <article>
          <header>
            <span class="num">${index + 1}</span>
            <span class="meta">${escape(q.code ?? '')} · ${row.marks} mark${row.marks === 1 ? '' : 's'}</span>
          </header>
          <div class="stem">${paragraphs(q.body)}</div>
          ${image(q.imageUrl, origin, `Figure for question ${index + 1}`)}
          <ol class="options">${options}</ol>
          ${unkeyed}
          ${
            q.explanation
              ? `<div class="explanation"><b>Explanation</b>${paragraphs(q.explanation)}</div>`
              : ''
          }
        </article>`;
    })
    .join('');

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escape(test.title)}</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 24px 28px;
    font: 12pt/1.5 Georgia, 'Times New Roman', serif; color: #111;
    max-width: 60rem;
  }
  /* The letterhead: mark on the left, the paper's title beside it, and a
     gold rule taken from the logo underneath. Sized in mm so it prints the
     same on A4 and Letter whatever the screen it was opened on. */
  .letterhead { display: flex; align-items: center; gap: 16px;
                padding-bottom: 12px; margin-bottom: 18px;
                border-bottom: 2px solid #c9a24a; }
  .letterhead img { height: 22mm; width: auto; flex-shrink: 0;
                    -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .letterhead .titles { min-width: 0; flex: 1; }
  .letterhead .brand { font: 600 8.5pt system-ui, sans-serif; letter-spacing: .14em;
                       text-transform: uppercase; color: #1e3a5f; margin: 0 0 3px; }
  h1 { font-size: 18pt; margin: 0 0 2px; }
  .sub { color: #555; font-size: 10pt; margin: 0; }
  /* A button, not an instruction to press Ctrl+P.
     There is no Ctrl+P on a phone, so the only way to save this was from a
     desktop. The browser's own print dialogue is what produces the PDF —
     tapping the button opens it, and on iOS and Android that dialogue offers
     "Save as PDF" the same way it does on a laptop. */
  .toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 10px;
             background: #f3f4f6; padding: 10px 12px; border-radius: 6px;
             font: 10pt/1.4 system-ui, sans-serif; color: #374151;
             margin-bottom: 20px; }
  .toolbar button { font: 600 10pt system-ui, sans-serif; cursor: pointer;
                    background: #4338ca; color: #fff; border: 0;
                    padding: 8px 14px; border-radius: 6px; }
  .toolbar button:hover { background: #3730a3; }
  .toolbar span { flex: 1 1 14rem; min-width: 0; }
  article { border-top: 1px solid #ddd; padding: 14px 0; break-inside: avoid; }
  /* The letterhead's gold rule already divides it from the first question. */
  .letterhead + .toolbar + article, .letterhead + article { border-top: 0; padding-top: 4px; }
  article header { display: flex; align-items: baseline; gap: 10px; margin-bottom: 6px; }
  .num { font-weight: 700; font-size: 13pt; }
  .meta { font: 9pt system-ui, sans-serif; color: #6b7280; }
  .stem p { margin: 0 0 6px; }
  .options { list-style: none; margin: 8px 0 0; padding: 0; }
  .options li { padding: 3px 0 3px 4px; }
  /* Deeper than the on-screen tints, and forced to survive printing.
     The palest shades read almost white once a browser renders to PDF, and
     Chrome drops backgrounds entirely unless print-color-adjust says
     otherwise — so the correct answer and the explanation, the two things
     someone proof-reading is looking for, were the hardest parts to see. */
  .options li.right { background: #d1fae5; border-left: 4px solid #047857;
                      padding-left: 8px; }
  .key { font: 8pt system-ui, sans-serif; color: #047857; font-weight: 700;
         text-transform: uppercase; letter-spacing: .06em; margin-left: 6px; }
  .warn { font: 9pt system-ui, sans-serif; color: #b91c1c; margin: 6px 0 0; }
  /* Capped in vh as well as width: a tall diagram scaled only by width can
     run past the bottom of the sheet, and a figure split across two pages is
     unreadable. break-inside: avoid keeps each one whole. */
  .figure { margin: 8px 0; break-inside: avoid; page-break-inside: avoid; }
  .figure img { max-width: 100%; max-height: 42vh; height: auto;
                object-fit: contain; border: 1px solid #e5e7eb; border-radius: 4px; }
  .options .figure { margin: 6px 0 2px; }
  .options .figure img { max-height: 28vh; }
  .explanation { margin-top: 10px; padding: 10px 12px; background: #fef3c7;
                 border-left: 4px solid #d97706; font-size: 11pt; }
  .explanation p { margin: 4px 0 0; }
  .explanation b { font: 9pt system-ui, sans-serif; text-transform: uppercase;
                   letter-spacing: .06em; color: #b45309; font-weight: 700; }
  /* Without this a browser prints the tints as plain white paper. */
  .options li.right, .explanation {
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  @media print {
    body { padding: 0; max-width: none; }
    .toolbar { display: none; }
    /* Chrome drops backgrounds and can wash out images without this, the same
       reason the answer tints carry it. */
    .figure img { -webkit-print-color-adjust: exact; print-color-adjust: exact;
                  max-height: 40vh; }
  }
</style>
</head>
<body>
  <header class="letterhead">
    ${logo() ? `<img src="${logo()}" alt="AVK Envisions">` : ''}
    <div class="titles">
      <p class="brand">AVK Envisions · KAS Prelims</p>
      <h1>${escape(test.title)}</h1>
      <p class="sub">
        ${test.totalQuestions} question${test.totalQuestions === 1 ? '' : 's'} ·
        ${test.totalMarks} marks · ${test.durationMinutes} minutes · ${escape(test.slug)}
      </p>
    </div>
  </header>
  <div class="toolbar">
    <button type="button" onclick="printWhenReady()">Download PDF</button>
    <span>The answer key and explanations are included — this is a staff document.</span>
  </div>
  ${rows || '<p>This paper has no questions yet.</p>'}
  <script>
    /*
     * Printing before the figures have decoded is what leaves gaps in the PDF:
     * window.print() captures the page as it stands, and an image still in
     * flight is captured as empty space. So wait for every one to settle first.
     *
     * Failures are awaited too, not just successes — one broken URL should cost
     * the paper that single figure, not the whole print.
     */
    async function printWhenReady() {
      const pending = Array.from(document.images).filter((img) => !img.complete);

      if (pending.length > 0) {
        await Promise.all(
          pending.map(
            (img) =>
              new Promise((resolve) => {
                img.addEventListener('load', resolve, { once: true });
                img.addEventListener('error', resolve, { once: true });
              }),
          ),
        );
      }

      window.print();
    }
  </script>
</body>
</html>`;

  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      // Never cached: it carries the answer key.
      'Cache-Control': 'no-store',
    },
  });
}
