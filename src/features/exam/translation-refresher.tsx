'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';

/**
 * Re-renders a server page while its Kannada is still arriving.
 *
 * The result page reads translations on the server; this asks for a fresh
 * render every few seconds while any are pending, so questions switch to
 * Kannada as the engine finishes them. It gives up after a few minutes of no
 * progress, leaving whatever is left in English, rather than refreshing a
 * page forever.
 */
export function TranslationRefresher({ pending, stamp }: { pending: number; stamp: number }) {
  const router = useRouter();
  const progress = React.useRef({ pending, at: Date.now() });

  // `stamp` changes on every server render, so each refresh re-arms the timer
  // even when the pending count has not moved.
  React.useEffect(() => {
    if (pending < progress.current.pending) progress.current = { pending, at: Date.now() };
    if (pending <= 0 || Date.now() - progress.current.at > 4 * 60_000) return;
    const timer = window.setTimeout(() => router.refresh(), 4_000);
    return () => window.clearTimeout(timer);
  }, [pending, stamp, router]);

  return null;
}
