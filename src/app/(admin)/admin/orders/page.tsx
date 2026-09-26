import type { Metadata } from 'next';
import { KeyRound, Receipt } from 'lucide-react';

import { StatusBadge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { StatCard } from '@/components/ui/stat-card';
import { EmptyState } from '@/components/ui/states';
import { serverEnv } from '@/lib/env';
import { formatDate, formatPaise } from '@/lib/utils';
import { enforceAdminPermission } from '@/server/auth/guards';
import { PERMISSIONS } from '@/server/auth/permissions';
import { db } from '@/server/db';

export const metadata: Metadata = {
  title: 'Orders',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

export default async function AdminOrdersPage() {
  await enforceAdminPermission(PERMISSIONS.ORDER_READ, '/admin/orders');

  const [orders, paid, revenue, refunded] = await Promise.all([
    db.order.findMany({
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: {
        id: true,
        orderNumber: true,
        status: true,
        totalInPaise: true,
        createdAt: true,
        user: { select: { name: true, email: true } },
      },
    }),
    db.order.count({ where: { status: 'PAID' } }),
    db.order.aggregate({ where: { status: 'PAID' }, _sum: { totalInPaise: true } }),
    db.order.count({ where: { status: { in: ['REFUNDED', 'PARTIALLY_REFUNDED'] } } }),
  ]);

  const paymentsEnabled = Boolean(
    serverEnv().RAZORPAY_KEY_ID && serverEnv().RAZORPAY_KEY_SECRET,
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
              {orders.map((order) => (
                <li key={order.id} className="flex items-center gap-4 p-4">
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-sm">{order.orderNumber}</span>
                      <StatusBadge status={order.status} />
                    </p>
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">
                      {order.user.name} · {order.user.email} ·{' '}
                      {formatDate(order.createdAt, 'short')}
                    </p>
                  </div>
                  <span className="shrink-0 font-semibold tabular-nums">
                    {formatPaise(order.totalInPaise)}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
