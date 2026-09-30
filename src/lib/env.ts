/**
 * Environment configuration.
 *
 * Server variables are validated lazily on first access so that importing this
 * module from a client bundle (which only ever touches `publicEnv`) never
 * throws. In production a missing or malformed required secret is a hard
 * failure — we refuse to boot rather than silently run with a broken payment
 * or email integration.
 */
import { z } from 'zod';

const booleanish = z
  .union([z.boolean(), z.string()])
  .transform((v) => (typeof v === 'boolean' ? v : ['1', 'true', 'yes', 'on'].includes(v.toLowerCase())));

const intFromString = (fallback: number) =>
  z
    .union([z.number(), z.string()])
    .optional()
    .transform((v) => {
      if (v === undefined || v === '') return fallback;
      const n = typeof v === 'number' ? v : Number.parseInt(v, 10);
      return Number.isFinite(n) ? n : fallback;
    });

const serverSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

    DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

    AUTH_SECRET: z.string().default(''),
    SESSION_MAX_AGE_DAYS: intFromString(30),
    REQUIRE_EMAIL_VERIFICATION: booleanish.default(true),

    EMAIL_PROVIDER: z.enum(['resend', 'console']).default('console'),
    EMAIL_API_KEY: z.string().optional().default(''),
    EMAIL_FROM: z.string().default('AVK Envisions <no-reply@avkvisions.com>'),
    EMAIL_REPLY_TO: z.string().optional().default(''),

    RAZORPAY_KEY_ID: z.string().optional().default(''),
    RAZORPAY_KEY_SECRET: z.string().optional().default(''),
    RAZORPAY_WEBHOOK_SECRET: z.string().optional().default(''),
    RAZORPAY_LIVE_MODE: booleanish.default(false),

    INVOICE_TAX_PERCENT: intFromString(18),
    INVOICE_SERIES_PREFIX: z.string().default('AVK'),
    INVOICE_LEGAL_NAME: z.string().default('AVK Envisions'),
    INVOICE_LEGAL_ADDRESS: z.string().default(''),
    INVOICE_GSTIN: z.string().optional().default(''),

    STORAGE_DRIVER: z.enum(['s3', 'local']).default('local'),
    STORAGE_ENDPOINT: z.string().optional().default(''),
    STORAGE_REGION: z.string().default('auto'),
    STORAGE_ACCESS_KEY: z.string().optional().default(''),
    STORAGE_SECRET_KEY: z.string().optional().default(''),
    STORAGE_BUCKET: z.string().optional().default(''),
    STORAGE_MAX_UPLOAD_MB: intFromString(10),

    REDIS_URL: z.string().optional().default(''),

    AI_PROVIDER: z.enum(['anthropic', 'openai', 'disabled']).default('disabled'),
    AI_API_KEY: z.string().optional().default(''),
    AI_MODEL: z.string().default('claude-sonnet-5'),
    AI_BASE_URL: z.string().optional().default(''),
    AI_MAX_OUTPUT_TOKENS: intFromString(4096),

    // The local Kannada translation engine (translator/server.py), reached
    // over loopback. No key: it is an open-source model on the same machine.
    TRANSLATOR_URL: z.string().default('http://127.0.0.1:8911'),
    // Whether idle time is spent translating the question bank ahead of
    // students asking for it. "off" still translates on demand.
    TRANSLATION_BACKGROUND: z.enum(['on', 'off']).default('on'),

    SENTRY_DSN: z.string().optional().default(''),
    LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),

    WHATSAPP_PROVIDER: z.enum(['disabled', 'meta']).default('disabled'),
    WHATSAPP_API_KEY: z.string().optional().default(''),
    WHATSAPP_PHONE_NUMBER_ID: z.string().optional().default(''),

    SEED_ADMIN_EMAIL: z.string().email().default('admin@avkvisions.com'),
    SEED_ADMIN_PASSWORD: z.string().default('ChangeMe!Admin2024'),
  })
  .superRefine((val, ctx) => {
    const addIssue = (path: string, message: string) =>
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path], message });

    // Development runs happily with placeholders; production must not.
    if (val.NODE_ENV !== 'production') return;

    if (val.AUTH_SECRET.length < 32) {
      addIssue('AUTH_SECRET', 'must be at least 32 characters in production');
    }
    if (val.EMAIL_PROVIDER === 'resend' && !val.EMAIL_API_KEY) {
      addIssue('EMAIL_API_KEY', 'is required when EMAIL_PROVIDER=resend');
    }
    if (val.STORAGE_DRIVER === 's3') {
      if (!val.STORAGE_BUCKET) addIssue('STORAGE_BUCKET', 'is required when STORAGE_DRIVER=s3');
      if (!val.STORAGE_ACCESS_KEY) addIssue('STORAGE_ACCESS_KEY', 'is required when STORAGE_DRIVER=s3');
      if (!val.STORAGE_SECRET_KEY) addIssue('STORAGE_SECRET_KEY', 'is required when STORAGE_DRIVER=s3');
    }
    // Local disk storage is intentionally *not* an error here. This stack is
    // single-node by design (SQLite, in-process rate limiting), and a
    // self-hosted deployment writing uploads to a mounted volume is coherent.
    // `warnings()` surfaces it at boot instead, since it does rule out running
    // more than one instance.
    if (val.AI_PROVIDER !== 'disabled' && !val.AI_API_KEY) {
      addIssue('AI_API_KEY', 'is required when AI_PROVIDER is enabled');
    }
    if (val.RAZORPAY_LIVE_MODE) {
      if (!val.RAZORPAY_KEY_ID) addIssue('RAZORPAY_KEY_ID', 'is required in live mode');
      if (!val.RAZORPAY_KEY_SECRET) addIssue('RAZORPAY_KEY_SECRET', 'is required in live mode');
      if (!val.RAZORPAY_WEBHOOK_SECRET) {
        addIssue('RAZORPAY_WEBHOOK_SECRET', 'is required in live mode — unverified webhooks grant free access');
      }
    }
  });

export type ServerEnv = z.infer<typeof serverSchema>;

let cached: ServerEnv | null = null;

/**
 * Validated server environment. Throws once, loudly, with every problem listed
 * rather than failing later at an unrelated call site.
 */
export function serverEnv(): ServerEnv {
  if (cached) return cached;

  const parsed = serverSchema.safeParse(process.env);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((i) => `  • ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${details}`);
  }

  cached = parsed.data;
  return cached;
}

/**
 * Values safe to reference from client components. Next.js inlines these at
 * build time, so they must be read as full literal property accesses.
 */
export const publicEnv = {
  appUrl: process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
  appName: process.env.NEXT_PUBLIC_APP_NAME || 'AVK Envisions',
  razorpayKeyId: process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID || '',
  storagePublicUrl: process.env.NEXT_PUBLIC_STORAGE_PUBLIC_URL || '',
  analyticsKey: process.env.NEXT_PUBLIC_ANALYTICS_KEY || '',
  analyticsHost: process.env.NEXT_PUBLIC_ANALYTICS_HOST || 'https://app.posthog.com',
  sentryDsn: process.env.NEXT_PUBLIC_SENTRY_DSN || '',
} as const;

export const isProduction = () => process.env.NODE_ENV === 'production';
export const isDevelopment = () => process.env.NODE_ENV === 'development';
export const isTest = () => process.env.NODE_ENV === 'test';

/**
 * Non-fatal configuration problems, reported once at startup.
 *
 * These are settings that work but constrain the deployment — running them
 * knowingly is fine, running them by accident is not.
 */
export function configWarnings(): string[] {
  const env = serverEnv();
  const warnings: string[] = [];

  if (!isProduction()) return warnings;

  if (env.STORAGE_DRIVER === 'local') {
    warnings.push(
      'STORAGE_DRIVER=local writes uploads to the application server’s disk. This limits you to a single instance and loses files on an ephemeral filesystem. Use s3 for multi-instance or containerised deployments.',
    );
  }
  if (!env.REDIS_URL) {
    warnings.push(
      'REDIS_URL is unset, so rate limiting is per-process. Correct for a single node; configure Redis before scaling horizontally.',
    );
  }
  if (env.EMAIL_PROVIDER === 'console') {
    warnings.push('EMAIL_PROVIDER=console — transactional email is logged, not delivered.');
  }
  if (env.DATABASE_URL.startsWith('file:')) {
    warnings.push(
      'DATABASE_URL points at a SQLite file. Ensure it lives on durable, backed-up storage and that only one instance writes to it.',
    );
  }
  if (!env.RAZORPAY_WEBHOOK_SECRET && env.RAZORPAY_KEY_ID) {
    warnings.push(
      'RAZORPAY_WEBHOOK_SECRET is unset — incoming webhooks cannot be verified and will be rejected.',
    );
  }

  return warnings;
}

/** Feature availability derived from configuration, for conditional UI. */
export function features() {
  const env = serverEnv();
  return {
    ai: env.AI_PROVIDER !== 'disabled' && Boolean(env.AI_API_KEY),
    payments: Boolean(env.RAZORPAY_KEY_ID && env.RAZORPAY_KEY_SECRET),
    email: env.EMAIL_PROVIDER !== 'console',
    whatsapp: env.WHATSAPP_PROVIDER !== 'disabled',
    redis: Boolean(env.REDIS_URL),
  } as const;
}
