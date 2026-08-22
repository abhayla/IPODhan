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
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './'),
    },
  },
});
