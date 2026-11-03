/**
 * The KEA FDA / SDA Test Series, end to end, in a real browser.
 *
 *   1. A visitor finds it: homepage banner, the menu's NEW entry, the course
 *      cards, pricing, and the series page with its fifteen dated papers.
 *   2. An admin fills a paper: "Import PDF" opens the importer on that paper
 *      with FDA marks already set, and "Add question" opens the editor the
 *      same way. A KAS question cannot be put on an FDA paper by either route.
 *   3. A student sits it: refused before its date and before buying, then a
 *      real attempt through the exam screen — a two-hour countdown, +1 / −0.25
 *      / 0 scoring out of the paper's own total — and a second attempt left to
 *      run out, which the browser submits itself when the clock reaches zero.
 *   4. General English stays in English when the paper is sat in Kannada.
 *
 * Runs against a local server on the dev database and puts every paper back
 * as it found it.
 *
 *   npx tsx scripts/e2e-kea-fda-sda.mts
 */
import { readFileSync } from 'node:fs';

import { PrismaClient } from '@prisma/client';
import { chromium, type BrowserContext, type Page } from 'playwright';

const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const SHOTS = process.env.SHOTS_DIR ?? '';

function envValue(key: string, fallback: string): string {
  if (process.env[key]) return process.env[key]!;
  try {
    const line = readFileSync('.env', 'utf8')
      .split(/\r?\n/)
      .find((l) => l.startsWith(`${key}=`));
    if (line) return line.slice(key.length + 1).replace(/^"|"$/g, '');
  } catch {
    /* no .env */
  }
  return fallback;
}

const ADMIN = { email: envValue('SEED_ADMIN_EMAIL', 'admin@avkvisions.com'), password: envValue('SEED_ADMIN_PASSWORD', 'ChangeMe!Admin2024') };
const STUDENT = { email: 'student@avkvisions.com', password: 'Demo@Pass2024' };

const SERIES_SLUG = 'kea-fda-sda-test-series';
const SOURCE = 'E2E KEA FDA SDA';

const db = new PrismaClient();
let passed = 0;
let failed = 0;

function check(ok: boolean, label: string, detail = '') {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
  if (ok) passed += 1;
  else {
    failed += 1;
    process.exitCode = 1;
  }
}

/** A real, single-page PDF in the format the importer reads. */
function makePdf(lines: string[]): Buffer {
  const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  const content = `BT /F1 10 Tf 40 780 Td 12 TL\n${lines.map((l) => `(${esc(l)}) Tj T*`).join('\n')}\nET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((body, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefAt = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objects.length; i++) pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF`;
  return Buffer.from(pdf, 'latin1');
}

/** Six questions — one page — keyed A, B, C, D, A, B so a lazy parser shows. */
function historyPaper(): Buffer {
  const lines: string[] = [];
  for (let n = 1; n <= 6; n++) {
    lines.push(`Q${n}. Which ruler is associated with Karnataka history fact number ${n}?`);
    lines.push('Options:');
    lines.push(`1. Alpha answer ${n}`);
    lines.push(`2. Beta answer ${n}`);
    lines.push(`3. Gamma answer ${n}`);
    lines.push(`4. Delta answer ${n}`);
    lines.push(`CORRECT ANSWER: ${((n - 1) % 4) + 1}`);
    lines.push('');
  }
  return makePdf(lines);
}

async function signIn(context: BrowserContext, who: { email: string; password: string }) {
  const response = await context.request.post(`${BASE}/api/auth/login`, { data: who });
  return response.ok();
}

async function text(page: Page, path: string): Promise<{ status: number; body: string }> {
  const response = await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' });
  return { status: response?.status() ?? 0, body: await page.content() };
}

/** What a person sees: rendered text, not HTML with React's markers in it. */
async function visible(page: Page, path: string): Promise<string> {
  await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' });
  return page.locator('body').innerText();
}

async function shot(page: Page, name: string) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: false });
}

async function main() {
  const series = await db.testSeries.findUniqueOrThrow({
    where: { slug: SERIES_SLUG },
    select: {
      id: true,
      examId: true,
      exam: { select: { slug: true } },
      tests: {
        orderBy: { sortOrder: 'asc' },
        select: { id: true, slug: true, title: true, status: true, startDate: true, subjectId: true, totalMarks: true, maxAttempts: true },
      },
    },
  });
  const t1 = series.tests[0]!;
  const t10 = series.tests.find((t) => t.title === 'General English')!;
  const original = series.tests.map((t) => ({ ...t }));
  const kas = await db.exam.findUniqueOrThrow({ where: { slug: 'kas' }, select: { id: true, subjects: { take: 1, select: { id: true } } } });
  const student = await db.user.findFirstOrThrow({ where: { email: STUDENT.email }, select: { id: true } });

  const browser = await chromium.launch();

  try {
    // =====================================================================
    console.log('\n1. A visitor finds the series');
    const visitor = await browser.newContext({ viewport: { width: 420, height: 900 } });
    const page = await visitor.newPage();

    const home = await text(page, '/');
    check(home.status === 200, 'homepage loads');
    check(/Prepare for.*KEA FDA &amp; SDA.*2026/s.test(home.body), 'banner: "Prepare for KEA FDA & SDA 2026"');
    check(home.body.includes('11<!-- --> Sectional Tests') || home.body.includes('11 Sectional Tests'), 'banner: 11 Sectional Tests');
    check(home.body.includes('4<!-- --> Full-Length Mock Tests') || home.body.includes('4 Full-Length Mock Tests'), 'banner: 4 Full-Length Mock Tests');
    check(home.body.includes('Enrolments open'), 'banner: Enrolments open');
    check(home.body.includes(`href="/test-series/${SERIES_SLUG}"`), 'banner links to the series');
    await page.locator('#fda-sda-heading').scrollIntoViewIfNeeded();
    await shot(page, '1-home-banner');

    await page.getByRole('button', { name: 'Open menu' }).click();
    const entry = page.getByRole('dialog', { name: 'Menu' }).getByRole('link', { name: /KEA FDA \/ SDA Test Series/ });
    check((await entry.count()) === 1, 'menu lists KEA FDA / SDA Test Series');
    check(((await entry.textContent()) ?? '').includes('NEW'), 'menu entry carries the NEW badge');
    await shot(page, '2-menu');
    await entry.click();
    await page.waitForURL(`**/test-series/${SERIES_SLUG}`);
    check(true, 'menu entry opens the series page');

    const sp = await page.content();
    for (const t of series.tests) check(sp.includes(t.title.replace('&', '&amp;')), `schedule lists "${t.title}"`);
    check(sp.includes('10 Nov 2026') && sp.includes('27 Dec 2026'), 'schedule shows the timetable dates');
    check(sp.includes('Sunday · Morning session') && sp.includes('Sunday · Afternoon session'), 'mock sessions named');
    check(sp.includes('+1 / −0.25'), 'marking stated: +1 / −0.25');
    check(sp.includes('Final revision') && sp.includes('28–31 December 2026'), 'final revision window shown');
    check(sp.includes('₹199'), 'price ₹199');
    check(!sp.includes(`/start/${t1.id}`), 'no Start button on an unwritten paper');
    await shot(page, '3-series-page');

    for (const [path, needle] of [
      ['/courses', 'KEA FDA / SDA Test Series'],
      ['/courses/kea-fda-sda', 'KEA FDA / SDA Test Series'],
      ['/courses/kea-fda-sda/syllabus', 'KEA FDA / SDA Test Series'],
      ['/test-series', 'KEA FDA / SDA Test Series'],
      ['/pricing', 'KEA FDA / SDA Test Series'],
    ] as const) {
      const r = await text(page, path);
      check(r.status === 200 && r.body.includes(needle), `${path} shows the series`);
    }
    const pdf = await visitor.request.get(`${BASE}/api/schedule/fda-sda`);
    check(pdf.ok() && pdf.headers()['content-type'] === 'application/pdf', 'timetable PDF served', pdf.headers()['content-length']);
    await visitor.close();

    // =====================================================================
    console.log('\n2. An admin fills Test 1 — History and Culture');
    const adminCtx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
    check(await signIn(adminCtx, ADMIN), 'admin signs in');
    const admin = await adminCtx.newPage();

    const panel = await visible(admin, '/admin/kea-fda-sda');
    check((panel.match(/0\/100 questions/g) ?? []).length === 15, 'admin page lists all 15 papers, empty');
    check((await admin.getByRole('link', { name: 'Import PDF' }).count()) === 15, 'every paper has Import PDF');
    check((await admin.getByRole('link', { name: 'Add question' }).count()) === 15, 'every paper has Add question');
    await shot(admin, '4-admin-page');

    await admin.goto(`${BASE}/admin/import?testId=${t1.id}`);
    await admin.setInputFiles('input[type=file]', { name: 'fda-history.pdf', mimeType: 'application/pdf', buffer: historyPaper() });
    await admin.waitForSelector('#i-exam');
    check((await admin.inputValue('#i-exam')) === series.examId, 'import opens on the KEA FDA / SDA exam');
    check((await admin.inputValue('#i-subject')) === t1.subjectId, 'and on the paper\'s subject');
    check((await admin.inputValue('#i-marks')) === '1', 'marks default to 1');
    check((await admin.inputValue('#i-neg')) === '0.25', 'negative defaults to 0.25');
    check((await admin.getByRole('button', { name: /Existing tests only/ }).getAttribute('aria-pressed')) === 'true', 'destination: existing test');
    check((await admin.getByRole('button', { name: /History and Culture/ }).first().getAttribute('aria-pressed')) === 'true', 'Test 1 already ticked');
    await admin.fill('#i-source', SOURCE);
    await admin.getByRole('checkbox', { name: /Publish the questions immediately/ }).check();
    await shot(admin, '5-import-review');
    await admin.getByRole('button', { name: /^Import 6/ }).click();
    await admin.getByText('Imported 6 questions').waitFor({ timeout: 30_000 });
    check(true, 'six questions imported through the UI');

    const attached = await db.testQuestion.findMany({
      where: { testId: t1.id },
      select: { marks: true, negativeMarks: true, question: { select: { examId: true, code: true, status: true, options: { where: { isCorrect: true }, select: { label: true } } } } },
    });
    check(attached.length === 6, 'Test 1 holds them', `${attached.length}`);
    check(attached.every((a) => a.marks === 1 && a.negativeMarks === 0.25), 'every one marked +1 / −0.25');
    check(attached.every((a) => a.question.examId === series.examId && a.question.code.startsWith('FDA-SDA-Q')), 'filed under the FDA exam (FDA-SDA-Q codes)');
    check(attached.map((a) => a.question.options[0]?.label).join('') === 'ABCDAB', 'answer keys read from the paper', attached.map((a) => a.question.options[0]?.label).join(''));

    // The guards: a KAS-marked question cannot reach an FDA paper.
    const refused = await adminCtx.request.post(`${BASE}/api/admin/import/commit`, {
      data: {
        examId: kas.id,
        subjectId: kas.subjects[0]!.id,
        destinations: [{ kind: 'EXISTING_TEST', testId: t1.id }],
        marks: 2,
        negativeMarks: 0.5,
        source: SOURCE,
        publish: false,
        questions: [{ number: 1, body: 'Should never land', options: [{ body: 'a' }, { body: 'b' }], correctIndex: 0 }],
      },
    });
    check(refused.status() === 422 && (await refused.text()).includes('another exam'), 'import from KAS onto an FDA paper refused', `${refused.status()}`);
    const kasQuestion = await db.question.findFirstOrThrow({ where: { examId: kas.id, deletedAt: null }, select: { id: true } });
    const attach = await adminCtx.request.post(`${BASE}/api/admin/tests/${t1.id}/questions`, {
      data: { action: 'attach', questionIds: [kasQuestion.id] },
    });
    const attachBody = await attach.json();
    check(attachBody.data?.attached === 0 && /another exam/.test(attachBody.message ?? ''), 'attaching a KAS bank question refused', attachBody.message);

    // Add question opens on the paper's exam, subject and marks.
    await admin.goto(`${BASE}/admin/questions/new?testId=${t1.id}`);
    await admin.waitForSelector('#q-exam');
    check((await admin.inputValue('#q-exam')) === series.examId, 'Add question opens on the FDA exam');
    check((await admin.inputValue('#q-subject')) === t1.subjectId, 'and on History and Culture');
    check((await admin.inputValue('#q-marks')) === '1' && (await admin.inputValue('#q-neg')) === '0.25', 'with marks 1 / 0.25');
    await admin.fill('#q-body', 'Who founded the Vijayanagara Empire? (e2e)');
    for (const [i, option] of ['Harihara and Bukka', 'Krishnadevaraya', 'Pulakeshin II', 'Vishnuvardhana'].entries()) {
      await admin.getByPlaceholder(`Option ${String.fromCharCode(65 + i)}`).fill(option);
    }
    await admin.getByRole('button', { name: 'Mark option A as correct' }).click();
    await admin.getByRole('button', { name: 'Create question' }).first().click();
    await admin.waitForURL(/\/admin\/questions\?testId=/, { timeout: 30_000 });
    const added = await db.testQuestion.findFirst({
      where: { testId: t1.id, question: { body: { contains: '(e2e)' } } },
      select: { marks: true, negativeMarks: true },
    });
    check(added?.marks === 1 && added?.negativeMarks === 0.25, 'the hand-written question joined Test 1 at +1 / −0.25');
    await db.question.updateMany({ where: { body: { contains: '(e2e)' } }, data: { source: SOURCE } });

    // Publish from Settings, as an admin would.
    await admin.goto(`${BASE}/admin/tests/${t1.id}`);
    await admin.selectOption('#t-status', 'PUBLISHED');
    await admin.getByRole('button', { name: 'Save changes' }).first().click();
    await admin.waitForTimeout(1500);
    const published = await db.test.findUniqueOrThrow({ where: { id: t1.id }, select: { status: true, totalQuestions: true, totalMarks: true } });
    check(published.status === 'PUBLISHED', 'Test 1 published from Settings');
    check(published.totalQuestions === 7 && published.totalMarks === 7, 'Test 1: 7 questions, out of 7', `${published.totalQuestions}q / ${published.totalMarks}`);

    const panel2 = await visible(admin, '/admin/kea-fda-sda');
    check(/History and Culture\s*live/.test(panel2) && panel2.includes('7/100 questions'), 'admin page shows Test 1 live with 7 questions');
    check(!/not marked \+1/.test(panel2) && !panel2.includes('draft question'), 'no marking or draft warning');

    // And the warning does fire: one question knocked to KAS marks.
    const one = await db.testQuestion.findFirstOrThrow({ where: { testId: t1.id }, select: { id: true } });
    await db.testQuestion.update({ where: { id: one.id }, data: { marks: 2, negativeMarks: 0.5 } });
    const panel3 = await visible(admin, '/admin/kea-fda-sda');
    check(panel3.includes('1 question is not marked +1 / −0.25'), 'a question at KAS marks is flagged');
    await db.testQuestion.update({ where: { id: one.id }, data: { marks: 1, negativeMarks: 0.25 } });

    // =====================================================================
    console.log('\n3. A student sits Test 1');
    const studentCtx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    check(await signIn(studentCtx, STUDENT), 'student signs in');
    const sPage = await studentCtx.newPage();

    // Clean slate for this student on these papers.
    await db.testAttempt.deleteMany({ where: { userId: student.id, testId: { in: series.tests.map((t) => t.id) } } });
    await db.entitlement.deleteMany({ where: { userId: student.id, testSeriesId: series.id } });

    const early = await studentCtx.request.post(`${BASE}/api/attempts`, { data: { testId: t1.id } });
    check(!early.ok() && /opens/i.test(await early.text()), 'refused before 10 Nov', `${early.status()}`);

    await db.test.update({ where: { id: t1.id }, data: { startDate: new Date(Date.now() - 86_400_000) } });
    const unpaid = await studentCtx.request.post(`${BASE}/api/attempts`, { data: { testId: t1.id } });
    check(!unpaid.ok() && [402, 403].includes(unpaid.status()), 'refused without buying the series', `${unpaid.status()}`);

    await db.entitlement.create({ data: { userId: student.id, testSeriesId: series.id, sourceType: 'PURCHASE', note: SOURCE } });

    // Read live, not from the build: the paper filled and dated a minute ago
    // must now offer Start, and the others still must not.
    const live = await text(sPage, `/test-series/${SERIES_SLUG}`);
    check(live.body.includes(`/start/${t1.id}`), 'series page now offers Start on Test 1');
    check(!live.body.includes(`/start/${series.tests[1]!.id}`), 'and still not on Test 2');

    await sPage.goto(`${BASE}/test/${t1.id}`);
    const start = await sPage.content();
    check(start.includes('This paper follows the KEA FDA / SDA examination pattern'), 'start screen shows the FDA instructions');
    check(start.includes('Each question carries 1 mark') && start.includes('0.25 marks are deducted'), 'and the +1 / −0.25 rule');
    await shot(sPage, '6-start-screen');
    await sPage.getByRole('button', { name: 'Start test' }).first().click();
    const timer = sPage.getByRole('timer');
    await timer.waitFor({ timeout: 30_000 });
    const shown = (await timer.textContent()) ?? '';
    check(/1:59:\d\d|02:00:00|2:00:00|01:59:\d\d/.test(shown), 'countdown starts at two hours', shown.trim());
    await shot(sPage, '7-exam-screen');

    const attempt = await db.testAttempt.findFirstOrThrow({
      where: { userId: student.id, testId: t1.id, status: 'IN_PROGRESS' },
      select: { id: true, startedAt: true, expiresAt: true, questionOrderJson: true },
    });
    const minutes = Math.round((attempt.expiresAt.getTime() - attempt.startedAt.getTime()) / 60_000);
    check(minutes === 120, 'server allows exactly 120 minutes', `${minutes}`);

    // In paper order: answer Q1 right, Q2 wrong, leave the rest.
    const paper = await db.testQuestion.findMany({
      where: { testId: t1.id },
      orderBy: { sortOrder: 'asc' },
      select: { question: { select: { options: { orderBy: { sortOrder: 'asc' }, select: { body: true, isCorrect: true } } } } },
    });
    const right = paper[0]!.question.options.find((o) => o.isCorrect)!.body;
    const wrong = paper[1]!.question.options.find((o) => !o.isCorrect)!.body;
    await sPage.getByRole('button', { name: right }).click();
    await sPage.getByRole('button', { name: /Save & next/ }).click();
    await sPage.getByRole('button', { name: wrong }).click();
    await sPage.getByRole('button', { name: /Save & next/ }).click();
    await sPage.waitForTimeout(1500);
    await sPage.getByRole('button', { name: /^Submit$/ }).first().click();
    await sPage.getByRole('button', { name: /^Submit test$/ }).last().click();
    await sPage.waitForURL(/\/result/, { timeout: 30_000 });
    await shot(sPage, '8-result');

    const scored = await db.testAttempt.findUniqueOrThrow({
      where: { id: attempt.id },
      select: { status: true, score: true, maxScore: true, correctCount: true, incorrectCount: true, unansweredCount: true },
    });
    check(scored.status === 'SUBMITTED', 'submitted');
    check(scored.score === 0.75 && scored.maxScore === 7, 'scored 1 − 0.25 = 0.75 out of 7', `${scored.score}/${scored.maxScore}`);
    check(scored.correctCount === 1 && scored.incorrectCount === 1 && scored.unansweredCount === 5, '1 right, 1 wrong, 5 blank');
    const resultPage = await sPage.content();
    check(resultPage.includes('0.75'), 'result page shows 0.75');

    // --- Second attempt: let the clock run out in the browser ------------
    console.log('\n   …second attempt, left to run out');
    const again = await studentCtx.request.post(`${BASE}/api/attempts`, { data: { testId: t1.id } });
    const againId = (await again.json()).data?.attemptId as string;
    check(again.ok() && Boolean(againId), 'second attempt starts (2 allowed)');
    const state = await (await studentCtx.request.get(`${BASE}/api/attempts/${againId}`)).json();
    const keyed = await db.testQuestion.findMany({
      where: { testId: t1.id },
      orderBy: { sortOrder: 'asc' },
      select: { id: true, question: { select: { options: { select: { id: true, isCorrect: true } } } } },
    });
    const pick = (i: number, correct: boolean) => ({
      testQuestionId: keyed[i]!.id,
      selectedOptionIds: [keyed[i]!.question.options.find((o) => o.isCorrect === correct)!.id],
      state: 'ANSWERED',
      timeDeltaSeconds: 5,
    });
    const save = await studentCtx.request.patch(`${BASE}/api/attempts/${againId}/answers`, {
      data: { patches: [pick(0, true), pick(1, true), pick(2, false)] },
    });
    check(save.ok() && state.data?.questions?.length === 7, 'two right and one wrong saved');

    await db.testAttempt.update({ where: { id: againId }, data: { expiresAt: new Date(Date.now() + 8_000) } });
    await sPage.goto(`${BASE}/test/${againId}`);
    await sPage.getByRole('timer').waitFor();
    await sPage.waitForURL(/\/result/, { timeout: 45_000 });
    const timedOut = await db.testAttempt.findUniqueOrThrow({ where: { id: againId }, select: { status: true, score: true, maxScore: true } });
    check(timedOut.status === 'AUTO_SUBMITTED', 'submitted by the browser when time ran out', timedOut.status);
    check(timedOut.score === 1.75 && timedOut.maxScore === 7, 'scored 2 − 0.25 = 1.75 out of 7', `${timedOut.score}/${timedOut.maxScore}`);

    const late = await studentCtx.request.patch(`${BASE}/api/attempts/${againId}/answers`, { data: { patches: [pick(3, true)] } });
    check(!(await late.json()).success, 'answers after submission refused');
    const third = await studentCtx.request.post(`${BASE}/api/attempts`, { data: { testId: t1.id } });
    check(!third.ok(), 'third attempt refused (two allowed)', `${third.status()}`);

    // =====================================================================
    console.log('\n4. General English stays in English in a Kannada sitting');
    const englishSubject = await db.subject.findFirstOrThrow({ where: { examId: series.examId, slug: 'general-english' }, select: { id: true } });
    const commit = await adminCtx.request.post(`${BASE}/api/admin/import/commit`, {
      data: {
        examId: series.examId,
        subjectId: englishSubject.id,
        destinations: [{ kind: 'EXISTING_TEST', testId: t10.id }],
        marks: 1,
        negativeMarks: 0.25,
        source: SOURCE,
        publish: true,
        questions: [
          { number: 1, body: 'Choose the synonym of ABUNDANT.', options: [{ body: 'Plentiful' }, { body: 'Scarce' }, { body: 'Tiny' }, { body: 'Rare' }], correctIndex: 0 },
          { number: 2, body: 'Choose the correctly spelt word.', options: [{ body: 'Accommodate' }, { body: 'Acommodate' }, { body: 'Accomodate' }, { body: 'Acomodate' }], correctIndex: 0 },
        ],
      },
    });
    check(commit.ok(), 'two General English questions imported');
    await db.test.update({ where: { id: t10.id }, data: { status: 'PUBLISHED', startDate: new Date(Date.now() - 86_400_000) } });
    const english = await studentCtx.request.post(`${BASE}/api/attempts`, { data: { testId: t10.id, language: 'kn' } });
    const englishId = (await english.json()).data?.attemptId as string;
    const translation = await (await studentCtx.request.get(`${BASE}/api/attempts/${englishId}/translation?lang=kn`)).json();
    check(translation.data?.pending?.stems === 0, 'nothing pending: the paper does not wait for Kannada', JSON.stringify(translation.data?.pending));
    check(Object.keys(translation.data?.stems ?? {}).length === 0, 'and no Kannada version is made');
    await studentCtx.request.post(`${BASE}/api/attempts/${englishId}/submit`, { data: { reason: 'MANUAL' } });

    await studentCtx.close();
    await adminCtx.close();
  } finally {
    await browser.close();

    // --- Put everything back --------------------------------------------
    const ids = series.tests.map((t) => t.id);
    const made = await db.question.findMany({ where: { source: SOURCE }, select: { id: true } });
    await db.testAttempt.deleteMany({ where: { testId: { in: ids } } });
    await db.testQuestion.deleteMany({ where: { testId: { in: ids } } });
    await db.questionStat.deleteMany({ where: { questionId: { in: made.map((q) => q.id) } } });
    await db.contentTranslation.deleteMany({ where: { entityId: { in: [...made.map((q) => q.id), ...ids] } } });
    await db.question.deleteMany({ where: { id: { in: made.map((q) => q.id) } } });
    await db.entitlement.deleteMany({ where: { userId: student.id, testSeriesId: series.id } });
    for (const t of original) {
      await db.test.update({
        where: { id: t.id },
        data: { status: t.status, startDate: t.startDate, totalQuestions: 0, totalMarks: t.totalMarks, publishedAt: null },
      });
    }
    await db.$disconnect();
  }

  console.log(`\n${passed} passed, ${failed} failed\n`);
}

main().catch(async (error) => {
  console.error(error);
  process.exitCode = 1;
  await db.$disconnect();
});
