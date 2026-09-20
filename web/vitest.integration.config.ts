import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'node',
    globals: true,
    setupFiles: ['./vitest.integration.setup.ts', './vitest.setup.ts'],
    include: ['tests/integration/**/*.integration.test.{ts,tsx}'],
    exclude: ['tests/unit/**', 'tests/e2e/**', 'node_modules/**', '.next/**'],
    testTimeout: 30000, // 30 seconds for integration tests
    hookTimeout: 30000,
    // #832: these three are REQUIRED deploy keys (scripts/assert-env-keys.sh
    // SCRAPER_REQUIRED_KEYS) -- production runs with them on. The write path
    // this harness exercises (scraper/src/services/data-consolidation-service.ts)
    // early-returns / falls back to fallbackConsolidation() when any of them
    // is unset, so a harness that leaves them off is asserting behaviour
    // production has switched off, not a real product gap. Same values as
    // scraper/.env.example and the 36 scraper unit tests that force these
    // flags true; vitest's `test.env` sets process.env before any test file
    // or setupFile loads, which a setupFile mutation cannot guarantee.
    env: {
      ENABLE_SOURCE_TRACKING: 'true',
      ENABLE_CONFLICT_DETECTION: 'true',
      ENABLE_DATA_CONSOLIDATION: 'true',
      CONSOLIDATION_PERCENTAGE: '100',
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './'),
    },
  },
});
