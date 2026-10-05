'use client';

import * as React from 'react';
import { AlertCircle, Loader2 } from 'lucide-react';

/**
 * Read-only viewer for a paper's analysis PDF.
 *
 * Renders each page to a canvas with PDF.js rather than handing the file to
 * the browser's own viewer. That was the previous approach and it fails
 * completely on phones: neither iOS Safari nor Android Chrome renders a PDF
 * inside `<object>` or `<iframe>`, so every mobile visitor saw the fallback
 * message instead of the document.
 *
 * Drawing to canvas also suits the read-only requirement better than the
 * native viewer did — there is no built-in toolbar, so no download or print
 * control to hide. It is still not DRM: a determined viewer can screenshot the
 * page or pull the file from the network tab, which is true of anything a
 * browser can display.
 */
const VIEWER_TEXT = {
  en: {
    loading: (done: number, total: number) => `Loading the analysis${total > 0 ? ` — page ${done} of ${total}` : '…'}`,
    pages: (done: number, total: number) => `${done} of ${total} pages`,
    noAccess: 'You do not have access to this analysis yet.',
    failed: (status: number) => `The document could not be loaded (HTTP ${status}).`,
    noCanvas: 'This browser could not create a canvas to draw on.',
    notShown: 'The document could not be displayed.',
  },
  kn: {
    loading: (done: number, total: number) => `ವಿಶ್ಲೇಷಣೆ ತೆರೆಯುತ್ತಿದೆ${total > 0 ? ` — ಪುಟ ${done} / ${total}` : '…'}`,
    pages: (done: number, total: number) => `ಪುಟ ${done} / ${total}`,
    noAccess: 'ಈ ವಿಶ್ಲೇಷಣೆಯನ್ನು ನೋಡಲು ನಿಮಗೆ ಇನ್ನೂ ಅನುಮತಿ ಇಲ್ಲ.',
    failed: (status: number) => `ದಾಖಲೆಯನ್ನು ತೆರೆಯಲು ಸಾಧ್ಯವಾಗಲಿಲ್ಲ (HTTP ${status}).`,
    noCanvas: 'ಈ ಬ್ರೌಸರ್‌ನಲ್ಲಿ ದಾಖಲೆಯನ್ನು ತೋರಿಸಲು ಸಾಧ್ಯವಿಲ್ಲ.',
    notShown: 'ದಾಖಲೆಯನ್ನು ತೋರಿಸಲು ಸಾಧ್ಯವಾಗಲಿಲ್ಲ.',
  },
} as const;

export function SynopsisViewer({
  src,
  title,
  language = 'en',
}: {
  src: string;
  title: string;
  language?: 'en' | 'kn';
}) {
  const text = VIEWER_TEXT[language];
  const containerRef = React.useRef<HTMLDivElement>(null);
  const [status, setStatus] = React.useState<'loading' | 'ready' | 'error'>('loading');
  const [message, setMessage] = React.useState('');
  const [progress, setProgress] = React.useState({ done: 0, total: 0 });

  React.useEffect(() => {
    let cancelled = false;
    const canvases: HTMLCanvasElement[] = [];

    async function render() {
      try {
        const pdfjs = await import('pdfjs-dist');
        // Served from our own origin: no CDN, so it works behind the site's
        // CSP and keeps the document off third-party infrastructure.
        pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';

        const response = await fetch(src, { credentials: 'same-origin' });
        if (!response.ok) {
          throw new Error(response.status === 403 ? text.noAccess : text.failed(response.status));
        }

        const data = new Uint8Array(await response.arrayBuffer());
        if (cancelled) return;

        const pdf = await pdfjs.getDocument({ data }).promise;
        if (cancelled) return;

        const container = containerRef.current;
        if (!container) return;
        container.replaceChildren();
        setProgress({ done: 0, total: pdf.numPages });

        // Cap the width so a wide page does not force horizontal scrolling,
        // and scale by device pixel ratio so text stays sharp on phones.
        const available = Math.min(container.clientWidth || 800, 1100);
        const dpr = Math.min(window.devicePixelRatio || 1, 2);

        for (let n = 1; n <= pdf.numPages; n += 1) {
          if (cancelled) return;

          const page = await pdf.getPage(n);
          const base = page.getViewport({ scale: 1 });
          const viewport = page.getViewport({ scale: (available / base.width) * dpr });

          const canvas = document.createElement('canvas');
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          canvas.style.width = '100%';
          canvas.style.height = 'auto';
          canvas.className = 'block w-full rounded-lg border border-border bg-white shadow-subtle';
          canvas.setAttribute('role', 'img');
          canvas.setAttribute('aria-label', `${title} — page ${n} of ${pdf.numPages}`);

          const context = canvas.getContext('2d');
          if (!context) throw new Error(text.noCanvas);

          container.append(canvas);
          canvases.push(canvas);

          await page.render({ canvasContext: context, viewport }).promise;
          if (cancelled) return;
          setProgress({ done: n, total: pdf.numPages });
          if (n === 1) setStatus('ready');
        }

        if (!cancelled) setStatus('ready');
      } catch (error) {
        if (cancelled) return;
        setMessage(error instanceof Error ? error.message : text.notShown);
        setStatus('error');
      }
    }

    void render();
    return () => {
      cancelled = true;
      for (const canvas of canvases) canvas.remove();
    };
  }, [src, title, text]);

  // Discourage the obvious ways of taking a copy. Deterrence, not protection.
  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if ((event.ctrlKey || event.metaKey) && (key === 's' || key === 'p')) event.preventDefault();
    };
    const onContextMenu = (event: MouseEvent) => event.preventDefault();

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('contextmenu', onContextMenu);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('contextmenu', onContextMenu);
    };
  }, []);

  return (
    <div className="rounded-xl border border-border bg-muted/30 p-3 sm:p-4">
      {status === 'loading' && (
        <div className="flex flex-col items-center gap-3 py-16 text-center">
          <Loader2 className="size-6 animate-spin text-primary" aria-hidden="true" />
          <p className="text-sm text-muted-foreground">{text.loading(progress.done, progress.total)}</p>
        </div>
      )}

      {status === 'error' && (
        <div className="flex flex-col items-center gap-3 py-16 text-center">
          <AlertCircle className="size-6 text-destructive" aria-hidden="true" />
          <p className="max-w-md text-sm text-muted-foreground">{message}</p>
        </div>
      )}

      <div
        ref={containerRef}
        className="space-y-3 select-none"
        aria-live="polite"
        aria-busy={status === 'loading'}
      />

      {status === 'ready' && progress.total > 0 && (
        <p className="mt-3 text-center text-xs text-muted-foreground">{text.pages(progress.done, progress.total)}</p>
      )}
    </div>
  );
}
