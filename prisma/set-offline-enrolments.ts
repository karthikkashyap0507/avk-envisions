/**
 * Records buyers who paid outside the site.
 *
 * Payment by UPI or bank transfer, and anyone who joined before the site took
 * payments, leaves no entitlement row — so the enrolled count read from the
 * database alone understates how many people have really bought. The paid
 * series showed 5 while 29 had paid.
 *
 * The number set here is added to the tracked count wherever enrolment is
 * counted, so the seats shown on the page, the tier the ladder is on and the
 * price checkout charges all move together.
 *
 * Keep it matched to a real roll of buyers. Two things go wrong otherwise: the
 * page tells visitors something untrue, and the early-bird tier closes at the
 * wrong moment — set it above the real figure and buyers are charged the later
 * price while the page still advertises the early one.
 *
 * Set it back by passing 0.
 *
 *   npm run db:offline -- --series kas-prelims-paid-test-series --count 29
 *   npm run db:offline -- --series kas-prelims-paid-test-series --count 29 --dry-run
 *
 * Run with: npm run db:offline
 */
import { PrismaClient } from '@prisma/client';

import { resolvePricing } from '../src/server/services/pricing-service';

const db = new PrismaClient();
const DRY_RUN = process.argv.includes('--dry-run');

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

/**
 * The series this defaults to, being the one it was written for.
 *
 * 29 is the roll of buyers who paid by UPI or bank transfer as of 14 Sep 2026.
 * With the 8 who paid through the site that is 37 in total, which is what the
 * page shows — one figure, since a buyer is a buyer however they paid.
 *
 * Raise it as more people pay offline. It runs unattended on deploy, so the
 * default here is the live figure rather than an example: leaving it stale
 * understates the count, and inflating it closes the early-bird tier early and
 * charges buyers ₹299 while the page still advertises ₹99.
 */
const DEFAULT_SERIES = 'kas-prelims-paid-test-series';
const DEFAULT_COUNT = 29;

async function main() {
  const slug = argument('series') ?? DEFAULT_SERIES;
  const raw = argument('count') ?? String(DEFAULT_COUNT);
  const count = Number(raw);

  if (!Number.isInteger(count) || count < 0) {
    throw new Error(`--count must be a whole number, not "${raw}".`);
  }

  const series = await db.testSeries.findFirst({
    where: { slug, deletedAt: null },
    select: {
      id: true,
      name: true,
      offlineEnrolments: true,
      priceInPaise: true,
      tier1PriceInPaise: true,
      tier1Limit: true,
      tier2PriceInPaise: true,
      tier2Limit: true,
    },
  });
  if (!series) throw new Error(`No series with the slug "${slug}".`);

  const now = new Date();
  const tracked = await db.entitlement.count({
    where: {
      testSeriesId: series.id,
      revokedAt: null,
      startsAt: { lte: now },
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    },
  });

  const before = tracked + series.offlineEnrolments;
  const after = tracked + count;

  console.log(`\n${series.name}`);
  console.log(`  paid through the site : ${tracked}`);
  console.log(`  paid another way      : ${series.offlineEnrolments} → ${count}`);
  console.log(`  shown as enrolled     : ${before} → ${after}`);

  if (series.tier1Limit !== null) {
    const left = Math.max(0, series.tier1Limit - after);
    console.log(`  early-bird places left: ${left} of ${series.tier1Limit}`);

    // What a buyer would be charged at that count, so an overshoot that closes
    // the tier early is obvious here rather than at someone's checkout.
    const price = resolvePricing(series, after);
    console.log(`  price a buyer now pays: ₹${(price.priceInPaise / 100).toLocaleString('en-IN')}`);

    if (after >= series.tier1Limit) {
      console.log('\n  Note: this fills the early-bird tier. New buyers pay the later price.');
    }
  }

  if (DRY_RUN) {
    console.log('\nDry run: nothing was written.\n');
    return;
  }

  await db.testSeries.update({
    where: { id: series.id },
    data: { offlineEnrolments: count },
  });

  console.log('\nSaved.\n');
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => db.$disconnect());
