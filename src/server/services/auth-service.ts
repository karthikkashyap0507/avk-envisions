import 'server-only';

import {
  passwordChangedTemplate,
  passwordResetTemplate,
  verifyEmailTemplate,
  welcomeTemplate,
} from '@/emails/templates';
import { AppError, errors } from '@/lib/api';
import { serverEnv } from '@/lib/env';
import type { HeardAbout, UserRole } from '@/lib/enums';
import { toStored as heardAboutColumns } from '@/lib/heard-about';
import { AUDIT_ACTIONS, audit } from '@/server/audit';
import { checkPasswordStrength, hashPassword, verifyPassword } from '@/server/auth/password';
import { revokeAllSessions } from '@/server/auth/session';
import { TOKEN_TTL, expiryFromNow, generateToken, hashToken, isExpired } from '@/server/auth/tokens';
import { db } from '@/server/db';
import { sendEmail } from '@/server/email';
import { logger } from '@/server/logger';
import { rateLimit } from '@/server/rate-limit';
import { isPhoneIdentifier } from '@/validations/auth';
import { normalisePhone } from '@/validations/guest';

/**
 * Authentication business logic.
 *
 * Everything that mutates credentials lives here rather than in route handlers,
 * so the same rules apply whether a change arrives from the public API, an
 * admin action or a script.
 */

export interface RequestContext {
  ipAddress?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
}

/**
 * Failed sign-ins tolerated for a single account before it is temporarily
 * locked. Deliberately account-scoped as well as IP-scoped: an attacker
 * rotating IPs still cannot grind one account.
 */
const MAX_FAILED_ATTEMPTS_PER_ACCOUNT = 8;
const LOCKOUT_WINDOW_MS = 15 * 60 * 1000;

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export interface RegisterParams {
  name: string;
  email: string;
  /** Ten digits, no country code. Required for new accounts. */
  phone: string;
  password: string;
  /** "How did you hear about us?" — what was ticked; empty when skipped. */
  heardAbout?: HeardAbout[];
  /** Their own words, kept only when "Other" is among `heardAbout`. */
  heardAboutOther?: string;
  context?: RequestContext;
}

export interface RegisterResult {
  userId: string;
  emailVerificationRequired: boolean;
}

/**
 * Creates a student account.
 *
 * Note on user enumeration: this returns an explicit "already registered"
 * conflict rather than a generic response. That is a deliberate trade — it is
 * the behaviour users expect from a signup form, and the endpoint is rate
 * limited per IP, which bounds enumeration to a few attempts per hour. The
 * password-reset flow, where no such UX pressure exists, is non-enumerating.
 */
export async function registerUser({
  name,
  email,
  phone,
  password,
  heardAbout = [],
  heardAboutOther,
  context,
}: RegisterParams): Promise<RegisterResult> {
  const emailNormal = email.trim().toLowerCase();

  // Stored as ten bare digits, matching the free-test lead capture, so one
  // person arriving by either route is recognisable as the same number.
  const phoneDigits = normalisePhone(phone);
  if (phoneDigits.length !== 10) {
    throw errors.validation({ phone: ['Enter a valid 10-digit mobile number'] });
  }

  const strength = checkPasswordStrength(password, { email: emailNormal, name });
  if (!strength.valid) {
    throw errors.validation({ password: strength.errors });
  }

  const existing = await db.user.findUnique({
    where: { emailNormal },
    select: { id: true },
  });
  if (existing) {
    throw new AppError('CONFLICT', 'An account with this email address already exists.', {
      details: { email: ['This email is already registered. Try signing in instead.'] },
    });
  }

  const passwordHash = await hashPassword(password);
  const { token, tokenHash } = generateToken();
  const requireVerification = serverEnv().REQUIRE_EMAIL_VERIFICATION;

  // One transaction so a student never ends up with an account but no
  // notification preferences or streak row.
  const user = await db.$transaction(async (tx) => {
    const created = await tx.user.create({
      data: {
        name: name.trim(),
        email: emailNormal,
        emailNormal,
        phone: phoneDigits,
        passwordHash,
        role: 'STUDENT' satisfies UserRole,
        status: requireVerification ? 'PENDING_VERIFICATION' : 'ACTIVE',
        emailVerified: requireVerification ? null : new Date(),
        // Always written, even empty: `[]` records that they were asked and
        // skipped it, which NULL (never asked) does not.
        ...heardAboutColumns(heardAbout, heardAboutOther),
      },
      select: { id: true, name: true, email: true },
    });

    await tx.studentProfile.create({
      data: { userId: created.id, displayName: created.name },
    });
    await tx.notificationPreference.create({ data: { userId: created.id } });
    await tx.streak.create({ data: { userId: created.id } });

    await tx.emailVerificationToken.create({
      data: {
        userId: created.id,
        tokenHash,
        expiresAt: expiryFromNow(TOKEN_TTL.emailVerification),
      },
    });

    return created;
  });

  await audit({
    actor: { id: user.id, email: user.email, role: 'STUDENT' },
    action: AUDIT_ACTIONS.USER_REGISTERED,
    entityType: 'User',
    entityId: user.id,
    ipAddress: context?.ipAddress,
    userAgent: context?.userAgent,
    requestId: context?.requestId,
  });

  await sendEmail({
    to: user.email,
    email: verifyEmailTemplate({ name: user.name, token }),
    userId: user.id,
  });

  return { userId: user.id, emailVerificationRequired: requireVerification };
}

// ---------------------------------------------------------------------------
// Sign-in
// ---------------------------------------------------------------------------

export interface AuthenticateParams {
  email: string;
  password: string;
  context?: RequestContext;
}

export interface AuthenticatedAccount {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  emailVerified: boolean;
}

/**
 * Verifies credentials.
 *
 * Failure is always reported with the same message and, as far as practical,
 * the same amount of work, so the response cannot be used to discover which
 * email addresses exist.
 */
export async function authenticate({
  email,
  password,
  context,
}: AuthenticateParams): Promise<AuthenticatedAccount> {
  const emailNormal = email.trim().toLowerCase();

  // The throttle and lockout key. A number is reduced to its ten digits so
  // "+91 98765 43210" and "9876543210" share one bucket rather than handing an
  // attacker a fresh allowance per spelling.
  const throttleKey = isPhoneIdentifier(email) ? normalisePhone(email) : emailNormal;

  // Per-account throttle, layered on top of the per-IP limit applied by the
  // route wrapper.
  const accountLimit = await rateLimit('loginPerAccount', throttleKey);
  if (!accountLimit.allowed) {
    await recordLoginAttempt(throttleKey, context, false, 'rate_limited');
    throw new AppError('RATE_LIMITED', 'Too many sign-in attempts. Please try again in a few minutes.');
  }

  if (await isAccountLockedOut(throttleKey)) {
    await recordLoginAttempt(throttleKey, context, false, 'locked_out');
    throw new AppError(
      'RATE_LIMITED',
      'Too many failed sign-in attempts for this account. Please wait 15 minutes or reset your password.',
    );
  }

  const account = {
    id: true,
    name: true,
    email: true,
    role: true,
    status: true,
    passwordHash: true,
    emailVerified: true,
    deletedAt: true,
  } as const;

  // Email or mobile number. `phone` is not unique — the free-test lead capture
  // creates a guest account keyed on a number, so one person can hold both a
  // guest row and a registered one. Only REGISTERED accounts are considered:
  // a guest is created without a usable password and signing in as one would
  // be meaningless, so matching it would just deny the person their real
  // account. Newest first, in the unlikely event of two.
  const user = isPhoneIdentifier(email)
    ? await db.user.findFirst({
        where: {
          phone: normalisePhone(email),
          deletedAt: null,
          signupSource: 'REGISTERED',
        },
        select: account,
        orderBy: { createdAt: 'desc' },
      })
    : await db.user.findUnique({ where: { emailNormal }, select: account });

  const invalidCredentials = errors.unauthorized(
    'The email, mobile number or password you entered is incorrect.',
  );

  if (!user || user.deletedAt) {
    // Burn a comparable amount of CPU so a missing account is not detectably
    // faster than a wrong password.
    await hashPassword(password);
    await recordLoginAttempt(throttleKey, context, false, 'no_such_user');
    throw invalidCredentials;
  }

  const passwordValid = await verifyPassword(user.passwordHash, password);
  if (!passwordValid) {
    await recordLoginAttempt(throttleKey, context, false, 'bad_password');
    await audit({
      actor: { id: user.id, email: user.email, role: user.role },
      action: AUDIT_ACTIONS.LOGIN_FAILED,
      entityType: 'User',
      entityId: user.id,
      ipAddress: context?.ipAddress,
      userAgent: context?.userAgent,
    });
    throw invalidCredentials;
  }

  if (user.status === 'SUSPENDED') {
    await recordLoginAttempt(throttleKey, context, false, 'suspended');
    throw new AppError(
      'ACCOUNT_SUSPENDED',
      'Your account has been suspended. Please contact support for assistance.',
    );
  }
  if (user.status === 'DELETED') {
    await recordLoginAttempt(throttleKey, context, false, 'deleted');
    throw invalidCredentials;
  }

  await recordLoginAttempt(throttleKey, context, true);

  await db.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date(), lastSeenAt: new Date() },
  });

  await audit({
    actor: { id: user.id, email: user.email, role: user.role },
    action: AUDIT_ACTIONS.LOGIN_SUCCESS,
    entityType: 'User',
    entityId: user.id,
    ipAddress: context?.ipAddress,
    userAgent: context?.userAgent,
    requestId: context?.requestId,
  });

  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role as UserRole,
    emailVerified: Boolean(user.emailVerified),
  };
}

async function recordLoginAttempt(
  emailNormal: string,
  context: RequestContext | undefined,
  successful: boolean,
  reason?: string,
) {
  try {
    await db.loginAttempt.create({
      data: {
        emailNormal,
        ipAddress: context?.ipAddress ?? null,
        successful,
        reason: reason ?? null,
      },
    });
  } catch (error) {
    logger.warn({ error }, 'Failed to record login attempt');
  }
}

async function isAccountLockedOut(emailNormal: string) {
  const since = new Date(Date.now() - LOCKOUT_WINDOW_MS);

  // A successful sign-in inside the window clears the lockout, so a user who
  // gets in and then mistypes again is not punished for earlier mistakes.
  const lastSuccess = await db.loginAttempt.findFirst({
    where: { emailNormal, successful: true, createdAt: { gte: since } },
    orderBy: { createdAt: 'desc' },
    select: { createdAt: true },
  });

  const failures = await db.loginAttempt.count({
    where: {
      emailNormal,
      successful: false,
      createdAt: { gte: lastSuccess?.createdAt ?? since },
    },
  });

  return failures >= MAX_FAILED_ATTEMPTS_PER_ACCOUNT;
}

// ---------------------------------------------------------------------------
// Email verification
// ---------------------------------------------------------------------------

export async function verifyEmailToken(token: string, context?: RequestContext) {
  const record = await db.emailVerificationToken.findUnique({
    where: { tokenHash: hashToken(token) },
    select: {
      id: true,
      usedAt: true,
      expiresAt: true,
      user: { select: { id: true, name: true, email: true, emailVerified: true, status: true } },
    },
  });

  if (!record || record.usedAt || isExpired(record.expiresAt)) {
    throw new AppError(
      'BAD_REQUEST',
      'This verification link is invalid or has expired. Request a new one from your account settings.',
    );
  }

  const { user } = record;

  // Already verified: treat as success so a double-clicked link is not an error.
  if (user.emailVerified) {
    return { alreadyVerified: true, userId: user.id };
  }

  await db.$transaction([
    db.emailVerificationToken.update({
      where: { id: record.id },
      data: { usedAt: new Date() },
    }),
    db.user.update({
      where: { id: user.id },
      data: {
        emailVerified: new Date(),
        status: user.status === 'PENDING_VERIFICATION' ? 'ACTIVE' : user.status,
      },
    }),
    // Any other outstanding verification tokens are now moot.
    db.emailVerificationToken.updateMany({
      where: { userId: user.id, usedAt: null },
      data: { usedAt: new Date() },
    }),
  ]);

  await audit({
    actor: { id: user.id, email: user.email, role: 'STUDENT' },
    action: AUDIT_ACTIONS.EMAIL_VERIFIED,
    entityType: 'User',
    entityId: user.id,
    ipAddress: context?.ipAddress,
  });

  await sendEmail({ to: user.email, email: welcomeTemplate({ name: user.name }), userId: user.id });

  return { alreadyVerified: false, userId: user.id };
}

/** Issues a fresh verification email. Non-enumerating. */
export async function resendVerificationEmail(email: string) {
  const emailNormal = email.trim().toLowerCase();

  const user = await db.user.findUnique({
    where: { emailNormal },
    select: { id: true, name: true, email: true, emailVerified: true, deletedAt: true },
  });

  if (!user || user.deletedAt || user.emailVerified) return;

  const { token, tokenHash } = generateToken();

  await db.$transaction([
    db.emailVerificationToken.updateMany({
      where: { userId: user.id, usedAt: null },
      data: { usedAt: new Date() },
    }),
    db.emailVerificationToken.create({
      data: { userId: user.id, tokenHash, expiresAt: expiryFromNow(TOKEN_TTL.emailVerification) },
    }),
  ]);

  await sendEmail({
    to: user.email,
    email: verifyEmailTemplate({ name: user.name, token }),
    userId: user.id,
  });
}

// ---------------------------------------------------------------------------
// Password reset
// ---------------------------------------------------------------------------

/**
 * Starts a password reset.
 *
 * Always resolves successfully, whether or not the address is registered. The
 * caller shows the same confirmation either way, so this endpoint cannot be
 * used to test which emails have accounts.
 */
export async function requestPasswordReset(email: string, context?: RequestContext) {
  const emailNormal = email.trim().toLowerCase();

  const user = await db.user.findUnique({
    where: { emailNormal },
    select: { id: true, name: true, email: true, status: true, deletedAt: true },
  });

  if (!user || user.deletedAt || user.status === 'DELETED') return;

  const { token, tokenHash } = generateToken();

  await db.$transaction([
    // Invalidate outstanding tokens so only the newest link works.
    db.passwordResetToken.updateMany({
      where: { userId: user.id, usedAt: null },
      data: { usedAt: new Date() },
    }),
    db.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash,
        expiresAt: expiryFromNow(TOKEN_TTL.passwordReset),
        ipAddress: context?.ipAddress ?? null,
      },
    }),
  ]);

  await audit({
    actor: { id: user.id, email: user.email },
    action: AUDIT_ACTIONS.PASSWORD_RESET_REQUESTED,
    entityType: 'User',
    entityId: user.id,
    ipAddress: context?.ipAddress,
  });

  await sendEmail({
    to: user.email,
    email: passwordResetTemplate({ name: user.name, token }),
    userId: user.id,
  });
}

/** Completes a password reset and signs the account out everywhere. */
export async function resetPassword(token: string, newPassword: string, context?: RequestContext) {
  const record = await db.passwordResetToken.findUnique({
    where: { tokenHash: hashToken(token) },
    select: {
      id: true,
      usedAt: true,
      expiresAt: true,
      user: { select: { id: true, name: true, email: true, role: true } },
    },
  });

  if (!record || record.usedAt || isExpired(record.expiresAt)) {
    throw new AppError(
      'BAD_REQUEST',
      'This reset link is invalid or has expired. Please request a new one.',
    );
  }

  const { user } = record;

  const strength = checkPasswordStrength(newPassword, { email: user.email, name: user.name });
  if (!strength.valid) {
    throw errors.validation({ password: strength.errors });
  }

  const passwordHash = await hashPassword(newPassword);

  await db.$transaction([
    db.passwordResetToken.update({ where: { id: record.id }, data: { usedAt: new Date() } }),
    db.user.update({ where: { id: user.id }, data: { passwordHash } }),
  ]);

  // A reset is the response to a possible compromise, so every existing
  // session must die — including the attacker's.
  await revokeAllSessions(user.id);

  await audit({
    actor: { id: user.id, email: user.email, role: user.role },
    action: AUDIT_ACTIONS.PASSWORD_RESET_COMPLETED,
    entityType: 'User',
    entityId: user.id,
    ipAddress: context?.ipAddress,
  });

  await sendEmail({
    to: user.email,
    email: passwordChangedTemplate({
      name: user.name,
      when: new Date(),
      ip: context?.ipAddress ?? null,
    }),
    userId: user.id,
  });

  return { userId: user.id };
}

// ---------------------------------------------------------------------------
// Password change (authenticated)
// ---------------------------------------------------------------------------

export async function changePassword(params: {
  userId: string;
  currentPassword: string;
  newPassword: string;
  signOutOtherDevices: boolean;
  context?: RequestContext;
}) {
  const { userId, currentPassword, newPassword, signOutOtherDevices, context } = params;

  const user = await db.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, email: true, role: true, passwordHash: true },
  });
  if (!user) throw errors.notFound('Account');

  if (!(await verifyPassword(user.passwordHash, currentPassword))) {
    throw errors.validation({ currentPassword: ['That is not your current password.'] });
  }

  const strength = checkPasswordStrength(newPassword, { email: user.email, name: user.name });
  if (!strength.valid) {
    throw errors.validation({ newPassword: strength.errors });
  }

  const passwordHash = await hashPassword(newPassword);
  await db.user.update({ where: { id: user.id }, data: { passwordHash } });

  if (signOutOtherDevices) {
    // Bumping the epoch invalidates this device too; the caller re-issues a
    // session so the user stays signed in where they are.
    await revokeAllSessions(user.id);
  }

  await audit({
    actor: { id: user.id, email: user.email, role: user.role },
    action: AUDIT_ACTIONS.PASSWORD_CHANGED,
    entityType: 'User',
    entityId: user.id,
    meta: { signedOutOtherDevices: signOutOtherDevices },
    ipAddress: context?.ipAddress,
  });

  await sendEmail({
    to: user.email,
    email: passwordChangedTemplate({
      name: user.name,
      when: new Date(),
      ip: context?.ipAddress ?? null,
    }),
    userId: user.id,
  });

  return { requiresReauthentication: signOutOtherDevices };
}
