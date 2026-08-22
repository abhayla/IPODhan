/**
 * Integration-test DB/Redis safety guard.
 *
 * T-265 root cause: several integration test suites write real INSERT/DELETE
 * operations through the SAME `db` client the whole app uses (wired to
 * DATABASE_URL), instead of a dedicated test database. When DATABASE_URL
 * pointed at the production `ipodhan` database (e.g. a locally SSH-tunneled
 * .env.local), running these suites leaked seed rows straight into prod --
 * 39 orphaned "Alpha Registrar Services Ltd" / "Beta Registrar Technologies"
 * / "Gamma Corporate Services" rows, discovered live on ipodhan.com.
 *
 * T-275 follow-up (2026-08-22): the DB check above was opt-in per test file
 * and had no Redis counterpart. The `registrars.integration.test.ts` suite
 * ran with its DATABASE_URL pointed at test infra but its REDIS_URL pointed
 * at the prod Redis instance (127.0.0.1:6379 on the Linux app box, reachable
 * only because prod Redis is loopback-only and was tunneled/copied into a
 * local .env), and `beforeEach`/`afterEach` cache-clears plus the route's own
 * cache-aside write populated `registrars:all:active` with 26 fabricated
 * "Alpha"/"Beta" fixture rows that then served on ipodhan.com for ~5.7 days
 * (the key's 7-day TTL). `assertSafeIntegrationTargets()` below is now called
 * from a global `setupFiles` entry (`vitest.integration.setup.ts`) so EVERY
 * integration test is gated automatically -- no per-file opt-in required.
 */
export function assertNotProductionDatabase(callerLabel: string): void {
  const url = process.env.DATABASE_URL || process.env.DATABASE_HOST || '';
  const dbNameMatch = url.match(/\/([^/?]+)(\?|$)/);
  const dbName = dbNameMatch?.[1] ?? '';

  if (!dbName) {
    throw new Error(
      `${callerLabel}: could not determine the target database name from DATABASE_URL. ` +
        'Refusing to run seed/cleanup writes without a confirmed non-production target.'
    );
  }

  if (!/(_test|test_|test$)/i.test(dbName)) {
    throw new Error(
      `${callerLabel}: DATABASE_URL targets database "${dbName}", which does not look like a test ` +
        'database (expected a name containing "_test"). Refusing to insert/delete rows against what ' +
        'looks like production. Point DATABASE_URL (or TEST_DATABASE_URL, once wired) at a "*_test" ' +
        'database before running integration tests. See T-265: this exact gap previously leaked 39 ' +
        'fake registrar rows into the live "ipodhan" database.'
    );
  }
}

/** Known production/staging Redis+DB hosts for this project (T-239/T-241/T-242). */
const KNOWN_PROD_HOST_MARKERS = ['72.61.240.224', '103.118.16.189', 'ipodhan.com'];

/**
 * Integration-test Redis safety guard (T-275).
 *
 * Prod and staging Redis on the Linux app box are loopback-only
 * (127.0.0.1:6379) and always require a password (`requirepass`, set by
 * T-239 M0) -- a real, ephemeral test/CI Redis (e.g. the unauthenticated
 * `redis://localhost:6379` service container in test.yml) never does. That
 * makes "a password/auth is present" a reliable signal that the resolved
 * target is prod/staging-shaped, independent of whether the host string
 * itself says "localhost" (which it will, if reached via an SSH tunnel).
 *
 * Throws unless the target is unambiguously safe. The ONLY override is the
 * explicit `ALLOW_INTEGRATION_TARGET=true` escape hatch (documented as
 * dangerous) -- and even that does NOT bypass the known-prod-host denylist,
 * which is a hard fail with no override.
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
        'production/staging host for this project. Refusing to run integration tests against it -- ' +
        'this override cannot be bypassed with ALLOW_INTEGRATION_TARGET.'
    );
  }

  // Embedded credentials in the URL form (redis://:PASSWORD@host:port) or a
  // separately-set REDIS_PASSWORD both indicate an authenticated (prod/staging-
  // shaped) Redis instance.
  const hasUrlAuth = /redis:\/\/:[^@]+@/.test(url);
  const hasAuth = hasUrlAuth || password.length > 0;

  if (hasAuth && !allowOverride) {
    throw new Error(
      `${callerLabel}: the resolved Redis target requires authentication, which does not match a ` +
        'throwaway test/CI Redis instance on this project (test infra runs unauthenticated). Refusing ' +
        'to run cache-writing integration tests against what looks like prod/staging Redis. Point ' +
        'REDIS_URL/REDIS_HOST at an unauthenticated test Redis instance, or set ' +
        'ALLOW_INTEGRATION_TARGET=true if you have independently confirmed this target is safe. ' +
        'See T-275: a poisoned prod `registrars:all:active` cache key served 26 fabricated registrar ' +
        'rows on ipodhan.com for ~5.7 days because no equivalent guard existed for Redis.'
    );
  }
}

/**
 * Runs both the DB and Redis production-target guards. Call once from a
 * global integration `setupFiles` entry so every integration test file is
 * covered without needing a per-file opt-in (T-275).
 */
export function assertSafeIntegrationTargets(callerLabel: string): void {
  assertNotProductionDatabase(callerLabel);
  assertNotProductionRedis(callerLabel);
}
