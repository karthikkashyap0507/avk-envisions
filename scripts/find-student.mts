/**
 * Everything the database knows about one student, by email or phone.
 *
 * Read-only. Nothing is written, so it is safe to run against production.
 *
 *   npx tsx scripts/find-student.mts ashwinikattimani42@gmail.com 9686640120
 *
 * Written for the case where a payment and a login belong to different rows.
 * Taking a free test creates a guest account keyed to the phone number, with
 * an undeliverable `@guest.invalid` address and no usable password; if a later
 * payment attaches to that account rather than the one the student signs in
 * with, the entitlement is real but unreachable. Granting access to either
 * address alone does not fix that, so look before granting.
 */
import { PrismaClient } from '@prisma/client';

const db = new PrismaClient();

/** Last ten digits, so "+91 98765 43210" and "9876543210" compare equal. */
function phoneKey(value: string | null | undefined): string {
  return (value ?? '').replace(/\D/g, '').slice(-10);
}

async function main() {
  const terms = process.argv.slice(2);

  if (terms.length === 0) {
    console.error('Usage: npx tsx scripts/find-student.mts <email-or-phone> [more...]');
    process.exitCode = 1;
    return;
  }

  const emails = terms.filter((t) => t.includes('@')).map((t) => t.trim().toLowerCase());
  const phones = terms.filter((t) => !t.includes('@')).map(phoneKey).filter(Boolean);

  // `emailNormal` is the lowercased copy the schema keeps for exactly this,
  // since SQLite cannot do a case-insensitive `equals`.
  const byEmail = emails.length
    ? await db.user.findMany({ where: { emailNormal: { in: emails } }, select: { id: true } })
    : [];

  // Phone is not unique, so one person can hold several rows: a guest account
  // from the free test and a registered account from signing up properly.
  const byPhone = phones.length
    ? (await db.user.findMany({ where: { phone: { not: null } }, select: { id: true, phone: true } }))
        .filter((row) => phones.includes(phoneKey(row.phone)))
    : [];

  const ids = [...new Set([...byEmail, ...byPhone].map((row) => row.id))];

  if (ids.length === 0) {
    console.log('No account matches those terms.');
    return;
  }

  const users = await db.user.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      role: true,
      status: true,
      signupSource: true,
      passwordHash: true,
      emailVerified: true,
      deletedAt: true,
      createdAt: true,
      entitlements: {
        select: {
          sourceType: true,
          startsAt: true,
          expiresAt: true,
          revokedAt: true,
          testSeries: { select: { slug: true, name: true } },
        },
      },
      orders: {
        select: {
          orderNumber: true,
          status: true,
          totalInPaise: true,
          paidAt: true,
          createdAt: true,
          billingEmail: true,
          billingPhone: true,
          // What was bought lives on the items, not the order.
          items: { select: { productName: true, testSeries: { select: { slug: true } } } },
        },
      },
    },
  });

  console.log(`${users.length} account(s) found.\n`);

  const now = new Date();

  for (const user of users) {
    console.log('='.repeat(64));
    console.log(`${user.name}  <${user.email}>`);
    console.log(`  id         : ${user.id}`);
    console.log(`  phone      : ${user.phone ?? '—'}`);
    console.log(`  role       : ${user.role}    status: ${user.status}`);
    console.log(`  signup     : ${user.signupSource}`);
    console.log(`  created    : ${user.createdAt.toISOString().slice(0, 10)}`);
    if (user.deletedAt) console.log('  DELETED    : yes');

    // The two reasons a correct entitlement still leaves someone locked out.
    const guestAddress = user.email.endsWith('@guest.invalid');
    if (guestAddress) {
      console.log('  NOTE       : guest address — undeliverable, cannot receive a reset link.');
    }
    if (!user.passwordHash) {
      console.log('  NOTE       : no password set — this account cannot be signed into.');
    }

    console.log(`  orders     : ${user.orders.length}`);
    for (const order of user.orders) {
      const rupees = (order.totalInPaise / 100).toFixed(2);
      const when = (order.paidAt ?? order.createdAt).toISOString().slice(0, 10);
      const what = order.items.map((item) => item.testSeries?.slug ?? item.productName).join(', ');
      console.log(`    - ${order.status.padEnd(9)} ₹${rupees.padStart(8)}  ${what}  (${when})`);
      console.log(`      ${order.orderNumber}`);

      // The billing address is where the student's real email often is, even
      // when the account itself carries the minted guest one.
      if (order.billingEmail && order.billingEmail.toLowerCase() !== user.email.toLowerCase()) {
        console.log(`      billed to: ${order.billingEmail}`);
      }
    }

    console.log(`  access     : ${user.entitlements.length}`);
    for (const row of user.entitlements) {
      const live =
        !row.revokedAt &&
        row.startsAt <= now &&
        (row.expiresAt === null || row.expiresAt > now);
      console.log(
        `    - ${live ? 'LIVE   ' : 'not live'} ${row.testSeries?.name ?? '—'} ` +
          `(${row.sourceType}${row.revokedAt ? ', revoked' : ''})`,
      );
    }
    console.log('');
  }

  if (users.length > 1) {
    console.log('='.repeat(64));
    console.log('More than one account matched — likely the same person twice.');
    console.log('Check which one holds the paid order, and which one they sign in with.');
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
