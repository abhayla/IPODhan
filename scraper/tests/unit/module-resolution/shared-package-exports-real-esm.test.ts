/**
 * T-268C/T-268F regression test.
 *
 * The checker found that scraper/src/scrapers/listing-performance-updater.ts and
 * scraper/scripts/backfill-price-bands.ts (plus 7 other scraper entrypoints) import
 * `@ipodhan/shared/cache/redis-client` and
 * `@ipodhan/shared/repositories/listing-performance-repository`, but neither subpath
 * was declared in packages/shared/package.json's `exports` map. Node's real ESM
 * resolver rejects an undeclared subpath with ERR_PACKAGE_PATH_NOT_EXPORTED, so the
 * scraper's actual entrypoint (`npm start` / the PM2 one-shot cron job, per
 * pm2-scheduled-one-shot-scraper.md) fails to even load.
 *
 * This bug was invisible to `vitest` because scraper/vitest.config.ts aliases both
 * subpaths straight to source for test-resolution only (see the comment there) —
 * vitest's Vite-based resolver intercepts the specifier via that alias BEFORE
 * Node's real exports-map check ever runs. Every existing unit test that touches
 * these files also `vi.mock()`s the import, which further masks the bug.
 *
 * So this test deliberately does NOT go through vitest's module resolver at all: it
 * spawns a real `tsx` child process (the same runtime the scraper's `npm start`
 * uses) and lets Node's actual ESM resolver decide. This is the only way to catch a
 * regression of the exports map — a vitest-level import or mock cannot.
 */
import { describe, it, expect } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';

const execFileAsync = promisify(execFile);
const scraperRoot = path.resolve(__dirname, '../../..');
// Resolve tsx's CLI entrypoint and invoke it via `node`, rather than `npx`/`npx.cmd` —
// npx's shim spawning is unreliable cross-platform (fails with EINVAL under Windows'
// spawn() when invoked without a shell) whereas `node <resolved-cli.mjs>` is not.
const tsxCliPath = createRequire(import.meta.url).resolve('tsx/cli');

/**
 * Runs `import(specifier)` in a fresh tsx child process (real Node ESM resolution,
 * scraper's own tsx.tsconfig.json) and returns combined stdout. Throws (with the
 * child's stderr attached) if the import rejects or the process exits non-zero.
 */
async function realEsmImport(specifier: string): Promise<string> {
  // Written INSIDE scraperRoot (not os.tmpdir()) — Node's ESM resolver walks up
  // node_modules from the importing FILE's own directory, not from cwd, so a
  // script outside the workspace can never see @ipodhan/shared regardless of cwd.
  const scriptPath = path.join(scraperRoot, `.esm-import-check-${randomUUID()}.mjs`);
  const script = [
    `import(${JSON.stringify(specifier)})`,
    `  .then((m) => { console.log('IMPORT_OK:' + Object.keys(m).join(',')); process.exit(0); })`,
    `  .catch((e) => { console.error('IMPORT_FAILED:' + e.message); process.exit(1); });`
  ].join('\n');

  await writeFile(scriptPath, script, 'utf-8');
  try {
    const { stdout } = await execFileAsync(
      process.execPath,
      [tsxCliPath, '--tsconfig', 'tsx.tsconfig.json', scriptPath],
      { cwd: scraperRoot, timeout: 30_000 }
    );
    return stdout;
  } finally {
    await unlink(scriptPath).catch(() => {});
  }
}

describe('packages/shared exports map — real ESM resolution (T-268F regression)', () => {
  it(
    'resolves @ipodhan/shared/cache/redis-client under the real Node/tsx loader',
    async () => {
      const stdout = await realEsmImport('@ipodhan/shared/cache/redis-client');
      expect(stdout).toContain('IMPORT_OK');
      expect(stdout).toContain('getRedisClient');
    },
    30_000
  );

  it(
    'resolves @ipodhan/shared/repositories/listing-performance-repository under the real Node/tsx loader',
    async () => {
      const stdout = await realEsmImport(
        '@ipodhan/shared/repositories/listing-performance-repository'
      );
      expect(stdout).toContain('IMPORT_OK');
      expect(stdout).toContain('ListingPerformanceRepository');
    },
    30_000
  );

  it(
    'loads the real scraper file that depends on both subpaths end-to-end (checker T-268C finding 1 repro)',
    async () => {
      const stdout = await realEsmImport('./src/scrapers/listing-performance-updater.ts');
      expect(stdout).toContain('IMPORT_OK');
    },
    30_000
  );
});
