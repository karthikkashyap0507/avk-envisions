import { db } from '@/server/db';
import { logger } from '@/server/logger';
import {
  fulfilOrder,
  razorpay,
  recordFailure,
  UNPAID_STATUSES,
} from '@/server/services/payment-service';

/**
 * Settles orders against Razorpay's own record of them.
 *
 * An order is marked paid by the buyer's browser, straight after paying, or by
 * Razorpay's webhook. Both can go missing. A phone that leaves for a UPI app
 * often never comes back to the tab that would report the payment, and a
 * webhook that is not set up, or whose secret does not match, is refused.
 * Either way a student who paid stays locked out, the order says pending, and
 * they may well pay a second time.
 *
 * Asking Razorpay closes that gap. The question goes over HTTPS with the API
 * secret, so the answer cannot be forged, and what it says paid is paid
 * through the same idempotent `fulfilOrder` as the other two paths.
 */

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/** What Razorpay says about one order. */
export type OrderSync = 'paid' | 'failed' | 'unpaid';

interface GatewayPayment {
  id: string;
  status: string;
  method?: string | null;
  error_code?: string | null;
  error_description?: string | null;
  error_reason?: string | null;
}

/**
 * Brings one order up to date with Razorpay. Null when payments are not
 * configured.
 */
export async function syncOrder(razorpayOrderId: string): Promise<OrderSync | null> {
  const gateway = razorpay();
  if (!gateway) return null;

  const { items } = await gateway.orders.fetchPayments(razorpayOrderId);
  const payments = items as unknown as GatewayPayment[];

  const captured = payments.find((payment) => payment.status === 'captured');
  if (captured) {
    const granted = await fulfilOrder({
      razorpayOrderId,
      razorpayPaymentId: captured.id,
      method: captured.method ?? undefined,
      rawPayload: JSON.stringify(captured),
    });
    if (granted) {
      logger.warn(
        { event: 'razorpay.sync.captured', orderId: razorpayOrderId, paymentId: captured.id },
        'Paid order found by asking Razorpay; access granted',
      );
    }
    return 'paid';
  }

  const failed = payments.filter((payment) => payment.status === 'failed');
  if (failed.length === 0) return 'unpaid';

  // Only the attempts not yet on file: a repeat would be refused by the
  // unique payment id anyway, but would log an error each time.
  const known = new Set(
    (
      await db.payment.findMany({
        where: { razorpayOrderId },
        select: { razorpayPaymentId: true },
      })
    ).map((payment) => payment.razorpayPaymentId),
  );
  for (const payment of failed) {
    if (known.has(payment.id)) continue;
    await recordFailure({
      razorpayOrderId,
      razorpayPaymentId: payment.id,
      code: payment.error_code ?? undefined,
      description: payment.error_description ?? payment.error_reason ?? undefined,
      rawPayload: JSON.stringify(payment),
    });
  }
  return 'failed';
}

/**
 * Settles every order placed since `since` that is not yet paid - for one
 * student, or for everyone. Returns how many turned out to be paid.
 */
export async function syncUnpaidOrders(filter: {
  since: Date;
  userId?: string;
  limit?: number;
}): Promise<number> {
  if (!razorpay()) return 0;

  const orders = await db.order.findMany({
    where: {
      status: { in: UNPAID_STATUSES },
      razorpayOrderId: { not: null },
      createdAt: { gte: filter.since },
      ...(filter.userId ? { userId: filter.userId } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: filter.limit ?? 200,
    select: { razorpayOrderId: true },
  });

  let paid = 0;
  for (const order of orders) {
    try {
      if ((await syncOrder(order.razorpayOrderId!)) === 'paid') paid += 1;
    } catch (error) {
      logger.warn(
        { event: 'razorpay.sync.error', orderId: order.razorpayOrderId, err: error },
        'Could not ask Razorpay about an order',
      );
    }
  }
  return paid;
}

/**
 * Waits for `work`, but no longer than `ms`: a page should not hang on
 * Razorpay. Past that the work carries on in the background, and errors are
 * already logged where they happen.
 */
export async function within(ms: number, work: Promise<unknown>): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    work.catch(() => undefined),
    new Promise((resolve) => {
      timer = setTimeout(resolve, ms);
    }),
  ]);
  clearTimeout(timer);
}

/** How far back a student's own unpaid orders are checked. */
export const STUDENT_WINDOW_MS = 3 * DAY;

/**
 * Checks unpaid orders with Razorpay for the life of the server.
 *
 * Orders from the last hour every five minutes, which is how long a student
 * who paid but was not let in waits at most. The last three days once an
 * hour, for anything slower. The first round goes back sixty days, so orders
 * left pending before this existed are put right once.
 */
export function startPaymentSync(): void {
  const holder = globalThis as unknown as { __avkPaymentSync?: boolean };
  if (holder.__avkPaymentSync || !razorpay()) return;
  holder.__avkPaymentSync = true;

  let lastWide = 0;
  let first = true;

  const round = async () => {
    const now = Date.now();
    const wide = now - lastWide >= HOUR;
    if (wide) lastWide = now;
    const window = first ? 60 * DAY : wide ? 3 * DAY : HOUR;
    const limit = first ? 1000 : 200;
    first = false;

    try {
      const paid = await syncUnpaidOrders({ since: new Date(now - window), limit });
      if (paid > 0) {
        logger.warn(
          { event: 'razorpay.sync.recovered', paid },
          'Orders paid at Razorpay but not here have been settled',
        );
      }
    } catch (error) {
      logger.error({ event: 'razorpay.sync.failed', err: error }, 'Payment check with Razorpay failed');
    }
    setTimeout(round, 5 * 60 * 1000).unref();
  };

  setTimeout(round, 30 * 1000).unref();
}

/**
 * What this server has heard from Razorpay's webhook since it started, for
 * the orders page. On globalThis so the webhook route and the page share it.
 */
export interface WebhookLog {
  lastVerifiedAt: Date | null;
  lastRefusedAt: Date | null;
}

export function webhookLog(): WebhookLog {
  const holder = globalThis as unknown as { __avkWebhookLog?: WebhookLog };
  holder.__avkWebhookLog ??= { lastVerifiedAt: null, lastRefusedAt: null };
  return holder.__avkWebhookLog;
}
