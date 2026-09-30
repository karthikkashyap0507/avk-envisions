'use client';

import * as React from 'react';
import { Clock } from 'lucide-react';

import { cn, formatClock } from '@/lib/utils';

/**
 * Exam countdown.
 *
 * The server is the only authority on time. At mount we measure the offset
 * between the server's clock and this device's clock, and every tick is
 * computed as `expiresAt − (localNow − offset)`. A student who changes their
 * system clock therefore changes nothing: the displayed time still tracks the
 * server, and submission is enforced server-side regardless of what this
 * component shows.
 */
export interface ExamTimerProps {
  /** ISO timestamp at which the attempt expires, from the server. */
  expiresAt: string;
  /** ISO timestamp of the server at the moment the state was fetched. */
  serverTime: string;
  /** Fired once, when the countdown first reaches zero. */
  onExpire: () => void;
  className?: string;
  /** Screen-reader wording, in the paper's language. */
  labels?: { remaining: string; timeUp: string };
}

export function ExamTimer({ expiresAt, serverTime, onExpire, className, labels }: ExamTimerProps) {
  const expiryMs = React.useMemo(() => new Date(expiresAt).getTime(), [expiresAt]);

  /**
   * How far this device's clock is ahead of the server's, measured once. Held
   * in a ref so a re-render never re-measures against an already-skewed base.
   */
  const offsetRef = React.useRef<number>(Date.now() - new Date(serverTime).getTime());

  const computeRemaining = React.useCallback(
    () => Math.max(0, Math.round((expiryMs - (Date.now() - offsetRef.current)) / 1000)),
    [expiryMs],
  );

  const [remaining, setRemaining] = React.useState(computeRemaining);

  // Guards against `onExpire` firing more than once across re-renders.
  const expiredRef = React.useRef(false);
  const onExpireRef = React.useRef(onExpire);
  onExpireRef.current = onExpire;

  React.useEffect(() => {
    // Recompute on an interval rather than decrementing a counter: a
    // backgrounded tab throttles timers, and decrementing would silently drift.
    const tick = () => {
      const next = computeRemaining();
      setRemaining(next);

      if (next <= 0 && !expiredRef.current) {
        expiredRef.current = true;
        onExpireRef.current();
      }
    };

    tick();
    const id = window.setInterval(tick, 1000);

    // A tab returning to the foreground may have missed many ticks.
    const onVisible = () => {
      if (document.visibilityState === 'visible') tick();
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [computeRemaining]);

  const critical = remaining <= 60;
  const warning = !critical && remaining <= 300;

  return (
    <div
      className={cn(
        'flex items-center gap-2 rounded-lg border px-3 py-1.5 tabular-nums transition-colors',
        critical
          ? 'border-destructive/30 bg-destructive/10 text-destructive'
          : warning
            ? 'border-warning/30 bg-warning/10 text-warning'
            : 'border-border bg-muted/50 text-foreground',
        className,
      )}
      // Announce only at meaningful thresholds; a per-second live region would
      // make the page unusable with a screen reader.
      role="timer"
      aria-label={labels?.remaining ?? 'Time remaining'}
    >
      <Clock className={cn('size-4 shrink-0', critical && 'animate-pulse')} aria-hidden="true" />
      <span className="font-semibold">{formatClock(remaining)}</span>

      <span className="sr-only" aria-live="polite" aria-atomic="true">
        {remaining === 300
          ? '5 minutes remaining'
          : remaining === 60
            ? '1 minute remaining'
            : remaining === 0
              ? (labels?.timeUp ?? 'Time is up. Submitting your test.')
              : ''}
      </span>
    </div>
  );
}
