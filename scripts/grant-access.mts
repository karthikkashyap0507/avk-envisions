/**
 * Grants a student access to one or more test series, by email.
 *
 * For access that was paid for but never landed — payment taken outside the
 * site, or a checkout that completed without writing the entitlement. The
 * admin panel has no control for this yet: the Orders page points at "the
 * Users page", but no grant exists there, so until one does this script is the
 * supported route.
 *
 *   npx tsx scripts/grant-access.mts <email> <series-slug> [more-slugs...]
 *
 * Run it on the VM, where the production database lives:
 *
 *   cd /opt/avkvisions
 *   sudo -u avk npx tsx scripts/grant-access.mts student@example.com \
 *     kas-prelims-paid-test-series kas-50-questions-50-days
 *
 * Safe to re-run. Access is upserted on (userId, testSeriesId, sourceType), so
 * granting twice updates the existing row rather than creating a duplicate or
 * failing. A previously revoked grant is un-revoked.
 *
 * Every grant is written to the audit log as user.access_granted, with the
 * reason, so there is a record of access that no payment row explains.
 */
import { PrismaClient } from '@prisma/client';

const db = new PrismaClient();

/** Reads back what the student can actually see, the same way the app does. */
async function liveEntitlements(userId: string) {
  const now = new Date();
  return db.entitlement.findMany({
    where: {
      userId,
      revokedAt: null,
      startsAt: { lte: now },
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    },
    select: {
      sourceType: true,
      startsAt: true,
      expiresAt: true,
      note: true,
      testSeries: { select: { slug: true, name: true } },
    },
  });
}

async function main() {
  const [email, ...slugs] = process.argv.slice(2);

  if (!email || slugs.length === 0) {
    console.error(
      'Usage: npx tsx scripts/grant-access.mts <email> <series-slug> [more-slugs...]',
    );
    process.exitCode = 1;
    return;
  }

  // Matched case-insensitively, because the address you are given is rarely
  // typed the way the student typed it at sign-up. Prisma's `mode:
  // 'insensitive'` is a PostgreSQL feature and does nothing on SQLite, so the
  // comparison is done in JS over the candidates instead.
  const wanted = email.trim().toLowerCase();
  const candidates = await db.user.findMany({
    where: { deletedAt: null },
    select: { id: true, name: true, email: true, status: true, role: true },
  });
  const user = candidates.find((row) => row.email.trim().toLowerCase() === wanted);

  if (!user) {
    console.error(`No account found for ${email}.`);
    console.error('Check the address on the admin Users page — a typo here grants nobody.');
    process.exitCode = 1;
    return;
  }

  console.log(`Student : ${user.name} <${user.email}>`);
  console.log(`Status  : ${user.status}`);

  // A suspended account holds entitlements but cannot sign in, so granting
  // access to one looks successful and changes nothing the student can see.
  if (user.status !== 'ACTIVE') {
    console.warn(`\n  WARNING: this account is ${user.status}, not ACTIVE.`);
    console.warn('  Access will be granted, but they cannot sign in until it is reactivated.');
  }

  console.log('\nBefore:');
  const before = await liveEntitlements(user.id);
  if (before.length === 0) console.log('  (no access to anything)');
  for (const row of before) {
    console.log(`  - ${row.testSeries?.name ?? 'unknown'} (${row.sourceType})`);
  }

  console.log('');

  for (const slug of slugs) {
    const series = await db.testSeries.findFirst({
      where: { slug, deletedAt: null },
      select: { id: true, name: true },
    });

    if (!series) {
      console.error(`  SKIPPED ${slug} — no such series. Nothing was granted for it.`);
      process.exitCode = 1;
      continue;
    }

    // Upsert rather than create: re-running must not fail, and a grant that
    // was revoked earlier should come back rather than sit dead beside a new
    // row it conflicts with on the unique key.
    await db.$transaction(async (tx) => {
      await tx.entitlement.upsert({
        where: {
          userId_testSeriesId_sourceType: {
            userId: user.id,
            testSeriesId: series.id,
            sourceType: 'ADMIN_GRANT',
          },
        },
        create: {
          userId: user.id,
          testSeriesId: series.id,
          sourceType: 'ADMIN_GRANT',
          startsAt: new Date(),
          expiresAt: null,
          note: 'Paid for but access not received; granted by hand.',
        },
        update: {
          revokedAt: null,
          expiresAt: null,
          note: 'Paid for but access not received; granted by hand.',
        },
      });

      await tx.auditLog.create({
        data: {
          action: 'user.access_granted',
          entityType: 'Entitlement',
          entityId: user.id,
          metaJson: JSON.stringify({
            email: user.email,
            seriesSlug: slug,
            seriesName: series.name,
            sourceType: 'ADMIN_GRANT',
            reason: 'Paid for but access not received; granted by hand.',
            via: 'scripts/grant-access.mts',
          }),
        },
      });
    });

    console.log(`  GRANTED ${series.name}  (${slug})`);
  }

  // Read back from the database rather than trusting the writes above: this is
  // the only line that proves the student can now see the series.
  console.log('\nAfter:');
  const after = await liveEntitlements(user.id);
  if (after.length === 0) console.log('  (no access to anything)');
  for (const row of after) {
    const until = row.expiresAt ? `until ${row.expiresAt.toISOString().slice(0, 10)}` : 'no expiry';
    console.log(`  - ${row.testSeries?.name ?? 'unknown'} (${row.sourceType}, ${until})`);
  }

  const missing = slugs.filter((slug) => !after.some((row) => row.testSeries?.slug === slug));
  if (missing.length > 0) {
    console.error(`\nFAILED: still no live access to ${missing.join(', ')}.`);
    process.exitCode = 1;
    return;
  }

  console.log('\nDone. Ask them to sign out and back in, then open the series.');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
