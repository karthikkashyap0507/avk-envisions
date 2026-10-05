/**
 * Four changes, end to end in a real browser:
 *
 *   1. Student menu: "Practice" is called "Quiz", and the old quizzes page is
 *      hidden (its address leads to the Quiz).
 *   2. Admin dashboard: a recent attempt opens that student's page, listing
 *      every test they have attempted.
 *   3. Admin question editor: saving an edit stays on the page, and Back
 *      returns to the list it came from (the questions with a review note).
 *   4. AVK AI Coach: on, and answering from the student's own results.
 *
 * Needs the site running - BASE_URL, default http://localhost:3000:
 *
 *   BASE_URL=http://localhost:3217 npx tsx scripts/e2e-dashboard-changes.mts
 */
import { chromium, type Browser } from 'playwright';
import { PrismaClient } from '@prisma/client';

const db = new PrismaClient();
const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const ADMIN = 'e2e-dash-admin@avkvisions.test';
const STUDENT = 'e2e-dash-student@avkvisions.test';
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

async function makeUser(email: string, role: 'ADMIN' | 'STUDENT', name: string) {
  const donor = await db.user.findFirstOrThrow({ where: { email: 'student@avkvisions.com' }, select: { passwordHash: true } });
  for (const old of await db.user.findMany({ where: { email }, select: { id: true } })) {
    await db.testAttempt.deleteMany({ where: { userId: old.id } });
    await db.user.delete({ where: { id: old.id } });
  }
  return db.user.create({
    data: { email, emailNormal: email, name, role, passwordHash: donor.passwordHash, emailVerified: new Date(), status: 'ACTIVE' },
  });
}

async function signIn(browser: Browser, email: string) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const response = await context.request.post(`${BASE}/api/auth/login`, { data: { email, password: PASSWORD } });
  if (!response.ok()) throw new Error(`sign-in failed for ${email}: ${response.status()}`);
  return context;
}

async function main() {
  console.log(`\n=== Dashboard changes — ${BASE} ===\n`);
  await makeUser(ADMIN, 'ADMIN', 'Dashboard Admin');
  const student = await makeUser(STUDENT, 'STUDENT', 'Dashboard E2E Student');

  // A question with a review note to edit, put back afterwards.
  let flagged = await db.question.findFirst({ where: { deletedAt: null, reviewNote: { not: null } }, select: { id: true } });
  let addedNote: string | null = null;
  if (!flagged) {
    const any = await db.question.findFirstOrThrow({ where: { deletedAt: null }, select: { id: true } });
    await db.question.update({ where: { id: any.id }, data: { reviewNote: 'e2e review note' } });
    flagged = any;
    addedNote = any.id;
  }

  const browser = await chromium.launch();
  try {
    const learner = await signIn(browser, STUDENT);
    const page = await learner.newPage();

    // The student sits one free test, so the dashboard has an attempt to show.
    const test = await db.test.findFirstOrThrow({
      where: { deletedAt: null, status: 'PUBLISHED', totalQuestions: { gt: 0 }, testSeries: { priceInPaise: 0 } },
      select: { id: true, title: true },
      orderBy: { title: 'asc' },
    });
    const started = await learner.request.post(`${BASE}/api/attempts`, { data: { testId: test.id } });
    const attemptId = ((await started.json()) as { data?: { attemptId?: string } }).data?.attemptId;
    if (!attemptId) throw new Error(`could not start an attempt: ${started.status()}`);
    await learner.request.post(`${BASE}/api/attempts/${attemptId}/submit`, { data: { reason: 'MANUAL' } });

    // --- 1. Quiz ------------------------------------------------------------------------
    console.log('-- Practice is now Quiz --');
    await page.goto(`${BASE}/dashboard`, { waitUntil: 'domcontentloaded' });
    const nav = page.getByRole('navigation', { name: 'Student' }).first();
    await nav.waitFor({ timeout: 120_000 });
    const quizLink = nav.getByRole('link', { name: 'Quiz', exact: true });
    log((await quizLink.count()) > 0 && (await quizLink.first().getAttribute('href')) === '/practice', 'the student menu has "Quiz", opening the practice drill');
    log((await nav.getByRole('link', { name: 'Practice', exact: true }).count()) === 0, 'and no "Practice" any more');
    log((await nav.getByRole('link', { name: 'Quizzes', exact: true }).count()) === 0, 'and the old "Quizzes" page is gone from it');

    await page.goto(`${BASE}/quiz`, { waitUntil: 'domcontentloaded' });
    await page.waitForURL(/\/practice$/, { timeout: 60_000 });
    log(new URL(page.url()).pathname === '/practice', 'the old quizzes address leads to the Quiz');
    log((await page.locator('h1').first().innerText()).trim() === 'Quiz', 'whose heading reads "Quiz"');

    // The site's section links live in the menu panel.
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: 'Open menu' }).click();
    const headerQuiz = page.getByRole('link', { name: 'Quiz', exact: true }).first();
    await headerQuiz.waitFor({ timeout: 30_000 });
    log((await headerQuiz.getAttribute('href')) === '/practice', 'the site menu\'s "Quiz" opens it too');

    // --- 4. The coach --------------------------------------------------------------------
    console.log('\n-- AVK AI Coach --');
    // networkidle: typed before the page is interactive, a question goes nowhere.
    await page.goto(`${BASE}/ai-coach`, { waitUntil: 'networkidle' });
    await page.locator('#coach-question').waitFor({ timeout: 120_000 });
    const coachPage = await page.locator('main, body').first().innerText();
    log(!/not switched on/i.test(coachPage), 'the coach is on - no "not switched on" notice');
    log(/Unlimited this month/.test(coachPage), 'with no monthly limit');

    await page.locator('#coach-question').fill('What should I focus on this week?');
    await page.keyboard.press('Enter');
    const weekAnswer = page.locator('p.whitespace-pre-line').nth(1);
    await weekAnswer.waitFor({ timeout: 60_000 });
    const week = await weekAnswer.innerText();
    log(/full-length test/.test(week) && /Every day/.test(week), 'it answers "this week" with a plan', week.split('\n')[0]);

    await page.locator('#coach-question').fill('How do I answer faster?');
    await page.keyboard.press('Enter');
    const speedAnswer = page.locator('p.whitespace-pre-line').nth(3);
    await speedAnswer.waitFor({ timeout: 60_000 });
    log(/seconds a question/.test(await speedAnswer.innerText()), 'and speed, from the student\'s own pace');

    // --- 2. Recent attempts ---------------------------------------------------------------
    console.log('\n-- Recent attempts open the student --');
    const admin = await signIn(browser, ADMIN);
    const adminPage = await admin.newPage();
    await adminPage.goto(`${BASE}/admin`, { waitUntil: 'domcontentloaded' });
    const attemptLink = adminPage.locator(`a[href="/admin/users/${student.id}"]`).first();
    await attemptLink.waitFor({ timeout: 120_000 });
    log(await attemptLink.isVisible(), 'the student\'s new attempt in Recent attempts is a link');
    await attemptLink.click();
    await adminPage.waitForURL(new RegExp(`/admin/users/${student.id}$`), { timeout: 60_000 });
    await adminPage.locator('h1').first().waitFor();
    log((await adminPage.locator('h1').first().innerText()).includes('Dashboard E2E Student'), 'it opens that student');
    const row = adminPage.locator('tbody tr', { hasText: test.title });
    log((await row.count()) === 1, 'with every test attempted, by name', test.title);
    log(/Submitted|Time up/.test(await row.first().innerText()), 'and how each went');

    await adminPage.goto(`${BASE}/admin/users?q=${encodeURIComponent(STUDENT)}`, { waitUntil: 'domcontentloaded' });
    const fromList = adminPage.locator(`a[href="/admin/users/${student.id}"]`, { hasText: 'Dashboard E2E Student' });
    log((await fromList.count()) === 1, 'the users list opens the same page from a name');

    // --- 3. Editing a flagged question stays put --------------------------------------------
    console.log('\n-- Saving a question with a review note --');
    await adminPage.goto(`${BASE}/admin/questions?flagged=1`, { waitUntil: 'domcontentloaded' });
    const first = adminPage.locator('a[href^="/admin/questions/c"]').first();
    await first.waitFor({ timeout: 120_000 });
    const href = (await first.getAttribute('href')) ?? '';
    log(href.includes('back=%2Fadmin%2Fquestions%3Fflagged%3D1'), 'a flagged question opens with the list it came from', href);
    await first.click();
    await adminPage.getByRole('button', { name: 'Save changes' }).first().waitFor({ timeout: 120_000 });
    // Clicked before the editor is interactive, Save does nothing yet.
    await adminPage.waitForLoadState('networkidle');
    const editorUrl = adminPage.url();
    const saved = adminPage.waitForResponse(
      (r) => r.request().method() === 'PUT' && r.url().includes('/api/admin/questions/'),
      { timeout: 60_000 },
    );
    await adminPage.getByRole('button', { name: 'Save changes' }).first().click();
    log((await saved).status() === 200, 'saving the question works');
    await adminPage.waitForTimeout(2500);
    log(adminPage.url() === editorUrl, 'saving changes stays on the question, not the question bank');
    const back = adminPage.getByRole('link', { name: 'Back to the list' });
    log((await back.getAttribute('href')) === '/admin/questions?flagged=1', 'and Back returns to the review-note list');
  } finally {
    await browser.close();
    if (addedNote) await db.question.update({ where: { id: addedNote }, data: { reviewNote: null } });
    await db.testAttempt.deleteMany({ where: { userId: student.id } });
    await db.user.deleteMany({ where: { email: { in: [ADMIN, STUDENT] } } });
    await db.$disconnect();
  }

  console.log(`\n${passed} passed, ${failed} failed\n`);
}

main().catch(async (error) => {
  console.error(error);
  process.exitCode = 1;
  await db.$disconnect();
});
