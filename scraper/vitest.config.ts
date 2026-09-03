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
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/index.ts', 'src/config.ts']
    }
  },
  resolve: {
    alias: {
      '@web': path.resolve(__dirname, '../web'),
      '@shared': path.resolve(__dirname, '../packages/shared/src'),
      '@scraper': path.resolve(__dirname, './src'),
      // Test-resolution only: these subpaths aren't in packages/shared's
      // `exports` map (schema-imports.md flags this as pre-existing debt),
      // but production code imports them directly and tsx resolves them
      // fine at runtime. Vitest's Vite-based resolver enforces the exports
      // map strictly and fails before vi.mock() can even intercept the
      // specifier, so alias them straight to source for tests only.
      '@ipodhan/shared/cache/redis-client': path.resolve(
        __dirname,
        '../packages/shared/src/cache/redis-client.ts'
      ),
      '@ipodhan/shared/repositories/listing-performance-repository': path.resolve(
        __dirname,
        '../packages/shared/src/repositories/listing-performance-repository.ts'
      )
    }
  }
});
