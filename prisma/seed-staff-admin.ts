/**
 * A second admin account that runs everything except users and orders.
 *
 * Holds the ADMIN role, so every permission by default, with the Users group
 * and the order, payment and revenue permissions revoked for this one account
 * through `UserPermission`. Revocations are per user: no other admin is
 * touched, and the original admin keeps full access.
 *
 * Runs on every deploy and is safe to repeat. It only ever touches the
 * account it created itself — marked by `signupSource: 'STAFF_SEED'` — and
 * refuses to act on any other, so pointing EMAIL at an existing admin by
 * mistake changes nothing. On later runs it re-applies the restrictions but
 * never resets the password, role or status, so a changed password or a
 * deliberate suspension is not undone by the next deploy.
 *
 * Only the argon2 hash of the password lives here, never the password.
 *
 *   npx tsx prisma/seed-staff-admin.ts
 */
import { PrismaClient } from '@prisma/client';

import { PERMISSIONS, type Permission } from '../src/server/auth/permissions';

const db = new PrismaClient();

const EMAIL = 'staff@avkenvisions.com';
const NAME = 'AVK Staff Admin';
const SOURCE = 'STAFF_SEED';
const PASSWORD_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$9L+gfutswyIUdEr3GsIryQ$A1BvyvC4LAbB9neXynB/9GhrneI4pt8PVTCnBhfmdUg';

/** Everything to do with users, and with orders and the money they carry. */
const REVOKED: Permission[] = [
  PERMISSIONS.USER_READ,
  PERMISSIONS.USER_CREATE,
  PERMISSIONS.USER_UPDATE,
  PERMISSIONS.USER_SUSPEND,
  PERMISSIONS.USER_DELETE,
  PERMISSIONS.USER_ASSIGN_ROLE,
  PERMISSIONS.USER_GRANT_ACCESS,
  PERMISSIONS.SESSION_REVOKE_ANY,
  PERMISSIONS.ADMIN_MANAGE,
  PERMISSIONS.ORDER_READ,
  PERMISSIONS.ORDER_REFUND,
  PERMISSIONS.PAYMENT_READ,
  PERMISSIONS.ANALYTICS_FINANCIAL,
];

async function main() {
  const emailNormal = EMAIL.toLowerCase();

  const existing = await db.user.findUnique({
    where: { emailNormal },
    select: { id: true, signupSource: true },
  });

  if (existing && existing.signupSource !== SOURCE) {
    console.log(`  --  ${EMAIL} is an account this script did not create; left untouched`);
    return;
  }

  const user =
    existing ??
    (await db.user.create({
      data: {
        name: NAME,
        email: EMAIL,
        emailNormal,
        role: 'ADMIN',
        status: 'ACTIVE',
        signupSource: SOURCE,
        passwordHash: PASSWORD_HASH,
        emailVerified: new Date(),
      },
      select: { id: true, signupSource: true },
    }));

  // The permission rows the revocations point at. The base seed creates them;
  // made sure of here so this script never depends on having run after it.
  for (const key of REVOKED) {
    const [category] = key.split('.');
    const permission = await db.permission.upsert({
      where: { key },
      update: {},
      create: {
        key,
        label: key.replace(/[._]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
        category: category ?? 'general',
      },
      select: { id: true },
    });

    // Scoped to this account's id — the only user this script writes for.
    await db.userPermission.upsert({
      where: { userId_permissionId: { userId: user.id, permissionId: permission.id } },
      update: { granted: false },
      create: { userId: user.id, permissionId: permission.id, granted: false },
    });
  }

  console.log(
    `  ok  ${EMAIL} ${existing ? 'exists' : 'created'}; ${REVOKED.length} permissions revoked (users, orders)`,
  );
}

main()
  .catch((error) => {
    console.error('\nFailed:\n', error?.message ?? error);
    process.exitCode = 1;
  })
  .finally(async () => db.$disconnect());
