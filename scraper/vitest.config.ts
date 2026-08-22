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
