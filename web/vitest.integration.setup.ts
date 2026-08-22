/**
 * Global integration-test setup (T-275).
 *
 * Runs once, before any `*.integration.test.ts` file, via
 * `vitest.integration.config.ts`'s `setupFiles`. Hard-fails the entire
 * integration run if the resolved DATABASE_URL/REDIS_URL look like
 * production or staging -- see `tests/helpers/db-safety-guard.ts` for the
 * detection logic and the T-265/T-275 incidents this guard exists to stop.
 *
 * Previously this check was opt-in per test file (only 2 of 42 integration
 * suites called it), so the other 40 had no protection at all. Wiring it
 * here means every integration test is covered automatically.
 */
import { assertSafeIntegrationTargets } from './tests/helpers/db-safety-guard';

assertSafeIntegrationTargets('vitest.integration.setup.ts (global guard)');
