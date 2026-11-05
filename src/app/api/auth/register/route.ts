import { defaultRouteForRole } from '@/server/auth/permissions';
import { createSession } from '@/server/auth/session';
import { parseBody, route } from '@/server/api-handler';
import { registerUser } from '@/server/services/auth-service';
import { registerSchema } from '@/validations/auth';

/**
 * POST /api/auth/register
 *
 * Creates a student account and signs them in immediately. Email verification
 * is still required before entitlement-gated actions (starting a test,
 * checking out); gating at that point rather than at signup lets a new student
 * explore the product while their verification email is in flight.
 */
export const POST = route(
  async ({ request, ip, requestId }) => {
    const input = await parseBody(request, registerSchema);
    const userAgent = request.headers.get('user-agent');

    const result = await registerUser({
      name: input.name,
      email: input.email,
      phone: input.phone,
      password: input.password,
      heardAbout: input.heardAbout,
      heardAboutOther: input.heardAboutOther,
      context: { ipAddress: ip, userAgent, requestId },
    });

    await createSession({ userId: result.userId, ipAddress: ip, userAgent });

    return {
      data: {
        userId: result.userId,
        emailVerificationRequired: result.emailVerificationRequired,
        redirectTo: '/onboarding',
        defaultRoute: defaultRouteForRole('STUDENT'),
      },
      message: result.emailVerificationRequired
        ? 'Account created. Check your inbox to verify your email address.'
        : 'Account created. Welcome to AVK Envisions.',
      status: 201,
    };
  },
  { rateLimit: 'register' },
);
