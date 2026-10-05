/**
 * Analysis PDFs in Kannada, end to end, in a real browser.
 *
 * What a student and an admin should find:
 *
 *   - every analysis page whose Kannada copy is made has an English | ಕನ್ನಡ
 *     switch; ಕನ್ನಡ shows the same PDF with Kannada in it, view-only as before
 *   - the choice sticks: in the address, and remembered for next time
 *   - no "being prepared" anywhere: a document without its copy simply has no
 *     switch, and the Kannada address answers 404
 *   - the Kannada copy is behind exactly the same doors as the English
 *   - an admin's upload makes its Kannada copy by itself, and removing the
 *     English removes the Kannada
 *   - the admin list shows each copy's state; Print / PDF prints in Kannada
 *   - a result page read in Kannada links to the Kannada analysis
 *
 * Needs the site running with its translation worker (and the PDF tool's
 * Python) - BASE_URL, default http://localhost:3000:
 *
 *   BASE_URL=http://localhost:3217 npx tsx scripts/e2e-kannada-analysis.mts
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { PrismaClient } from '@prisma/client';
import { extractText, getDocumentProxy } from 'unpdf';

const db = new PrismaClient();
const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const ADMIN = 'e2e-kn-admin@avkvisions.test';
const STUDENT = 'e2e-kn-student@avkvisions.test';
const PASSWORD = 'Demo@Pass2024';
const KANNADA = /[ಀ-೿]/;

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

function synopsisDir(): string {
  const url = process.env.DATABASE_URL ?? 'file:./dev.db';
  return url.startsWith('file:') ? path.join(path.dirname(url.slice('file:'.length)), 'synopses') : path.resolve('storage/synopses');
}

async function makeUser(email: string, role: 'ADMIN' | 'STUDENT') {
  const donor = await db.user.findFirstOrThrow({ where: { email: 'student@avkvisions.com' }, select: { passwordHash: true } });
  const old = await db.user.findMany({ where: { email }, select: { id: true } });
  for (const user of old) {
    await db.testAttempt.deleteMany({ where: { userId: user.id } });
    await db.user.delete({ where: { id: user.id } });
  }
  return db.user.create({
    data: {
      email,
      emailNormal: email,
      name: role === 'ADMIN' ? 'Kannada Admin' : 'Kannada Student',
      role,
      passwordHash: donor.passwordHash,
      emailVerified: new Date(),
      status: 'ACTIVE',
    },
  });
}

async function signIn(browser: Browser, email: string, viewport = { width: 1200, height: 900 }) {
  const context = await browser.newContext({ viewport });
  const response = await context.request.post(`${BASE}/api/auth/login`, { data: { email, password: PASSWORD } });
  if (!response.ok()) throw new Error(`sign-in failed for ${email}: ${response.status()}`);
  return context;
}

async function pdfText(bytes: Buffer): Promise<string> {
  const { text } = await extractText(await getDocumentProxy(new Uint8Array(bytes)), { mergePages: true });
  return String(text);
}

/** The Kannada copy's state as the admin list sees it. */
async function copyState(admin: BrowserContext, kind: 'test' | 'series', id: string) {
  const response = await admin.request.get(`${BASE}/api/admin/synopsis/kannada?kind=${kind}&id=${id}`);
  return ((await response.json()) as { data: { state: string; preview?: string; done?: number; total?: number } }).data;
}

async function waitForCopy(admin: BrowserContext, kind: 'test' | 'series', id: string, minutes: number) {
  const until = Date.now() + minutes * 60_000;
  let state = await copyState(admin, kind, id);
  while (state.state !== 'ready' && Date.now() < until) {
    await new Promise((resolve) => setTimeout(resolve, 5_000));
    state = await copyState(admin, kind, id);
  }
  return state;
}

async function openAnalysis(page: Page, testId: string, query = '') {
  const kannadaPdf = page.waitForResponse((r) => r.url().includes(`/api/synopsis/test/${testId}`), { timeout: 120_000 });
  await page.goto(`${BASE}/synopsis/test/${testId}${query}`, { waitUntil: 'domcontentloaded' });
  return kannadaPdf;
}

async function main() {
  console.log(`\n=== Analysis PDFs in Kannada — ${BASE} ===\n`);
  await makeUser(ADMIN, 'ADMIN');
  const student = await makeUser(STUDENT, 'STUDENT');

  const browser = await chromium.launch();
  const admin = await signIn(browser, ADMIN);
  const learner = await signIn(browser, STUDENT);
  const page = await learner.newPage();

  // A free paper with its own analysis, whose Kannada copy is made.
  const candidates = await db.test.findMany({
    where: { deletedAt: null, status: 'PUBLISHED', synopsisFileName: { not: null }, totalQuestions: { gt: 0 }, testSeries: { priceInPaise: 0 } },
    select: { id: true, title: true, slug: true, synopsisFileName: true, testSeriesId: true },
    orderBy: { title: 'asc' },
  });
  // ...preferably in a series with another paper to upload an analysis to
  // whose slug names no file yet: the upload test must never overwrite a
  // real analysis (an upload is stored under the paper's slug).
  const safeSibling = async (c: (typeof candidates)[number]) => {
    const siblings = await db.test.findMany({
      where: { deletedAt: null, status: 'PUBLISHED', testSeriesId: c.testSeriesId, id: { not: c.id }, totalQuestions: { gt: 0 } },
      select: { slug: true },
    });
    return siblings.some((t) => !existsSync(path.join(synopsisDir(), `${t.slug}.pdf`)));
  };
  let paper: (typeof candidates)[number] | undefined;
  let fallback: (typeof candidates)[number] | undefined;
  for (const candidate of candidates) {
    if ((await copyState(admin, 'test', candidate.id)).state !== 'ready') continue;
    fallback ??= candidate;
    if (await safeSibling(candidate)) {
      paper = candidate;
      break;
    }
  }
  paper ??= fallback;
  if (!paper) throw new Error('No free paper has its Kannada analysis made yet - let the worker finish first.');
  console.log(`  paper: ${paper.title} (${paper.synopsisFileName})\n`);

  try {
    // --- Before the paper is sat ------------------------------------------------
    console.log('-- The same doors as the English --');
    const anonymous = await browser.newContext();
    const signedOut = await anonymous.request.get(`${BASE}/api/synopsis/test/${paper.id}?lang=kn`);
    log(signedOut.status() === 401, 'a signed-out visitor is refused the Kannada copy', `HTTP ${signedOut.status()}`);
    await anonymous.close();

    const early = await learner.request.get(`${BASE}/api/synopsis/test/${paper.id}?lang=kn`);
    log(early.status() === 403, 'a student who has not sat the paper is refused it too', `HTTP ${early.status()}`);
    await page.goto(`${BASE}/synopsis/test/${paper.id}`, { waitUntil: 'domcontentloaded' });
    log((await page.getByTestId('analysis-language').count()) === 0, 'and is shown no language switch, only "attempt first"');

    // --- Sit the paper -------------------------------------------------------------
    const start = await learner.request.post(`${BASE}/api/attempts`, { data: { testId: paper.id } });
    const attemptId = ((await start.json()) as { data?: { attemptId?: string } }).data?.attemptId;
    if (!attemptId) throw new Error(`could not start an attempt: ${start.status()}`);
    await learner.request.post(`${BASE}/api/attempts/${attemptId}/submit`, { data: { reason: 'MANUAL' } });

    // --- The switch --------------------------------------------------------------------
    console.log('\n-- English | ಕನ್ನಡ --');
    const englishLoad = await openAnalysis(page, paper.id);
    const englishResponse = await englishLoad;
    log(englishResponse.url().endsWith(`/api/synopsis/test/${paper.id}`), 'the analysis opens in English first');
    const toggle = page.getByTestId('analysis-language');
    await toggle.waitFor({ timeout: 30_000 });
    log(await toggle.isVisible(), 'with an English | ಕನ್ನಡ switch above it');
    log(
      (await toggle.getByRole('button', { name: 'English' }).getAttribute('aria-pressed')) === 'true',
      'English is the one selected',
    );

    const kannadaLoad = page.waitForResponse((r) => r.url().endsWith(`/api/synopsis/test/${paper!.id}?lang=kn`), { timeout: 120_000 });
    await toggle.getByRole('button', { name: 'ಕನ್ನಡ' }).click();
    const kannadaResponse = await kannadaLoad;
    log(kannadaResponse.status() === 200, 'choosing ಕನ್ನಡ loads the Kannada copy', `HTTP ${kannadaResponse.status()}`);
    log((kannadaResponse.headers()['content-type'] ?? '').includes('application/pdf'), 'which is a PDF');
    log(
      (kannadaResponse.headers()['content-disposition'] ?? '').startsWith('inline'),
      'served inline, view-only like the English',
    );
    await page.locator('canvas').first().waitFor({ timeout: 120_000 });
    const pages = await page.locator('canvas').count();
    log(pages > 0, 'its pages are drawn in the viewer', `${pages} page(s)`);
    log(new URL(page.url()).searchParams.get('lang') === 'kn', 'the address says ?lang=kn');
    const heading = (await page.locator('h1').first().innerText()).trim();
    log(heading.includes('ವಿಶ್ಲೇಷಣೆ'), 'the page heading is in Kannada', heading);
    log(KANNADA.test(await page.getByRole('link', { name: /ಹಿಂತಿರುಗಿ/ }).innerText()), 'so is the back link');

    // The document itself.
    const kannadaBytes = Buffer.from(await (await learner.request.get(`${BASE}/api/synopsis/test/${paper.id}?lang=kn`)).body());
    const englishBytes = Buffer.from(await (await learner.request.get(`${BASE}/api/synopsis/test/${paper.id}`)).body());
    const [kannadaText, englishText] = await Promise.all([pdfText(kannadaBytes), pdfText(englishBytes)]);
    const kannadaChars = (kannadaText.match(/[ಀ-೿]/g) ?? []).length;
    log(kannadaBytes.subarray(0, 5).toString('latin1') === '%PDF-', 'the Kannada copy is a real PDF');
    log(kannadaChars > 2000, 'full of Kannada', `${kannadaChars} Kannada characters`);
    const englishPages = (await getDocumentProxy(new Uint8Array(englishBytes))).numPages;
    const kannadaPages = (await getDocumentProxy(new Uint8Array(kannadaBytes))).numPages;
    log(englishPages === kannadaPages, 'with the same pages as the English', `${kannadaPages} pages`);
    const englishLabels = (englishText.match(/\b(?:ANSWER|EXPLANATION|ABOUT THE QUESTION|HOW TO SOLVE)\b/g) ?? []).length;
    const leftLabels = (kannadaText.match(/\b(?:ANSWER|EXPLANATION|ABOUT THE QUESTION|HOW TO SOLVE)\b/g) ?? []).length;
    log(englishLabels > 0 && leftLabels === 0, 'and none of the English box headings left in it', `${englishLabels} in English, ${leftLabels} in Kannada`);
    log(!KANNADA.test(englishText), 'while the English one stays English');

    // --- It sticks ------------------------------------------------------------------------
    console.log('\n-- The choice sticks --');
    const reload = page.waitForResponse((r) => r.url().endsWith(`?lang=kn`), { timeout: 120_000 });
    await page.reload({ waitUntil: 'domcontentloaded' });
    log((await reload).status() === 200, 'a reload stays in Kannada');
    const remembered = page.waitForResponse((r) => r.url().endsWith(`/api/synopsis/test/${paper!.id}?lang=kn`), { timeout: 120_000 });
    await page.goto(`${BASE}/synopsis/test/${paper.id}`, { waitUntil: 'domcontentloaded' });
    log((await remembered).status() === 200, 'and opening it again later, with no ?lang, remembers ಕನ್ನಡ');
    const backToEnglish = page.waitForResponse((r) => r.url().endsWith(`/api/synopsis/test/${paper!.id}`), { timeout: 120_000 });
    await page.getByTestId('analysis-language').getByRole('button', { name: 'English' }).click();
    log((await backToEnglish).status() === 200, 'English is one tap back');
    log(!new URL(page.url()).searchParams.has('lang'), 'and the address drops ?lang');

    // --- The result page ----------------------------------------------------------------
    console.log('\n-- From a result read in Kannada --');
    await page.goto(`${BASE}/test/${attemptId}/result?lang=kn`, { waitUntil: 'domcontentloaded' });
    const analysisLink = page.locator(`a[href^="/synopsis/test/${paper.id}"]`).first();
    log((await analysisLink.getAttribute('href')) === `/synopsis/test/${paper.id}?lang=kn`, 'the analysis link opens the Kannada copy');

    // --- On a phone ----------------------------------------------------------------------
    console.log('\n-- On a phone --');
    const phone = await signIn(browser, STUDENT, { width: 390, height: 844 });
    const phonePage = await phone.newPage();
    await openAnalysis(phonePage, paper.id, '?lang=kn');
    await phonePage.locator('canvas').first().waitFor({ timeout: 120_000 });
    const overflow = await phonePage.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    log(await phonePage.getByTestId('analysis-language').isVisible(), 'the switch is there at phone width');
    log(overflow <= 1, 'and nothing runs off the side', `${overflow}px`);
    await phone.close();

    // --- A new upload ----------------------------------------------------------------------
    console.log('\n-- An admin uploads an analysis --');
    // An upload is stored under the paper's slug, so only a paper whose slug
    // names no file yet: the test must never write over a real analysis.
    const others = await db.test.findMany({
      where: { deletedAt: null, status: 'PUBLISHED', id: { not: paper.id }, totalQuestions: { gt: 0 }, testSeriesId: { not: null } },
      select: { id: true, slug: true, synopsisFileName: true, testSeriesId: true },
      orderBy: [{ testSeriesId: 'asc' }, { slug: 'asc' }],
    });
    const second =
      others.find((t) => t.testSeriesId === paper!.testSeriesId && !existsSync(path.join(synopsisDir(), `${t.slug}.pdf`))) ??
      others.find((t) => !existsSync(path.join(synopsisDir(), `${t.slug}.pdf`)));
    if (second && second.testSeriesId !== paper.testSeriesId) {
      // Another series: the student is given it, as a buyer would be, and sits
      // a paper in it, as the analysis requires.
      await db.entitlement.create({
        data: { userId: student.id, testSeriesId: second.testSeriesId!, sourceType: 'ADMIN_GRANT', note: 'e2e-kannada-analysis' },
      });
      const begun = await learner.request.post(`${BASE}/api/attempts`, { data: { testId: second.id } });
      const id = ((await begun.json()) as { data?: { attemptId?: string } }).data?.attemptId;
      if (id) await learner.request.post(`${BASE}/api/attempts/${id}/submit`, { data: { reason: 'MANUAL' } });
    }
    if (!second) {
      log(false, 'a paper with no analysis file of its name, to upload to');
    } else {
      const sample = path.join(synopsisDir(), 'kas-pyq-2011-subject-indian-polity.pdf');
      const original = second.synopsisFileName;
      try {
        const uploaded = await admin.request.post(`${BASE}/api/admin/synopsis`, {
          multipart: {
            kind: 'test',
            id: second.id,
            file: { name: 'analysis.pdf', mimeType: 'application/pdf', buffer: readFileSync(sample) },
          },
        });
        log(uploaded.ok(), 'the upload is accepted', `HTTP ${uploaded.status()}`);
        const fileName = `${second.slug}.pdf`;

        // Straight after: no copy yet, so no switch and no promise of one.
        const now = await copyState(admin, 'test', second.id);
        log(now.state === 'pending', 'its Kannada copy starts at once, in the background', now.state);
        await page.goto(`${BASE}/synopsis/test/${second.id}`, { waitUntil: 'domcontentloaded' });
        await page.locator('h1').first().waitFor();
        const body = await page.locator('body').innerText();
        log((await page.getByTestId('analysis-language').count()) === 0, 'until it is complete, the student sees no switch');
        // Specific wording: the site's own footer says "Exam Preparation".
        log(
          !/being prepared|being translated|translating|ಸಿದ್ಧವಾಗುತ್ತಿದೆ|ಸಿದ್ಧಪಡಿಸಲಾಗುತ್ತಿದೆ/i.test(body),
          'and no "being prepared" message - just the English',
        );
        const notYet = await learner.request.get(`${BASE}/api/synopsis/test/${second.id}?lang=kn`);
        log(notYet.status() === 404, 'the Kannada address has nothing to give yet', `HTTP ${notYet.status()}`);

        const done = await waitForCopy(admin, 'test', second.id, 10);
        log(done.state === 'ready', 'the copy is made by itself', done.state);
        await page.goto(`${BASE}/synopsis/test/${second.id}`, { waitUntil: 'domcontentloaded' });
        await page.getByTestId('analysis-language').waitFor({ timeout: 30_000 });
        log(true, 'and the student gets the ಕನ್ನಡ switch on that paper');
        const made = Buffer.from(await (await learner.request.get(`${BASE}/api/synopsis/test/${second.id}?lang=kn`)).body());
        log(KANNADA.test(await pdfText(made)), 'which opens a Kannada copy of the uploaded file');

        // The admin list.
        const list = await admin.newPage();
        await list.goto(`${BASE}/admin/synopsis`, { waitUntil: 'domcontentloaded' });
        await list.getByText('ಕನ್ನಡ ready').first().waitFor({ timeout: 60_000 });
        const readyBadges = await list.getByText('ಕನ್ನಡ ready').count();
        log(readyBadges > 0, 'the admin list marks Kannada copies as ready', `${readyBadges} rows`);
        const preview = await list.getByRole('link', { name: 'Preview' }).first().getAttribute('href');
        const previewResponse = preview ? await admin.request.get(`${BASE}${preview}`) : null;
        log(previewResponse?.status() === 200, 'and Preview opens the Kannada PDF for the admin', preview ?? 'no link');
        await list.close();

        // Removing the English removes the Kannada.
        const removed = await admin.request.delete(`${BASE}/api/admin/synopsis?kind=test&id=${second.id}`);
        log(removed.ok(), 'removing the analysis works');
        const gone = !existsSync(path.join(synopsisDir(), 'kn', fileName));
        log(gone, 'and takes its Kannada copy with it');
      } finally {
        await db.test.update({ where: { id: second.id }, data: { synopsisFileName: original } });
      }
    }

    // --- Print / PDF in Kannada -------------------------------------------------------------
    console.log('\n-- Print / PDF in Kannada --');
    const printable = await admin.newPage();
    await printable.goto(`${BASE}/api/admin/tests/${paper.id}/export?lang=kn`, { waitUntil: 'networkidle' });
    log((await printable.locator('html').getAttribute('lang')) === 'kn', 'the printable paper is marked Kannada');
    log(await printable.getByRole('button', { name: 'PDF ಡೌನ್‌ಲೋಡ್ ಮಾಡಿ' }).isVisible(), 'with its download button in Kannada');
    const stems = await printable.locator('.stem').evaluateAll((nodes) => nodes.map((n) => n.textContent ?? ''));
    const inKannada = stems.filter((text) => KANNADA.test(text)).length;
    log(inKannada > 0, 'and the questions printed in Kannada', `${inKannada} of ${stems.length}`);
    const fontLoaded = await printable.evaluate(async () => {
      await document.fonts.ready;
      return document.fonts.check('16px "Noto Sans Kannada"', 'ಕನ್ನಡ');
    });
    log(fontLoaded, 'set in Noto Sans Kannada, embedded in the page');
    await printable.close();
  } finally {
    await browser.close();
    await db.testAttempt.deleteMany({ where: { userId: student.id } });
    await db.entitlement.deleteMany({ where: { userId: student.id } });
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
