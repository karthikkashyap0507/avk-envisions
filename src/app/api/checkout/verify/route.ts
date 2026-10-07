import { parseBody, route } from '@/server/api-handler';
import { requireUser } from '@/server/auth/guards';
import { AppError } from '@/lib/api';
import { db } from '@/server/db';
import { fulfilOrder, verifyCheckoutSignature } from '@/server/services/payment-service';
import { destinationFor } from '@/server/services/purchased-service';
import { verifyCheckoutSchema } from '@/validations/checkout';

/**
 * POST /api/checkout/verify — confirms a payment the browser just completed.
 *
 * This is the fast path so a student gets access immediately rather than
 * waiting on the webhook. It is not the authoritative one: the webhook covers
 * the case where the browser is closed before this fires, and both converge on
 * the same idempotent fulfilment.
 */
export const POST = route<{ granted: boolean; redirectTo: string; courseName: string }>(
  async ({ request }) => {
    await requireUser();
    const input = await parseBody(request, verifyCheckoutSchema);

    const valid = verifyCheckoutSignature({
      razorpayOrderId: input.razorpay_order_id,
      razorpayPaymentId: input.razorpay_payment_id,
      signature: input.razorpay_signature,
    });

    if (!valid) {
      throw new AppError(
        'FORBIDDEN',
        'This payment could not be verified. If money has left your account, contact support with your order number.',
      );
    }

    const granted = await fulfilOrder({
      razorpayOrderId: input.razorpay_order_id,
      razorpayPaymentId: input.razorpay_payment_id,
      signature: input.razorpay_signature,
    });

    // Where the buyer should land. A receipt page is not what someone who has
    // just paid wants — they want the thing they bought — so the destination
    // travels back with the confirmation rather than the browser guessing.
    const order = await db.order.findUnique({
      where: { razorpayOrderId: input.razorpay_order_id },
      select: {
        items: {
          select: { testSeries: { select: { slug: true, name: true } } },
          take: 1,
        },
      },
    });

    const series = order?.items[0]?.testSeries;
    const destination = series
      ? destinationFor(series.slug, series.name)
      : { name: 'your courses', href: '/dashboard' };

    return {
      data: { granted, redirectTo: destination.href, courseName: destination.name },
      message: 'Payment confirmed. Your access is active.',
    };
  },
  { rateLimit: 'checkoutVerify' },
);
