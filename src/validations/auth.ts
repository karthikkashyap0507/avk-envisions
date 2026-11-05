import { z } from 'zod';

import { HEARD_ABOUT_OTHER_MAX, HeardAbout, Language } from '@/lib/enums';
// Imported from `lib`, not `server`, so these schemas stay usable in client
// components — the server-side module pulls in a native Argon2 addon.
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '@/lib/password-policy';

import { cuidSchema, emailSchema, nameSchema, optionalText } from './common';

/**
 * Authentication input schemas.
 *
 * These run on both sides of the wire: the client form uses them for instant
 * feedback, and the API re-runs the identical schema because client validation
 * is a convenience, never a control.
 */

/**
 * Length only. Composition requirements were removed by product decision —
 * see the note in `@/lib/password-policy`.
 */
export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `Password must be at least ${PASSWORD_MIN_LENGTH} characters`)
  .max(PASSWORD_MAX_LENGTH, `Password must be at most ${PASSWORD_MAX_LENGTH} characters`);

/**
 * Mobile number, required at registration.
 *
 * The same rule the free-test lead capture uses, so a number captured either
 * way is stored identically — ten digits, no country code. It is a contact
 * detail rather than a credential at signup; nothing is sent to it.
 */
export const registerPhoneSchema = z
  .string()
  .trim()
  .min(1, 'Mobile number is required')
  .regex(/^(?:\+91[-\s]?)?[6-9]\d{9}$/, 'Enter a valid 10-digit mobile number');

export const registerSchema = z
  .object({
    name: nameSchema,
    email: emailSchema,
    phone: registerPhoneSchema,
    password: passwordSchema,
    confirmPassword: z.string(),
    /**
     * "How did you hear about us?" — optional, any number ticked, including
     * none. Duplicates are dropped rather than refused, and the codes are kept
     * in the order the form lists them, so two answers that mean the same
     * thing are stored the same way.
     */
    heardAbout: z
      .array(HeardAbout.schema)
      .max(10)
      .default([])
      .transform((codes) => HeardAbout.values.filter((code) => codes.includes(code))),
    /** Their own words, for "Other". Ignored unless "Other" is ticked. */
    heardAboutOther: z
      .string()
      .trim()
      .max(HEARD_ABOUT_OTHER_MAX, `Please keep this under ${HEARD_ABOUT_OTHER_MAX} characters`)
      .optional(),
    /** Explicit consent, required before an account is created. */
    acceptTerms: z.literal(true, {
      errorMap: () => ({ message: 'Please accept the Terms and Privacy Policy to continue' }),
    }),
  })
  .refine((v) => v.password === v.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });

export type RegisterInput = z.infer<typeof registerSchema>;

/**
 * What someone types into the sign-in box: an email address or a mobile
 * number.
 *
 * Validated loosely on purpose. A precise rule here would tell an attacker
 * which of the two they had got wrong, and an existing account whose email
 * predates the current rule must still be able to sign in. The server decides
 * which kind it is and looks it up; anything that matches nothing gets the
 * same answer as a wrong password.
 */
export const loginIdentifierSchema = z
  .string()
  .trim()
  .min(1, 'Enter your email address or mobile number')
  .max(254);

export function isPhoneIdentifier(value: string): boolean {
  return /^(?:\+91[-\s]?)?[6-9]\d{9}$/.test(value.trim());
}

export const loginSchema = z.object({
  /**
   * Either an email address or a 10-digit mobile number.
   *
   * Still called `email` on the wire: the field name is part of the API that
   * the login form, the tests and every existing client already send, and
   * renaming it would break them for no gain to the person signing in.
   */
  email: loginIdentifierSchema,
  /**
   * Deliberately not `passwordSchema`: an existing password predating a policy
   * change must still be accepted at sign-in, and echoing any policy on the
   * login form leaks it to an attacker for no benefit.
   */
  password: z.string().min(1, 'Enter your password').max(PASSWORD_MAX_LENGTH),
  // `.default()` without `.optional()`, so the parsed output is a plain boolean
  // rather than `boolean | undefined`.
  rememberMe: z.boolean().default(true),
  /** Post-login redirect. Validated as a safe relative path before use. */
  next: z.string().optional(),
});

export type LoginInput = z.infer<typeof loginSchema>;

export const forgotPasswordSchema = z.object({
  email: emailSchema,
});

export const resetPasswordSchema = z
  .object({
    token: z.string().min(20, 'This reset link is invalid').max(200),
    password: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((v) => v.password === v.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });

export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Enter your current password'),
    newPassword: passwordSchema,
    confirmPassword: z.string(),
    /** Ends every other session after the change. Defaults on for safety. */
    signOutOtherDevices: z.boolean().default(true),
  })
  .refine((v) => v.newPassword === v.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  })
  .refine((v) => v.newPassword !== v.currentPassword, {
    message: 'Your new password must be different from your current one',
    path: ['newPassword'],
  });

export const verifyEmailSchema = z.object({
  token: z.string().min(20, 'This verification link is invalid').max(200),
});

export const resendVerificationSchema = z.object({
  email: emailSchema,
});

// ---------------------------------------------------------------------------
// Profile & onboarding
// ---------------------------------------------------------------------------

/** Collected after registration; every field is optional and skippable. */
export const onboardingSchema = z.object({
  targetExamId: cuidSchema.optional(),
  targetYear: z
    .number()
    .int()
    .min(new Date().getFullYear())
    .max(new Date().getFullYear() + 6)
    .optional(),
  preferredLanguage: Language.schema.default('en'),
  city: optionalText(80),
  state: optionalText(80),
});

export const updateProfileSchema = z.object({
  name: nameSchema,
  displayName: optionalText(40),
  city: optionalText(80),
  state: optionalText(80),
  targetExamId: cuidSchema.optional().nullable(),
  targetYear: z.number().int().min(2000).max(2100).optional().nullable(),
  preferredLanguage: Language.schema.optional(),
  /** Controls whether the student appears on public leaderboards. */
  leaderboardVisible: z.boolean().optional(),
});

export const revokeSessionSchema = z.object({
  sessionId: cuidSchema,
});

// ---------------------------------------------------------------------------
// Redirect safety
// ---------------------------------------------------------------------------

/**
 * Sanitises a post-login redirect target.
 *
 * Only same-site absolute paths are allowed. Anything else — a full URL, a
 * protocol-relative `//evil.com`, or a backslash variant that some browsers
 * normalise to a slash — is discarded in favour of the caller's fallback,
 * which is what prevents open-redirect phishing off the login page.
 */
export function safeRedirectPath(input: string | null | undefined, fallback = '/dashboard'): string {
  if (!input) return fallback;

  const value = input.trim();
  if (!value.startsWith('/')) return fallback;
  if (value.startsWith('//') || value.startsWith('/\\')) return fallback;
  if (value.includes('\\')) return fallback;
  // Reject control characters that could smuggle a header or split the URL.
  if ([...value].some((ch) => ch.charCodeAt(0) < 32)) return fallback;

  return value;
}
