/**
 * What the fifty-day table offers once a student has sat a paper.
 *
 * Two faults, both on the Day 1 row after one attempt:
 *
 *   the Result button linked to `/test/<testId>/result`, but that page
 *     resolves an ATTEMPT id — so it 404'd every time
 *   "Take Test" disappeared for good once any attempt existed, even though
 *     these papers are set to unlimited attempts, so a paper a student was
 *     entitled to retake could never be retaken from this page
 */
import { chromium, type Page } from 'playwright';
import { PrismaClient } from '@prisma/client';

const db = new PrismaClient();
const BASE = 'http://localhost:3000';
const STUDENT = 'student@avkvisions.com';
const PASSWORD = 'Demo@Pass2024';

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

/** The Day 1 row, which is where this was reported. */
function dayOneRow(page: Page) {
  return page.locator('tr', { hasText: 'Day 1 —' }).first();
}

async function main() {
  console.log('\n=== The fifty-day table, after an attempt ===\n');

  const user = await db.user.findFirstOrThrow({
    where: { email: STUDENT },
    select: { id: true },
  });
  const paper = await db.test.findFirstOrThrow({
    where: { slug: 'kas-50-days-01' },
    select: { id: true, slug: true, startDate: true, status: true, totalQuestions: true, maxAttempts: true },
  });

  const was = { ...paper };
  const madeAttempts: string[] = [];
  const madeRows: string[] = [];
  let entitlementId: string | null = null;

  const browser = await chromium.launch();
  try {
    // --- reproduce production: open, published, with questions -------------
    const questions = await db.question.findMany({
      where: { deletedAt: null, options: { some: {} } },
      take: 5,
      select: { id: true, marks: true },
    });

    await db.testQuestion.deleteMany({ where: { testId: paper.id } });
    for (const [index, q] of questions.entries()) {
      const row = await db.testQuestion.create({
        data: { testId: paper.id, questionId: q.id, sortOrder: index + 1, marks: q.marks },
      });
      madeRows.push(row.id);
    }

    await db.test.update({
      where: { id: paper.id },
      data: {
        startDate: new Date(Date.now() - 24 * 60 * 60 * 1000),
        status: 'PUBLISHED',
        totalQuestions: questions.length,
        maxAttempts: 0, // unlimited, which is how these ship
      },
    });

    // The series is paid, so the student needs access to see the actions.
    const series = await db.testSeries.findFirstOrThrow({
      where: { slug: { contains: '50-questions-50-days' } },
      select: { id: true },
    });
    const existing = await db.entitlement.findFirst({
      where: { userId: user.id, testSeriesId: series.id, revokedAt: null },
      select: { id: true },
    });
    if (!existing) {
      const granted = await db.entitlement.create({
        data: {
          userId: user.id,
          testSeriesId: series.id,
          sourceType: 'ADMIN_GRANT',
          startsAt: new Date(Date.now() - 60_000),
        },
        select: { id: true },
      });
      entitlementId = granted.id;
    }

    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });

    // Signed in from inside the page. `page.request` keeps its own cookie jar,
    // so a session established there does not reach fetches the page makes.
    await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
    const signedIn = await page.evaluate(
      async ([email, password]) => {
        const response = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({ email, password }),
        });
        return (await response.json()).success === true;
      },
      [STUDENT, PASSWORD],
    );
    if (!signedIn) throw new Error('Could not sign in as the student.');

    // --- before any attempt -------------------------------------------------
    console.log('-- Before the student has sat it --');

    await db.testAttempt.deleteMany({ where: { userId: user.id, testId: paper.id } });
    await page.goto(`${BASE}/50-days`, { waitUntil: 'networkidle' });

    const fresh = dayOneRow(page);
    log((await fresh.getByRole('link', { name: /take test/i }).count()) === 1, 'Take Test is offered');
    log((await fresh.getByRole('link', { name: /^result$/i }).count()) === 0, 'and no Result link yet');

    // --- after one finished attempt ----------------------------------------
    console.log('\n-- After one finished attempt --');

    // Started and submitted through the real endpoints. The attempt carries a
    // question snapshot the engine builds at start, so a hand-written row
    // would not be one the result page could actually render.
    // Issued from inside the page so the session cookie travels with them.
    const attemptId = await page.evaluate(async (testId) => {
      const start = await fetch('/api/attempts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ testId }),
      });
      const payload = await start.json();
      if (!payload.success) throw new Error(`start failed: ${JSON.stringify(payload.error)}`);
      const id = payload.data.attemptId as string;

      const done = await fetch(`/api/attempts/${id}/submit`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({}),
      });
      const after = await done.json();
      if (!after.success) throw new Error(`submit failed: ${JSON.stringify(after.error)}`);
      return id;
    }, paper.id);

    const attempt = { id: attemptId };
    madeAttempts.push(attempt.id);

    await page.reload({ waitUntil: 'networkidle' });
    const sat = dayOneRow(page);

    // The whole point: unlimited attempts must keep the paper sittable.
    const retake = sat.getByRole('link', { name: /retake|take test/i });
    log(
      (await retake.count()) === 1,
      'the paper can still be sat, because attempts are unlimited',
      await retake.first().innerText().catch(() => ''),
    );

    const result = sat.getByRole('link', { name: /^result$/i });
    log((await result.count()) === 1, 'and the result is reachable too');

    // --- the result link actually resolves ----------------------------------
    console.log('\n-- The Result link --');

    const href = await result.first().getAttribute('href');
    log(
      href === `/test/${attempt.id}/result`,
      'points at the attempt, not the paper',
      href ?? 'none',
    );

    const response = await page.request.get(`${BASE}${href}`);
    log(response.status() !== 404, 'and does not 404', `HTTP ${response.status()}`);

    // Following it must actually land on the result. Checked by navigating
    // rather than clicking: a click that silently fails leaves the browser on
    // this page, and "no 404 text here" would then pass without the result
    // page ever having been opened.
    await page.goto(`${BASE}${href}`, { waitUntil: 'networkidle' });

    log(
      page.url().includes(`/test/${attempt.id}/result`),
      'the browser lands on the result page',
      page.url().replace(BASE, ''),
    );

    const body = await page.locator('body').innerText();
    log(
      !/this page isn.t here|404|not found/i.test(body),
      'and it is a result, not the error page',
    );

    // Something from the attempt itself, so an empty shell cannot pass.
    log(
      /score|marks|result|attempt/i.test(body),
      'showing the attempt it belongs to',
    );

    await page.goBack({ waitUntil: 'networkidle' });

    // --- a capped paper stops offering it -----------------------------------
    console.log('\n-- When attempts are capped --');

    await db.test.update({ where: { id: paper.id }, data: { maxAttempts: 1 } });
    await page.goto(`${BASE}/50-days`, { waitUntil: 'networkidle' });
    const capped = dayOneRow(page);

    log(
      (await capped.getByRole('link', { name: /retake|take test/i }).count()) === 0,
      'the paper is no longer offered once the allowance is used',
      'maxAttempts 1, one attempt taken',
    );
    log(
      (await capped.getByRole('link', { name: /^result$/i }).count()) === 1,
      'but the result stays reachable',
    );

    await page.close();
  } finally {
    // Put everything back exactly as it was.
    await db.testAttempt.deleteMany({ where: { id: { in: madeAttempts } } });
    await db.testQuestion.deleteMany({ where: { id: { in: madeRows } } });
    if (entitlementId) await db.entitlement.delete({ where: { id: entitlementId } });
    await db.test.update({
      where: { id: paper.id },
      data: {
        startDate: was.startDate,
        status: was.status,
        totalQuestions: was.totalQuestions,
        maxAttempts: was.maxAttempts,
      },
    });
    const now = await db.test.findFirstOrThrow({
      where: { id: paper.id },
      select: { status: true, totalQuestions: true, maxAttempts: true },
    });
    console.log(
      `\n  restored ${paper.slug}: ${now.status}, ${now.totalQuestions} questions, maxAttempts ${now.maxAttempts}`,
    );
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
