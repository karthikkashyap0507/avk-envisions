/**
 * The printable paper behind Print / PDF.
 *
 * Three faults, all in the document a staff member prints to proof-read:
 *
 *   it numbered the first question 102, because it printed `sortOrder` —
 *     an ordering key carrying whatever values the questions were attached
 *     with — instead of the question's place on the paper
 *   the only way to save it was Ctrl+P, which a phone does not have
 *   the green and amber washed out to near-white once rendered to PDF
 */
import { chromium, type Page } from 'playwright';
import { PrismaClient } from '@prisma/client';

const db = new PrismaClient();
const BASE = 'http://localhost:3000';
const ADMIN = 'e2e-export-admin@avkvisions.test';
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

async function makeAdmin() {
  const donor = await db.user.findFirstOrThrow({
    where: { email: 'student@avkvisions.com' },
    select: { passwordHash: true },
  });
  await db.user.deleteMany({ where: { email: ADMIN } });
  await db.user.create({
    data: {
      email: ADMIN,
      emailNormal: ADMIN,
      name: 'Export Admin',
      role: 'ADMIN',
      passwordHash: donor.passwordHash,
      emailVerified: new Date(),
      status: 'ACTIVE',
    },
  });
}

async function biggestPaper() {
  const tests = await db.test.findMany({
    where: { deletedAt: null },
    select: { id: true, title: true, _count: { select: { questions: true } } },
  });
  const best = tests
    .filter((t) => t._count.questions > 0)
    .sort((a, b) => b._count.questions - a._count.questions)[0];
  if (!best) throw new Error('No paper in the database holds any questions.');
  return best;
}

async function main() {
  console.log('\n=== The printable paper ===\n');
  await makeAdmin();
  const paper = await biggestPaper();
  console.log(`  paper: ${paper.title} (${paper._count.questions} questions)\n`);

  // The reported paper's questions were attached with sortOrder starting at
  // 102, so that is the state this reproduces — with sortOrder equal to the
  // position, printing the wrong field would still look right.
  const original = await db.testQuestion.findMany({
    where: { testId: paper.id },
    orderBy: { sortOrder: 'asc' },
    select: { id: true, sortOrder: true },
  });

  const browser = await chromium.launch();
  try {
    for (const [index, row] of original.entries()) {
      await db.testQuestion.update({
        where: { id: row.id },
        data: { sortOrder: 102 + index },
      });
    }

    const page: Page = await browser.newPage({ viewport: { width: 1100, height: 1000 } });
    await page.request.post(`${BASE}/api/auth/login`, {
      data: { email: ADMIN, password: PASSWORD },
    });
    await page.goto(`${BASE}/api/admin/tests/${paper.id}/export`, { waitUntil: 'networkidle' });

    // --- numbering ---------------------------------------------------------
    console.log('-- Numbering --');

    const numbers = await page
      .locator('.num')
      .evaluateAll((nodes) => nodes.map((n) => n.textContent?.trim() ?? ''));

    log(numbers[0] === '1', 'the first question is numbered 1', `printed "${numbers[0]}"`);
    log(
      numbers.every((value, index) => value === String(index + 1)),
      'and they run consecutively to the end',
      `1 … ${numbers[numbers.length - 1]} over ${numbers.length}`,
    );
    log(
      !numbers.includes('102') || numbers.length >= 102,
      'the stored sortOrder is not what gets printed',
      'sortOrder was offset to 102+ for this check',
    );

    // --- saving it on a phone ---------------------------------------------
    console.log('\n-- Saving it --');

    const download = page.getByRole('button', { name: /download pdf/i });
    log((await download.count()) === 1, 'there is a Download PDF button to tap');

    const body = await page.locator('body').innerText();
    log(
      !/Ctrl\/Cmd/i.test(body),
      'and no instruction to press a key combination a phone does not have',
    );

    // --- the colours -------------------------------------------------------
    console.log('\n-- Colour in the printed document --');

    // Read one at a time: a helper declared inside evaluate() is rewritten by
    // the TypeScript loader into something the page cannot run.
    const correctTint = await page
      .locator('.options li.right')
      .first()
      .evaluate((el) => getComputedStyle(el).backgroundColor);
    const explanationTint = await page
      .locator('.explanation')
      .first()
      .evaluate((el) => getComputedStyle(el).backgroundColor);
    const tint = { correct: correctTint, explanation: explanationTint };

    // Brightness on the 0-255 scale. The old tints sat above 250 on every
    // channel — indistinguishable from white paper once printed.
    const correctChannels = (tint.correct.match(/\d+/g) ?? []).slice(0, 3).map(Number);
    const explanationChannels = (tint.explanation.match(/\d+/g) ?? []).slice(0, 3).map(Number);

    log(
      correctChannels.length === 3 && Math.min(...correctChannels) < 240,
      'the correct answer is tinted deeply enough to see',
      tint.correct,
    );
    log(
      explanationChannels.length === 3 && Math.min(...explanationChannels) < 240,
      'and so is the explanation',
      tint.explanation,
    );

    // Backgrounds are dropped when printing unless this is asked for.
    const forced = await page.evaluate(() => {
      const el = document.querySelector('.options li.right');
      if (!el) return '';
      const style = getComputedStyle(el);
      return style.printColorAdjust || style.getPropertyValue('-webkit-print-color-adjust');
    });
    log(forced === 'exact', 'and the tints are told to survive printing', forced || 'not set');

    // --- what a real PDF render produces -----------------------------------
    console.log('\n-- Rendered as a PDF --');

    const pdf = await page.pdf({ format: 'A4', printBackground: true });
    log(pdf.length > 10_000, 'the page renders to a PDF', `${pdf.length.toLocaleString()} bytes`);

    // The toolbar is a screen control and must not print. Checked against the
    // served CSS, which says so plainly.
    const css = await page.content();
    const printBlock = /@media print\s*\{([\s\S]*?)\n\s*\}/.exec(css)?.[1] ?? '';
    const printRule = /\.toolbar[^{]*\{[^}]*display:\s*none/.test(printBlock);
    log(printRule, 'and the Download button itself is left off the printed page');

    await page.close();
  } finally {
    // Put the ordering back exactly as it was.
    for (const row of original) {
      await db.testQuestion.update({
        where: { id: row.id },
        data: { sortOrder: row.sortOrder },
      });
    }
    await browser.close();
    await db.user.deleteMany({ where: { email: ADMIN } });
  }

  console.log(`\n  ${passed} passed, ${failed} failed\n`);
}

main()
  .catch((error) => {
    console.error('\nFailed:\n', error);
    process.exitCode = 1;
  })
  .finally(async () => db.$disconnect());
