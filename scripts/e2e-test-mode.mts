/**
 * Saving a test whose stored mode is from an older vocabulary.
 *
 * Opening a KAS-50 day paper and pressing Save changes failed with
 *
 *   Invalid enum value. Expected 'EXAM' | 'PRACTICE', received 'TIMED'
 *
 * `mode` is a plain string column with no constraint, so an old value sits
 * there until something reads it. The builder has no mode field: it loads
 * whatever is stored, carries it invisibly through the form and posts it back.
 * So the save was refused over a value the admin could not see or change —
 * every edit to that paper was blocked, with no way out through the UI.
 */
import { chromium, type Page } from 'playwright';
import { PrismaClient } from '@prisma/client';

const db = new PrismaClient();
const BASE = 'http://localhost:3000';
const ADMIN = 'e2e-mode-admin@avkvisions.test';
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
      name: 'Mode Admin',
      role: 'ADMIN',
      passwordHash: donor.passwordHash,
      emailVerified: new Date(),
      status: 'ACTIVE',
    },
  });
}

async function main() {
  console.log('\n=== Saving a test with a stale mode ===\n');
  await makeAdmin();

  // A KAS-50 day paper, which is what was reported.
  const paper = await db.test.findFirstOrThrow({
    where: { deletedAt: null, slug: { startsWith: 'kas-50-days-' } },
    select: { id: true, slug: true, title: true, mode: true },
    orderBy: { slug: 'asc' },
  });
  const wasMode = paper.mode;
  console.log(`  paper: ${paper.title} (mode currently ${wasMode})\n`);

  const browser = await chromium.launch();
  try {
    // Reproduce production: a value from the older vocabulary.
    await db.$executeRawUnsafe(`UPDATE tests SET mode = 'TIMED' WHERE id = ?`, paper.id);
    const staged = await db.$queryRawUnsafe<{ mode: string }[]>(
      `SELECT mode FROM tests WHERE id = ?`,
      paper.id,
    );
    log(staged[0]?.mode === 'TIMED', 'the reported state is reproduced', `mode = ${staged[0]?.mode}`);

    const page: Page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    await page.request.post(`${BASE}/api/auth/login`, {
      data: { email: ADMIN, password: PASSWORD },
    });

    // --- saving through the form -------------------------------------------
    console.log('\n-- Pressing Save changes --');

    await page.goto(`${BASE}/admin/tests/${paper.id}`, { waitUntil: 'networkidle' });

    // Two of them: the form repeats the button at the top and bottom.
    const save = page.getByRole('button', { name: /save changes/i }).first();
    log((await save.count()) === 1, 'the builder opens with a Save changes button');

    await save.click();

    // Either an error banner appears, or the save goes through.
    const banner = page.getByText(/invalid enum value/i);
    const raced = await Promise.race([
      banner.waitFor({ timeout: 8_000 }).then(() => 'error' as const).catch(() => null),
      page
        .getByText(/saved|updated/i)
        .first()
        .waitFor({ timeout: 8_000 })
        .then(() => 'saved' as const)
        .catch(() => null),
    ]);

    log(raced !== 'error', 'the save is not refused over a value the form never shows', String(raced));

    // --- what it stored -----------------------------------------------------
    console.log('\n-- What was written --');

    const after = await db.$queryRawUnsafe<{ mode: string }[]>(
      `SELECT mode FROM tests WHERE id = ?`,
      paper.id,
    );
    log(
      after[0]?.mode === 'EXAM',
      'the stale value is settled to EXAM on save',
      `mode = ${after[0]?.mode}`,
    );

    // The correction must never hand students the answer key mid-paper.
    log(
      after[0]?.mode !== 'PRACTICE',
      'and never silently to PRACTICE, which reveals answers as they go',
    );

    // --- a deliberate PRACTICE paper is left alone -------------------------
    console.log('\n-- A real PRACTICE paper is untouched --');

    await db.$executeRawUnsafe(`UPDATE tests SET mode = 'PRACTICE' WHERE id = ?`, paper.id);
    await page.goto(`${BASE}/admin/tests/${paper.id}`, { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: /save changes/i }).first().click();
    await page.waitForTimeout(2_500);

    const practice = await db.$queryRawUnsafe<{ mode: string }[]>(
      `SELECT mode FROM tests WHERE id = ?`,
      paper.id,
    );
    log(
      practice[0]?.mode === 'PRACTICE',
      'saving a PRACTICE paper keeps it on PRACTICE',
      `mode = ${practice[0]?.mode}`,
    );

    await page.close();
  } finally {
    // Put the paper back exactly as it was found.
    await db.$executeRawUnsafe(`UPDATE tests SET mode = ? WHERE id = ?`, wasMode, paper.id);
    const restored = await db.$queryRawUnsafe<{ mode: string }[]>(
      `SELECT mode FROM tests WHERE id = ?`,
      paper.id,
    );
    console.log(`\n  restored ${paper.slug} to mode ${restored[0]?.mode}`);

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
