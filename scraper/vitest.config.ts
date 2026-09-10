import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/unit/**/*.test.ts'],
    // T-306 (T-300C2 advisory): with no testTimeout set, vitest's 5000ms
    // default is tight enough that the index-*-wiring tests (which spin up a
    // real scheduler/CLI wiring path under mocks) intermittently exceeded it
    // once the full ~93-file / ~1115-test suite started running as ONE
    // pr-gate step under CPU contention (3 measured full-suite runs: 55/45/49
    // failures, delta entirely these files — timeouts, not real regressions).
    // 20s gives real headroom under parallel-worker contention without
    // masking a genuinely hung test (which would still exceed 20s).
    testTimeout: 20_000,
    // Native addons that aren't context-aware crash worker_threads on
    // Windows/Node 22 (segfault, exit 139) when tests/unit/services runs
    // under vitest's default `threads` pool; forks (separate processes) are
    // immune and are vitest 2's documented-safe default for this class.
    pool: 'forks',
    // Item 1 slice s14: prove, on every run, which checkout this suite is
    // actually reading. A worktree whose node_modules was junctioned without
    // re-pointing the workspace packages resolves @ipodhan/shared to the MAIN
    // checkout, so a green suite here said nothing about the branch.
    // globalSetup runs ONCE per run and aborts the run if it throws, so the
    // "which checkout did this run read" line is printed there -- one line,
    // not two per test file across ~280 files. setupFiles keeps the per-file
    // check (a single misconfigured file still fails closed) but stays silent
    // unless it refuses.
    globalSetup: ['../scripts/lib/alias-preflight-global-setup.mjs'],
    setupFiles: ['../scripts/lib/alias-preflight-quiet.mjs'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/index.ts', 'src/config.ts']
    }
  },
  resolve: {
    // ARRAY form, not the object form, and the order below is load-bearing.
    // A string `find` in vite/rollup alias matches the specifier itself AND
    // anything under `<find>/`, so a plain '@ipodhan/shared' key would also
    // capture '@ipodhan/shared/db/schema' and rewrite it to
    // '<...>/index.ts/db/schema'. The bare specifier therefore needs an
    // ANCHORED regex, and only the array form accepts one.
    alias: [
      { find: '@web', replacement: path.resolve(__dirname, '../web') },
      { find: '@shared', replacement: path.resolve(__dirname, '../packages/shared/src') },
      { find: '@scraper', replacement: path.resolve(__dirname, './src') },
      // Test-resolution only: these subpaths aren't in packages/shared's
      // `exports` map (schema-imports.md flags this as pre-existing debt),
      // but production code imports them directly and tsx resolves them
      // fine at runtime. Vitest's Vite-based resolver enforces the exports
      // map strictly and fails before vi.mock() can even intercept the
      // specifier, so alias them straight to source for tests only.
      {
        find: '@ipodhan/shared/cache/redis-client',
        replacement: path.resolve(__dirname, '../packages/shared/src/cache/redis-client.ts'),
      },
      {
        find: '@ipodhan/shared/repositories/listing-performance-repository',
        replacement: path.resolve(
          __dirname,
          '../packages/shared/src/repositories/listing-performance-repository.ts'
        ),
      },
      // Item 1 slice s14 -- the entry that was missing. The two subpaths above
      // were aliased; the BARE specifier was not, so every
      // `import ... from '@ipodhan/shared'` in a test fell through to node
      // resolution and, in an un-re-pointed worktree, read the main checkout.
      {
        find: /^@ipodhan\/shared$/,
        replacement: path.resolve(__dirname, '../packages/shared/src/index.ts'),
      },
    ],
  },
});
