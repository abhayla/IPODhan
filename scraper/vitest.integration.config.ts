import { defineConfig } from 'vitest/config';
import path from 'path';
import dotenv from 'dotenv';

// T-279: load the TEST-ONLY env file, never the live runtime `.env` --
// scraper/.env's DATABASE_HOST/DATABASE_URL point at the production
// Postgres host (103.118.16.189), and several integration suites here
// perform real insert/delete/upsert writes (GitHub #163). Copy
// `.env.test.example` to `.env.test` (gitignored) with throwaway/local
// targets to run this suite. If `.env.test` is missing, no DB/Redis env
// vars resolve and the setupFiles guard below refuses to run -- fail
// closed, not fail open.
dotenv.config({ path: path.resolve(__dirname, '.env.test') });

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./vitest.integration.setup.ts'],
    include: ['tests/integration/**/*.test.ts'],
    testTimeout: 60000,
    // #451: same guard as vitest.config.ts — a target outside `include`
    // (e.g. a unit-test path run against this config by mistake) must fail
    // loudly instead of silently exiting 0.
    passWithNoTests: false,
    // #252 follow-up: vitest's default file-level parallelism runs different
    // integration test FILES concurrently in separate worker processes, all
    // against the ONE shared Postgres target this suite requires. Several
    // files reuse the exact same fixture company names ("Rays of Belief
    // Ltd", "Himalayan Solar Ltd", "Himalaya Nutravedics India Ltd") because
    // those names encode real look-alike scenarios from the identity-match
    // spec — renaming them per file would make the fixture less realistic,
    // not more. Two files racing those names against the same `ipos` table
    // (identity matching resolves by normalized name GLOBALLY, not scoped to
    // a test's own rows) made identity-matching-od68 and
    // source-record-keys-od85 fail non-deterministically when run together
    // (measured 2026-09-26: both pass individually, both fail when run in
    // the same invocation) — an outcome depending on which worker's insert
    // committed first is exactly the class this integration tier exists to
    // prevent silently. Serializing file execution trades one dimension of
    // speed for determinism against a single live DB target; it does not
    // change what any test asserts.
    fileParallelism: false
  },
  resolve: {
    alias: {
      '@web': path.resolve(__dirname, '../web'),
      '@shared': path.resolve(__dirname, '../packages/shared/src'),
      '@scraper': path.resolve(__dirname, './src'),
      '@': path.resolve(__dirname, '../web')
    }
  }
});
