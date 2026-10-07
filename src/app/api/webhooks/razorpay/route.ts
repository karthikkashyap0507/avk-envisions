import { db } from '@/server/db';
import { logger } from '@/server/logger';
import {
  fulfilOrder,
  recordFailure,
  verifyWebhookSignature,
} from '@/server/services/payment-service';
import { webhookLog } from '@/server/services/payment-sync';

/**
 * POST /api/webhooks/razorpay
 *
 * The authoritative record of what was paid. The browser callback is faster but
 * unreliable — a student who closes the tab after paying never sends it — so
 * access ultimately depends on this.
 *
 * Read carefully before changing:
 *
 *   • The **raw body** is verified, not parsed JSON. `JSON.stringify` of a
 *     parsed object changes whitespace and key order, which changes the HMAC
 *     and would reject every genuine delivery.
 *
 *   • A bad signature returns 400 and does nothing. Without that check anyone
 *     who finds this URL could post "payment succeeded" and grant themselves
 *     the paid series.
 *
 *   • Anything verified returns 200, even when the event is one we ignore -
 *     a payment for an order this site did not create among them, as the
 *     Razorpay account may take payments elsewhere too. Razorpay retries
 *     non-2xx for hours and switches off a webhook that keeps failing, which
 *     would leave every later payment here unconfirmed.
 */
export const dynamic = 'force-dynamic';

interface RazorpayEntity {
  id?: string;
  order_id?: string;
  method?: string;
  error_code?: string;
  error_description?: string;
  error_reason?: string;
}

export async function POST(request: Request) {
  const signature = request.headers.get('x-razorpay-signature');
  const rawBody = await request.text();

  if (!signature || !verifyWebhookSignature(rawBody, signature)) {
    // Noted for the orders page only when it looks like Razorpay sent it.
    // Anyone can post to this address, and a scanner's junk must not read as
    // Razorpay's messages being refused.
    if (signature && looksLikeRazorpay(rawBody)) webhookLog().lastRefusedAt = new Date();
    logger.warn({ event: 'razorpay.webhook.rejected' }, 'Webhook signature did not verify');
    return new Response('invalid signature', { status: 400 });
  }
  webhookLog().lastVerifiedAt = new Date();

  let payload: {
    event?: string;
    payload?: {
      payment?: { entity?: RazorpayEntity };
      order?: { entity?: RazorpayEntity };
    };
  };

  try {
    payload = JSON.parse(rawBody);
  } catch {
    // Signed but unparseable. Accept it so Razorpay stops retrying; there is
    // nothing here we could act on.
    logger.error({ event: 'razorpay.webhook.malformed' }, 'Signed webhook body was not JSON');
    return new Response('ok', { status: 200 });
  }

  const event = payload.event ?? 'unknown';
  const payment = payload.payload?.payment?.entity;

  if (payment?.order_id && !(await isOurOrder(payment.order_id))) {
    logger.info(
      { event: 'razorpay.webhook.foreign', razorpayEvent: event, orderId: payment.order_id },
      'Webhook for an order this site did not create; ignored',
    );
    return new Response('ok', { status: 200 });
  }

  try {
    switch (event) {
      case 'payment.captured': {
        if (!payment?.order_id || !payment.id) break;
        const granted = await fulfilOrder({
          razorpayOrderId: payment.order_id,
          razorpayPaymentId: payment.id,
          method: payment.method,
          rawPayload: rawBody,
        });
        logger.info(
          { event: 'razorpay.webhook.captured', orderId: payment.order_id, granted },
          granted ? 'Access granted from webhook' : 'Already fulfilled',
        );
        break;
      }

      case 'payment.failed': {
        if (!payment?.order_id || !payment.id) break;
        await recordFailure({
          razorpayOrderId: payment.order_id,
          razorpayPaymentId: payment.id,
          code: payment.error_code,
          description: payment.error_description ?? payment.error_reason,
          rawPayload: rawBody,
        });
        break;
      }

      default:
        logger.debug({ event: 'razorpay.webhook.ignored', razorpayEvent: event }, 'Event ignored');
    }
  } catch (error) {
    // A 500 here makes Razorpay retry, which is what we want for a transient
    // database problem — the handler is idempotent, so a retry is safe.
    logger.error(
      { event: 'razorpay.webhook.error', razorpayEvent: event, err: error },
      'Webhook handling failed',
    );
    return new Response('handler error', { status: 500 });
  }

  return new Response('ok', { status: 200 });
}

/** An unverified body with the shape of a Razorpay delivery: an event for a Razorpay account. */
function looksLikeRazorpay(rawBody: string): boolean {
  try {
    const body = JSON.parse(rawBody) as { entity?: unknown; account_id?: unknown };
    return (
      body.entity === 'event' &&
      typeof body.account_id === 'string' &&
      body.account_id.startsWith('acc_')
    );
  } catch {
    return false;
  }
}

async function isOurOrder(razorpayOrderId: string): Promise<boolean> {
  try {
    const order = await db.order.findUnique({ where: { razorpayOrderId }, select: { id: true } });
    return order !== null;
  } catch {
    // Unsure. Let the handler run: if the database really is down it fails,
    // and Razorpay retries.
    return true;
  }
}
