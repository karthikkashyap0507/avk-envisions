import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight, BookOpen, CalendarDays, CheckCircle2, Gift, Trophy } from 'lucide-react';

import { BuyButton } from '@/features/checkout/buy-button';
import { COMBO_INCLUDES, COMBO_SLUG, DAILY_CHALLENGE_SLUG, PYQ_BUNDLE_SLUG } from '@/lib/enums';
import { formatPaise } from '@/lib/utils';
import { getSession } from '@/server/auth/session';
import { db } from '@/server/db';
import { hasEntitlement } from '@/server/services/entitlement-service';
import { countEnrolledMany, resolvePricing } from '@/server/services/pricing-service';
import { destinationFor } from '@/server/services/purchased-service';

export const metadata: Metadata = {
  title: 'KAS Complete Practice Combo',
  description:
    'KAS PYQ Tests, KAS-50 (Daily tests) and KAS Full Length Tests in one purchase.',
  alternates: { canonical: '/combo' },
};

export const dynamic = 'force-dynamic';

const ICONS: Record<string, typeof BookOpen> = {
  [PYQ_BUNDLE_SLUG]: BookOpen,
  [DAILY_CHALLENGE_SLUG]: CalendarDays,
};

/**
 * `/combo` — KAS Complete Practice Combo.
 *
 * Where every "Get Complete Combo" button leads, and where a buyer is sent
 * after paying. For a buyer it becomes the index of what they unlocked, with a
 * link into each of the three — the combo has no papers of its own, so a
 * receipt with nowhere to go would strand them.
 */
export default async function ComboPage() {
  const session = await getSession();

  const series = await db.testSeries.findMany({
    where: { slug: { in: [COMBO_SLUG, ...COMBO_INCLUDES] }, deletedAt: null },
    select: {
      id: true,
      slug: true,
      name: true,
      priceInPaise: true,
      tier1PriceInPaise: true,
      tier1Limit: true,
      tier2PriceInPaise: true,
      tier2Limit: true,
    },
  });

  const combo = series.find((s) => s.slug === COMBO_SLUG);
  const enrolled = await countEnrolledMany(series.map((s) => s.id));
  const priceOf = (row: (typeof series)[number]) =>
    resolvePricing(row, enrolled.get(row.id) ?? 0).priceInPaise;

  // Live, not fixed: the saving is against what the three cost today.
  const parts = COMBO_INCLUDES.map((slug) => series.find((s) => s.slug === slug)).filter(
    (row): row is (typeof series)[number] => Boolean(row),
  );
  const separately = parts.reduce((sum, row) => sum + priceOf(row), 0);
  const price = combo ? priceOf(combo) : 0;
  const saving = separately - price;

  const owned = Boolean(
    session?.user && combo && (await hasEntitlement(session.user.id, combo.id)),
  );

  const included = parts.map((row) => ({
    slug: row.slug,
    ...destinationFor(row.slug, row.name),
    priceInPaise: priceOf(row),
  }));

  return (
    <div className="bg-gradient-to-b from-rose-50/70 to-transparent dark:from-rose-950/10">
      <div className="container max-w-4xl py-10 sm:py-14">
        <header className="flex flex-col gap-6 md:flex-row md:items-start md:justify-between">
          <div className="min-w-0">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-400 px-3 py-1 text-xs font-bold uppercase tracking-wide text-amber-950">
              <Gift className="size-3.5" aria-hidden="true" />
              Best Value
            </span>
            <h1 className="mt-3 text-3xl font-extrabold tracking-tight sm:text-4xl">
              KAS Complete Practice Combo
            </h1>
            <p className="mt-2 max-w-xl text-base leading-relaxed text-muted-foreground">
              KAS PYQ Tests, KAS-50 (Daily tests) and KAS Full Length Tests — everything you need
              for KAS Prelims practice, in one purchase.
            </p>
          </div>

          <div className="w-full shrink-0 rounded-2xl border-2 border-rose-300 bg-card p-5 text-center shadow-sm md:w-64 dark:border-rose-800/60">
            {owned ? (
              <>
                <CheckCircle2 className="mx-auto size-8 text-success" aria-hidden="true" />
                <p className="mt-2 font-semibold">You own the combo</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  All three courses below are unlocked.
                </p>
              </>
            ) : combo && price > 0 ? (
              <>
                {saving > 0 && (
                  <p className="text-sm text-muted-foreground line-through tabular-nums">
                    {formatPaise(separately)}
                  </p>
                )}
                <p className="text-4xl font-extrabold tracking-tight text-rose-600 tabular-nums dark:text-rose-400">
                  {formatPaise(price)}
                </p>
                {saving > 0 && (
                  <p className="mt-1.5 inline-block rounded-full bg-success/15 px-2.5 py-0.5 text-xs font-bold text-success">
                    Save {formatPaise(saving)}
                  </p>
                )}
                <BuyButton
                  seriesSlug={COMBO_SLUG}
                  label="Get Complete Combo"
                  size="default"
                  className="mt-4 w-full"
                />
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                The combo opens shortly. Check back soon.
              </p>
            )}
          </div>
        </header>

        <h2 className="mt-10 text-lg font-bold tracking-tight">
          {owned ? 'Your courses' : 'What you get'}
        </h2>
        <ul className="mt-4 grid gap-4 sm:grid-cols-3">
          {included.map((item) => {
            const Icon = ICONS[item.slug] ?? Trophy;
            return (
              <li key={item.slug}>
                <Link
                  href={item.href}
                  className="flex h-full flex-col rounded-2xl border border-border bg-card p-5 transition-colors hover:border-rose-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="flex size-11 items-center justify-center rounded-xl bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300">
                    <Icon className="size-5" aria-hidden="true" />
                  </span>
                  <span className="mt-3 font-semibold leading-snug">{item.name}</span>
                  <span className="mt-1 flex-1 text-sm leading-relaxed text-muted-foreground">
                    {item.blurb}
                  </span>
                  <span className="mt-4 flex items-center justify-between text-sm font-semibold">
                    {owned ? (
                      <span className="text-rose-600 dark:text-rose-400">Open</span>
                    ) : (
                      <span className="text-muted-foreground tabular-nums">
                        {formatPaise(item.priceInPaise)} on its own
                      </span>
                    )}
                    <ArrowRight className="size-4 text-rose-600" aria-hidden="true" />
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
