#!/usr/bin/env node
/**
 * #151 detection: every Redis client in app/script code must come from one of
 * the four slot-namespaced factories. A `new Redis(` / `new IORedis(` anywhere
 * else would open a client WITHOUT the slot keyPrefix, so its keys would be
 * shared by prod and staging again (the class behind #151: a staging write
 * served on prod). The factories themselves are pinned by
 * web/tests/unit/lib/cache/redis-slot-factories.test.ts.
 *
 * Exit 1 names every offending file:line. Test files and test utilities are
 * exempt (they build their own clients against a test Redis or a fake).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = fileURLToPath(new URL('../..', import.meta.url));

export const ALLOWED_FACTORIES = new Set([
  'packages/shared/src/cache/redis-client.ts',
  'packages/shared/src/redis-client.ts',
  'web/lib/cache/redis-client.ts',
  'web/lib/redis-client.ts',
]);

const ROOTS = ['web', 'packages', 'scraper', 'scripts'];
const SKIP_DIRS = new Set(['node_modules', 'dist', '.next', 'tests', '__tests__', 'coverage', 'test-results', 'playwright-report']);
const EXT = /\.(ts|tsx|mts|cts|js|mjs|cjs)$/;
const TEST_FILE = /\.(test|spec)\.[a-z]+$/;
const CONSTRUCT = /\bnew\s+(?:IORedis|Redis|Cluster|Redis\.Cluster)\s*\(/;

export function findOffenders(files, readText) {
  const offenders = [];
  for (const file of files) {
    if (ALLOWED_FACTORIES.has(file) || TEST_FILE.test(file)) continue;
    const lines = readText(file).split(/\r?\n/);
    lines.forEach((line, i) => {
      const code = line.replace(/\/\/.*$/, '');
      if (/^\s*\*/.test(code)) return;
      if (CONSTRUCT.test(code)) offenders.push(`${file}:${i + 1}: ${line.trim()}`);
    });
  }
  return offenders;
}

function walk(dir, out) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    if (SKIP_DIRS.has(name) || name.startsWith('.')) continue;
    const full = join(dir, name);
    const st = statSync(full, { throwIfNoEntry: false });
    if (!st) continue;
    if (st.isDirectory()) walk(full, out);
    else if (EXT.test(name)) out.push(relative(REPO, full).split(sep).join('/'));
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const files = [];
  for (const root of ROOTS) walk(join(REPO, root), files);
  if (files.length === 0) {
    console.error('check-redis-client-factories: scanned 0 files - the walk is broken, refusing to pass');
    process.exit(1);
  }
  const offenders = findOffenders(files, (f) => readFileSync(join(REPO, f), 'utf8'));
  if (offenders.length > 0) {
    console.error(
      `check-redis-client-factories: ${offenders.length} Redis client(s) constructed outside the slot-namespaced factories (#151).\n` +
        'Use getRedisClient() from @ipodhan/shared (or web/lib/cache/redis-client) so the key carries the slot prefix:\n' +
        offenders.map((o) => `  ${o}`).join('\n')
    );
    process.exit(1);
  }
  console.log(`check-redis-client-factories: OK - ${files.length} files scanned, Redis clients only in the ${ALLOWED_FACTORIES.size} factories`);
}
