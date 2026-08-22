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
    testTimeout: 60000
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
