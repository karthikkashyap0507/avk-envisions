/**
 * Creates the previous-year bundle: one purchase, every exam year.
 *
 * Each year stays its own series so it can be scheduled, priced and
 * administered separately. This adds the parent that is actually sold, and
 * `hasEntitlement` treats holding it as access to every year.
 *
 * Before this, the pricing card titled "KAS Previous Year Question Papers" at
 * ₹49 was wired to the 2015 series alone: a student paid for what the page
 * called the previous-year papers and received a single year.
 *
 * Anyone who already bought an individual year keeps it — those entitlements
 * are untouched — and is additionally granted the bundle, because they paid
 * the advertised price for what the page described.
 *
 *   npm run db:pyq-bundle -- --dry-run
 */
import { PrismaClient } from '@prisma/client';

import { PYQ_BUNDLE_SLUG, PYQ_SERIES_PREFIX } from '../src/lib/enums';

const db = new PrismaClient();
const DRY_RUN = process.argv.includes('--dry-run');

/** What the bundle costs: the same early-bird ladder each year carried. */
const TIER1_PAISE = 9900;
const TIER1_LIMIT = 50;
const TIER2_PAISE = 19900;

async function main() {
  console.log(`\nPrevious-year bundle${DRY_RUN ? ' (dry run)' : ''}...\n`);

  const years = (
    await db.testSeries.findMany({
      where: { slug: { startsWith: PYQ_SERIES_PREFIX }, deletedAt: null },
      select: { id: true, slug: true, name: true, priceInPaise: true },
      orderBy: { slug: 'asc' },
    })
  ).filter((row) => row.slug !== PYQ_BUNDLE_SLUG);

  const paid = years.filter((row) => row.priceInPaise > 0);
  console.log(`  ${years.length} year(s), of which ${paid.length} are paid:`);
  for (const row of years) {
    console.log(`    ${row.slug.padEnd(24)} ${row.priceInPaise === 0 ? 'free' : `₹${row.priceInPaise / 100}`}`);
  }

  const exam = await db.exam.findFirst({ select: { id: true } });
  if (!exam) throw new Error('No exam found. Seed the catalogue first.');

  // Everyone who bought a single year before the bundle existed.
  const priorBuyers = await db.entitlement.findMany({
    where: { testSeriesId: { in: paid.map((row) => row.id) }, revokedAt: null },
    select: { userId: true },
    distinct: ['userId'],
  });
  console.log(`\n  ${priorBuyers.length} student(s) already hold a single year.`);

  if (DRY_RUN) {
    console.log('\n  Nothing written.\n');
    return;
  }

  const bundle = await db.testSeries.upsert({
    where: { slug: PYQ_BUNDLE_SLUG },
    update: {
      name: 'KAS Previous Year Question Papers',
      description:
        'Every previous year paper KPSC has set — full-length and subject-wise, with the complete analysis for each. One payment covers all years.',
      status: 'PUBLISHED',
      priceInPaise: TIER2_PAISE,
      tier1PriceInPaise: TIER1_PAISE,
      tier1Limit: TIER1_LIMIT,
      tier2PriceInPaise: TIER2_PAISE,
    },
    create: {
      slug: PYQ_BUNDLE_SLUG,
      examId: exam.id,
      name: 'KAS Previous Year Question Papers',
      description:
        'Every previous year paper KPSC has set — full-length and subject-wise, with the complete analysis for each. One payment covers all years.',
      status: 'PUBLISHED',
      priceInPaise: TIER2_PAISE,
      tier1PriceInPaise: TIER1_PAISE,
      tier1Limit: TIER1_LIMIT,
      tier2PriceInPaise: TIER2_PAISE,
    },
    select: { id: true },
  });

  // Honour what earlier buyers were told they were buying.
  let granted = 0;
  for (const buyer of priorBuyers) {
    const held = await db.entitlement.findFirst({
      where: { userId: buyer.userId, testSeriesId: bundle.id, revokedAt: null },
      select: { id: true },
    });
    if (held) continue;
    await db.entitlement.create({
      data: {
        userId: buyer.userId,
        testSeriesId: bundle.id,
        sourceType: 'ADMIN_GRANT',
        note: 'Bought a previous-year series before the bundle existed.',
      },
    });
    granted += 1;
  }

  console.log(`  Bundle ready. ${granted} earlier buyer(s) upgraded to all years.\n`);
}

main()
  .catch((error) => {
    console.error('\nFailed:\n', error?.message ?? error);
    process.exitCode = 1;
  })
  .finally(async () => db.$disconnect());
