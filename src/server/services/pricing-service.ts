import { db } from '@/server/db';

/**
 * Early-bird pricing.
 *
 * A series can advertise a price that steps up as seats fill: tier 1 until
 * `tier1Limit` people have enrolled, tier 2 until `tier2Limit`, then the
 * regular `priceInPaise`.
 *
 * The seats-taken figure is always counted from live entitlements. It is never
 * stored, and never seeded with a flattering starting number — a countdown
 * that does not correspond to real sales is a lie told to every visitor, and it
 * would also let the advertised price drift away from what checkout charges.
 */

export interface SeriesPricing {
  /** What a new buyer pays right now, in paise. */
  priceInPaise: number;
  /** The regular price once every tier is exhausted. */
  regularPriceInPaise: number;
  /** Which tier is live: 1, 2, or null when selling at the regular price. */
  activeTier: 1 | 2 | null;
  /** People who already hold access. Counted, not stored. */
  enrolled: number;
  /** Seats left in the current tier, or null when there is no tier running. */
  seatsLeftInTier: number | null;
  /** The ceiling of the current tier, or null at regular price. */
  tierLimit: number | null;
  /** Price of the next step up, or null when this is already the last step. */
  nextPriceInPaise: number | null;
  /**
   * Every rung, in order, for rendering the published ladder.
   *
   * Needed because a page showing "199 / 299 / 399" has to name all three
   * prices even when only one of them is currently on sale.
   */
  ladder: PricingRung[];
}

export interface PricingRung {
  /** Human label, e.g. "For the first 50 members". */
  label: string;
  priceInPaise: number;
  /** Enrolment ceiling for this rung; null on the final one. */
  limit: number | null;
  /** Whether this is the price a buyer pays right now. */
  active: boolean;
}

interface SeriesPricingInput {
  priceInPaise: number;
  tier1PriceInPaise: number | null;
  tier1Limit: number | null;
  tier2PriceInPaise: number | null;
  tier2Limit: number | null;
}

/** Counts everyone holding live, unrevoked access to a series. */
export async function countEnrolled(testSeriesId: string): Promise<number> {
  const now = new Date();

  // Both halves, exactly as `countEnrolledMany` does it. This is the count
  // checkout prices against, so if it ignored the offline buyers the page
  // could offer a seat the payment step had already priced out of the tier.
  const [tracked, series] = await Promise.all([
    db.entitlement.count({
      where: {
        testSeriesId,
        revokedAt: null,
        startsAt: { lte: now },
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
    }),
    db.testSeries.findUnique({
      where: { id: testSeriesId },
      select: { offlineEnrolments: true },
    }),
  ]);

  return tracked + (series?.offlineEnrolments ?? 0);
}

/**
 * Resolves the price a buyer pays, given how many have already enrolled.
 *
 * Pure, so the ladder can be unit-tested without a database.
 */
export function resolvePricing(series: SeriesPricingInput, enrolled: number): SeriesPricing {
  const regular = series.priceInPaise;

  const t1 = series.tier1PriceInPaise;
  const l1 = series.tier1Limit;
  const t2 = series.tier2PriceInPaise;
  const l2 = series.tier2Limit;

  const tier1Live = t1 !== null && l1 !== null && enrolled < l1;
  const tier2Live = !tier1Live && t2 !== null && l2 !== null && enrolled < l2;

  const ladder: PricingRung[] = [];
  if (t1 !== null && l1 !== null) {
    ladder.push({
      label: `For the first ${l1} members`,
      priceInPaise: t1,
      limit: l1,
      active: tier1Live,
    });
  }
  if (t2 !== null && l2 !== null) {
    ladder.push({
      label: `Up to ${l2} members`,
      priceInPaise: t2,
      limit: l2,
      active: tier2Live,
    });
  }
  ladder.push({
    label: ladder.length > 0 ? 'Final price' : 'Price',
    priceInPaise: regular,
    limit: null,
    active: !tier1Live && !tier2Live,
  });

  const base: SeriesPricing = {
    priceInPaise: regular,
    regularPriceInPaise: regular,
    activeTier: null,
    enrolled,
    seatsLeftInTier: null,
    tierLimit: null,
    nextPriceInPaise: null,
    ladder,
  };

  // Free series have no ladder to climb.
  if (regular === 0) return { ...base, ladder: [] };

  if (tier1Live) {
    return {
      ...base,
      priceInPaise: t1 as number,
      activeTier: 1,
      seatsLeftInTier: (l1 as number) - enrolled,
      tierLimit: l1,
      nextPriceInPaise: t2 ?? regular,
    };
  }

  if (tier2Live) {
    return {
      ...base,
      priceInPaise: t2 as number,
      activeTier: 2,
      seatsLeftInTier: (l2 as number) - enrolled,
      tierLimit: l2,
      nextPriceInPaise: regular,
    };
  }

  return base;
}

/** Convenience wrapper: reads the ladder and the live count together. */
export async function getSeriesPricing(testSeriesId: string): Promise<SeriesPricing | null> {
  const series = await db.testSeries.findUnique({
    where: { id: testSeriesId },
    select: {
      priceInPaise: true,
      tier1PriceInPaise: true,
      tier1Limit: true,
      tier2PriceInPaise: true,
      tier2Limit: true,
    },
  });

  if (!series) return null;
  return resolvePricing(series, await countEnrolled(testSeriesId));
}

/**
 * Enrolment counts for many series at once.
 *
 * A listing page needs one count per series; doing that with a query each
 * turns a six-card grid into seven round trips. Series with nobody enrolled
 * are absent from `groupBy`, so the caller must treat a missing key as zero.
 */
export async function countEnrolledMany(testSeriesIds: string[]): Promise<Map<string, number>> {
  if (testSeriesIds.length === 0) return new Map();

  const now = new Date();
  const rows = await db.entitlement.groupBy({
    by: ['testSeriesId'],
    where: {
      testSeriesId: { in: testSeriesIds },
      revokedAt: null,
      startsAt: { lte: now },
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    },
    _count: { _all: true },
  });

  const counts = new Map<string, number>();
  for (const row of rows) {
    if (row.testSeriesId) counts.set(row.testSeriesId, row._count._all);
  }

  // Buyers who paid outside the site hold no entitlement row, so the query
  // above undercounts them. Added here rather than at each call site because
  // this one number decides three things that must agree: how many seats the
  // page says are left, which tier the ladder is on, and what checkout
  // charges. Adding it further out would let the seats shown drift from the
  // price actually taken.
  const offline = await db.testSeries.findMany({
    where: { id: { in: testSeriesIds }, offlineEnrolments: { gt: 0 } },
    select: { id: true, offlineEnrolments: true },
  });

  for (const series of offline) {
    counts.set(series.id, (counts.get(series.id) ?? 0) + series.offlineEnrolments);
  }

  return counts;
}
