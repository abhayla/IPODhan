import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // Item 1 slice s14. This package needs no alias (it IS the package), but
    // it can still be run from a worktree whose node_modules points at the
    // main checkout, so it gets the same which-tree-am-I-reading line.
    globalSetup: ['../../scripts/lib/alias-preflight-global-setup.mjs'],
    setupFiles: ['../../scripts/lib/alias-preflight-quiet.mjs'],
  },
});
