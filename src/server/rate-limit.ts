import 'server-only';

import { serverEnv } from '@/lib/env';
import { logger } from '@/server/logger';

/**
 * Rate limiting with a fixed-window counter.
 *
 * Uses Redis when `REDIS_URL` is configured, and falls back to a per-process
 * in-memory map otherwise. The fallback is correct for a single-node
 * deployment — which is the same topology SQLite already implies — but it does
 * NOT coordinate across instances. Configure Redis before scaling horizontally.
 */

export interface RateLimitResult {
  allowed: boolean;
  /** Requests still available in the current window. */
  remaining: number;
  /** Unix ms at which the window resets. */
  resetAt: number;
  limit: number;
}

export interface RateLimitOptions {
  /** Maximum requests permitted per window. */
  limit: number;
  /** Window length in milliseconds. */
  windowMs: number;
}

/** Named policies, so limits are declared once and reused by every call site. */
export const RATE_LIMITS = {
  /** Per IP. Login is the highest-value target on the platform. */
  login: { limit: 10, windowMs: 15 * 60 * 1000 },
  /** Per email address, stricter than per IP to slow credential stuffing. */
  loginPerAccount: { limit: 5, windowMs: 15 * 60 * 1000 },
  register: { limit: 5, windowMs: 60 * 60 * 1000 },
  /**
   * Free-test lead capture. Creates a real account without a password, so it
   * is held to the same ceiling as registration: an open endpoint that mints
   * accounts is worth abusing.
   */
  guestStart: { limit: 5, windowMs: 60 * 60 * 1000 },
  forgotPassword: { limit: 4, windowMs: 60 * 60 * 1000 },
  resendVerification: { limit: 4, windowMs: 60 * 60 * 1000 },
  /** Answer autosave fires often by design; this only catches runaway clients. */
  attemptSync: { limit: 240, windowMs: 60 * 1000 },
  submitAttempt: { limit: 10, windowMs: 60 * 1000 },
  aiCoach: { limit: 60, windowMs: 60 * 60 * 1000 },
  aiGenerate: { limit: 10, windowMs: 60 * 60 * 1000 },
  checkout: { limit: 20, windowMs: 60 * 60 * 1000 },
  /**
   * Confirming a payment already made. Its own budget: sharing one with
   * opening checkouts meant a student who had tried a few times could pay and
   * then be refused the confirmation.
   */
  checkoutVerify: { limit: 60, windowMs: 60 * 60 * 1000 },
  support: { limit: 10, windowMs: 60 * 60 * 1000 },
  questionReport: { limit: 20, windowMs: 60 * 60 * 1000 },
  search: { limit: 60, windowMs: 60 * 1000 },
  /** Generic ceiling applied to any unauthenticated write endpoint. */
  publicWrite: { limit: 30, windowMs: 60 * 60 * 1000 },
} as const satisfies Record<string, RateLimitOptions>;

export type RateLimitPolicy = keyof typeof RATE_LIMITS;

// ---------------------------------------------------------------------------
// In-memory backend
// ---------------------------------------------------------------------------

interface Bucket {
  count: number;
  resetAt: number;
}

const memoryBuckets = new Map<string, Bucket>();

/** Bounds memory use if an attacker cycles through many distinct keys. */
const MAX_MEMORY_KEYS = 50_000;

function memoryConsume(key: string, options: RateLimitOptions): RateLimitResult {
  const now = Date.now();
  const existing = memoryBuckets.get(key);

  if (!existing || existing.resetAt <= now) {
    // Opportunistic sweep — cheaper than a timer and bounded by the map size.
    if (memoryBuckets.size > MAX_MEMORY_KEYS) {
      for (const [k, v] of memoryBuckets) {
        if (v.resetAt <= now) memoryBuckets.delete(k);
      }
    }
    const bucket = { count: 1, resetAt: now + options.windowMs };
    memoryBuckets.set(key, bucket);
    return { allowed: true, remaining: options.limit - 1, resetAt: bucket.resetAt, limit: options.limit };
  }

  existing.count += 1;
  const allowed = existing.count <= options.limit;
  return {
    allowed,
    remaining: Math.max(0, options.limit - existing.count),
    resetAt: existing.resetAt,
    limit: options.limit,
  };
}

// ---------------------------------------------------------------------------
// Redis backend
// ---------------------------------------------------------------------------

type RedisLike = {
  incr(key: string): Promise<number>;
  pexpire(key: string, ms: number): Promise<number>;
  pttl(key: string): Promise<number>;
};

let redisClient: RedisLike | null = null;
let redisUnavailable = false;

async function getRedis(): Promise<RedisLike | null> {
  if (redisUnavailable) return null;
  if (redisClient) return redisClient;

  const url = serverEnv().REDIS_URL;
  if (!url) {
    redisUnavailable = true;
    return null;
  }

  try {
    const { default: Redis } = await import('ioredis');
    const client = new Redis(url, {
      maxRetriesPerRequest: 2,
      lazyConnect: true,
      enableOfflineQueue: false,
    });
    client.on('error', (error) => logger.warn({ error }, 'Redis error; rate limiting degrades to memory'));
    await client.connect();
    redisClient = client as unknown as RedisLike;
    return redisClient;
  } catch (error) {
    logger.warn({ error }, 'Redis unavailable; using in-memory rate limiting');
    redisUnavailable = true;
    return null;
  }
}

async function redisConsume(
  redis: RedisLike,
  key: string,
  options: RateLimitOptions,
): Promise<RateLimitResult> {
  const count = await redis.incr(key);
  if (count === 1) {
    await redis.pexpire(key, options.windowMs);
  }
  const ttl = await redis.pttl(key);
  const resetAt = Date.now() + (ttl > 0 ? ttl : options.windowMs);

  return {
    allowed: count <= options.limit,
    remaining: Math.max(0, options.limit - count),
    resetAt,
    limit: options.limit,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Consumes one unit against `identifier` under the named policy.
 *
 * Fails open: if the backing store errors, the request is allowed. A rate
 * limiter outage must not take down sign-in for everyone — the other controls
 * (password hashing, account lockout counters, audit logging) still apply.
 */
export async function rateLimit(
  policy: RateLimitPolicy,
  identifier: string,
): Promise<RateLimitResult> {
  const options = RATE_LIMITS[policy];
  const key = `rl:${policy}:${identifier}`;

  try {
    const redis = await getRedis();
    if (redis) return await redisConsume(redis, key, options);
  } catch (error) {
    logger.warn({ error, policy }, 'Rate limit check failed; allowing request');
    return { allowed: true, remaining: options.limit, resetAt: Date.now() + options.windowMs, limit: options.limit };
  }

  return memoryConsume(key, options);
}

/** Seconds until the window resets, for the `Retry-After` header. */
export function retryAfterSeconds(result: RateLimitResult) {
  return Math.max(1, Math.ceil((result.resetAt - Date.now()) / 1000));
}

/** Standard rate-limit response headers. */
export function rateLimitHeaders(result: RateLimitResult): Record<string, string> {
  return {
    'X-RateLimit-Limit': String(result.limit),
    'X-RateLimit-Remaining': String(result.remaining),
    'X-RateLimit-Reset': String(Math.ceil(result.resetAt / 1000)),
    ...(result.allowed ? {} : { 'Retry-After': String(retryAfterSeconds(result)) }),
  };
}

/** Test-only helper; clears the in-memory buckets between test cases. */
export function __resetRateLimits() {
  memoryBuckets.clear();
}
