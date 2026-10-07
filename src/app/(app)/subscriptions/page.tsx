import type { Metadata } from 'next';
import Link from 'next/link';
import { CheckCircle2, CreditCard, Info, KeyRound, ShieldCheck } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { serverEnv } from '@/lib/env';
import { formatDate, formatPaise } from '@/lib/utils';
import { enforceStudent } from '@/server/auth/guards';
import { CommunityInvite } from '@/features/checkout/community-invite';
import { db } from '@/server/db';
import { getPublishedPlans } from '@/server/services/marketing-service';
import { STUDENT_WINDOW_MS, syncUnpaidOrders, within } from '@/server/services/payment-sync';

export const metadata: Metadata = {
  title: 'Subscription',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

export default async function SubscriptionPage() {
  const user = await enforceStudent('/subscriptions');

  // A student who paid but was not let in comes here to look. Their recent
  // unpaid orders are checked with Razorpay first, so a payment that went
  // through shows - and opens their access - without waiting for anyone.
  await within(
    5_000,
    syncUnpaidOrders({ userId: user.id, since: new Date(Date.now() - STUDENT_WINDOW_MS) }),
  );

  const [subscription, entitlements, plans, orders] = await Promise.all([
    db.subscription.findFirst({
      where: { userId: user.id, status: { in: ['ACTIVE', 'CANCELLED'] } },
      orderBy: { expiresAt: 'desc' },
      select: {
        id: true,
        status: true,
        startsAt: true,
        expiresAt: true,
        cancelledAt: true,
        aiRequestsUsed: true,
        plan: {
          select: {
            name: true,
            priceInPaise: true,
            durationDays: true,
            maxAiRequestsPerMonth: true,
          },
        },
      },
    }),
    db.entitlement.findMany({
      where: { userId: user.id, revokedAt: null },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        sourceType: true,
        startsAt: true,
        expiresAt: true,
        testSeries: { select: { name: true, slug: true } },
      },
    }),
    getPublishedPlans(),
    db.order.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: {
        id: true,
        orderNumber: true,
        status: true,
        totalInPaise: true,
        createdAt: true,
      },
    }),
  ]);

  // Payments are only live once Razorpay credentials are configured. Saying so
  // is better than a Buy button that dead-ends at a provider error.
  const paymentsEnabled = Boolean(serverEnv().RAZORPAY_KEY_ID && serverEnv().RAZORPAY_KEY_SECRET);

  const activePlan = subscription?.plan;
  const daysLeft = subscription
    ? Math.max(0, Math.ceil((subscription.expiresAt.getTime() - Date.now()) / 86_400_000))
    : 0;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Subscription</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Your current access, what it covers, and what is available.
        </p>
      </header>

      {/* Community — shown to anyone who has bought something. --------- */}
      {entitlements.length > 0 && <CommunityInvite />}

      {/* Current plan ---------------------------------------------------- */}
      <Card variant={subscription ? 'accent' : 'default'}>
        <CardContent className="p-5 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Current plan</p>
              <h2 className="mt-1 text-xl font-semibold tracking-tight">
                {activePlan?.name ?? 'Free'}
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {subscription
                  ? subscription.status === 'CANCELLED'
                    ? `Cancelled — access continues until ${formatDate(subscription.expiresAt, 'long')}`
                    : `Active until ${formatDate(subscription.expiresAt, 'long')} (${daysLeft} ${daysLeft === 1 ? 'day' : 'days'} left)`
                  : 'Free mock tests, daily practice and your basic performance report.'}
              </p>
            </div>

            <Badge variant={subscription?.status === 'ACTIVE' ? 'success' : 'muted'}>
              {subscription?.status === 'ACTIVE'
                ? 'Active'
                : subscription?.status === 'CANCELLED'
                  ? 'Cancelled'
                  : 'Free tier'}
            </Badge>
          </div>

          {subscription && activePlan && activePlan.maxAiRequestsPerMonth > 0 && (
            <div className="mt-5 border-t border-border pt-4">
              <div className="flex items-baseline justify-between text-sm">
                <span className="font-medium">AI Coach usage this month</span>
                <span className="tabular-nums text-muted-foreground">
                  {subscription.aiRequestsUsed} / {activePlan.maxAiRequestsPerMonth}
                </span>
              </div>
              <Progress
                value={(subscription.aiRequestsUsed / activePlan.maxAiRequestsPerMonth) * 100}
                className="mt-2"
                size="sm"
              />
            </div>
          )}
        </CardContent>
      </Card>

      {/* Payments not configured ---------------------------------------- */}
      {!paymentsEnabled && (
        <div className="flex items-start gap-3 rounded-xl border border-warning/25 bg-warning/10 p-4 text-sm text-warning">
          <KeyRound className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <div>
            <p className="font-medium">Online payment is not enabled yet</p>
            <p className="mt-1 leading-relaxed">
              Razorpay credentials have not been configured on this deployment, so checkout is
              unavailable. Access can still be granted manually by an administrator. Set{' '}
              <code className="rounded bg-warning/15 px-1 py-0.5 font-mono text-xs">
                RAZORPAY_KEY_ID
              </code>{' '}
              and{' '}
              <code className="rounded bg-warning/15 px-1 py-0.5 font-mono text-xs">
                RAZORPAY_KEY_SECRET
              </code>{' '}
              to enable it.
            </p>
          </div>
        </div>
      )}

      {/* Entitlements ---------------------------------------------------- */}
      <Card>
        <CardContent className="p-5 sm:p-6">
          <h2 className="font-semibold tracking-tight">What you have access to</h2>

          {entitlements.length === 0 ? (
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
              You currently have access to everything marked free — free mock tests, daily practice
              and your performance report. Paid test series appear here once granted.
            </p>
          ) : (
            <ul className="mt-4 space-y-2.5">
              {entitlements.map((entitlement) => (
                <li
                  key={entitlement.id}
                  className="flex items-center gap-3 rounded-lg border border-border p-3"
                >
                  <CheckCircle2 className="size-4 shrink-0 text-success" aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {entitlement.testSeries?.name ?? 'Platform access'}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {entitlement.sourceType === 'PURCHASE'
                        ? 'Purchased'
                        : entitlement.sourceType === 'ADMIN_GRANT'
                          ? 'Granted by an administrator'
                          : entitlement.sourceType}
                      {entitlement.expiresAt
                        ? ` · until ${formatDate(entitlement.expiresAt, 'short')}`
                        : ' · no expiry'}
                    </p>
                  </div>
                  {entitlement.testSeries && (
                    <Button asChild size="sm" variant="ghost" className="shrink-0">
                      <Link href={`/test-series/${entitlement.testSeries.slug}`}>Open</Link>
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Available plans -------------------------------------------------- */}
      {plans.length > 0 && (
        <section aria-labelledby="plans-heading">
          <h2 id="plans-heading" className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Available plans
          </h2>

          <div className="mt-3 grid gap-4 lg:grid-cols-3">
            {plans.map((plan) => {
              const isCurrent = activePlan?.name === plan.name;

              return (
                <Card key={plan.id} className={isCurrent ? 'border-primary/40' : undefined}>
                  <CardContent className="flex h-full flex-col p-5">
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="font-semibold tracking-tight">{plan.name}</h3>
                      {isCurrent && (
                        <Badge variant="brand" size="sm">
                          Current
                        </Badge>
                      )}
                    </div>

                    <p className="mt-2 text-2xl font-semibold tabular-nums">
                      {plan.priceInPaise === 0 ? 'Free' : formatPaise(plan.priceInPaise)}
                    </p>
                    {plan.tagline && (
                      <p className="mt-1 text-sm text-muted-foreground">{plan.tagline}</p>
                    )}

                    <ul className="mt-4 flex-1 space-y-2">
                      {plan.features.slice(0, 5).map((feature) => (
                        <li key={feature} className="flex items-start gap-2 text-sm">
                          <CheckCircle2
                            className="mt-0.5 size-3.5 shrink-0 text-success"
                            aria-hidden="true"
                          />
                          <span className="leading-relaxed text-muted-foreground">{feature}</span>
                        </li>
                      ))}
                    </ul>

                    <Button
                      asChild={!isCurrent && paymentsEnabled}
                      disabled={isCurrent || !paymentsEnabled}
                      fullWidth
                      variant={plan.isFeatured ? 'brand' : 'outline'}
                      className="mt-5"
                    >
                      {isCurrent ? (
                        <span>Your current plan</span>
                      ) : !paymentsEnabled ? (
                        <span>Checkout unavailable</span>
                      ) : (
                        <Link href={`/checkout?plan=${plan.slug}`}>Choose {plan.name}</Link>
                      )}
                    </Button>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </section>
      )}

      {/* Orders ----------------------------------------------------------- */}
      {orders.length > 0 && (
        <Card>
          <CardContent className="p-5 sm:p-6">
            <h2 className="font-semibold tracking-tight">Order history</h2>
            <ul className="mt-4 divide-y divide-border">
              {orders.map((order) => (
                <li key={order.id} className="flex items-center gap-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-mono text-sm">{order.orderNumber}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatDate(order.createdAt, 'short')}
                    </p>
                  </div>
                  <Badge variant={order.status === 'PAID' ? 'success' : 'muted'} size="sm">
                    {order.status}
                  </Badge>
                  <span className="shrink-0 font-medium tabular-nums">
                    {formatPaise(order.totalInPaise)}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <p className="flex items-start gap-2 text-xs leading-relaxed text-muted-foreground">
        <ShieldCheck className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
        Cancelling keeps your access until the end of the paid period. Your results, bookmarks and
        analytics are never deleted when a subscription ends.
      </p>
    </div>
  );
}
