import { COMBO_INCLUDES, COMBO_SLUG, PYQ_BUNDLE_SLUG, PYQ_SERIES_PREFIX } from '@/lib/enums';
import { db } from '@/server/db';

/**
 * Who may open a paid series.
 *
 * One purchase of the previous-year bundle unlocks every exam year, which is
 * how the papers are sold and how the pricing page describes them. Before this
 * existed each year was its own series with its own entitlement, so a student
 * who paid ₹49 for "KAS Previous Year Question Papers" received a single year
 * and was asked to pay again for the next one.
 *
 * The rule lives here rather than at each call site because access is checked
 * in three separate places — starting an attempt, opening an analysis, and
 * creating an order — and a bundle honoured in only two of them is worse than
 * no bundle at all: it sells access the site then refuses to serve.
 */

/** A series is one of the previous-year papers, so the bundle covers it. */
export function isPyqSeries(slug: string): boolean {
  return slug.startsWith(PYQ_SERIES_PREFIX) && slug !== PYQ_BUNDLE_SLUG;
}

/** The combo covers the three it names, and every year inside the PYQ bundle. */
function comboCovers(slug: string): boolean {
  return (COMBO_INCLUDES as readonly string[]).includes(slug) || isPyqSeries(slug);
}

/**
 * The series ids whose entitlement grants access to `seriesId`.
 *
 * Normally just the series itself. A previous-year paper is also opened by
 * the PYQ bundle; the bundle, KAS-50 and the full-length series are also
 * opened by the Complete Practice Combo. So one purchase of the combo opens
 * every paper in all three, through this one function — which is what every
 * access check on the site goes through.
 */
export async function grantingSeriesIds(seriesId: string): Promise<string[]> {
  const series = await db.testSeries.findUnique({
    where: { id: seriesId },
    select: { slug: true },
  });
  if (!series) return [seriesId];

  const parents: string[] = [];
  if (isPyqSeries(series.slug)) parents.push(PYQ_BUNDLE_SLUG);
  if (comboCovers(series.slug)) parents.push(COMBO_SLUG);
  if (parents.length === 0) return [seriesId];

  const rows = await db.testSeries.findMany({
    where: { slug: { in: parents }, deletedAt: null },
    select: { id: true },
  });

  return [seriesId, ...rows.map((row) => row.id)];
}

/**
 * Whether `userId` may open `seriesId` right now.
 *
 * Checks the series itself and anything that bundles it. Revoked, not-yet-
 * started and expired entitlements are all excluded, so lapsed access reads as
 * no access rather than silently continuing.
 */
export async function hasEntitlement(userId: string, seriesId: string): Promise<boolean> {
  const now = new Date();
  const ids = await grantingSeriesIds(seriesId);

  const found = await db.entitlement.findFirst({
    where: {
      userId,
      testSeriesId: { in: ids },
      revokedAt: null,
      startsAt: { lte: now },
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    },
    select: { id: true },
  });

  return found !== null;
}

/**
 * Every previous-year series the bundle covers, for the catalogue pages.
 *
 * Returned as ids so a page can mark each year "included" without asking the
 * database once per card.
 */
export async function pyqSeriesIds(): Promise<string[]> {
  const rows = await db.testSeries.findMany({
    where: { slug: { startsWith: PYQ_SERIES_PREFIX }, deletedAt: null },
    select: { id: true, slug: true },
  });
  return rows.filter((row) => isPyqSeries(row.slug)).map((row) => row.id);
}
