import 'server-only';

import { cache } from 'react';
import { redirect } from 'next/navigation';

import { AppError, errors } from '@/lib/api';
import { serverEnv } from '@/lib/env';
import { isGuestEmail } from '@/server/services/guest-service';
import type { UserRole } from '@/lib/enums';
import { db } from '@/server/db';

import { getSession, type AuthenticatedSession, type SessionUser } from './session';
import {
  ADMIN_AREA_ROLES,
  atLeastRole,
  defaultRouteForRole,
  type Permission,
} from './permissions';

/**
 * Authorization guards.
 *
 * Two families exist and they are not interchangeable:
 *
 *   `require*`  — throw `AppError`. Use inside API route handlers and server
 *                 actions, where the caller converts the error into a JSON
 *                 failure envelope.
 *   `enforce*`  — redirect. Use inside server components and layouts, where a
 *                 browser navigation is the correct response.
 *
 * Both read from the same request-scoped cached session, so guarding a layout
 * and then guarding again inside a nested page costs one database query, not
 * two.
 */

/**
 * Request-scoped memoisation. `cache` dedupes within a single React render
 * pass, which is exactly the lifetime we want — never across requests.
 */
export const currentSession = cache(async (): Promise<AuthenticatedSession | null> => getSession());

export const currentUser = cache(async (): Promise<SessionUser | null> => {
  const session = await currentSession();
  return session?.user ?? null;
});

// ---------------------------------------------------------------------------
// API / server-action guards — throw
// ---------------------------------------------------------------------------

/** Requires any authenticated, active account. */
export async function requireUser(): Promise<SessionUser> {
  const user = await currentUser();
  if (!user) throw errors.unauthorized();
  if (user.status === 'SUSPENDED') {
    throw new AppError('ACCOUNT_SUSPENDED', 'Your account has been suspended. Contact support for help.');
  }
  return user;
}

/**
 * Requires a verified email address.
 *
 * Gating happens at the point of consumption (starting a test, checking out)
 * rather than at login, so an unverified student can still reach their profile
 * and re-send the verification email.
 */
export async function requireVerifiedUser(): Promise<SessionUser> {
  const user = await requireUser();
  // Guest accounts from the free-test lead capture have a generated `.invalid`
  // address by design. Holding them to email verification would make the free
  // test unreachable the moment verification is switched on.
  if (serverEnv().REQUIRE_EMAIL_VERIFICATION && !user.emailVerified && !isGuestEmail(user.email)) {
    throw new AppError(
      'EMAIL_NOT_VERIFIED',
      'Please verify your email address to continue. Check your inbox for the verification link.',
    );
  }
  return user;
}

export async function requireRole(...roles: UserRole[]): Promise<SessionUser> {
  const user = await requireUser();
  if (!roles.includes(user.role)) throw errors.forbidden();
  return user;
}

export async function requireMinimumRole(minimum: UserRole): Promise<SessionUser> {
  const user = await requireUser();
  if (!atLeastRole(user.role, minimum)) throw errors.forbidden();
  return user;
}

export async function requirePermission(...permissions: Permission[]): Promise<SessionUser> {
  const user = await requireUser();
  const held = new Set(user.permissions);
  const missing = permissions.filter((p) => !held.has(p));
  if (missing.length > 0) {
    throw errors.forbidden(`This action requires: ${missing.join(', ')}.`);
  }
  return user;
}

/** Requires at least one of the listed permissions. */
export async function requireAnyPermission(...permissions: Permission[]): Promise<SessionUser> {
  const user = await requireUser();
  const held = new Set(user.permissions);
  if (!permissions.some((p) => held.has(p))) throw errors.forbidden();
  return user;
}

export async function requireStudent(): Promise<SessionUser> {
  return requireRole('STUDENT');
}

/**
 * Requires an admin. Preferred over `requirePermission` when an endpoint is
 * wholly administrative — there is only one staff role, so naming it directly
 * reads more plainly than enumerating the permissions it implies.
 */
export async function requireAdmin(): Promise<SessionUser> {
  return requireRole('ADMIN');
}

// ---------------------------------------------------------------------------
// Server-component guards — redirect
// ---------------------------------------------------------------------------

/**
 * Requires a signed-in user, redirecting to login with a return path.
 * `next` is passed through so the student lands back where they were headed.
 */
export async function enforceAuth(returnTo?: string): Promise<SessionUser> {
  const user = await currentUser();
  if (!user) {
    const target = returnTo ? `/login?next=${encodeURIComponent(returnTo)}` : '/login';
    redirect(target);
  }
  if (user.status === 'SUSPENDED') redirect('/account-suspended');
  return user;
}

/**
 * Guards the student area. Staff are bounced to their own home rather than
 * shown an error, since landing here is a navigation mistake, not an attack.
 */
export async function enforceStudent(returnTo?: string): Promise<SessionUser> {
  const user = await enforceAuth(returnTo);
  if (user.role !== 'STUDENT') redirect(defaultRouteForRole(user.role));
  return user;
}

export async function enforceAdminArea(returnTo?: string): Promise<SessionUser> {
  const user = await enforceAuth(returnTo);
  if (!ADMIN_AREA_ROLES.includes(user.role)) redirect(defaultRouteForRole(user.role));
  return user;
}

/**
 * An admin page that also needs one specific permission.
 *
 * Being an admin is not enough on its own for every page: a staff account can
 * have single permissions revoked (see `ROLE_PERMISSIONS`), and a page that
 * only checked the role would ignore that — the link could be hidden and the
 * address typed in regardless. Sent back to the dashboard rather than shown an
 * error, since the page is simply not theirs.
 */
export async function enforceAdminPermission(
  permission: Permission,
  returnTo?: string,
): Promise<SessionUser> {
  const user = await enforceAdminArea(returnTo);
  if (!user.permissions.includes(permission)) redirect('/admin');
  return user;
}

/** Redirects an already-signed-in visitor away from /login and /register. */
export async function redirectIfAuthenticated(next?: string) {
  const user = await currentUser();
  if (user) redirect(next || defaultRouteForRole(user.role));
}

// ---------------------------------------------------------------------------
// Non-throwing checks for conditional UI
// ---------------------------------------------------------------------------

export function can(user: SessionUser | null, permission: Permission): boolean {
  return Boolean(user?.permissions.includes(permission));
}

export function canAny(user: SessionUser | null, ...permissions: Permission[]): boolean {
  if (!user) return false;
  const held = new Set(user.permissions);
  return permissions.some((p) => held.has(p));
}
