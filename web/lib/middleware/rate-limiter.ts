/**
 * Rate Limiting Middleware for API Protection
 *
 * Implements sliding window rate limiting using Redis to prevent API abuse.
 *
 * Features:
 * - Per-IP rate limiting with configurable windows
 * - Different rate limits for different endpoint types
 * - Graceful degradation if Redis is unavailable
 * - Standard rate limit headers (X-RateLimit-*)
 *
 * @module lib/middleware/rate-limiter
 */

import { NextRequest, NextResponse } from 'next/server';
import { getRedisClient } from '@/lib/cache/redis-client';
import { logger } from '@/lib/logger';

/**
 * Rate limit configuration for different endpoint types
 */
export interface RateLimitConfig {
  /**
   * Maximum number of requests allowed in the window
   */
  maxRequests: number;

  /**
   * Time window in seconds
   */
  windowSeconds: number;

  /**
   * Optional message to return when rate limit is exceeded
   */
  message?: string;

  /**
   * What to do when Redis cannot be reached. 'allow' (the default) fails open. 'local' counts in
   * this process's memory with the same limit instead, so a Redis outage cannot turn a brute-force
   * guard (admin sign-in) into no guard at all.
   */
  onStoreError?: 'allow' | 'local';
}

// Fallback counters for onStoreError: 'local'. Bounded so a flood of distinct keys cannot grow the
// process's memory without limit; the oldest key is evicted first.
const LOCAL_COUNTER_MAX_KEYS = 10_000;
const localCounters = new Map<string, number[]>();

export function checkLocalRateLimit(
  key: string,
  config: RateLimitConfig,
  now: number = Date.now()
): { allowed: boolean; limit: number; remaining: number; reset: number } {
  const windowMs = config.windowSeconds * 1000;
  const hits = (localCounters.get(key) ?? []).filter((t) => t > now - windowMs);
  const reset = Math.ceil(((hits[0] ?? now) + windowMs) / 1000);
  if (hits.length >= config.maxRequests) {
    localCounters.set(key, hits);
    return { allowed: false, limit: config.maxRequests, remaining: 0, reset };
  }
  hits.push(now);
  localCounters.delete(key);
  localCounters.set(key, hits);
  while (localCounters.size > LOCAL_COUNTER_MAX_KEYS) {
    const oldest = localCounters.keys().next().value;
    if (oldest === undefined) break;
    localCounters.delete(oldest);
  }
  return { allowed: true, limit: config.maxRequests, remaining: config.maxRequests - hits.length, reset };
}

/** Test seam: forget every local fallback counter. */
export function resetLocalRateLimitCounters(): void {
  localCounters.clear();
}

/**
 * Default rate limit configurations by endpoint type
 */
export const RATE_LIMIT_CONFIGS = {
  // Public API endpoints - moderate limits
  public: {
    maxRequests: 100,
    windowSeconds: 60, // 100 requests per minute
    message: 'Too many requests. Please try again in a minute.',
  },

  // Read-heavy endpoints (dashboard, listings) - higher limits
  readHeavy: {
    maxRequests: 200,
    windowSeconds: 60, // 200 requests per minute
    message: 'Too many requests. Please slow down.',
  },

  // Search endpoints - moderate limits to prevent abuse
  search: {
    maxRequests: 50,
    windowSeconds: 60, // 50 searches per minute
    message: 'Too many search requests. Please wait a moment.',
  },

  // Write/mutation endpoints - stricter limits
  write: {
    maxRequests: 20,
    windowSeconds: 60, // 20 writes per minute
    message: 'Too many write requests. Please wait before trying again.',
  },

  // Admin endpoints - very strict limits
  admin: {
    maxRequests: 10,
    windowSeconds: 60, // 10 requests per minute
    message: 'Too many admin requests. Please wait.',
  },

  // Scraper endpoints - strict limits
  scraper: {
    maxRequests: 5,
    windowSeconds: 60, // 5 requests per minute
    message: 'Too many scraper requests. These endpoints are rate-limited.',
  },
} as const;

/**
 * Extract client IP address from request
 */
function getClientIP(request: NextRequest): string {
  // Check for forwarded IP (behind proxy)
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    // Take the first IP if multiple are present
    return forwarded.split(',')[0].trim();
  }

  // Check for real IP header
  const realIP = request.headers.get('x-real-ip');
  if (realIP) {
    return realIP;
  }

  // Fallback to connection remote address (not available in Edge runtime)
  return 'unknown';
}

/**
 * Generate Redis key for rate limiting
 */
function getRateLimitKey(ip: string, endpoint: string): string {
  return `ratelimit:${endpoint}:${ip}`;
}

/**
 * The whole sliding-window step as ONE Redis script, so it is atomic across every web process
 * (Tier A round 2, MAJOR 1). Counting and adding in separate calls let N concurrent callers all
 * read the same count before any of them added, so all N were allowed. Inside EVAL no other command
 * runs between the steps: drop entries older than the window, count, and add this attempt only when
 * the count is below the limit. A refused attempt is not added, so a flood cannot extend the lockout
 * past one window for the account's real owner.
 *
 * KEYS[1] = counter key; ARGV = now (ms), window (ms), limit, unique member.
 * Returns { allowed (1|0), count after this call, oldest score in the window (ms) }.
 */
export const SLIDING_WINDOW_SCRIPT = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local windowMs = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])
redis.call('ZREMRANGEBYSCORE', key, 0, now - windowMs)
local count = redis.call('ZCARD', key)
local allowed = 0
if count < limit then
  allowed = 1
  redis.call('ZADD', key, now, ARGV[4])
  redis.call('PEXPIRE', key, windowMs)
  count = count + 1
end
local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
local oldestScore = now
if oldest[2] then oldestScore = tonumber(oldest[2]) end
return {allowed, count, oldestScore}
`;

/**
 * Check rate limit using Redis sliding window algorithm (one atomic EVAL).
 */
export async function checkRateLimit(
  ip: string,
  endpoint: string,
  config: RateLimitConfig
): Promise<{
  allowed: boolean;
  limit: number;
  remaining: number;
  reset: number;
}> {
  const redis = getRedisClient();
  const key = getRateLimitKey(ip, endpoint);
  const now = Date.now();
  const windowMs = config.windowSeconds * 1000;

  try {
    const requestId = `${now}:${Math.random()}`;
    const raw = (await redis.eval(
      SLIDING_WINDOW_SCRIPT,
      1,
      key,
      String(now),
      String(windowMs),
      String(config.maxRequests),
      requestId
    )) as [number | string, number | string, number | string];
    const allowed = Number(raw[0]) === 1;
    const count = Number(raw[1]);
    const oldest = Number(raw[2]);

    if (!allowed) {
      return {
        allowed: false,
        limit: config.maxRequests,
        remaining: 0,
        reset: Math.ceil(((Number.isFinite(oldest) ? oldest : now) + windowMs) / 1000),
      };
    }
    return {
      allowed: true,
      limit: config.maxRequests,
      remaining: Math.max(0, config.maxRequests - count),
      reset: Math.ceil((now + windowMs) / 1000),
    };
  } catch (error) {
    // The endpoint (not the key) is logged: callers keying on personal data pass a hash, never the
    // raw value, so nothing here can carry an email address.
    logger.error({ err: error instanceof Error ? error.message : 'unknown', endpoint }, 'Rate limit check failed');

    if (config.onStoreError === 'local') {
      return checkLocalRateLimit(key, config, now);
    }

    // Default: fail open (public endpoints).
    return {
      allowed: true,
      limit: config.maxRequests,
      remaining: config.maxRequests - 1,
      reset: Math.ceil((now + windowMs) / 1000),
    };
  }
}

/**
 * Rate limiting middleware factory
 *
 * @param config - Rate limit configuration
 * @returns Middleware function
 *
 * @example
 * ```ts
 * // In API route
 * export async function GET(request: NextRequest) {
 *   const rateLimitResult = await rateLimiter(RATE_LIMIT_CONFIGS.public)(request);
 *   if (rateLimitResult) return rateLimitResult;
 *
 *   // Process request...
 * }
 * ```
 */
export function rateLimiter(config: RateLimitConfig) {
  return async (request: NextRequest): Promise<NextResponse | null> => {
    const ip = getClientIP(request);
    const endpoint = new URL(request.url).pathname;

    logger.debug({ ip, endpoint }, 'Rate limit check');

    // Check rate limit
    const result = await checkRateLimit(ip, endpoint, config);

    // Add rate limit headers to all responses
    const headers = new Headers();
    headers.set('X-RateLimit-Limit', result.limit.toString());
    headers.set('X-RateLimit-Remaining', result.remaining.toString());
    headers.set('X-RateLimit-Reset', result.reset.toString());

    if (!result.allowed) {
      logger.warn({ ip, endpoint, limit: config.maxRequests }, 'Rate limit exceeded');

      // Return 429 Too Many Requests
      return NextResponse.json(
        {
          error: 'rate_limit_exceeded',
          message: config.message || 'Too many requests. Please try again later.',
          limit: result.limit,
          reset: result.reset,
        },
        {
          status: 429,
          headers,
        }
      );
    }

    // Rate limit passed, return null to continue
    return null;
  };
}

/**
 * Helper to apply rate limiter to a route handler
 *
 * @example
 * ```ts
 * export const GET = withRateLimit(
 *   RATE_LIMIT_CONFIGS.public,
 *   async (request: NextRequest) => {
 *     // Your route handler logic
 *     return NextResponse.json({ data: 'response' });
 *   }
 * );
 * ```
 */
export function withRateLimit<T extends any[]>(
  config: RateLimitConfig,
  handler: (request: NextRequest, ...args: T) => Promise<NextResponse>
) {
  return async (request: NextRequest, ...args: T): Promise<NextResponse> => {
    // Apply rate limiting
    const rateLimitResponse = await rateLimiter(config)(request);
    if (rateLimitResponse) {
      return rateLimitResponse;
    }

    // Continue to handler
    return handler(request, ...args);
  };
}

/**
 * Endpoint-specific rate limiters for convenience
 */
export const publicAPIRateLimiter = rateLimiter(RATE_LIMIT_CONFIGS.public);
export const readHeavyRateLimiter = rateLimiter(RATE_LIMIT_CONFIGS.readHeavy);
export const searchRateLimiter = rateLimiter(RATE_LIMIT_CONFIGS.search);
export const writeRateLimiter = rateLimiter(RATE_LIMIT_CONFIGS.write);
export const adminRateLimiter = rateLimiter(RATE_LIMIT_CONFIGS.admin);
export const scraperRateLimiter = rateLimiter(RATE_LIMIT_CONFIGS.scraper);
