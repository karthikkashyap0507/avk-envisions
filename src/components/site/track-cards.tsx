import Link from "next/link";
import {
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  ClipboardCheck,
  ClipboardList,
  Clock,
  FileQuestion,
  Gift,
  Layers,
  Star,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { formatPaise } from "@/lib/utils";
import type { TrackSummary } from "@/server/services/catalogue-service";

const ICONS: Record<string, typeof ClipboardCheck> = {
  CalendarDays,
  ClipboardCheck,
  ClipboardList,
  FileQuestion,
  Gift,
  Layers,
};

/**
 * The four preparation tracks, as a card grid.
 *
 * Shared by the home page and `/test-series` so the two cannot drift apart —
 * they were separately maintained copies of the same four cards, which is how
 * the site ended up advertising different prices in different places.
 */
export function TrackCards({ tracks }: { tracks: TrackSummary[] }) {
  // The first two lead — the current offer and the free entry point — so they
  // get a wider row of their own. Everything after sits in a denser second row,
  // which keeps the whole set on one screen instead of a long even column.
  //
  // The combo is pulled out of that flow into a full-width row of its own: it
  // is the one product that contains others, and in the three-column grid it
  // read as just another card beside the series it bundles.
  const combo = tracks.find((track) => track.key === "COMBO");
  const others = tracks.filter((track) => track.key !== "COMBO");
  const featured = others.slice(0, 2);
  const rest = others.slice(2);

  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-2">
        {featured.map((track) => (
          <TrackCard key={track.key} track={track} featured />
        ))}
      </div>

      {combo && <ComboCard track={combo} />}

      {rest.length > 0 && (
        <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          {rest.map((track) => (
            <TrackCard key={track.key} track={track} />
          ))}
        </div>
      )}
    </div>
  );
}

function TrackCard({
  track,
  featured = false,
}: {
  track: TrackSummary;
  featured?: boolean;
}) {
  const Icon = ICONS[track.iconName] ?? Layers;
  const highlight =
    featured ||
    track.ribbon === "Most useful" ||
    track.ribbon === "Most important";

  return (
    <Card className={highlight ? "relative border-primary/40" : "relative"}>
      <CardContent className="flex h-full flex-col p-6">
        <div className="flex items-start justify-between gap-3">
          <span className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Icon className="size-6" aria-hidden="true" />
          </span>

          <div className="flex flex-wrap items-center justify-end gap-2">
            <Badge variant="muted" size="sm">
              KAS
            </Badge>
            {track.ribbon && (
              <Badge
                variant={
                  track.comingSoon ? "info" : highlight ? "warning" : "success"
                }
                size="sm"
              >
                {track.comingSoon ? (
                  <Clock aria-hidden="true" />
                ) : (
                  <Star aria-hidden="true" />
                )}
                {track.ribbon}
              </Badge>
            )}
            {track.isFree && (
              <Badge variant="success" size="sm">
                Free
              </Badge>
            )}
          </div>
        </div>

        <h3 className="mt-4 text-lg font-semibold leading-tight tracking-tight">
          {track.title}
        </h3>
        <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
          {track.blurb}
        </p>

        <ul className="mt-5 flex-1 space-y-2.5">
          {track.benefits.map((benefit) => (
            <li key={benefit} className="flex items-start gap-2 text-sm">
              <CheckCircle2
                className="mt-0.5 size-4 shrink-0 text-success"
                aria-hidden="true"
              />
              <span className="leading-relaxed text-muted-foreground">
                {benefit}
              </span>
            </li>
          ))}
        </ul>

        {/* No price-and-test-count strip. Half of it was usually a dash —
            a track with no papers yet, or one whose price is per subject —
            and a card promising "50 Questions × 50 Days" then reporting "—"
            tests reads as a fault rather than as content still being written.
            The pricing page carries the numbers, in full and in context. */}

        {/* Shown only while an early-bird tier is genuinely running. */}
        {track.earlyBirdLimit != null && (
          <p className="mt-6 text-center text-xs font-semibold leading-tight text-primary">
            Early bird offer — only for the first {track.earlyBirdLimit} members
          </p>
        )}

        {track.comingSoon ? (
          <Button disabled fullWidth className={track.earlyBirdLimit != null ? 'mt-2' : 'mt-6'}>
            <Clock aria-hidden="true" />
            Coming soon
          </Button>
        ) : (
          <Button asChild fullWidth className={track.earlyBirdLimit != null ? 'mt-2' : 'mt-6'}>
            <Link href={track.href}>
              {track.ctaLabel}
              <ArrowRight aria-hidden="true" />
            </Link>
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * KAS Complete Practice Combo, as a banner across the grid.
 *
 * The struck-through figure is what the three series cost bought separately,
 * at their live prices, so the saving is true on the day it is read rather
 * than a number fixed when the card was written.
 */
function ComboCard({ track }: { track: TrackSummary }) {
  const separately = track.separatelyInPaise ?? 0;
  const saving = separately - track.fromPriceInPaise;

  return (
    <Card className="relative overflow-hidden border-2 border-rose-300 bg-gradient-to-br from-rose-50 via-card to-amber-50 dark:border-rose-800/60 dark:from-rose-950/30 dark:to-amber-950/20">
      <CardContent className="flex flex-col gap-6 p-6 md:flex-row md:items-center">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-rose-100 text-rose-600 dark:bg-rose-900/40 dark:text-rose-300">
              <Gift className="size-6" aria-hidden="true" />
            </span>
            {track.ribbon && (
              <Badge variant="warning" size="sm">
                <Star aria-hidden="true" />
                {track.ribbon}
              </Badge>
            )}
          </div>

          <h3 className="mt-4 text-xl font-bold leading-tight tracking-tight">{track.title}</h3>
          <p className="mt-1.5 text-sm font-medium leading-relaxed text-rose-700 dark:text-rose-300">
            {track.blurb}
          </p>

          <ul className="mt-4 grid gap-2 sm:grid-cols-2">
            {track.benefits.map((benefit) => (
              <li key={benefit} className="flex items-start gap-2 text-sm">
                <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" />
                <span className="leading-relaxed text-muted-foreground">{benefit}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="w-full shrink-0 rounded-2xl border border-rose-200 bg-card p-5 text-center shadow-sm md:w-64 dark:border-rose-900/50">
          {saving > 0 && (
            <p className="text-sm text-muted-foreground line-through tabular-nums">
              {formatPaise(separately)}
            </p>
          )}
          <p className="text-4xl font-extrabold tracking-tight text-rose-600 tabular-nums dark:text-rose-400">
            {formatPaise(track.fromPriceInPaise)}
          </p>
          {saving > 0 && (
            <p className="mt-1.5 inline-block rounded-full bg-success/15 px-2.5 py-0.5 text-xs font-bold text-success">
              Save {formatPaise(saving)}
            </p>
          )}
          <Button asChild fullWidth className="mt-4 bg-rose-600 text-white hover:bg-rose-700">
            <Link href={track.href}>
              {track.ctaLabel}
              <ArrowRight aria-hidden="true" />
            </Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
