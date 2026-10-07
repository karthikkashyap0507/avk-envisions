import type { Metadata } from 'next';
import { KeyRound, Receipt, Webhook } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { StatCard } from '@/components/ui/stat-card';
import { EmptyState } from '@/components/ui/states';
import { serverEnv } from '@/lib/env';
import { formatPaise } from '@/lib/utils';
import { enforceAdminPermission } from '@/server/auth/guards';
import { PERMISSIONS } from '@/server/auth/permissions';
import { db } from '@/server/db';
import { syncUnpaidOrders, webhookLog, within } from '@/server/services/payment-sync';

export const metadata: Metadata = {
  title: 'Orders',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

/** Times as the Razorpay dashboard shows them, in India. */
const timeFormat = new Intl.DateTimeFormat('en-IN', {
  day: 'numeric',
  month: 'short',
  hour: 'numeric',
  minute: '2-digit',
  timeZone: 'Asia/Kolkata',
});

type Variant = 'success' | 'danger' | 'muted' | 'warning';

const STATUS: Record<string, { label: string; variant: Variant }> = {
  PAID: { label: 'Paid', variant: 'success' },
  FAILED: { label: 'Payment failed', variant: 'danger' },
  PENDING: { label: 'Not paid', variant: 'muted' },
  CREATED: { label: 'Not paid', variant: 'muted' },
  CANCELLED: { label: 'Cancelled', variant: 'muted' },
  REFUNDED: { label: 'Refunded', variant: 'warning' },
  PARTIALLY_REFUNDED: { label: 'Partly refunded', variant: 'warning' },
};

interface OrderPayment {
  status: string;
  method: string | null;
  razorpayPaymentId: string | null;
  failureDescription: string | null;
}

/** One line on what happened to an order's payment, newest attempt first. */
function paymentLine(status: string, payments: OrderPayment[]): string {
  const captured = payments.find((payment) => payment.status === 'CAPTURED');
  if (captured) {
    return [captured.razorpayPaymentId, captured.method].filter(Boolean).join(' · ');
  }
  const failed = payments.filter((payment) => payment.status === 'FAILED');
  if (failed.length > 0) {
    const last = failed[0]!;
    const tries = failed.length > 1 ? `${failed.length} attempts failed, last: ` : '';
    const method = last.method ? ` (${last.method})` : '';
    return `${tries}${last.failureDescription ?? 'declined'}${method} · ${last.razorpayPaymentId}`;
  }
  if (status === 'PENDING') return 'Payment window opened, no payment made';
  // Razorpay did not take the order, so no payment window opened.
  if (status === 'CREATED') return 'Checkout did not start';
  return '';
}

export default async function AdminOrdersPage() {
  await enforceAdminPermission(PERMISSIONS.ORDER_READ, '/admin/orders');

  // The last few days' unpaid orders are checked with Razorpay before they are
  // listed, so what this page says paid is what Razorpay says paid. A slow
  // answer does not hold the page up; the background check finishes it.
  await within(
    6_000,
    syncUnpaidOrders({ since: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000), limit: 50 }),
  );

  const [orders, paid, revenue, refunded, lastWebhookPayment] = await Promise.all([
    db.order.findMany({
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: {
        id: true,
        orderNumber: true,
        status: true,
        totalInPaise: true,
        createdAt: true,
        billingPhone: true,
        user: { select: { name: true, email: true } },
        payments: {
          orderBy: { createdAt: 'desc' },
          take: 10,
          select: {
            status: true,
            method: true,
            razorpayPaymentId: true,
            failureDescription: true,
          },
        },
      },
    }),
    db.order.count({ where: { status: 'PAID' } }),
    db.order.aggregate({ where: { status: 'PAID' }, _sum: { totalInPaise: true } }),
    db.order.count({ where: { status: { in: ['REFUNDED', 'PARTIALLY_REFUNDED'] } } }),
    // A payment stored from a webhook keeps the whole event, which starts so.
    db.payment.findFirst({
      where: { gatewayPayloadJson: { startsWith: '{"entity":"event"' } },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    }),
  ]);

  const env = serverEnv();
  const paymentsEnabled = Boolean(env.RAZORPAY_KEY_ID && env.RAZORPAY_KEY_SECRET);
  const webhook = webhookStatus(
    Boolean(env.RAZORPAY_WEBHOOK_SECRET),
    lastWebhookPayment?.createdAt ?? null,
  );

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Orders</h1>
        <p className="mt-1 text-sm text-muted-foreground">Purchases and their payment status.</p>
      </header>

      {!paymentsEnabled && (
        <div className="flex items-start gap-3 rounded-xl border border-warning/25 bg-warning/10 p-4 text-sm text-warning">
          <KeyRound className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <div>
            <p className="font-medium">Payments are not enabled</p>
            <p className="mt-1 leading-relaxed">
              Razorpay is not configured, so students cannot check out and no new orders can be
              created. Set <code className="font-mono text-xs">RAZORPAY_KEY_ID</code> and{' '}
              <code className="font-mono text-xs">RAZORPAY_KEY_SECRET</code> to enable it. Access
              can still be granted manually from the Users page.
            </p>
          </div>
        </div>
      )}

      {paymentsEnabled && (
        <div
          className={
            webhook.ok
              ? 'flex items-start gap-3 rounded-xl border border-border bg-muted/40 p-4 text-sm'
              : 'flex items-start gap-3 rounded-xl border border-warning/25 bg-warning/10 p-4 text-sm text-warning'
          }
        >
          <Webhook className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <div className="min-w-0">
            <p className="font-medium">{webhook.title}</p>
            <p className="mt-1 leading-relaxed [overflow-wrap:anywhere]">
              {webhook.detail} Unpaid orders are also checked with Razorpay every five minutes, so
              a payment that went through shows here as paid, and opens the student&apos;s
              access, even when its confirmation went missing.
            </p>
          </div>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          label="Revenue collected"
          value={formatPaise(revenue._sum.totalInPaise ?? 0)}
          icon={Receipt}
        />
        <StatCard label="Paid orders" value={paid} />
        <StatCard label="Refunded" value={refunded} />
      </div>

      {orders.length === 0 ? (
        <EmptyState
          icon={Receipt}
          title="No orders yet"
          description={
            paymentsEnabled
              ? 'Orders appear here as soon as a student completes a purchase.'
              : 'No orders can be placed until payments are configured.'
          }
        />
      ) : (
        <Card>
          <CardContent className="p-0">
            <ul className="divide-y divide-border">
              {orders.map((order) => {
                const status = STATUS[order.status] ?? { label: order.status, variant: 'muted' };
                const line = paymentLine(order.status, order.payments);
                return (
                  <li key={order.id} className="flex items-center gap-4 p-4">
                    <div className="min-w-0 flex-1">
                      <p className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-sm">{order.orderNumber}</span>
                        <Badge variant={status.variant}>{status.label}</Badge>
                      </p>
                      <p className="mt-0.5 text-xs text-muted-foreground [overflow-wrap:anywhere]">
                        {[order.user.name, order.user.email, order.billingPhone]
                          .filter(Boolean)
                          .join(' · ')}{' '}
                        · {timeFormat.format(order.createdAt)}
                      </p>
                      {line && (
                        <p className="mt-0.5 text-xs text-muted-foreground [overflow-wrap:anywhere]">
                          {line}
                        </p>
                      )}
                    </div>
                    <span className="shrink-0 font-semibold tabular-nums">
                      {formatPaise(order.totalInPaise)}
                    </span>
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

/** Whether Razorpay's webhook is reaching the site, in words for the admin. */
function webhookStatus(
  secretSet: boolean,
  lastStored: Date | null,
): { ok: boolean; title: string; detail: string } {
  const setup =
    'In Razorpay: Account & Settings, Webhooks. URL https://avkenvisions.com/api/webhooks/razorpay, events payment.captured and payment.failed, status Active, and the same secret as RAZORPAY_WEBHOOK_SECRET on the server.';
  if (!secretSet) {
    return {
      ok: false,
      title: 'Razorpay webhook is not set up',
      detail: `RAZORPAY_WEBHOOK_SECRET is empty, so the server refuses Razorpay's payment messages. ${setup}`,
    };
  }

  const log = webhookLog();
  if (log.lastRefusedAt && (!log.lastVerifiedAt || log.lastRefusedAt > log.lastVerifiedAt)) {
    return {
      ok: false,
      title: 'Razorpay webhook is being refused',
      detail: `A message from Razorpay was refused at ${timeFormat.format(log.lastRefusedAt)}: its secret does not match RAZORPAY_WEBHOOK_SECRET. ${setup}`,
    };
  }

  const last = [log.lastVerifiedAt, lastStored]
    .filter((date): date is Date => date !== null)
    .sort((a, b) => b.getTime() - a.getTime())[0];
  if (last) {
    return {
      ok: true,
      title: 'Razorpay webhook is working',
      detail: `Last message from Razorpay: ${timeFormat.format(last)}.`,
    };
  }
  return {
    ok: false,
    title: "No message from Razorpay's webhook yet",
    detail: `If students have paid or tried to pay since the last deploy, the webhook is probably not set up. ${setup}`,
  };
}
