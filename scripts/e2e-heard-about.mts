/**
 * "How did you hear about us?", end to end, in a real browser.
 *
 *   1. The sign-up form shows the question with its four options, and the
 *      "Other" box only once "Other" is ticked.
 *   2. Four students sign up through the form: two options, "Other" with
 *      their own words, nothing at all, and "Other" typed then unticked. The
 *      database holds exactly what each one ticked.
 *   3. The API refuses an option that is not on the form.
 *   4. The admin Users page shows every answer on its row, counts them in the
 *      summary, filters by each option, and shows nothing for an account that
 *      was never asked. The student's own admin page shows it too.
 *
 * Runs against a local server on the dev database and deletes the students it
 * made.
 *
 *   npx tsx scripts/e2e-heard-about.mts
 */
import { readFileSync } from 'node:fs';

import { PrismaClient } from '@prisma/client';
import { chromium, type Browser, type Page } from 'playwright';

const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const SHOTS = process.env.SHOTS_DIR ?? '';
const PREFIX = 'e2e.heard.';
const PASSWORD = 'Kea-Fda-Sign-up-2026!';

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
const ADMIN = {
  email: envValue('SEED_ADMIN_EMAIL', 'admin@avkvisions.com'),
  password: envValue('SEED_ADMIN_PASSWORD', 'ChangeMe!Admin2024'),
};

const LABELS = {
  TELEGRAM_TARGET_GROUPS: 'Telegram Groups – TARGET PSI & KAS, TARGET PC & PSI, TARGET SDA & FDA',
  TELEGRAM_OTHER: 'Other Telegram Group',
  YOUTUBE: 'YouTube',
  OTHER: 'Other',
} as const;

const db = new PrismaClient();
let passed = 0;
let failed = 0;
// A different block of addresses each run, so reruns within the hour do not
// share a sign-up allowance.
const ipBlock = `10.${Math.floor(Math.random() * 250) + 1}.${Math.floor(Math.random() * 250) + 1}`;
let ipCounter = 10;

function check(ok: boolean, label: string, detail = '') {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
  if (ok) passed += 1;
  else {
    failed += 1;
    process.exitCode = 1;
  }
}

/**
 * A fresh browser per sign-up, each from its own address: registration is
 * limited to five an hour per address, and these are five sign-ups.
 */
async function freshPage(browser: Browser, width = 420): Promise<Page> {
  ipCounter += 1;
  const context = await browser.newContext({
    viewport: { width, height: 1000 },
    extraHTTPHeaders: { 'x-forwarded-for': `${ipBlock}.${ipCounter}` },
  });
  return context.newPage();
}

async function signUp(
  browser: Browser,
  who: { name: string; email: string; phone: string },
  tick: (keyof typeof LABELS)[],
  options: { other?: string; untickOtherAfterTyping?: boolean; shot?: string } = {},
) {
  const page = await freshPage(browser);
  // Settled first: typing before the form's script has started is undone
  // when it does, which no person is quick enough to hit.
  await page.goto(`${BASE}/register`, { waitUntil: 'networkidle' });
  await page.fill('#name', who.name);
  await page.fill('#email', who.email);
  await page.fill('#phone', who.phone);
  await page.fill('#password', PASSWORD);
  await page.fill('#confirmPassword', PASSWORD);

  for (const code of tick) await page.getByLabel(LABELS[code], { exact: true }).click();
  if (options.other !== undefined) await page.fill('#heardAboutOther', options.other);
  if (options.untickOtherAfterTyping) await page.getByLabel(LABELS.OTHER, { exact: true }).click();

  await page.locator('#acceptTerms').click();
  if (options.shot && SHOTS) await page.screenshot({ path: `${SHOTS}/${options.shot}.png`, fullPage: true });
  await page.getByRole('button', { name: 'Create account' }).click();
  try {
    await page.waitForURL((url) => !url.pathname.startsWith('/register'), { timeout: 30_000 });
  } catch {
    // Say why, rather than only that it timed out.
    const messages = await page.locator('.text-destructive, [role="alert"]').allInnerTexts();
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/heard-stuck-${who.phone}.png`, fullPage: true });
    console.log(`  !! sign-up for ${who.name} stayed on the form: ${messages.join(' | ') || '(no message shown)'}`);
  }

  const stored = await db.user.findUnique({
    where: { emailNormal: who.email },
    select: { id: true, heardAboutJson: true, heardAboutOther: true },
  });
  await page.context().close();
  return stored;
}

async function visible(page: Page, path: string): Promise<string> {
  await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' });
  return page.locator('body').innerText();
}

/** The text of one user's row on the admin list. */
async function rowOf(page: Page, name: string): Promise<string | null> {
  const row = page.locator('li', { has: page.getByRole('link', { name, exact: true }) });
  return (await row.count()) > 0 ? row.first().innerText() : null;
}

async function main() {
  await db.user.deleteMany({ where: { emailNormal: { startsWith: PREFIX } } });
  const browser = await chromium.launch();
  // Letters, not digits: a name may not contain numbers.
  const stamp = Date.now().toString().slice(-6).replace(/\d/g, (d) => 'abcdefghij'[Number(d)]!);
  const people = {
    a: { name: `Heard Telegram YouTube ${stamp}`, email: `${PREFIX}a${stamp}@avk.test`, phone: '9000000011' },
    b: { name: `Heard Other Friend ${stamp}`, email: `${PREFIX}b${stamp}@avk.test`, phone: '9000000012' },
    c: { name: `Heard Nothing ${stamp}`, email: `${PREFIX}c${stamp}@avk.test`, phone: '9000000013' },
    d: { name: `Heard Unticked ${stamp}`, email: `${PREFIX}d${stamp}@avk.test`, phone: '9000000014' },
  };

  try {
    // =====================================================================
    console.log('\n1. The sign-up form');
    const form = await freshPage(browser);
    await form.goto(`${BASE}/register`, { waitUntil: 'networkidle' });
    const fieldset = form.getByRole('group', { name: 'How did you hear about us?' });
    check((await fieldset.count()) === 1, 'shows "How did you hear about us?"');
    for (const label of Object.values(LABELS)) {
      check((await form.getByLabel(label, { exact: true }).count()) === 1, `offers "${label}"`);
    }
    check((await form.locator('#heardAboutOther').count()) === 0, 'no "Other" box until Other is ticked');
    await form.getByLabel(LABELS.OTHER, { exact: true }).click();
    check(await form.locator('#heardAboutOther').isVisible(), 'ticking Other reveals the box');
    await form.getByLabel(LABELS.OTHER, { exact: true }).click();
    check((await form.locator('#heardAboutOther').count()) === 0, 'unticking Other hides it again');
    await form.context().close();

    // =====================================================================
    console.log('\n2. Four students sign up through the form');
    const a = await signUp(browser, people.a, ['TELEGRAM_TARGET_GROUPS', 'YOUTUBE'], { shot: 'heard-form-filled' });
    check(a?.heardAboutJson === '["TELEGRAM_TARGET_GROUPS","YOUTUBE"]', 'A: TARGET groups + YouTube stored', a?.heardAboutJson ?? 'no user');
    check(a?.heardAboutOther === null, 'A: no "Other" words');

    const b = await signUp(browser, people.b, ['OTHER'], { other: '  A friend at my coaching centre ' });
    check(b?.heardAboutJson === '["OTHER"]', 'B: Other stored', b?.heardAboutJson ?? 'no user');
    check(b?.heardAboutOther === 'A friend at my coaching centre', 'B: their words stored, trimmed', String(b?.heardAboutOther));

    const c = await signUp(browser, people.c, []);
    check(c?.heardAboutJson === '[]', 'C: ticked nothing — stored as asked-and-skipped', c?.heardAboutJson ?? 'no user');

    const d = await signUp(browser, people.d, ['OTHER'], { other: 'typed then changed my mind', untickOtherAfterTyping: true });
    check(d?.heardAboutJson === '[]' && d?.heardAboutOther === null, 'D: Other unticked — the typed words are not kept', `${d?.heardAboutJson} / ${d?.heardAboutOther}`);

    // =====================================================================
    console.log('\n3. The API refuses an option that is not on the form');
    const api = await freshPage(browser);
    const bad = await api.request.post(`${BASE}/api/auth/register`, {
      data: {
        name: 'Bad Option',
        email: `${PREFIX}bad${stamp}@avk.test`,
        phone: '9000000015',
        password: PASSWORD,
        confirmPassword: PASSWORD,
        acceptTerms: true,
        heardAbout: ['INSTAGRAM'],
      },
    });
    check(bad.status() === 422, 'unknown option refused', String(bad.status()));
    check((await db.user.count({ where: { emailNormal: `${PREFIX}bad${stamp}@avk.test` } })) === 0, 'and no account created');
    await api.context().close();

    // =====================================================================
    console.log('\n4. The admin sees every answer');
    const adminCtx = await browser.newContext({ viewport: { width: 1280, height: 1100 } });
    check((await adminCtx.request.post(`${BASE}/api/auth/login`, { data: ADMIN })).ok(), 'admin signs in');
    const admin = await adminCtx.newPage();

    await visible(admin, '/admin/users');
    const rowA = await rowOf(admin, people.a.name);
    check(Boolean(rowA?.includes('Heard about us:') && rowA.includes('TARGET Telegram groups') && rowA.includes('YouTube')), 'A\'s row: TARGET Telegram groups, YouTube', rowA?.split('\n').find((l) => l.includes('Heard')) ?? '');
    const rowB = await rowOf(admin, people.b.name);
    check(Boolean(rowB?.includes('Other — “A friend at my coaching centre”')), 'B\'s row: Other — their words');
    const rowC = await rowOf(admin, people.c.name);
    check(Boolean(rowC?.includes('Heard about us:') && rowC.includes('didn’t say')), 'C\'s row: didn’t say');
    if (SHOTS) await admin.screenshot({ path: `${SHOTS}/heard-admin-users.png` });

    // The summary counts everyone asked, whatever page they are on.
    const asked = await db.user.findMany({
      where: { deletedAt: null, role: 'STUDENT', heardAboutJson: { not: null } },
      select: { heardAboutJson: true },
    });
    const answered = asked.filter((u) => u.heardAboutJson !== '[]').length;
    const youtube = asked.filter((u) => u.heardAboutJson!.includes('"YOUTUBE"')).length;
    const summary = admin.locator('div', { has: admin.getByRole('heading', { name: 'How students heard about us' }) }).last();
    const summaryText = (await summary.innerText()).replace(/\s+/g, ' ');
    check(summaryText.includes(`${answered} of ${asked.length} students`), 'summary: answered of asked', summaryText.slice(0, 120));
    const youtubeTile = (await admin.getByRole('link', { name: /^YouTube/ }).first().innerText()).replace(/\s+/g, ' ');
    check(youtubeTile.startsWith(`YouTube ${youtube}`), 'summary: YouTube count', youtubeTile);

    const onlyYoutube = await visible(admin, '/admin/users?heard=YOUTUBE');
    check(onlyYoutube.includes(people.a.name) && !onlyYoutube.includes(people.b.name) && !onlyYoutube.includes(people.c.name), 'filter YouTube: only A');
    const onlyOther = await visible(admin, '/admin/users?heard=OTHER');
    check(onlyOther.includes(people.b.name) && !onlyOther.includes(people.a.name), 'filter Other: only B');
    const none = await visible(admin, '/admin/users?heard=NONE');
    check(none.includes(people.c.name) && none.includes(people.d.name) && !none.includes(people.a.name), 'filter Didn’t say: C and D');

    // Clicking a summary tile filters too.
    await visible(admin, '/admin/users');
    await admin.getByRole('link', { name: /^TARGET Telegram groups/ }).first().click();
    await admin.waitForURL(/heard=TELEGRAM_TARGET_GROUPS/);
    const viaTile = await admin.locator('body').innerText();
    check(viaTile.includes(people.a.name) && !viaTile.includes(people.c.name), 'summary tile filters the list');

    // An account from before the question existed shows no line at all.
    const old = await db.user.findFirst({
      where: { role: 'STUDENT', heardAboutJson: null, deletedAt: null, signupSource: 'REGISTERED' },
      select: { name: true, email: true },
    });
    if (old) {
      await visible(admin, `/admin/users?q=${encodeURIComponent(old.email)}`);
      const oldRow = await rowOf(admin, old.name);
      check(oldRow !== null && !oldRow.includes('Heard about us'), 'an older account shows no answer line');
    }

    const detail = await visible(admin, `/admin/users/${a!.id}`);
    check(detail.includes('Heard about us:') && detail.includes('TARGET Telegram groups') && detail.includes('YouTube'), 'A\'s own admin page shows the answer');

    await adminCtx.close();
  } finally {
    await browser.close();
    const made = await db.user.deleteMany({ where: { emailNormal: { startsWith: PREFIX } } });
    console.log(`\n  cleaned up ${made.count} test account(s)`);
    await db.$disconnect();
  }

  console.log(`\n${passed} passed, ${failed} failed\n`);
}

main().catch(async (error) => {
  console.error(error);
  process.exitCode = 1;
  await db.$disconnect();
});
