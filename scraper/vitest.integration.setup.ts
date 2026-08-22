/**
 * Global integration-test setup (T-279).
 *
 * Runs once, before any `tests/integration/**\/*.test.ts` file, via
 * `vitest.integration.config.ts`'s `setupFiles`. Hard-fails the entire
 * integration run if the resolved DATABASE_URL/DATABASE_HOST/REDIS_URL look
 * like production or staging -- see `tests/helpers/db-safety-guard.ts` for
 * the detection logic and GitHub #163, the incident this guard exists to
 * stop.
 *
 * Previously this workspace had NO such guard: `scraper/.env` (the LIVE
 * runtime env) points DATABASE_HOST/DATABASE_URL at the production Postgres
 * host, and the config loaded that file directly via a bare
 * `dotenv.config()`. Wiring this guard into `setupFiles` (and pointing the
 * config at a separate `.env.test` file -- see vitest.integration.config.ts)
 * means every integration test file is covered automatically, with no
 * per-file opt-in required.
 */
import { assertSafeIntegrationTargets } from './tests/helpers/db-safety-guard';

assertSafeIntegrationTargets('vitest.integration.setup.ts (global guard)');
