import Link from 'next/link';
import {
  ArrowRight,
  CalendarDays,
  ClipboardCheck,
  ClipboardList,
  Clock,
  FileQuestion,
  Gift,
  Layers,
  type LucideIcon,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import type { TrackKey, TrackSummary } from '@/server/services/catalogue-service';

const ICONS: Record<string, LucideIcon> = {
  CalendarDays,
  ClipboardCheck,
  ClipboardList,
  FileQuestion,
  Gift,
  Layers,
};

/**
 * Per-track presentation, keyed by track.
 *
 * Colour, ordering and the details link live here; the title, blurb, price and
 * whether a track is ready come from the catalogue, so a card cannot advertise
 * something the site does not have.
 */
interface Skin {
  /** `/courses/<slug>` — the details page for this track. */
  detailsSlug: string;
  /** Overrides the details link for a track with no `/courses` page. */
  detailsHref?: string;
  wash: string;
  button: string;
  chip: string;
}

const SKINS: Record<TrackKey, Skin> = {
  FREE_SERIES: {
    detailsSlug: 'free-test-series',
    wash: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-300',
    button: 'bg-emerald-600 hover:bg-emerald-700 text-white',
    chip: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  },
  COMBO: {
    detailsSlug: 'combo',
    // The combo has its own page, which is its details page.
    detailsHref: '/combo',
    wash: 'bg-rose-50 text-rose-600 dark:bg-rose-950/40 dark:text-rose-300',
    button: 'bg-rose-600 hover:bg-rose-700 text-white',
    chip: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
  },
  PYQ: {
    detailsSlug: 'previous-year-papers',
    wash: 'bg-indigo-50 text-indigo-600 dark:bg-indigo-950/40 dark:text-indigo-300',
    button: 'bg-indigo-600 hover:bg-indigo-700 text-white',
    chip: 'bg-muted text-muted-foreground',
  },
  DAILY_CHALLENGE: {
    detailsSlug: 'kas-50',
    wash: 'bg-violet-50 text-violet-600 dark:bg-violet-950/40 dark:text-violet-300',
    button: 'bg-violet-600 hover:bg-violet-700 text-white',
    chip: 'bg-muted text-muted-foreground',
  },
  PAID_SERIES: {
    detailsSlug: 'paid-test-series',
    wash: 'bg-amber-50 text-amber-600 dark:bg-amber-950/40 dark:text-amber-300',
    button: 'bg-amber-500 hover:bg-amber-600 text-white',
    chip: 'bg-muted text-muted-foreground',
  },
  CHAPTERWISE: {
    detailsSlug: 'chapterwise',
    wash: 'bg-sky-50 text-sky-600 dark:bg-sky-950/40 dark:text-sky-300',
    button: 'bg-sky-600 hover:bg-sky-700 text-white',
    chip: 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300',
  },
};

/**
 * The preparation tracks, as a card grid.
 *
 * Shared by `/courses` and the home page so the two cannot drift apart — they
 * were separately maintained copies of the same cards, which is how the site
 * ended up advertising different prices in different places.
 */
export function CourseTracks({ tracks }: { tracks: TrackSummary[] }) {
  // Rendered in the order the catalogue gives them. This used to re-sort by a
  // second list kept here, so changing the order in one place silently left
  // the other disagreeing — the home page and /courses showed the same cards
  // in different sequences.
  return (
    <ul className="grid gap-5 lg:grid-cols-2">
      {tracks.map((track, index) => {
        const skin = SKINS[track.key];
        const Icon = ICONS[track.iconName] ?? Layers;
        if (!skin) return null;

        return (
          <li key={track.key}>
            <div
              className={cn(
                'flex h-full flex-col rounded-2xl border bg-card p-5',
                track.comingSoon ? 'border-border' : 'border-border',
              )}
            >
              <div className="flex items-start gap-4">
                <span
                  className={cn(
                    'flex size-12 shrink-0 items-center justify-center rounded-xl',
                    skin.wash,
                  )}
                  aria-hidden="true"
                >
                  <Icon className="size-6" />
                </span>

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-base font-bold leading-snug tracking-tight">
                      {/* Numbered by position, so the label can never
                          disagree with the order the cards are actually in. */}
                      {index + 1}. {track.title}
                    </h2>

                    <span
                      className={cn(
                        'shrink-0 rounded-full px-2 py-0.5 text-xs font-medium',
                        track.comingSoon
                          ? 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300'
                          : track.isFree
                            ? skin.chip
                            : 'bg-muted text-muted-foreground',
                      )}
                    >
                      {track.comingSoon ? 'Coming Soon' : track.isFree ? 'Free' : 'Paid'}
                    </span>
                  </div>

                  <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                    {track.blurb}
                  </p>
                </div>
              </div>

              {/* The free sample year, which is the reason to try PYQs at all. */}
              {track.key === 'PYQ' && !track.comingSoon && (
                <p className="mt-3 flex items-center gap-2 rounded-lg bg-indigo-50 px-3 py-2.5 text-sm font-medium text-indigo-700 dark:bg-indigo-950/30 dark:text-indigo-300">
                  <Gift className="size-4 shrink-0" aria-hidden="true" />
                  2011 Paper is FREE — Try now!
                </p>
              )}

              <div className="mt-auto flex gap-2.5 pt-4">
                <Link
                  href={skin.detailsHref ?? `/courses/${skin.detailsSlug}`}
                  className="inline-flex flex-1 items-center justify-center rounded-lg border border-border px-3 py-2.5 text-sm font-medium transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  View details
                </Link>

                {track.comingSoon ? (
                  <span className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-muted px-3 py-2.5 text-sm font-semibold text-muted-foreground">
                    <Clock className="size-4" aria-hidden="true" />
                    Coming Soon
                  </span>
                ) : (
                  <Link
                    href={track.href}
                    className={cn(
                      'inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2.5 text-sm font-semibold transition-colors',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      skin.button,
                    )}
                  >
                    {track.ctaLabel}
                    <ArrowRight className="size-4" aria-hidden="true" />
                  </Link>
                )}
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
