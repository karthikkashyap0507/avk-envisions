/**
 * Sets the catalogue prices.
 *
 * Everything was made free during launch. This applies the published pricing:
 * an early-bird rung for the first fifty members, then the standard price.
 * The ladder is computed from live entitlement counts at request time, so a
 * price is never stored per-buyer and cannot drift.
 *
 * 2011 stays free in full. It is the sample year — a student needs to sit a
 * complete paper before being asked to pay for the rest, and 2011 is the paper
 * every landing page points at.
 *
 * Test-level access follows the series: a paid series' tests become PAID so
 * `startAttempt` refuses them without an entitlement. That check reads
 * `accessType` on the test, not the price on the series, so leaving the tests
 * FREE would price the series while giving it away.
 *
 *   npm run db:pricing -- --dry-run
 *
 * Run with: npm run db:pricing
 */
import { PrismaClient } from '@prisma/client';

const db = new PrismaClient();
const DRY_RUN = process.argv.includes('--dry-run');

/** Prices in rupees, as published. */
interface Plan {
  slug: string;
  price: number;
  earlyBird: number | null;
  earlyBirdLimit: number | null;
  /** Free years inside a paid track, by slug. */
  free?: boolean;
}

const PLANS: Plan[] = [
  // Free forever.
  { slug: 'kas-prelims-free-test-series', price: 0, earlyBird: null, earlyBirdLimit: null, free: true },
  // The sample year: a complete paper, free, so the paid years are a decision
  // made after sitting one rather than before.
  { slug: 'kas-pyq-2011', price: 0, earlyBird: null, earlyBirdLimit: null, free: true },

  // The previous-year bundle — ₹99 for the first 50, then ₹199. This is what
  // is actually sold; the per-year rows below only matter if a year is ever
  // offered on its own again, and they are kept in step so it could be.
  { slug: 'kas-pyq-all-years', price: 199, earlyBird: 99, earlyBirdLimit: 50 },

  // PYQ — ₹99 for the first 50, then ₹199. Priced per year.
  { slug: 'kas-pyq-2015', price: 199, earlyBird: 99, earlyBirdLimit: 50 },
  { slug: 'kas-pyq-2017', price: 199, earlyBird: 99, earlyBirdLimit: 50 },
  { slug: 'kas-pyq-2020', price: 199, earlyBird: 99, earlyBirdLimit: 50 },
  { slug: 'kas-pyq-2024-august', price: 199, earlyBird: 99, earlyBirdLimit: 50 },
  { slug: 'kas-pyq-2024-december', price: 199, earlyBird: 99, earlyBirdLimit: 50 },

  // KAS Complete Practice Combo — PYQ, KAS-50 and the full-length series in
  // one purchase, at a flat ₹249. No early-bird ladder: the saving it shows is
  // against buying the three separately, computed from their live prices.
  { slug: 'kas-complete-practice-combo', price: 249, earlyBird: null, earlyBirdLimit: null },

  // KAS50 — ₹99 for the first 50, then ₹299.
  { slug: 'kas-50-questions-50-days', price: 299, earlyBird: 99, earlyBirdLimit: 50 },

  // Full-length mocks — ₹99 for the first 50, then ₹299.
  { slug: 'kas-prelims-paid-test-series', price: 199, earlyBird: 99, earlyBirdLimit: 50 },

  // Chapterwise, priced per subject. Each is bought on its own, which is why
  // the page offers both "Unlock Now" per subject and "Unlock All Subjects".
  { slug: 'chapterwise-polity', price: 199, earlyBird: 49, earlyBirdLimit: 50 },
  { slug: 'chapterwise-history', price: 199, earlyBird: 49, earlyBirdLimit: 50 },
  { slug: 'chapterwise-geography', price: 199, earlyBird: 49, earlyBirdLimit: 50 },
  { slug: 'chapterwise-environment', price: 199, earlyBird: 49, earlyBirdLimit: 50 },
  { slug: 'chapterwise-economy', price: 199, earlyBird: 49, earlyBirdLimit: 50 },
];

async function main() {
  console.log(`\nSetting catalogue prices${DRY_RUN ? ' (dry run)' : ''}...\n`);

  for (const plan of PLANS) {
    const series = await db.testSeries.findFirst({
      where: { slug: plan.slug, deletedAt: null },
      select: { id: true, name: true, tests: { where: { deletedAt: null }, select: { id: true } } },
    });

    if (!series) {
      console.log(`  --  ${plan.slug} not found; skipped`);
      continue;
    }

    const access = plan.free ? 'FREE' : 'PAID';
    const label = plan.free
      ? 'free'
      : plan.earlyBird === null
        ? `₹${plan.price}`
        : `₹${plan.earlyBird} for the first ${plan.earlyBirdLimit}, then ₹${plan.price}`;

    console.log(
      `  ${DRY_RUN ? '   ' : 'ok '} ${plan.slug.padEnd(30)} ${label.padEnd(38)} ${series.tests.length} test(s) → ${access}`,
    );

    if (DRY_RUN) continue;

    await db.testSeries.update({
      where: { id: series.id },
      data: {
        priceInPaise: plan.price * 100,
        // Struck-through reference price, shown only when a discount is live.
        comparePriceInPaise: plan.earlyBird !== null ? plan.price * 100 : 0,
        tier1PriceInPaise: plan.earlyBird !== null ? plan.earlyBird * 100 : null,
        tier1Limit: plan.earlyBirdLimit,
        // No second rung: the published ladder is early-bird then standard.
        tier2PriceInPaise: null,
        tier2Limit: null,
      },
    });

    // The gate a student actually meets is on the test, so it has to match.
    await db.test.updateMany({
      where: { id: { in: series.tests.map((t) => t.id) } },
      data: { accessType: access },
    });
  }

  console.log(
    `\n  2011 and the free series stay free. Everything else needs an entitlement.\n`,
  );
}

main()
  .catch((error) => {
    console.error('\nFailed:\n', error?.message ?? error);
    process.exitCode = 1;
  })
  .finally(async () => db.$disconnect());
