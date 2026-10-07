import { createHmac, timingSafeEqual } from 'node:crypto';

import Razorpay from 'razorpay';

import { AppError, errors } from '@/lib/api';
import { serverEnv } from '@/lib/env';
import { db } from '@/server/db';
import { hasEntitlement } from '@/server/services/entitlement-service';
import { getSeriesPricing } from '@/server/services/pricing-service';

/**
 * Razorpay checkout.
 *
 * Three rules hold this together, and every function below exists to keep one
 * of them true:
 *
 *   1. **The server decides the price.** The amount charged is computed here
 *      from the live pricing ladder and frozen onto the order. A client that
 *      posts its own amount is ignored — otherwise anyone could buy the series
 *      for one rupee by editing a request.
 *
 *   2. **Access is granted only against a verified signature.** Both the
 *      browser callback and the webhook carry an HMAC that only Razorpay and
 *      this server can produce. Nothing grants entitlement without one.
 *
 *   3. **Granting is idempotent.** Razorpay calls the webhook more than once by
 *      design, and the browser callback races it. Both paths converge on the
 *      same conditional write, so a student ends up with exactly one
 *      entitlement no matter how many times either fires.
 */

let client: Razorpay | null = null;

/** The configured client, or null when payments are switched off. */
export function razorpay(): Razorpay | null {
  const env = serverEnv();
  if (!env.RAZORPAY_KEY_ID || !env.RAZORPAY_KEY_SECRET) return null;

  client ??= new Razorpay({
    key_id: env.RAZORPAY_KEY_ID,
    key_secret: env.RAZORPAY_KEY_SECRET,
  });
  return client;
}

export function paymentsEnabled(): boolean {
  return razorpay() !== null;
}

/**
 * Orders that can still be paid. FAILED is one of them: after a failed
 * attempt Razorpay offers the buyer another go in the same window, against the
 * same order, and that second attempt often succeeds - a bank's netbanking
 * fails, they switch to UPI.
 */
export const UNPAID_STATUSES = ['CREATED', 'PENDING', 'FAILED'];

/** Compares two hex digests without leaking their contents through timing. */
function safeEqualHex(a: string, b: string): boolean {
  const left = Buffer.from(a, 'hex');
  const right = Buffer.from(b, 'hex');
  if (left.length === 0 || left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/**
 * `AVK-2026-000148`.
 *
 * The sequence is per calendar year and derived from a count, so numbers stay
 * readable on an invoice. A collision under concurrency is possible in theory;
 * the unique constraint on `orderNumber` catches it and the caller retries.
 */
async function nextOrderNumber(): Promise<string> {
  const env = serverEnv();
  const year = new Date().getFullYear();
  const startOfYear = new Date(Date.UTC(year, 0, 1));

  const soFar = await db.order.count({ where: { createdAt: { gte: startOfYear } } });
  const prefix = env.INVOICE_SERIES_PREFIX || 'AVK';
  return `${prefix}-${year}-${String(soFar + 1).padStart(6, '0')}`;
}

export interface CheckoutDraft {
  orderId: string;
  orderNumber: string;
  razorpayOrderId: string;
  amountInPaise: number;
  currency: string;
  keyId: string;
  seriesName: string;
}

/**
 * Creates an order for one test series and opens it at Razorpay.
 *
 * The price is read from the ladder here and written onto the order, so the
 * figure the student was shown is the figure they are charged even if another
 * buyer fills the tier a second later. That is deliberate: quoting one price
 * and taking another is worse than selling one seat past the limit.
 */
export async function createSeriesCheckout(params: {
  userId: string;
  seriesSlug: string;
}): Promise<CheckoutDraft> {
  const gateway = razorpay();
  if (!gateway) {
    throw new AppError('PAYMENT_REQUIRED', 'Payments are not configured yet. Please contact support.');
  }

  const series = await db.testSeries.findFirst({
    where: { slug: params.seriesSlug, status: 'PUBLISHED', deletedAt: null },
    select: {
      id: true,
      name: true,
      priceInPaise: true,
      accessDurationDays: true,
    },
  });
  if (!series) throw errors.notFound('Test series');

  if (series.priceInPaise === 0) {
    throw new AppError('BAD_REQUEST', 'This series is free — no payment is needed.');
  }

  const user = await db.user.findUnique({
    where: { id: params.userId },
    select: { name: true, email: true, phone: true },
  });
  if (!user) throw errors.notFound('Account');

  // Already bought? Send them back rather than taking money twice. Uses the
  // shared check, so someone holding the previous-year bundle cannot be
  // charged again for a single year the bundle already covers.
  if (await hasEntitlement(params.userId, series.id)) {
    throw new AppError('CONFLICT', 'You already have access to this series.');
  }

  const pricing = await getSeriesPricing(series.id);
  const amountInPaise = pricing?.priceInPaise ?? series.priceInPaise;

  const orderNumber = await nextOrderNumber();

  const order = await db.order.create({
    data: {
      orderNumber,
      userId: params.userId,
      status: 'CREATED',
      subtotalInPaise: amountInPaise,
      totalInPaise: amountInPaise,
      currency: 'INR',
      billingName: user.name,
      billingEmail: user.email,
      billingPhone: user.phone,
      items: {
        create: {
          productType: 'TEST_SERIES',
          testSeriesId: series.id,
          productName: series.name,
          unitPriceInPaise: amountInPaise,
          quantity: 1,
          totalInPaise: amountInPaise,
        },
      },
    },
    select: { id: true, orderNumber: true },
  });

  const rzpOrder = await gateway.orders.create({
    amount: amountInPaise,
    currency: 'INR',
    receipt: order.orderNumber,
    notes: { orderId: order.id, seriesSlug: params.seriesSlug, userId: params.userId },
  });

  await db.order.update({
    where: { id: order.id },
    data: { razorpayOrderId: rzpOrder.id, status: 'PENDING' },
  });

  return {
    orderId: order.id,
    orderNumber: order.orderNumber,
    razorpayOrderId: rzpOrder.id,
    amountInPaise,
    currency: 'INR',
    keyId: serverEnv().RAZORPAY_KEY_ID,
    seriesName: series.name,
  };
}

/**
 * Verifies the signature Razorpay hands the browser after a successful payment.
 *
 * The digest is over `order_id|payment_id`, keyed with the API secret — which
 * the browser never sees, so a forged callback cannot produce a matching one.
 */
export function verifyCheckoutSignature(input: {
  razorpayOrderId: string;
  razorpayPaymentId: string;
  signature: string;
}): boolean {
  const secret = serverEnv().RAZORPAY_KEY_SECRET;
  if (!secret) return false;

  const expected = createHmac('sha256', secret)
    .update(`${input.razorpayOrderId}|${input.razorpayPaymentId}`)
    .digest('hex');

  return safeEqualHex(expected, input.signature);
}

/**
 * Verifies a webhook against the raw request body.
 *
 * The body must be the exact bytes received. Re-serialising parsed JSON changes
 * key order and whitespace, which changes the digest and rejects every genuine
 * delivery.
 */
export function verifyWebhookSignature(rawBody: string, signature: string): boolean {
  const secret = serverEnv().RAZORPAY_WEBHOOK_SECRET;
  if (!secret) return false;

  const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
  return safeEqualHex(expected, signature);
}

/**
 * Marks an order paid and grants access, exactly once.
 *
 * The browser callback, the webhook and the check with Razorpay all call this,
 * often within a second of each other, and the webhook may arrive several
 * times. The conditional `updateMany` on status is the gate: whichever call
 * flips an unpaid order to PAID does the work, and the rest see zero rows
 * updated and stop.
 *
 * Returns true when this call was the one that granted access.
 */
export async function fulfilOrder(input: {
  razorpayOrderId: string;
  razorpayPaymentId: string;
  signature?: string;
  method?: string;
  rawPayload?: string;
}): Promise<boolean> {
  const order = await db.order.findUnique({
    where: { razorpayOrderId: input.razorpayOrderId },
    select: {
      id: true,
      userId: true,
      status: true,
      totalInPaise: true,
      items: {
        select: {
          testSeriesId: true,
          testSeries: { select: { accessDurationDays: true } },
        },
      },
    },
  });

  if (!order) throw errors.notFound('Order');

  // Compare-and-set. Only one caller can move the order out of an unpaid state.
  const claimed = await db.order.updateMany({
    where: { id: order.id, status: { in: UNPAID_STATUSES } },
    data: { status: 'PAID', paidAt: new Date() },
  });

  if (claimed.count === 0) {
    // Someone got here first. Still record the payment row if it is new, so a
    // second payment id against the same order is not lost.
    await db.payment
      .create({
        data: {
          orderId: order.id,
          userId: order.userId,
          razorpayPaymentId: input.razorpayPaymentId,
          razorpayOrderId: input.razorpayOrderId,
          razorpaySignature: input.signature,
          amountInPaise: order.totalInPaise,
          status: 'CAPTURED',
          method: input.method,
          gatewayPayloadJson: input.rawPayload,
          capturedAt: new Date(),
        },
      })
      .catch(() => {
        /* Unique on razorpayPaymentId — a repeat delivery, nothing to do. */
      });
    return false;
  }

  await db.payment
    .create({
      data: {
        orderId: order.id,
        userId: order.userId,
        razorpayPaymentId: input.razorpayPaymentId,
        razorpayOrderId: input.razorpayOrderId,
        razorpaySignature: input.signature,
        amountInPaise: order.totalInPaise,
        status: 'CAPTURED',
        method: input.method,
        gatewayPayloadJson: input.rawPayload,
        capturedAt: new Date(),
      },
    })
    .catch(() => {
      /* Already recorded by a racing delivery. */
    });

  const now = new Date();
  for (const item of order.items) {
    if (!item.testSeriesId) continue;

    const days = item.testSeries?.accessDurationDays ?? 0;
    const expiresAt = days > 0 ? new Date(now.getTime() + days * 86_400_000) : null;

    // Unique on (userId, testSeriesId, sourceType), so a repeat is a no-op
    // rather than a second grant.
    await db.entitlement.upsert({
      where: {
        userId_testSeriesId_sourceType: {
          userId: order.userId,
          testSeriesId: item.testSeriesId,
          sourceType: 'PURCHASE',
        },
      },
      update: { revokedAt: null, startsAt: now, expiresAt, orderId: order.id },
      create: {
        userId: order.userId,
        testSeriesId: item.testSeriesId,
        sourceType: 'PURCHASE',
        orderId: order.id,
        startsAt: now,
        expiresAt,
      },
    });
  }

  return true;
}

/** Records a failed payment without touching the order's access. */
export async function recordFailure(input: {
  razorpayOrderId: string;
  razorpayPaymentId: string;
  code?: string;
  description?: string;
  rawPayload?: string;
}): Promise<void> {
  const order = await db.order.findUnique({
    where: { razorpayOrderId: input.razorpayOrderId },
    select: { id: true, userId: true, totalInPaise: true, status: true },
  });
  if (!order) return;

  await db.payment
    .create({
      data: {
        orderId: order.id,
        userId: order.userId,
        razorpayPaymentId: input.razorpayPaymentId,
        razorpayOrderId: input.razorpayOrderId,
        amountInPaise: order.totalInPaise,
        status: 'FAILED',
        failureCode: input.code,
        failureDescription: input.description,
        gatewayPayloadJson: input.rawPayload,
      },
    })
    .catch(() => {
      /* Repeat delivery. */
    });

  // A failure must never downgrade an order that has already been paid — the
  // two can arrive out of order.
  await db.order.updateMany({
    where: { id: order.id, status: { in: ['CREATED', 'PENDING'] } },
    data: { status: 'FAILED' },
  });
}
