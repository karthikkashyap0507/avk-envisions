import { parseBody, route } from '@/server/api-handler';
import { requireUser } from '@/server/auth/guards';
import { createSeriesCheckout, type CheckoutDraft } from '@/server/services/payment-service';
import { STUDENT_WINDOW_MS, syncUnpaidOrders, within } from '@/server/services/payment-sync';
import { createCheckoutSchema } from '@/validations/checkout';

/**
 * POST /api/checkout — opens a Razorpay order for a test series.
 *
 * The body names only the series. The amount is resolved from the live pricing
 * ladder on the server and frozen onto the order, so a client cannot nominate
 * what it would like to pay.
 */
export const POST = route<CheckoutDraft>(
  async ({ request }) => {
    const user = await requireUser();
    const input = await parseBody(request, createCheckoutSchema);

    // A student who paid but was never let in - the tab that would have
    // reported it was closed - comes back here to pay again. Their earlier
    // orders are settled with Razorpay first, so the payment they already made
    // gives them access instead of a second charge.
    await within(
      8_000,
      syncUnpaidOrders({ userId: user.id, since: new Date(Date.now() - STUDENT_WINDOW_MS) }),
    );

    const draft = await createSeriesCheckout({
      userId: user.id,
      seriesSlug: input.seriesSlug,
    });

    return { data: draft, message: 'Order created.', status: 201 };
  },
  { rateLimit: 'checkout' },
);
