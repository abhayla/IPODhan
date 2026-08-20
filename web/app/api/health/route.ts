import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { getRedisClient } from '@/lib/cache/redis-client';

/**
 * Health Check Endpoint
 *
 * Story: 8.4a - Production Deployment - Dev Machine Preparation
 * Fixed T-226 (2026-08-20): during a deploy, a DB connect timeout right after
 * migrations left every data-backed page 502ing while this endpoint reported
 * 200 the whole outage. Two compounding causes:
 *  1. This GET handler had no `dynamic = 'force-dynamic'`. A route handler
 *     with no request-derived input (no cookies/headers/searchParams) can be
 *     statically evaluated by Next.js and served as a frozen build-time
 *     response forever - it never actually re-ran the DB/Redis checks at
 *     request time in production.
 *  2. The DB check had no explicit timeout, so it inherited the pg pool's
 *     10s `connectionTimeoutMillis` - too slow for a check meant to be
 *     polled every few minutes and to fail fast during an active outage.
 *
 * `?probe=live` returns a pure liveness signal (process is up, no
 * dependency checks) for callers that only need to know the app is running.
 * The default (readiness) probe is what MUST fail when the database is
 * unreachable - it is what gates the deploy workflow's automatic rollback.
 *
 * Redis is best-effort in this app (see
 * .claude/rules/redis-best-effort-fail-open.md - the app degrades
 * gracefully to the database when Redis is down), so a Redis outage alone
 * is reported but does not fail readiness or trigger a rollback. The
 * database is a hard dependency and is the sole gate on overall status.
 */
export const dynamic = 'force-dynamic';

const DB_TIMEOUT_MS = 2000;
const REDIS_TIMEOUT_MS = 2000;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
      // Don't hold the process open just for this timer.
      if (typeof timer === 'object' && 'unref' in timer) {
        (timer as unknown as { unref: () => void }).unref();
      }
    }),
  ]);
}

export async function GET(request: Request) {
  const timestamp = new Date().toISOString();
  const { searchParams } = new URL(request.url);

  if (searchParams.get('probe') === 'live') {
    return NextResponse.json(
      { status: 'alive', probe: 'live', timestamp },
      { status: 200 }
    );
  }

  // Run both checks concurrently - each has its own timeout budget, so the
  // endpoint's worst-case latency is ~max(DB_TIMEOUT_MS, REDIS_TIMEOUT_MS),
  // not the sum of the two.
  const dbStart = Date.now();
  const redisStart = Date.now();

  const [dbResult, redisResult] = await Promise.allSettled([
    withTimeout(query('SELECT 1 AS health_check'), DB_TIMEOUT_MS, 'Database'),
    withTimeout(Promise.resolve().then(() => getRedisClient().ping()), REDIS_TIMEOUT_MS, 'Redis'),
  ]);

  // Database health check - a hard dependency; a connect timeout MUST fail
  // this endpoint. Kept to a single trivial query, no aggregation.
  let databaseStatus: 'healthy' | 'unhealthy' = 'unhealthy';
  let dbError: string | undefined;

  if (dbResult.status === 'fulfilled') {
    databaseStatus = 'healthy';
  } else {
    console.error('[Health Check] Database check failed:', dbResult.reason);
    dbError = dbResult.reason instanceof Error ? dbResult.reason.message : 'Unknown error';
  }
  const databaseResponseTimeMs = Date.now() - dbStart;

  // Redis health check - best-effort; reported for visibility, never fails
  // readiness (see the module doc comment above).
  let redisStatus: 'healthy' | 'unhealthy' = 'unhealthy';
  let redisError: string | undefined;

  if (redisResult.status === 'fulfilled' && redisResult.value === 'PONG') {
    redisStatus = 'healthy';
  } else if (redisResult.status === 'rejected') {
    console.error('[Health Check] Redis check failed:', redisResult.reason);
    redisError = redisResult.reason instanceof Error ? redisResult.reason.message : 'Unknown error';
  } else {
    redisError = `Unexpected PING reply: ${String(redisResult.value)}`;
  }
  const redisResponseTimeMs = Date.now() - redisStart;

  const isHealthy = databaseStatus === 'healthy';

  const responseData = {
    status: isHealthy ? 'healthy' : 'unhealthy',
    probe: 'ready',
    timestamp,
    services: {
      database: databaseStatus,
      redis: redisStatus,
    },
    details: {
      database: {
        connected: databaseStatus === 'healthy',
        responseTimeMs: databaseResponseTimeMs,
        ...(dbError && { error: dbError }),
      },
      redis: {
        connected: redisStatus === 'healthy',
        responseTimeMs: redisResponseTimeMs,
        ...(redisError && { error: redisError }),
      },
    },
    application: {
      name: process.env.NEXT_PUBLIC_APP_NAME || 'IPODhan',
      environment: process.env.NODE_ENV,
    },
  };

  // Return 503 if the database (the hard dependency) is unhealthy.
  return NextResponse.json(responseData, {
    status: isHealthy ? 200 : 503,
  });
}
