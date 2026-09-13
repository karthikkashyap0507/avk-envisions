/**
 * Counting buyers who paid outside the site.
 *
 * Payment by UPI or bank transfer leaves no entitlement row, so the enrolled
 * count read from the database alone understates how many people have bought.
 * The paid series showed 8 while 37 had paid.
 *
 * The correction is added wherever enrolment is counted, so one number decides
 * all three things that have to agree: how many places the page says are left,
 * which tier the ladder is on, and what checkout actually charges. If they
 * disagreed, a buyer could be shown ₹99 and charged ₹299.
 *
 * The page shows a single total. There is no separate "offline" figure in the
 * UI — a buyer is a buyer however they paid.
 */
import { chromium } from 'playwright';
import { PrismaClient } from '@prisma/client';

import { resolvePricing } from '../src/server/services/pricing-service';

const db = new PrismaClient();
const BASE = 'http://localhost:3000';
const PAID = 'kas-prelims-paid-test-series';

let passed = 0;
let failed = 0;

function log(ok: boolean, label: string, detail = '') {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
  if (ok) passed += 1;
  else {
    failed += 1;
    process.exitCode = 1;
  }
}

async function main() {
  console.log('\n=== Buyers who paid outside the site ===\n');

  const series = await db.testSeries.findFirstOrThrow({
    where: { slug: PAID, deletedAt: null },
    select: {
      id: true,
      offlineEnrolments: true,
      priceInPaise: true,
      tier1PriceInPaise: true,
      tier1Limit: true,
      tier2PriceInPaise: true,
      tier2Limit: true,
    },
  });
  const wasOffline = series.offlineEnrolments;

  const now = new Date();
  const tracked = await db.entitlement.count({
    where: {
      testSeriesId: series.id,
      revokedAt: null,
      startsAt: { lte: now },
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    },
  });
  console.log(`  paid through the site: ${tracked}\n`);

  const browser = await chromium.launch();
  try {
    // --- the count is the sum ----------------------------------------------
    console.log('-- The two halves add up --');

    const offline = 29;
    await db.testSeries.update({
      where: { id: series.id },
      data: { offlineEnrolments: offline },
    });

    const { countEnrolled, countEnrolledMany } = await import(
      '../src/server/services/pricing-service'
    );

    const single = await countEnrolled(series.id);
    log(single === tracked + offline, 'countEnrolled adds them', `${tracked} + ${offline} = ${single}`);

    const many = (await countEnrolledMany([series.id])).get(series.id) ?? 0;
    log(many === single, 'and countEnrolledMany agrees with it', `${many} vs ${single}`);

    // They must never disagree: one prices the page, the other prices
    // checkout, and a mismatch charges a buyer more than they were shown.
    log(
      resolvePricing(series, single).priceInPaise === resolvePricing(series, many).priceInPaise,
      'so the page and checkout quote the same price',
      `₹${resolvePricing(series, single).priceInPaise / 100}`,
    );

    // --- what the page says -------------------------------------------------
    console.log('\n-- What a visitor reads --');

    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.goto(`${BASE}/test-series/${PAID}`, { waitUntil: 'networkidle' });

    const body = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
    const total = tracked + offline;

    log(body.includes(`${total} people have joined`), 'the page shows the combined total', `${total}`);

    if (series.tier1Limit !== null) {
      const left = Math.max(0, series.tier1Limit - total);
      log(body.includes(`${left} left`), 'and the places left follow from it', `${left} left`);
    }

    // One figure, not two. Nothing on the page distinguishes how anyone paid.
    log(
      !/offline/i.test(body) && !body.includes(`${tracked} people have joined`),
      'with no separate offline figure shown',
    );

    // --- the tier still closes at the right moment --------------------------
    console.log('\n-- The price ladder still holds --');

    if (series.tier1Limit !== null) {
      const price = resolvePricing(series, total);
      const expected =
        total >= series.tier1Limit ? series.priceInPaise : series.tier1PriceInPaise!;
      log(
        price.priceInPaise === expected,
        'the early price applies while places remain',
        `₹${price.priceInPaise / 100} at ${total} of ${series.tier1Limit}`,
      );

      // Past the cap the early tier must close, or the page advertises a price
      // checkout will not honour.
      const overCap = resolvePricing(series, series.tier1Limit + 1);
      log(
        overCap.priceInPaise !== series.tier1PriceInPaise,
        'and closes once the cap is passed',
        `₹${overCap.priceInPaise / 100} beyond ${series.tier1Limit}`,
      );
    }

    // --- zero means nothing is added ---------------------------------------
    console.log('\n-- Set back to zero --');

    await db.testSeries.update({ where: { id: series.id }, data: { offlineEnrolments: 0 } });
    const bare = await countEnrolled(series.id);
    log(bare === tracked, 'the count returns to the tracked buyers alone', `${bare}`);

    await page.close();
  } finally {
    await db.testSeries.update({
      where: { id: series.id },
      data: { offlineEnrolments: wasOffline },
    });
    console.log(`\n  restored offlineEnrolments to ${wasOffline}`);
    await browser.close();
  }

  console.log(`\n  ${passed} passed, ${failed} failed\n`);
}

main()
  .catch((error) => {
    console.error('\nFailed:\n', error);
    process.exitCode = 1;
  })
  .finally(async () => db.$disconnect());
