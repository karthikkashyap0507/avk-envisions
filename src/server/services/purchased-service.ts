import {
  DAILY_CHALLENGE_SLUG,
  PYQ_BUNDLE_SLUG,
  PYQ_SERIES_PREFIX,
} from '@/lib/enums';
import { db } from '@/server/db';
import { hasEntitlement } from '@/server/services/entitlement-service';
import { countEnrolledMany, resolvePricing } from '@/server/services/pricing-service';

/**
 * What a student has bought, and where each purchase is used.
 *
 * A series and the page a student actually studies on are not the same thing:
 * the previous-year papers are bought as one bundle but read at `/pyq`, and
 * KAS-50 is a series of fifty tests read at `/50-days`. Buying something and
 * then being left on a receipt page — with no route to the thing itself — is
 * the gap this closes.
 *
 * One definition serves both the post-payment redirect and the dashboard list,
 * so a student is sent to the same place the dashboard later links them to.
 */

export interface PurchasedCourse {
  /** The entitlement's series id, so a caller can dedupe. */
  id: string;
  /** What the student calls it, not the catalogue's full name. */
  name: string;
  /** Where the course is actually studied. */
  href: string;
  /** Shown under the name on the dashboard. */
  blurb: string;
  purchasedAt: Date;
}

/** Where a series is studied, and what to call it once bought. */
interface Destination {
  name: string;
  href: string;
  blurb: string;
}

/**
 * Resolves a series slug to the page its buyer should be sent to.
 *
 * Falls back to the series page, which always exists, so a series added later
 * still lands somewhere sensible rather than nowhere.
 */
export function destinationFor(slug: string, name: string): Destination {
  if (slug === PYQ_BUNDLE_SLUG || slug.startsWith(PYQ_SERIES_PREFIX)) {
    return {
      name: 'KAS PYQ Tests',
      href: '/pyq',
      blurb: 'Every previous year paper, full-length and subject-wise.',
    };
  }

  if (slug === DAILY_CHALLENGE_SLUG) {
    return {
      name: 'KAS-50 (Daily tests)',
      href: '/50-days',
      blurb: '50 questions a day for 50 days, with the full timetable.',
    };
  }

  if (slug === 'kas-prelims-paid-test-series') {
    return {
      name: 'KAS Full Length Tests',
      href: '/test-series/kas-prelims-paid-test-series',
      blurb: 'Full-length mocks in the real prelims pattern.',
    };
  }

  if (slug === 'kas-prelims-free-test-series') {
    return {
      name: 'Free Test Series',
      href: '/test-series/kas-prelims-free-test-series',
      blurb: 'Ten free tests you can attempt any day, in any order.',
    };
  }

  if (slug.startsWith('chapterwise-')) {
    return {
      name,
      href: '/chapterwise',
      blurb: 'Chapter by chapter practice for this subject.',
    };
  }

  return { name, href: `/test-series/${slug}`, blurb: 'Your purchased test series.' };
}

/**
 * Everything `userId` currently holds, newest purchase first.
 *
 * Only live entitlements count: revoked, not-yet-started and expired ones are
 * excluded, so lapsed access disappears from the list rather than linking a
 * student to a page that will turn them away.
 */
export async function getPurchasedCourses(userId: string): Promise<PurchasedCourse[]> {
  const now = new Date();

  const rows = await db.entitlement.findMany({
    where: {
      userId,
      revokedAt: null,
      startsAt: { lte: now },
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      testSeriesId: { not: null },
    },
    select: {
      createdAt: true,
      testSeries: { select: { id: true, slug: true, name: true, priceInPaise: true } },
    },
    orderBy: { createdAt: 'desc' },
  });

  // A student holding both the bundle and a single year bought before it
  // exists twice here; the destination is the same page either way, so the
  // list shows it once.
  const seen = new Set<string>();
  const courses: PurchasedCourse[] = [];

  for (const row of rows) {
    const series = row.testSeries;
    if (!series) continue;

    const destination = destinationFor(series.slug, series.name);
    if (seen.has(destination.href)) continue;
    seen.add(destination.href);

    courses.push({
      id: series.id,
      name: destination.name,
      href: destination.href,
      blurb: destination.blurb,
      purchasedAt: row.createdAt,
    });
  }

  return courses;
}

export interface AvailableCourse {
  id: string;
  name: string;
  href: string;
  blurb: string;
  /** What a buyer pays today, which is the early-bird price while one is live. */
  priceInPaise: number;
  /** What it costs once the early-bird seats are gone, or null at full price. */
  laterPriceInPaise: number | null;
}

/**
 * Courses the student could buy but has not.
 *
 * Shown beneath what they own, so the dashboard answers both "what do I have"
 * and "what else is there" — the second was only on the public catalogue,
 * which a signed-in student has little reason to revisit.
 *
 * Anything already owned is left out, through the same entitlement check the
 * rest of the site uses, so a previous-year bundle correctly suppresses every
 * individual year rather than advertising years the student can already open.
 */
export async function getAvailableCourses(userId: string): Promise<AvailableCourse[]> {
  const sellable = await db.testSeries.findMany({
    where: {
      deletedAt: null,
      status: 'PUBLISHED',
      priceInPaise: { gt: 0 },
      // Two things are held back.
      //
      // A year inside the previous-year bundle is not sold separately: the
      // bundle is the product, and listing both invites paying twice. The
      // bundle itself stays, and holds no papers of its own by design — it is
      // the parent that entitles every year.
      //
      // Not the chapterwise subjects. They are published and priced, but the
      // pricing page marks the whole track "Coming Soon" — a product decision
      // rather than anything the data says — while this list was quietly
      // selling them at ₹199 each.
      //
      // Excluded by slug, matching that decision, because inferring it from
      // the data does not work: a first paper had been attached to Polity in
      // production, so a "has at least one test" rule let it through again
      // while the pricing page still called it Coming Soon. The two have to
      // agree, and the pricing page is where the decision is made.
      NOT: [
        { slug: { startsWith: `${PYQ_SERIES_PREFIX}2` } },
        { slug: { startsWith: 'chapterwise-' } },
      ],
    },
    orderBy: { sortOrder: 'asc' },
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

  // Resolved against the live enrolment count, exactly as the pricing page and
  // checkout do. Reading `priceInPaise` straight off the row shows the price
  // AFTER the early-bird seats are gone — the dashboard quoted PYQ at ₹199 and
  // KAS-50 at ₹299 while they were actually selling at ₹49 and ₹99. Quoting a
  // higher price than a buyer would be charged is the worst direction for that
  // error to go.
  const enrolled = await countEnrolledMany(sellable.map((s) => s.id));
  const courses: AvailableCourse[] = [];

  for (const series of sellable) {
    if (await hasEntitlement(userId, series.id)) continue;

    const pricing = resolvePricing(series, enrolled.get(series.id) ?? 0);
    const destination = destinationFor(series.slug, series.name);

    courses.push({
      id: series.id,
      name: destination.name,
      href: destination.href,
      blurb: destination.blurb,
      priceInPaise: pricing.priceInPaise,
      // Only where it differs, so a series at its regular price shows one
      // figure rather than the same number twice.
      laterPriceInPaise:
        pricing.nextPriceInPaise !== null && pricing.nextPriceInPaise !== pricing.priceInPaise
          ? pricing.nextPriceInPaise
          : null,
    });
  }

  return courses;
}

export interface OpenableSeries {
  id: string;
  name: string;
  /** Where the student goes to pick a paper. */
  href: string;
  blurb: string;
  /** Papers a student can actually sit today. */
  readyCount: number;
  /** Papers on the published plan, written or not. */
  totalCount: number;
  /** Free series come first, then what they bought. */
  isFree: boolean;
}

/**
 * The series a student can open, as series rather than as papers.
 *
 * "My tests" listed every individual paper with its own Start button. With the
 * free series, the previous-year papers and their subject-wise drills all
 * published, that is dozens of near-identical cards on one screen — and the
 * ones a student had paid for were not among them, because the list only ever
 * queried free tests.
 *
 * One card per series fixes both: the page says what you have access to, and
 * the series page is where you choose a paper. That page already exists, knows
 * which papers are open, and shows the schedule beside them.
 *
 * A paid series appears only where the student holds it. A free one always
 * does, since anyone signed in can sit it.
 */
export async function getOpenableSeries(userId: string): Promise<OpenableSeries[]> {
  const series = await db.testSeries.findMany({
    where: {
      deletedAt: null,
      status: 'PUBLISHED',
      // Nothing empty. A series with no published paper has nothing to open,
      // and a card leading to an empty list is worse than no card.
      tests: { some: { deletedAt: null, status: 'PUBLISHED' } },
    },
    orderBy: { sortOrder: 'asc' },
    select: {
      id: true,
      slug: true,
      name: true,
      priceInPaise: true,
      tests: {
        where: { deletedAt: null, status: 'PUBLISHED' },
        select: { totalQuestions: true, startDate: true },
      },
    },
  });

  const now = new Date();
  const open: OpenableSeries[] = [];
  const seen = new Set<string>();

  for (const row of series) {
    const isFree = row.priceInPaise === 0;

    // Paid means owned. `hasEntitlement` is the same check the rest of the
    // site uses, so a bundle correctly opens every year inside it.
    if (!isFree && !(await hasEntitlement(userId, row.id))) continue;

    const destination = destinationFor(row.slug, row.name);

    // The previous-year years all resolve to /pyq, and the bundle with them.
    // One card, not one per year.
    if (seen.has(destination.href)) continue;
    seen.add(destination.href);

    const ready = row.tests.filter(
      (test) => test.totalQuestions > 0 && (test.startDate === null || test.startDate <= now),
    ).length;

    open.push({
      id: row.id,
      name: destination.name,
      href: destination.href,
      blurb: destination.blurb,
      readyCount: ready,
      totalCount: row.tests.length,
      isFree,
    });
  }

  // Free first — it is what a new student can start without paying — then the
  // courses they own, in catalogue order.
  return open.sort((a, b) => (a.isFree === b.isFree ? 0 : a.isFree ? -1 : 1));
}
