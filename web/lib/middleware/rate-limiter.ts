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
 * Check rate limit using Redis sliding window algorithm
 */
async function checkRateLimit(
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
  const windowStart = now - (config.windowSeconds * 1000);

  try {
    // Use Redis sorted set for sliding window
    // Score is timestamp, member is unique request ID

    // Remove old entries outside the window
    await redis.zremrangebyscore(key, 0, windowStart);

    // Count requests in current window
    const count = await redis.zcard(key);

    // Check if limit exceeded
    if (count >= config.maxRequests) {
      // Get oldest entry to calculate reset time
      const oldestEntries = await redis.zrange(key, 0, 0, 'WITHSCORES');
      const resetTimestamp = oldestEntries.length > 0
        ? parseInt(oldestEntries[1] as string) + (config.windowSeconds * 1000)
        : now + (config.windowSeconds * 1000);

      return {
        allowed: false,
        limit: config.maxRequests,
        remaining: 0,
        reset: Math.ceil(resetTimestamp / 1000),
      };
    }

    // Add current request
    const requestId = `${now}:${Math.random()}`;
    await redis.zadd(key, now, requestId);

    // Set expiry on the key (cleanup)
    await redis.expire(key, config.windowSeconds);

    return {
      allowed: true,
      limit: config.maxRequests,
      remaining: config.maxRequests - count - 1,
      reset: Math.ceil((now + (config.windowSeconds * 1000)) / 1000),
    };
  } catch (error) {
    // If Redis fails, log error and allow request (fail open)
    logger.error({ error, ip, endpoint }, 'Rate limit check failed');

    // Return permissive response on Redis failure
    return {
      allowed: true,
      limit: config.maxRequests,
      remaining: config.maxRequests - 1,
      reset: Math.ceil((now + (config.windowSeconds * 1000)) / 1000),
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
