/**
 * Gets a student who paid into the series they paid for — whatever went wrong.
 *
 *   npx tsx scripts/fix-student-access.mts <email> <phone> <slug> [more-slugs...]
 *
 * On the VM:
 *
 *   cd /opt/avkvisions && git pull
 *   sudo -u avk npx tsx scripts/fix-student-access.mts \
 *     ashwinikattimani42@gmail.com 9686640120 \
 *     kas-prelims-paid-test-series kas-50-questions-50-days
 *
 * Works through the cases that leave a paying student locked out:
 *
 *   - The entitlement was never written though the order exists. Grant it.
 *   - The payment landed on the guest account the free-test flow minted against
 *     their phone number, while they sign in with their real address. That
 *     account has no usable password and an undeliverable @guest.invalid
 *     address, so access sitting on it is unreachable. Grant to the account
 *     they can actually sign into, and carry any orders across so the history
 *     is not stranded.
 *   - They have no real account at all, only the guest one. Rename it to the
 *     address they gave, so a password reset can reach them, and grant there.
 *   - The entitlement exists but is revoked or expired. Revive it.
 *
 * Safe to re-run: every write is an upsert or a no-op on a row already right.
 * Prints what it found, what it changed, and a verification read from the
 * database afterwards — exiting non-zero if the student still lacks access.
 */
import { PrismaClient } from '@prisma/client';

const db = new PrismaClient();

const GUEST_DOMAIN = '@guest.invalid';
const REASON = 'Paid for but access not received; repaired by hand.';

function phoneKey(value: string | null | undefined): string {
  return (value ?? '').replace(/\D/g, '').slice(-10);
}

interface Candidate {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  status: string;
  passwordHash: string | null;
  createdAt: Date;
  orderCount: number;
}

/** The account the student can actually sign into, if there is one. */
function pickLoginAccount(candidates: Candidate[], wantedEmail: string): Candidate | undefined {
  const real = candidates.filter((c) => !c.email.endsWith(GUEST_DOMAIN));
  return (
    real.find((c) => c.email.toLowerCase() === wantedEmail) ??
    // Falls back to any non-guest account on that phone: they may have
    // registered with a different address than the one you were given.
    real.sort((a, b) => b.orderCount - a.orderCount || +a.createdAt - +b.createdAt)[0]
  );
}

async function liveAccess(userId: string) {
  const now = new Date();
  return db.entitlement.findMany({
    where: {
      userId,
      revokedAt: null,
      startsAt: { lte: now },
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    },
    select: { sourceType: true, testSeries: { select: { slug: true, name: true } } },
  });
}

async function main() {
  const [email, phone, ...slugs] = process.argv.slice(2);

  if (!email || !phone || slugs.length === 0) {
    console.error(
      'Usage: npx tsx scripts/fix-student-access.mts <email> <phone> <slug> [more-slugs...]',
    );
    process.exitCode = 1;
    return;
  }

  const wantedEmail = email.trim().toLowerCase();
  const wantedPhone = phoneKey(phone);

  // Both keys, because the whole problem is that they can name different rows.
  const withPhone = await db.user.findMany({
    where: { deletedAt: null, phone: { not: null } },
    select: { id: true, phone: true },
  });
  const phoneIds = withPhone.filter((u) => phoneKey(u.phone) === wantedPhone).map((u) => u.id);

  const emailMatch = await db.user.findFirst({
    where: { emailNormal: wantedEmail, deletedAt: null },
    select: { id: true },
  });

  const ids = [...new Set([...phoneIds, ...(emailMatch ? [emailMatch.id] : [])])];

  if (ids.length === 0) {
    console.error(`No account matches ${email} or ${phone}.`);
    console.error('Nothing was changed. Check both on the admin Users page.');
    process.exitCode = 1;
    return;
  }

  const rows = await db.user.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      status: true,
      passwordHash: true,
      createdAt: true,
      _count: { select: { orders: true } },
    },
  });

  const candidates: Candidate[] = rows.map((r) => ({
    id: r.id,
    name: r.name,
    email: r.email,
    phone: r.phone,
    status: r.status,
    passwordHash: r.passwordHash,
    createdAt: r.createdAt,
    orderCount: r._count.orders,
  }));

  console.log(`Found ${candidates.length} account(s):\n`);
  for (const c of candidates) {
    const kind = c.email.endsWith(GUEST_DOMAIN) ? 'GUEST' : 'real';
    const access = await liveAccess(c.id);
    console.log(`  [${kind}] ${c.name} <${c.email}>`);
    console.log(`         status ${c.status} · ${c.orderCount} order(s) · ${access.length} live access`);
    if (!c.passwordHash) console.log('         no password set');
  }

  let target = pickLoginAccount(candidates, wantedEmail);
  const guests = candidates.filter((c) => c.email.endsWith(GUEST_DOMAIN));

  // No account they can sign into. Rather than granting onto a dead guest row,
  // give it the real address so a password reset can reach them — their
  // attempts and history come with it, because it is the same row.
  if (!target && guests.length > 0) {
    const guest = guests.sort((a, b) => b.orderCount - a.orderCount)[0];
    const clash = await db.user.findFirst({
      where: { emailNormal: wantedEmail, NOT: { id: guest.id } },
      select: { id: true },
    });

    if (clash) {
      console.error('\nA different account already holds that address. Not renaming.');
      process.exitCode = 1;
      return;
    }

    console.log(`\nNo signable account. Moving the guest account to ${email}.`);
    await db.user.update({
      where: { id: guest.id },
      data: { email: email.trim(), emailNormal: wantedEmail },
    });
    target = { ...guest, email: email.trim() };
    console.log('  Ask them to use "forgot password" to set one.');
  }

  if (!target) {
    console.error('\nCould not decide which account to grant to. Nothing changed.');
    process.exitCode = 1;
    return;
  }

  console.log(`\nGranting to: ${target.name} <${target.email}>`);

  // Orders stranded on a guest account are moved across, so the student's
  // history and the access they hold describe the same person.
  for (const guest of guests) {
    if (guest.id === target.id) continue;
    const moved = await db.order.updateMany({
      where: { userId: guest.id },
      data: { userId: target.id },
    });
    if (moved.count > 0) {
      console.log(`  Moved ${moved.count} order(s) from ${guest.email}.`);
    }
  }

  let failed = false;

  for (const slug of slugs) {
    const series = await db.testSeries.findFirst({
      where: { slug, deletedAt: null },
      select: { id: true, name: true },
    });

    if (!series) {
      console.error(`  SKIPPED ${slug} — no such series.`);
      failed = true;
      continue;
    }

    // Revive anything already there but revoked or expired, on any source
    // type: a PURCHASE row that was revoked in error should come back as
    // itself rather than be shadowed by a second ADMIN_GRANT row.
    const revived = await db.entitlement.updateMany({
      where: {
        userId: target.id,
        testSeriesId: series.id,
        OR: [{ revokedAt: { not: null } }, { expiresAt: { lt: new Date() } }],
      },
      data: { revokedAt: null, expiresAt: null, note: REASON },
    });

    await db.$transaction(async (tx) => {
      await tx.entitlement.upsert({
        where: {
          userId_testSeriesId_sourceType: {
            userId: target!.id,
            testSeriesId: series.id,
            sourceType: 'ADMIN_GRANT',
          },
        },
        create: {
          userId: target!.id,
          testSeriesId: series.id,
          sourceType: 'ADMIN_GRANT',
          startsAt: new Date(),
          expiresAt: null,
          note: REASON,
        },
        update: { revokedAt: null, expiresAt: null, note: REASON },
      });

      await tx.auditLog.create({
        data: {
          action: 'user.access_granted',
          entityType: 'Entitlement',
          entityId: target!.id,
          metaJson: JSON.stringify({
            email: target!.email,
            phone: wantedPhone,
            seriesSlug: slug,
            revivedExisting: revived.count,
            reason: REASON,
            via: 'scripts/fix-student-access.mts',
          }),
        },
      });
    });

    console.log(`  GRANTED ${series.name}`);
  }

  // The only line that matters: read back what the student can now see.
  console.log('\nVerifying against the database:');
  const after = await liveAccess(target.id);
  for (const row of after) {
    console.log(`  LIVE  ${row.testSeries?.name} (${row.sourceType})`);
  }

  const missing = slugs.filter((s) => !after.some((r) => r.testSeries?.slug === s));
  if (missing.length > 0 || failed) {
    console.error(`\nFAILED: no live access to ${missing.join(', ') || '(see above)'}.`);
    process.exitCode = 1;
    return;
  }

  if (target.status !== 'ACTIVE') {
    console.warn(`\nAccess is correct, but the account is ${target.status} and cannot sign in.`);
    process.exitCode = 1;
    return;
  }

  console.log(`\nDone. ${target.email} has access to all ${slugs.length} series.`);
  if (!target.passwordHash) {
    console.log('They have no password yet — send them through "forgot password" first.');
  } else {
    console.log('Ask them to sign out and back in.');
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
