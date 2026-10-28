/**
 * Sets KAS-50 (Daily tests) to a flat price for everyone.
 *
 * The price lives in the database, not in code. The seed deliberately leaves
 * it alone once set, and the admin panel only displays it, so a deploy does
 * not change it — this script does, and is the supported route.
 *
 * It sets the regular price to the figure below and REMOVES the early-bird
 * tiers, so every buyer pays the same amount now and later, with no
 * "for the first 50 members" offer and no struck-through compare price. The
 * compare price is levelled to the new price so nothing shows as a discount.
 *
 *   npx tsx scripts/set-kas50-price.mts
 *
 * Run it on the VM, where the production database lives:
 *
 *   cd /opt/avkvisions
 *   sudo -u avk npx tsx scripts/set-kas50-price.mts
 *
 * Safe to re-run: it sets absolute values, so running it twice leaves the same
 * result. It reads the price back and resolves it the way checkout does before
 * reporting success.
 */
import { PrismaClient } from '@prisma/client';

import { DAILY_CHALLENGE_SLUG } from '../src/lib/enums';
import { resolvePricing } from '../src/server/services/pricing-service';

const db = new PrismaClient();

/** The new flat price, in paise. 19900 = Rs 199. Edit this line to change it. */
const NEW_PRICE_PAISE = 19_900;

const rupees = (paise: number | null) => (paise === null ? '—' : `Rs ${(paise / 100).toFixed(0)}`);

async function main() {
  const series = await db.testSeries.findFirst({
    where: { slug: DAILY_CHALLENGE_SLUG, deletedAt: null },
    select: {
      id: true,
      name: true,
      priceInPaise: true,
      comparePriceInPaise: true,
      tier1PriceInPaise: true,
      tier1Limit: true,
      tier2PriceInPaise: true,
      tier2Limit: true,
    },
  });

  if (!series) {
    console.error(`No series found for slug "${DAILY_CHALLENGE_SLUG}". Nothing changed.`);
    process.exitCode = 1;
    return;
  }

  console.log(`Series : ${series.name}`);
  console.log('\nBefore:');
  console.log(`  regular price   ${rupees(series.priceInPaise)}`);
  console.log(`  compare price   ${rupees(series.comparePriceInPaise)}`);
  console.log(
    `  early-bird      ${rupees(series.tier1PriceInPaise)}` +
      (series.tier1Limit ? ` for the first ${series.tier1Limit}` : ' (none)'),
  );
  console.log(
    `  second tier     ${rupees(series.tier2PriceInPaise)}` +
      (series.tier2Limit ? ` up to ${series.tier2Limit}` : ' (none)'),
  );

  const before = { ...series };

  await db.$transaction([
    db.testSeries.update({
      where: { id: series.id },
      data: {
        priceInPaise: NEW_PRICE_PAISE,
        // Levelled to the price so no "discount" strike-through shows.
        comparePriceInPaise: NEW_PRICE_PAISE,
        // Remove the early-bird ladder: one flat price for everyone.
        tier1PriceInPaise: null,
        tier1Limit: null,
        tier2PriceInPaise: null,
        tier2Limit: null,
      },
    }),
    db.auditLog.create({
      data: {
        action: 'testseries.price_changed',
        entityType: 'TestSeries',
        entityId: series.id,
        metaJson: JSON.stringify({
          slug: DAILY_CHALLENGE_SLUG,
          before: {
            priceInPaise: before.priceInPaise,
            comparePriceInPaise: before.comparePriceInPaise,
            tier1PriceInPaise: before.tier1PriceInPaise,
            tier1Limit: before.tier1Limit,
            tier2PriceInPaise: before.tier2PriceInPaise,
            tier2Limit: before.tier2Limit,
          },
          after: {
            priceInPaise: NEW_PRICE_PAISE,
            comparePriceInPaise: NEW_PRICE_PAISE,
            tier1PriceInPaise: null,
            tier1Limit: null,
            tier2PriceInPaise: null,
            tier2Limit: null,
          },
          via: 'scripts/set-kas50-price.mts',
        }),
      },
    }),
  ]);

  // Read it back and resolve the price the way checkout and every page do.
  // Flat means the buyer pays the same regardless of how many have enrolled,
  // so prove it at several enrolment counts rather than trusting one.
  const after = await db.testSeries.findUniqueOrThrow({
    where: { id: series.id },
    select: {
      priceInPaise: true,
      comparePriceInPaise: true,
      tier1PriceInPaise: true,
      tier1Limit: true,
      tier2PriceInPaise: true,
      tier2Limit: true,
    },
  });

  console.log('\nAfter:');
  console.log(`  flat price      ${rupees(after.priceInPaise)}  (everyone, now and later)`);
  console.log(`  compare price   ${rupees(after.comparePriceInPaise)}  (not shown as a discount)`);
  console.log(`  early-bird      ${after.tier1PriceInPaise === null ? 'removed' : 'STILL SET'}`);

  const samples = [0, 25, 49, 50, 100, 1000];
  const prices = samples.map((n) => resolvePricing(after, n).priceInPaise);
  const allFlat = prices.every((p) => p === NEW_PRICE_PAISE);
  const noTiers =
    after.tier1PriceInPaise === null &&
    after.tier1Limit === null &&
    after.tier2PriceInPaise === null &&
    after.tier2Limit === null;

  console.log(
    `\n  resolved price at ${samples.length} enrolment counts: ` +
      `${[...new Set(prices)].map(rupees).join(', ')}`,
  );

  if (!allFlat || !noTiers || after.priceInPaise !== NEW_PRICE_PAISE) {
    console.error('\nFAILED: the price did not come out flat at the target. Re-run and check.');
    process.exitCode = 1;
    return;
  }

  console.log(`\nDone. KAS-50 now sells at ${rupees(NEW_PRICE_PAISE)} for everyone.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
