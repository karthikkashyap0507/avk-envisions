/**
 * Sets a student's password by hand, by email.
 *
 * For a student who has forgotten their password and cannot get in through
 * "Forgot password". The admin panel has no control for this, so this script
 * is the supported route. It does what a completed reset does: replaces the
 * password, signs the account out everywhere, voids any outstanding reset
 * link and writes the audit log.
 *
 *   npx tsx scripts/reset-password.mts <email> <new-password>
 *
 * Run it on the VM, where the production database lives:
 *
 *   cd /opt/avkvisions
 *   sudo -u avk npx tsx scripts/reset-password.mts student@example.com 'Test@1234'
 *
 * Quote the password: the shell reads an unquoted $, ! or space.
 *
 * The site's password rules are not applied - an admin setting a temporary
 * password is trusted to - so ask the student to change it from Settings once
 * they are in. Safe to re-run.
 */
import { hash, verify } from '@node-rs/argon2';
import { PrismaClient } from '@prisma/client';

const db = new PrismaClient();

/**
 * The settings in src/server/auth/password.ts, which is server-only and cannot
 * be imported here. Sign-in reads the parameters back out of the hash, so a
 * drift would weaken new hashes, never lock anyone out.
 */
const ARGON2_OPTIONS = { memoryCost: 19_456, timeCost: 2, parallelism: 1, outputLen: 32 } as const;

/** The sign-in lockout in src/server/services/auth-service.ts. */
const LOCKOUT_WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILED_ATTEMPTS = 8;

/** When `key` (an email or ten-digit number) stops being locked out, or null if it is not. */
async function lockedUntil(key: string): Promise<Date | null> {
  const since = new Date(Date.now() - LOCKOUT_WINDOW_MS);
  const lastSuccess = await db.loginAttempt.findFirst({
    where: { emailNormal: key, successful: true, createdAt: { gte: since } },
    orderBy: { createdAt: 'desc' },
    select: { createdAt: true },
  });
  const failures = await db.loginAttempt.findMany({
    where: { emailNormal: key, successful: false, createdAt: { gte: lastSuccess?.createdAt ?? since } },
    orderBy: { createdAt: 'desc' },
    select: { createdAt: true },
  });
  if (failures.length < MAX_FAILED_ATTEMPTS) return null;
  return new Date(failures[0]!.createdAt.getTime() + LOCKOUT_WINDOW_MS);
}

async function main() {
  const [email, password] = process.argv.slice(2);

  if (!email || !password) {
    console.error('Usage: npx tsx scripts/reset-password.mts <email> <new-password>');
    process.exitCode = 1;
    return;
  }

  // Looked up on `emailNormal`, the lowercased copy: Prisma's case-insensitive
  // mode does nothing on SQLite.
  const user = await db.user.findFirst({
    where: { emailNormal: email.trim().toLowerCase(), deletedAt: null },
    select: { id: true, name: true, email: true, phone: true, status: true, role: true },
  });

  if (!user) {
    console.error(`No account found for ${email}.`);
    console.error('Check the address on the admin Users page - a typo here changes nobody.');
    process.exitCode = 1;
    return;
  }

  console.log(`Account : ${user.name} <${user.email}>`);
  console.log(`Phone   : ${user.phone ?? '(none)'}`);
  console.log(`Role    : ${user.role}`);
  console.log(`Status  : ${user.status}`);

  if (user.status === 'SUSPENDED' || user.status === 'DELETED') {
    console.warn(`\n  WARNING: this account is ${user.status}. The password will be set, but`);
    console.warn('  they cannot sign in until it is reactivated on the admin Users page.');
  }

  // Signing in with a number opens the newest registered account holding it.
  // When that is another account, this password is not the one it checks.
  let numberOpensThisAccount = Boolean(user.phone);
  if (user.phone) {
    const byPhone = await db.user.findFirst({
      where: { phone: user.phone, deletedAt: null, signupSource: 'REGISTERED' },
      orderBy: { createdAt: 'desc' },
      select: { id: true, email: true },
    });
    if (byPhone && byPhone.id !== user.id) {
      numberOpensThisAccount = false;
      console.warn(`\n  WARNING: signing in with ${user.phone} opens a different account, ${byPhone.email}.`);
      console.warn(`  Tell them to sign in with ${user.email} instead of the number.`);
    }
  }

  const passwordHash = await hash(password, ARGON2_OPTIONS);
  const now = new Date();

  await db.$transaction([
    // The epoch bump ends every session at once, as a completed reset does.
    db.user.update({
      where: { id: user.id },
      data: { passwordHash, sessionEpoch: { increment: 1 } },
    }),
    db.session.updateMany({
      where: { userId: user.id, revokedAt: null },
      data: { revokedAt: now },
    }),
    // An old emailed link must not be able to change it again afterwards.
    db.passwordResetToken.updateMany({
      where: { userId: user.id, usedAt: null },
      data: { usedAt: now },
    }),
    // Never the password itself.
    db.auditLog.create({
      data: {
        action: 'user.password_set_by_admin',
        entityType: 'User',
        entityId: user.id,
        metaJson: JSON.stringify({ email: user.email, via: 'scripts/reset-password.mts' }),
      },
    }),
  ]);

  // Read back and check it the way sign-in does: the only proof it works.
  const stored = await db.user.findUniqueOrThrow({
    where: { id: user.id },
    select: { passwordHash: true },
  });
  if (!(await verify(stored.passwordHash, password))) {
    console.error('\nFAILED: the stored password does not match. Nothing they type will work; re-run.');
    process.exitCode = 1;
    return;
  }

  console.log(`\nPassword set to: ${password}`);

  for (const key of [user.email.toLowerCase(), ...(user.phone ? [user.phone] : [])]) {
    const until = await lockedUntil(key);
    if (until) {
      console.warn(`\n  NOTE: too many wrong tries on ${key}. Sign-in with it opens again at`);
      console.warn(`  ${until.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' })} IST; until then it says to wait 15 minutes.`);
    }
  }

  console.log(
    `\nDone. They can sign in with ${numberOpensThisAccount ? 'their email or number' : 'their email'} and this password.`,
  );
  console.log('Ask them to change it under Settings once they are in.');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
