/**
 * Integration-test DB/Redis safety guard for the scraper workspace (T-279).
 *
 * Port of `web/tests/helpers/db-safety-guard.ts` (T-265/T-275 -- see that
 * file for the incident history behind this pattern). This copy exists
 * because the scraper workspace had NO guard at all: `scraper/vitest.
 * integration.config.ts` loaded `scraper/.env` (the LIVE runtime env, whose
 * DATABASE_HOST/DATABASE_URL point at the production Postgres host
 * 103.118.16.189) via a bare `dotenv.config()`, and at least 5 of the 12
 * scraper integration suites perform real insert/delete/upsert writes -- so
 * running `npm run test:integration` in scraper/ wrote straight to prod
 * (GitHub #163, filed by the T-275C checker).
 *
 * Scraper's failure mode is HOST-shaped, not just name-shaped: the scraper
 * test helper (`tests/test-utils/db.ts`) derives the test database name as
 * `DATABASE_NAME + '_test'`, which produces a name that already LOOKS like a
 * test database ("ipodhan_test") even while DATABASE_HOST still points at
 * the live prod server. A name-only check would pass silently in exactly
 * that scenario, so this guard denylists known prod/staging hosts for BOTH
 * Postgres and Redis, in addition to the database-name heuristic.
 */

/** Known production/staging hosts for this project (T-239/T-241/T-242/T-275). */
const KNOWN_PROD_HOST_MARKERS = ['72.61.240.224', '103.118.16.189', 'ipodhan.com'];

/**
 * Refuses to run when the resolved Postgres target is unset, matches a known
 * prod/staging host, or does not look like a "*_test" database.
 *
 * The host-denylist check is NOT overridable by `ALLOW_INTEGRATION_TARGET`
 * (nor is there a name-only escape hatch) -- it is a hard fail, matching the
 * non-overridable denylist posture already established for Redis below.
 */
export function assertNotProductionDatabase(callerLabel: string): void {
  const url = process.env.DATABASE_URL || '';
  const host = process.env.DATABASE_HOST || '';
  const resolved = url || host;

  if (!resolved) {
    throw new Error(
      `${callerLabel}: could not determine the target database host from DATABASE_URL/DATABASE_HOST. ` +
        'Refusing to run seed/cleanup writes without a confirmed non-production target.'
    );
  }

  const hitsKnownProdHost = KNOWN_PROD_HOST_MARKERS.some((marker) => resolved.includes(marker));
  if (hitsKnownProdHost) {
    throw new Error(
      `${callerLabel}: database target "${resolved.replace(/:[^:@]*@/, ':<redacted>@')}" matches a known ` +
        'production/staging host for this project. Refusing to run integration tests against it -- this ' +
        'denylist cannot be bypassed with ALLOW_INTEGRATION_TARGET. See GitHub #163: scraper/.env points ' +
        'DATABASE_HOST at prod (103.118.16.189), and several scraper integration suites perform real ' +
        'insert/delete/upsert writes.'
    );
  }

  const dbNameMatch = url.match(/\/([^/?]+)(\?|$)/);
  const dbName = dbNameMatch?.[1] || process.env.DATABASE_NAME || '';

  if (!dbName) {
    throw new Error(
      `${callerLabel}: could not determine the target database name from DATABASE_URL/DATABASE_NAME. ` +
        'Refusing to run seed/cleanup writes without a confirmed non-production target.'
    );
  }

  if (!/(_test|test_|test$)/i.test(dbName)) {
    throw new Error(
      `${callerLabel}: database target "${dbName}" does not look like a test database (expected a name ` +
        'containing "_test"). Refusing to insert/delete rows against what looks like production. Point ' +
        'DATABASE_URL/DATABASE_NAME at a "*_test" database before running integration tests.'
    );
  }
}

/**
 * Refuses to run when the resolved Redis target is unset, matches a known
 * prod/staging host, or looks authenticated (prod/staging Redis on this
 * project always requires a password; throwaway test/CI Redis never does).
 *
 * The ONLY override is the explicit `ALLOW_INTEGRATION_TARGET=true` escape
 * hatch for the auth check -- it does NOT bypass the known-prod-host
 * denylist, which is a hard fail with no override.
 */
export function assertNotProductionRedis(callerLabel: string): void {
  const url = process.env.REDIS_URL || '';
  const host = process.env.REDIS_HOST || '';
  const password = process.env.REDIS_PASSWORD || '';
  const resolved = url || host;
  const allowOverride = process.env.ALLOW_INTEGRATION_TARGET === 'true';

  if (!resolved) {
    throw new Error(
      `${callerLabel}: could not determine the target Redis host from REDIS_URL/REDIS_HOST. ` +
        'Refusing to run cache-writing integration tests without a confirmed non-production target.'
    );
  }

  const hitsKnownProdHost = KNOWN_PROD_HOST_MARKERS.some((marker) => resolved.includes(marker));
  if (hitsKnownProdHost) {
    throw new Error(
      `${callerLabel}: Redis target "${resolved.replace(/:[^:@]*@/, ':<redacted>@')}" matches a known ` +
        'production/staging host for this project. Refusing to run integration tests against it -- this ' +
        'denylist cannot be bypassed with ALLOW_INTEGRATION_TARGET.'
    );
  }

  const hasUrlAuth = /redis:\/\/:[^@]+@/.test(url);
  const hasAuth = hasUrlAuth || password.length > 0;

  if (hasAuth && !allowOverride) {
    throw new Error(
      `${callerLabel}: the resolved Redis target requires authentication, which does not match a ` +
        'throwaway test/CI Redis instance on this project (test infra runs unauthenticated). Refusing ' +
        'to run cache-writing integration tests against what looks like prod/staging Redis. Point ' +
        'REDIS_URL/REDIS_HOST at an unauthenticated test Redis instance, or set ' +
        'ALLOW_INTEGRATION_TARGET=true if you have independently confirmed this target is safe.'
    );
  }
}

/**
 * Runs both the DB and Redis production-target guards. Call once from a
 * global integration `setupFiles` entry so every integration test file is
 * covered without needing a per-file opt-in (T-279, mirroring T-275's web
 * fix).
 */
export function assertSafeIntegrationTargets(callerLabel: string): void {
  assertNotProductionDatabase(callerLabel);
  assertNotProductionRedis(callerLabel);
}
