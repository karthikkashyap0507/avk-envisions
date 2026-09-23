/**
 * Creates the KAS Complete Practice Combo.
 *
 * One purchase that opens KAS PYQ Tests, KAS-50 (Daily tests) and KAS Full
 * Length Tests. It holds no tests of its own — `grantingSeriesIds` treats
 * holding it as holding each of those — so there is nothing here but the row.
 *
 * Runs on every deploy, before `set-pricing.ts`, and is safe to repeat: it
 * upserts, and never touches the price of a combo that already exists, because
 * `set-pricing.ts` owns every price. The price given on create is only so the
 * row is never briefly on sale at ₹0 between the two scripts.
 *
 *   npx tsx prisma/create-combo.ts
 */
import { PrismaClient } from '@prisma/client';

import { COMBO_SLUG } from '../src/lib/enums';

const db = new PrismaClient();

const NAME = 'KAS Complete Practice Combo';
const DESCRIPTION =
  'KAS PYQ Tests, KAS-50 (Daily tests) and KAS Full Length Tests in one purchase — every previous year paper, fifty daily papers and the full-length mocks.';

async function main() {
  const exam = await db.exam.findFirst({ select: { id: true } });
  if (!exam) {
    console.log('  --  no exam yet; combo not created');
    return;
  }

  const combo = await db.testSeries.upsert({
    where: { slug: COMBO_SLUG },
    update: {
      name: NAME,
      description: DESCRIPTION,
      track: 'COMBO',
      status: 'PUBLISHED',
      deletedAt: null,
      accessDurationDays: 0,
    },
    create: {
      slug: COMBO_SLUG,
      examId: exam.id,
      name: NAME,
      description: DESCRIPTION,
      track: 'COMBO',
      status: 'PUBLISHED',
      priceInPaise: 24900,
      // Never expires, like the three series it opens.
      accessDurationDays: 0,
      sortOrder: 5,
    },
    select: { id: true, priceInPaise: true },
  });

  console.log(`  ok  ${COMBO_SLUG} (₹${combo.priceInPaise / 100})`);
}

main()
  .catch((error) => {
    console.error('\nFailed:\n', error?.message ?? error);
    process.exitCode = 1;
  })
  .finally(async () => db.$disconnect());
