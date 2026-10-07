import { createHmac } from 'node:crypto';

import { beforeEach, describe, expect, it, vi } from 'vitest';

const WEBHOOK_SECRET = 'test_webhook_secret';

vi.mock('@/lib/env', () => ({
  serverEnv: () => ({
    RAZORPAY_KEY_ID: 'rzp_test_key',
    RAZORPAY_KEY_SECRET: 'test_secret_do_not_use',
    RAZORPAY_WEBHOOK_SECRET: WEBHOOK_SECRET,
    INVOICE_SERIES_PREFIX: 'AVK',
  }),
}));
vi.mock('@/server/logger', () => ({
  logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
}));
vi.mock('@/server/services/pricing-service', () => ({ getSeriesPricing: async () => null }));
vi.mock('@/server/services/entitlement-service', () => ({ hasEntitlement: async () => false }));

/** What Razorpay holds for each of its orders. */
const gateway = new Map<string, Array<Record<string, unknown>>>();
const unreachable = new Set<string>();

vi.mock('razorpay', () => ({
  default: class {
    orders = {
      fetchPayments: async (orderId: string) => {
        if (unreachable.has(orderId)) throw new Error('Razorpay did not answer');
        const items = gateway.get(orderId) ?? [];
        return { entity: 'collection', count: items.length, items };
      },
    };
  },
}));

interface FakeOrder {
  id: string;
  userId: string;
  razorpayOrderId: string;
  status: string;
  totalInPaise: number;
  seriesId: string;
  createdAt: Date;
  paidAt?: Date;
}

const state = {
  orders: [] as FakeOrder[],
  payments: [] as Array<Record<string, unknown>>,
  entitlements: [] as Array<{ userId: string; testSeriesId: string }>,
};

type Where = Record<string, any>;

vi.mock('@/server/db', () => ({
  db: {
    order: {
      findUnique: async ({ where }: { where: Where }) => {
        const order = state.orders.find((o) => o.razorpayOrderId === where.razorpayOrderId);
        if (!order) return null;
        return {
          ...order,
          items: [{ testSeriesId: order.seriesId, testSeries: { accessDurationDays: 365 } }],
        };
      },
      updateMany: async ({ where, data }: { where: Where; data: Where }) => {
        const order = state.orders.find(
          (o) => o.id === where.id && (where.status.in as string[]).includes(o.status),
        );
        if (!order) return { count: 0 };
        Object.assign(order, data);
        return { count: 1 };
      },
      findMany: async ({ where, take }: { where: Where; take: number }) =>
        state.orders
          .filter(
            (o) =>
              (where.status.in as string[]).includes(o.status) &&
              o.createdAt >= where.createdAt.gte &&
              (!where.userId || o.userId === where.userId),
          )
          .slice(0, take)
          .map((o) => ({ razorpayOrderId: o.razorpayOrderId })),
    },
    payment: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        if (state.payments.some((p) => p.razorpayPaymentId === data.razorpayPaymentId)) {
          throw new Error('Unique constraint failed on razorpayPaymentId');
        }
        state.payments.push(data);
        return data;
      },
      findMany: async ({ where }: { where: Where }) =>
        state.payments.filter((p) => p.razorpayOrderId === where.razorpayOrderId),
    },
    entitlement: {
      upsert: async ({ create }: { create: { userId: string; testSeriesId: string } }) => {
        const exists = state.entitlements.some(
          (e) => e.userId === create.userId && e.testSeriesId === create.testSeriesId,
        );
        if (!exists) state.entitlements.push(create);
        return create;
      },
    },
  },
}));

const { fulfilOrder, recordFailure } = await import('./payment-service');
const { syncOrder, syncUnpaidOrders, webhookLog } = await import('./payment-sync');
const { POST: webhook } = await import('@/app/api/webhooks/razorpay/route');

function order(id: string, overrides: Partial<FakeOrder> = {}): FakeOrder {
  const created: FakeOrder = {
    id,
    userId: 'user_1',
    razorpayOrderId: `order_${id}`,
    status: 'PENDING',
    totalInPaise: 9900,
    seriesId: 'series_1',
    createdAt: new Date(),
    ...overrides,
  };
  state.orders.push(created);
  return created;
}

const captured = (id: string) => ({ id, status: 'captured', method: 'upi' });
const failed = (id: string) => ({
  id,
  status: 'failed',
  method: 'netbanking',
  error_code: 'GATEWAY_ERROR',
  error_description: 'Payment failed because of a technical error at the bank',
  error_reason: 'bank_technical_error',
});

const hasAccess = (userId = 'user_1') =>
  state.entitlements.some((e) => e.userId === userId && e.testSeriesId === 'series_1');

beforeEach(() => {
  state.orders = [];
  state.payments = [];
  state.entitlements = [];
  gateway.clear();
  unreachable.clear();
});

describe('a payment made after a failed attempt on the same order', () => {
  it('still marks the order paid and opens access', async () => {
    const o = order('a');
    // Netbanking fails at the bank; the webhook says so first.
    await recordFailure({ razorpayOrderId: o.razorpayOrderId, razorpayPaymentId: 'pay_nb' });
    expect(o.status).toBe('FAILED');

    // The student switches to UPI in the same window, and pays.
    const granted = await fulfilOrder({
      razorpayOrderId: o.razorpayOrderId,
      razorpayPaymentId: 'pay_upi',
    });

    expect(granted).toBe(true);
    expect(o.status).toBe('PAID');
    expect(hasAccess()).toBe(true);
  });

  it('is not undone by the failure arriving after it', async () => {
    const o = order('b');
    await fulfilOrder({ razorpayOrderId: o.razorpayOrderId, razorpayPaymentId: 'pay_upi' });
    await recordFailure({ razorpayOrderId: o.razorpayOrderId, razorpayPaymentId: 'pay_nb' });
    expect(o.status).toBe('PAID');
  });
});

describe('syncOrder', () => {
  it('marks an order paid when Razorpay has captured its payment', async () => {
    const o = order('c');
    gateway.set(o.razorpayOrderId, [captured('pay_1')]);

    expect(await syncOrder(o.razorpayOrderId)).toBe('paid');
    expect(o.status).toBe('PAID');
    expect(hasAccess()).toBe(true);
    expect(state.payments).toMatchObject([{ razorpayPaymentId: 'pay_1', status: 'CAPTURED', method: 'upi' }]);
  });

  it('finds the paid attempt among failed ones, in any order', async () => {
    const o = order('d');
    gateway.set(o.razorpayOrderId, [failed('pay_1'), captured('pay_2'), failed('pay_3')]);

    expect(await syncOrder(o.razorpayOrderId)).toBe('paid');
    expect(o.status).toBe('PAID');
  });

  it('marks an order failed, with the bank’s reason, when every attempt failed', async () => {
    const o = order('e');
    gateway.set(o.razorpayOrderId, [failed('pay_1'), failed('pay_2')]);

    expect(await syncOrder(o.razorpayOrderId)).toBe('failed');
    expect(o.status).toBe('FAILED');
    expect(hasAccess()).toBe(false);
    expect(state.payments).toHaveLength(2);
    expect(state.payments[0]).toMatchObject({
      status: 'FAILED',
      failureDescription: 'Payment failed because of a technical error at the bank',
    });

    // Asked again, nothing is written twice.
    await syncOrder(o.razorpayOrderId);
    expect(state.payments).toHaveLength(2);
  });

  it('leaves an order with no payment as it is', async () => {
    const o = order('f');
    expect(await syncOrder(o.razorpayOrderId)).toBe('unpaid');
    expect(o.status).toBe('PENDING');
  });

  it('does not count an authorised payment that is not yet captured', async () => {
    const o = order('g');
    gateway.set(o.razorpayOrderId, [{ id: 'pay_1', status: 'authorized', method: 'upi' }]);
    expect(await syncOrder(o.razorpayOrderId)).toBe('unpaid');
    expect(hasAccess()).toBe(false);
  });
});

describe('syncUnpaidOrders', () => {
  it('settles the unpaid orders in the window and counts the paid ones', async () => {
    const paid = order('h');
    const nothing = order('i');
    const old = order('j', { createdAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000) });
    gateway.set(paid.razorpayOrderId, [captured('pay_1')]);
    gateway.set(old.razorpayOrderId, [captured('pay_2')]);

    const count = await syncUnpaidOrders({ since: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000) });

    expect(count).toBe(1);
    expect(paid.status).toBe('PAID');
    expect(nothing.status).toBe('PENDING');
    expect(old.status).toBe('PENDING');
  });

  it('looks only at the one student’s orders when asked to', async () => {
    const mine = order('k');
    const theirs = order('l', { userId: 'user_2' });
    gateway.set(mine.razorpayOrderId, [captured('pay_1')]);
    gateway.set(theirs.razorpayOrderId, [captured('pay_2')]);

    await syncUnpaidOrders({ since: new Date(0), userId: 'user_1' });

    expect(mine.status).toBe('PAID');
    expect(theirs.status).toBe('PENDING');
  });

  it('carries on past an order Razorpay does not answer for', async () => {
    const stuck = order('m');
    const paid = order('n');
    unreachable.add(stuck.razorpayOrderId);
    gateway.set(paid.razorpayOrderId, [captured('pay_1')]);

    expect(await syncUnpaidOrders({ since: new Date(0) })).toBe(1);
    expect(paid.status).toBe('PAID');
  });
});

describe('the Razorpay webhook', () => {
  function delivery(body: object, secret = WEBHOOK_SECRET) {
    const raw = JSON.stringify(body);
    const signature = createHmac('sha256', secret).update(raw).digest('hex');
    return new Request('https://avkenvisions.com/api/webhooks/razorpay', {
      method: 'POST',
      headers: { 'x-razorpay-signature': signature },
      body: raw,
    });
  }

  const capturedEvent = (orderId: string) => ({
    entity: 'event',
    event: 'payment.captured',
    payload: { payment: { entity: { id: 'pay_w', order_id: orderId, method: 'upi' } } },
  });

  it('marks the order paid', async () => {
    const o = order('o');
    const response = await webhook(delivery(capturedEvent(o.razorpayOrderId)));
    expect(response.status).toBe(200);
    expect(o.status).toBe('PAID');
    expect(webhookLog().lastVerifiedAt).not.toBeNull();
  });

  it('acknowledges a payment for an order this site did not create, rather than failing', async () => {
    const response = await webhook(delivery(capturedEvent('order_from_elsewhere')));
    expect(response.status).toBe(200);
  });

  it('refuses a wrong secret, and notes it for the orders page', async () => {
    const o = order('p');
    const before = Date.now();
    const response = await webhook(delivery(capturedEvent(o.razorpayOrderId), 'not_the_secret'));
    expect(response.status).toBe(400);
    expect(o.status).toBe('PENDING');
    expect(webhookLog().lastRefusedAt!.getTime()).toBeGreaterThanOrEqual(before);
  });
});
