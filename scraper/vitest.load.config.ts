import { defineConfig } from 'vitest/config';
import path from 'path';
import dotenv from 'dotenv';

// Load environment variables from .env file
dotenv.config();

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/load/**/*.test.ts'],
    testTimeout: 300000 // 5 minutes for load tests
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
