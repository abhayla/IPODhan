// Mutation-proof self-test for scripts/check-write-ratchet.mjs (T-316).
//
// Imports the ACTUAL detectPatterns()/PATTERNS from the script under test —
// not a re-implementation — so deleting any one pattern from the script
// turns its corresponding fixture assertion RED. Run: node --test scripts/tests/check-write-ratchet.test.mjs

import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import {
  detectPatterns,
  PATTERNS,
  SCAN_EXTENSIONS,
  EXCLUDED_DIR_NAMES,
  EXCLUDED_PATH_SEGMENTS,
  ROOT,
  scanRepo,
  stripComments,
  diffAgainstBaseline,
} from '../check-write-ratchet.mjs';

test('exactly the four documented pattern classes exist', () => {
  assert.deepEqual(
    Object.keys(PATTERNS).sort(),
    ['drizzle', 'dynamic_table', 'raw_sql', 'repository']
  );
});

// T-318: pin the scanned extensions and exclusion sets so a future edit that
// silently narrows them (e.g. dropping '.tsx' or re-adding the over-broad
// bare '/test/' segment) turns this fixture red instead of drifting quietly.
test('SCAN_EXTENSIONS includes .ts, .tsx, .js, .jsx, .cjs, .mjs, .sql', () => {
  assert.deepEqual(
    [...SCAN_EXTENSIONS].sort(),
    ['.cjs', '.js', '.jsx', '.mjs', '.sql', '.ts', '.tsx']
  );
});

test('EXCLUDED_DIR_NAMES is exactly the documented directory set', () => {
  assert.deepEqual(
    [...EXCLUDED_DIR_NAMES].sort(),
    ['.git', '.husky', '.next', '.turbo', 'coverage', 'dist', 'node_modules']
  );
});

test('EXCLUDED_PATH_SEGMENTS does NOT contain the over-broad bare "/test/" segment', () => {
  // T-318: a route directory literally named `test/` (e.g.
  // web/app/api/admin/notifications/test/route.ts) is a live production
  // write site, not a test fixture. Only the plural '/tests/' and the
  // per-file '.test.'/'.spec.'/'__tests__/' conventions are legitimate.
  assert.deepEqual(
    EXCLUDED_PATH_SEGMENTS,
    ['/tests/', '__tests__/', '.test.', '.spec.', '/drizzle/migrations/']
  );
});

test('drizzle: .insert(ipos) is detected', () => {
  const fixture = `
    await db.insert(ipos).values({ companyName: 'Acme' });
  `;
  assert.deepEqual(detectPatterns(fixture), ['drizzle']);
});

test('drizzle: .update(schema.ipos) is detected', () => {
  const fixture = `
    await db.update(schema.ipos).set({ status: 'LISTED' }).where(eq(schema.ipos.id, id));
  `;
  assert.deepEqual(detectPatterns(fixture), ['drizzle']);
});

test('drizzle: .delete(ipos) is detected', () => {
  const fixture = `await tx.delete(ipos).where(eq(ipos.id, dupId));`;
  assert.deepEqual(detectPatterns(fixture), ['drizzle']);
});

test('drizzle: unrelated table writes do NOT match', () => {
  const fixture = `await db.update(subscriptions).set({ count: 5 }).where(eq(subscriptions.ipoId, id));`;
  assert.deepEqual(detectPatterns(fixture), []);
});

test('repository: ipoRepository.create/update/delete/upsert is detected', () => {
  assert.deepEqual(detectPatterns(`await ipoRepository.create(data);`), ['repository']);
  assert.deepEqual(detectPatterns(`await ipoRepository.update(id, data);`), ['repository']);
  assert.deepEqual(detectPatterns(`await ipoRepository.delete(id);`), ['repository']);
  assert.deepEqual(detectPatterns(`await ipoRepository.upsert(data);`), ['repository']);
});

test('repository: unrelated repository calls do NOT match', () => {
  const fixture = `const rows = await ipoRepository.findAll({ segment: ['MAINBOARD'] });`;
  assert.deepEqual(detectPatterns(fixture), []);
});

test('raw_sql: INSERT INTO ipos in a .sql-style string is detected', () => {
  const fixture = `INSERT INTO ipos (company_name, slug) VALUES ('Acme', 'acme');`;
  assert.deepEqual(detectPatterns(fixture), ['raw_sql']);
});

test('raw_sql: UPDATE ipos is detected (case-insensitive)', () => {
  const fixture = `update ipos set lot_size = 100 where id = $1;`;
  assert.deepEqual(detectPatterns(fixture), ['raw_sql']);
});

test('raw_sql: DELETE FROM ipos is detected', () => {
  const fixture = `await pool.query('DELETE FROM ipos WHERE id = $1', [id]);`;
  assert.deepEqual(detectPatterns(fixture), ['raw_sql']);
});

test('raw_sql: a table name that merely starts with "ipos" does NOT match', () => {
  const fixture = `INSERT INTO ipos_backup (id) SELECT id FROM ipos_source;`;
  assert.deepEqual(detectPatterns(fixture), []);
});

test('raw_sql: schema-qualified public.ipos is detected', () => {
  const fixture = `UPDATE public.ipos SET status = 'LISTED' WHERE id = $1;`;
  assert.deepEqual(detectPatterns(fixture), ['raw_sql']);
});

test('raw_sql: double-quoted "ipos" identifier is detected', () => {
  const fixture = `INSERT INTO "ipos" (company_name) VALUES ('Acme');`;
  assert.deepEqual(detectPatterns(fixture), ['raw_sql']);
});

test('raw_sql: schema-qualified public.ipos_backup does NOT match', () => {
  const fixture = `INSERT INTO public.ipos_backup (id) SELECT 1;`;
  assert.deepEqual(detectPatterns(fixture), []);
});

test('raw_sql: fully double-quoted "public"."ipos" (drizzle-kit/pg_dump form) is detected', () => {
  const fixture = `INSERT INTO "public"."ipos" (company_name) VALUES ('Acme');`;
  assert.deepEqual(detectPatterns(fixture), ['raw_sql']);
});

test('raw_sql: fully double-quoted "public"."ipos_backup" does NOT match', () => {
  const fixture = `INSERT INTO "public"."ipos_backup" (id) SELECT 1;`;
  assert.deepEqual(detectPatterns(fixture), []);
});

test('dynamic_table: getTableFromSchema( is detected', () => {
  const fixture = `const table = getTableFromSchema(tableName);`;
  assert.deepEqual(detectPatterns(fixture), ['dynamic_table']);
});

test('dynamic_table: (schema as any)[tableName] is detected', () => {
  const fixture = `const table = (schema as any)[tableName];\nawait db.insert(table).values(body);`;
  const kinds = detectPatterns(fixture);
  assert.ok(kinds.includes('dynamic_table'));
});

test('a file with no write pattern at all detects nothing', () => {
  const fixture = `
    export function formatCurrency(n: number): string {
      return \`₹\${n.toLocaleString('en-IN')}\`;
    }
  `;
  assert.deepEqual(detectPatterns(fixture), []);
});

test('a file can match more than one pattern class', () => {
  const fixture = `
    await db.update(ipos).set(fields).where(eq(ipos.id, id));
    await pool.query('UPDATE ipos SET last_scraped_at = now() WHERE id = $1', [id]);
  `;
  assert.deepEqual(detectPatterns(fixture), ['drizzle', 'raw_sql']);
});

// --- stripComments() -------------------------------------------------------

test('stripComments: a // line comment quoting a write statement is removed', () => {
  const fixture = `
    // old approach: await db.update(ipos).set(fields).where(eq(ipos.id, id));
    doSomethingElse();
  `;
  assert.deepEqual(detectPatterns(stripComments(fixture, '.ts')), []);
});

test('stripComments: a /* */ block comment quoting raw SQL is removed', () => {
  const fixture = `
    /*
     * Rejected approach: UPDATE ipos SET status = 'LISTED' WHERE id = $1;
     * Use the shared write path instead.
     */
    doSomethingElse();
  `;
  assert.deepEqual(detectPatterns(stripComments(fixture, '.ts')), []);
});

test('stripComments: a JSDoc /** */ block quoting raw SQL is removed', () => {
  const fixture = `
    /**
     * WHY: the old writer issued \`UPDATE ipos SET x = 1\` as raw SQL; the
     * ratchet correctly failed it, so it now goes through ipoRepository.
     */
    export function noop() {}
  `;
  assert.deepEqual(detectPatterns(stripComments(fixture, '.ts')), []);
});

test('stripComments: a python # comment quoting a write statement is removed', () => {
  const fixture = `
    # old: cursor.execute("UPDATE ipos SET status = 'LISTED'")
    def noop():
        pass
  `;
  assert.deepEqual(detectPatterns(stripComments(fixture, '.py')), []);
});

test('stripComments: a real SQL string literal still matches (strings are preserved)', () => {
  const fixture = `
    // apply the fix below
    await pool.query('UPDATE ipos SET lot_size = 100 WHERE id = $1', [id]);
  `;
  assert.deepEqual(detectPatterns(stripComments(fixture, '.ts')), ['raw_sql']);
});

test('stripComments: a real SQL string literal survives python comment stripping', () => {
  const fixture = `
    # apply the fix below
    cursor.execute("UPDATE ipos SET lot_size = 100 WHERE id = %s", [id])
  `;
  assert.deepEqual(detectPatterns(stripComments(fixture, '.py')), ['raw_sql']);
});

test('stripComments: a // marker inside a string literal is not treated as a comment start', () => {
  const fixture = `
    const url = 'https://example.com/ipos'; // not a write
    await db.update(ipos).set(fields).where(eq(ipos.id, id));
  `;
  assert.deepEqual(detectPatterns(stripComments(fixture, '.ts')), ['drizzle']);
});

test('stripComments: a doc comment describing the raw_sql pattern in prose is removed', () => {
  const fixture = `
    // See docs: the raw_sql pattern matches INSERT INTO ipos, UPDATE ipos, DELETE FROM ipos.
    export const x = 1;
  `;
  assert.deepEqual(detectPatterns(stripComments(fixture, '.ts')), []);
});

// --- diffAgainstBaseline(): per-file pattern-set comparison -----------------

test('diffAgainstBaseline: a brand-new file is reported as newFiles, not newPatterns', () => {
  const found = new Map([['a.ts', ['drizzle']]]);
  const baselineMap = new Map();
  const diff = diffAgainstBaseline(found, baselineMap);
  assert.deepEqual(diff.newFiles, ['a.ts']);
  assert.deepEqual(diff.newPatterns, []);
});

test('diffAgainstBaseline: a baselined file gaining an unrecorded pattern kind is a newPatterns FAIL', () => {
  const found = new Map([['a.ts', ['drizzle', 'raw_sql']]]);
  const baselineMap = new Map([['a.ts', ['drizzle']]]);
  const diff = diffAgainstBaseline(found, baselineMap);
  assert.deepEqual(diff.newFiles, []);
  assert.deepEqual(diff.staleFiles, []);
  assert.deepEqual(diff.newPatterns, [{ file: 'a.ts', kinds: ['raw_sql'] }]);
});

test('diffAgainstBaseline: a baselined file losing a pattern kind is a shrunkPatterns note, not a failure', () => {
  const found = new Map([['a.ts', ['drizzle']]]);
  const baselineMap = new Map([['a.ts', ['drizzle', 'raw_sql']]]);
  const diff = diffAgainstBaseline(found, baselineMap);
  assert.deepEqual(diff.newPatterns, []);
  assert.deepEqual(diff.shrunkPatterns, [{ file: 'a.ts', kinds: ['raw_sql'] }]);
  assert.deepEqual(diff.staleFiles, []);
});

test('diffAgainstBaseline: an unchanged baselined file produces no diffs', () => {
  const found = new Map([['a.ts', ['drizzle']]]);
  const baselineMap = new Map([['a.ts', ['drizzle']]]);
  const diff = diffAgainstBaseline(found, baselineMap);
  assert.deepEqual(diff, { newFiles: [], staleFiles: [], newPatterns: [], shrunkPatterns: [] });
});

// W-69: scanRepo() must only scan git-TRACKED files. A gitignored/untracked
// leftover script sitting in a dev's working tree (never committed) must
// never be reported as a new baseline violation — the ratchet guards what
// gets committed, not the whole working tree.
const TMP_RATCHET_DIR = join(ROOT, 'scraper', '.tmp-ratchet-test');

afterEach(() => {
  rmSync(TMP_RATCHET_DIR, { recursive: true, force: true });
});

test('scanRepo() ignores a gitignored/untracked file that matches a write pattern', () => {
  mkdirSync(TMP_RATCHET_DIR, { recursive: true });
  writeFileSync(join(TMP_RATCHET_DIR, '.gitignore'), '*\n');
  writeFileSync(
    join(TMP_RATCHET_DIR, 'leftover-write.ts'),
    `await pool.query('UPDATE ipos SET lot_size = 100 WHERE id = $1', [id]);\n`
  );

  const found = scanRepo(ROOT);

  assert.equal(
    found.has('scraper/.tmp-ratchet-test/leftover-write.ts'),
    false,
    'a gitignored/untracked file must not be reported by scanRepo()'
  );
});
