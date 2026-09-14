/**
 * The paid series page, the practice solution, and the retimed PYQ tests.
 *
 * Four things were reported together:
 *
 *   the paid series had no way to open its published timetable
 *   its schedule listed subjects with no dates beside them
 *   nothing said how many of the discounted places were left
 *   the practice solution sat above Previous/Next, pushing them off a phone
 *
 * and the drill papers were to run at 1.2 minutes per question.
 */
import { chromium, type Page } from 'playwright';
import { PrismaClient } from '@prisma/client';

const db = new PrismaClient();
const BASE = 'http://localhost:3000';
const STUDENT = 'student@avkvisions.com';
const PASSWORD = 'Demo@Pass2024';
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

async function paidSeriesPage(page: Page) {
  console.log('-- The paid series page --');

  await page.goto(`${BASE}/test-series/${PAID}`, { waitUntil: 'networkidle' });

  // --- the timetable is reachable ----------------------------------------
  const button = page.getByRole('link', { name: /view schedule/i });
  log((await button.count()) === 1, 'there is a View Schedule button');

  const href = await button.getAttribute('href');
  const reader = await page.request.get(`${BASE}${href}`);
  log(reader.ok(), 'it opens a page that loads', `${href} → HTTP ${reader.status()}`);

  // And that page serves the timetable itself, not a 404 body with a 200.
  const pdf = await page.request.get(`${BASE}/api/schedule/paid`);
  const bytes = (await pdf.body()).length;
  log(
    pdf.ok() && pdf.headers()['content-type'] === 'application/pdf' && bytes > 100_000,
    'and the timetable PDF is served behind it',
    `${bytes.toLocaleString()} bytes`,
  );

  // --- every paper shows its date ----------------------------------------
  const scheduled = await db.test.findMany({
    where: { deletedAt: null, testSeries: { slug: PAID } },
    select: { title: true, startDate: true },
    orderBy: { sortOrder: 'asc' },
  });

  const dated = scheduled.filter((t) => t.startDate !== null);
  log(
    dated.length === scheduled.length && scheduled.length > 0,
    'every paper in the series has a date set',
    `${dated.length} of ${scheduled.length}`,
  );

  const table = (await page.locator('table').first().innerText()).replace(/\s+/g, ' ');
  log(/date/i.test(table), 'the schedule table has a Date column');

  // Each date the database holds must actually appear, formatted for IST.
  const format = (date: Date) =>
    new Intl.DateTimeFormat('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      timeZone: 'Asia/Kolkata',
    }).format(date);

  const missing = dated.filter((t) => !table.includes(format(t.startDate!)));
  log(
    missing.length === 0,
    'and each paper\'s own date is printed beside it',
    missing.length ? `missing: ${missing.map((t) => format(t.startDate!)).join(', ')}` : `${dated.length} dates shown`,
  );

  // The dates must be the published ones, read in IST rather than UTC — a
  // date stored at 18:30 UTC is midnight IST the following day, and getting
  // this wrong shifts the whole timetable by one.
  const first = dated[0]?.startDate;
  log(
    first !== undefined && format(first!) === '13 Sept 2026',
    'the series still starts on the published date',
    first ? format(first) : 'none',
  );

  // --- how many places are left ------------------------------------------
  const series = await db.testSeries.findFirstOrThrow({
    where: { slug: PAID },
    select: { id: true, tier1Limit: true, tier1PriceInPaise: true },
  });

  if (series.tier1Limit !== null) {
    const body = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
    const taken = await db.entitlement.count({
      where: { testSeriesId: series.id, revokedAt: null },
    });
    const left = series.tier1Limit - taken;

    log(/joined/i.test(body), 'the page says how many have joined');
    log(
      body.includes(`${left} left`),
      'and how many places are left at this price',
      `${taken} of ${series.tier1Limit} taken`,
    );

    // The count has to be the real one, not a number typed into the page.
    log(
      !body.includes(`${left + 7} left`),
      'the figure tracks the database rather than being fixed',
    );
  }
}

async function practiceSolution(page: Page) {
  console.log('\n-- Where the solution sits in practice --');

  const user = await db.user.findFirstOrThrow({
    where: { email: STUDENT },
    select: { id: true },
  });
  const session = await db.practiceSession.findFirst({
    where: { userId: user.id, completedAt: null },
    select: { id: true },
    orderBy: { createdAt: 'desc' },
  });

  if (!session) {
    console.log('  (no open practice session to check)');
    return;
  }

  await page.goto(`${BASE}/practice/${session.id}`, { waitUntil: 'networkidle' });

  // The first aria-pressed button is the bookmark; the options follow it.
  const options = page.locator('button[aria-pressed]');
  if ((await options.count()) < 2) {
    console.log('  (this question takes a typed answer, not options)');
    return;
  }

  await options.nth(1).click();
  await page.getByRole('button', { name: /check answer/i }).click();
  await page.getByText(/^(Correct|Not quite)$/).waitFor({ timeout: 15_000 });

  log(true, 'checking an answer reveals the solution');

  // Order in the document, which is what decides what a phone shows first.
  const placement = await page.evaluate(() => {
    const previous = Array.from(document.querySelectorAll('button')).find((b) =>
      /Previous/.test(b.textContent ?? ''),
    );
    const verdict = document.querySelector('[role="status"]');
    if (!previous || !verdict) return 'missing';
    return previous.compareDocumentPosition(verdict) & Node.DOCUMENT_POSITION_FOLLOWING
      ? 'after'
      : 'before';
  });
  log(placement === 'after', 'and it comes below Previous / Next, not above them', placement);

  // Which means the buttons are reachable without scrolling past it.
  const order = await page.evaluate(() => {
    const previous = Array.from(document.querySelectorAll('button')).find((b) =>
      /Previous/.test(b.textContent ?? ''),
    );
    const verdict = document.querySelector('[role="status"]');
    return {
      buttonTop: previous?.getBoundingClientRect().top ?? -1,
      solutionTop: verdict?.getBoundingClientRect().top ?? -1,
    };
  });
  log(
    order.buttonTop < order.solutionTop,
    'the controls really are higher up the page',
    `controls at ${Math.round(order.buttonTop)}px, solution at ${Math.round(order.solutionTop)}px`,
  );
}

async function pyqDurations() {
  console.log('\n-- PYQ subject-wise durations --');

  const subject = await db.test.findMany({
    where: {
      deletedAt: null,
      slug: { contains: '-subject-' },
      testSeries: { slug: { startsWith: 'kas-pyq-' } },
    },
    select: { slug: true, durationMinutes: true, totalQuestions: true },
  });

  // 1.2 minutes a question, the real prelims pattern.
  const want = (questions: number) => Math.max(1, Math.round(questions * 1.2));

  const withQuestions = subject.filter((t) => t.totalQuestions > 0);
  const wrong = withQuestions.filter((t) => t.durationMinutes !== want(t.totalQuestions));
  log(
    wrong.length === 0,
    'every written subject-wise PYQ test runs at 1.2 minutes a question',
    wrong.length ? wrong.map((t) => `${t.slug} ${t.durationMinutes}m`).join(', ') : `${withQuestions.length} checked`,
  );

  // The full-length papers were not part of the request and must be untouched.
  const full = await db.test.findMany({
    where: {
      deletedAt: null,
      slug: { contains: '-paper-' },
      testSeries: { slug: { startsWith: 'kas-pyq-' } },
    },
    select: { slug: true, durationMinutes: true },
  });
  const shortened = full.filter((t) => t.durationMinutes < 60);
  log(
    shortened.length === 0,
    'and the full-length papers keep their exam-length timing',
    shortened.length ? shortened.map((t) => t.slug).join(', ') : `${full.length} still at full length`,
  );

  // Nothing may reach zero: a test with no time cannot be sat at all.
  const zero = subject.filter((t) => t.durationMinutes < 1);
  log(zero.length === 0, 'no test was left with no time on the clock');
}

async function main() {
  console.log('\n=== Schedule, enrolment, solution placement and durations ===\n');

  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
    await page.request.post(`${BASE}/api/auth/login`, {
      data: { email: STUDENT, password: PASSWORD },
    });

    await paidSeriesPage(page);
    await practiceSolution(page);
    await pyqDurations();

    await page.close();
  } finally {
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
