import { Users } from 'lucide-react';

import { cn } from '@/lib/utils';

/**
 * How many of the early-price seats are gone.
 *
 * Shared by every page that sells a series on a capped price — the paid test
 * series and KAS-50 both — so the two cannot drift apart in wording or in how
 * the bar behaves as it fills.
 *
 * Every number here is the real one: `count` is the live enrolment and `limit`
 * is the tier's actual cap, so the bar empties because people really joined.
 * Nothing counts down on its own and nothing is inflated — a scarcity notice
 * that lies is worth less than none, because a student who joins and finds the
 * "last 3 seats" still showing next week stops believing the rest of the page
 * too.
 *
 * It disappears once the tier is full, rather than sitting at zero: by then the
 * price on the page is the standard one and there is no offer left to hurry
 * for.
 */
export function EnrolmentBar({
  count,
  limit,
  className,
}: {
  count: number;
  limit: number;
  /** Lets a caller set its own width; the schedule header and the KAS-50
      purchase panel sit in differently shaped spaces. */
  className?: string;
}) {
  const left = Math.max(0, limit - count);
  if (left === 0) return null;

  const takenPercent = Math.min(100, Math.round((count / limit) * 100));
  const nearlyGone = left <= Math.max(5, Math.round(limit * 0.2));

  return (
    <div
      className={cn(
        'min-w-[13rem] flex-1 rounded-lg border border-border bg-card px-4 py-2.5 sm:max-w-xs',
        className,
      )}
    >
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="flex items-center gap-1.5 font-semibold">
          <Users className="size-3.5 text-primary" aria-hidden="true" />
          {count} {count === 1 ? 'person has' : 'people have'} joined
        </span>
        <span className={cn('font-semibold tabular-nums', nearlyGone && 'text-warning')}>
          {left} left
        </span>
      </div>

      <div
        className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-valuenow={count}
        aria-valuemin={0}
        aria-valuemax={limit}
        aria-label={`${count} of ${limit} early-price places taken`}
      >
        <div
          className={cn('h-full rounded-full', nearlyGone ? 'bg-warning' : 'bg-primary')}
          style={{ width: `${takenPercent}%` }}
        />
      </div>

      <p className="mt-1 text-[0.7rem] leading-snug text-muted-foreground">
        at this price, for the first {limit} members
      </p>
    </div>
  );
}
