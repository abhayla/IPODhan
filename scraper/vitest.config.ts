import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/unit/**/*.test.ts'],
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
      '@scraper': path.resolve(__dirname, './src')
    }
  }
});
