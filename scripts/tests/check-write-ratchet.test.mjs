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
  resolveIposImportAliases,
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

test('stripComments: a regex literal containing an escaped slash does not blank a same-line write', () => {
  const fixture = `const urlRe = /^https:\\/\\//; db.update(ipos).set({});`;
  assert.deepEqual(detectPatterns(stripComments(fixture, '.ts')), ['drizzle']);
});

test('stripComments: a same-line string literal still matches (regex-literal fix does not regress string tracking)', () => {
  const fixture = `const s = "http://x"; db.update(ipos).set({})`;
  assert.deepEqual(detectPatterns(stripComments(fixture, '.ts')), ['drizzle']);
});

test('stripComments: a same-line regex literal is skipped and the following write still matches', () => {
  const fixture = `const re = /^https:\\/\\//; db.update(ipos)`;
  assert.deepEqual(detectPatterns(stripComments(fixture, '.ts')), ['drizzle']);
});

test('stripComments: a "//"-lookalike inside a string literal on the same line as a write still matches', () => {
  const fixture = `const s = 'a // b'; UPDATE ipos SET lot_size = 100 WHERE id = 1;`;
  assert.deepEqual(detectPatterns(stripComments(fixture, '.ts')), ['raw_sql']);
});

test('stripComments: a real line comment quoting a write on the same line is NOT matched', () => {
  const fixture = `// db.update(ipos).set({});`;
  assert.deepEqual(detectPatterns(stripComments(fixture, '.ts')), []);
});

// --- resolveIposImportAliases(): issue #1323 alias resolution --------------

test('alias: a named import alias of ipos makes db.update(alias) detected', () => {
  const fixture = `
    import { ipos as iposTable } from '@ipodhan/shared/db/schema';
    export async function stamp(params) {
      await params.db.update(iposTable).set({ priceLastAttemptAt: params.at }).where(eqOp(iposTable.id, params.ipoId));
    }
  `;
  const resolved = resolveIposImportAliases(fixture, '.ts');
  assert.deepEqual(detectPatterns(stripComments(resolved, '.ts')), ['drizzle']);
});

test('alias: .insert(alias) and .delete(alias) are both detected', () => {
  const insertFixture = `
    import { ipos as iposTable } from '@ipodhan/shared/db/schema';
    await db.insert(iposTable).values({ companyName: 'Acme' });
  `;
  const deleteFixture = `
    import { ipos as iposTable } from '@ipodhan/shared/db/schema';
    await tx.delete(iposTable).where(eq(iposTable.id, dupId));
  `;
  assert.deepEqual(
    detectPatterns(stripComments(resolveIposImportAliases(insertFixture, '.ts'), '.ts')),
    ['drizzle']
  );
  assert.deepEqual(
    detectPatterns(stripComments(resolveIposImportAliases(deleteFixture, '.ts'), '.ts')),
    ['drizzle']
  );
});

test('alias: a multi-line aliased named-import list is still resolved', () => {
  const fixture = `
    import {
      ipoDemandGraph,
      ipoDetails,
      ipos as iposTable,
      fieldSources as fieldSourcesTable,
    } from '@ipodhan/shared/db/schema';
    await db.update(iposTable).set({ leadManagers: [] }).where(eqOp(iposTable.id, ipoId));
  `;
  assert.deepEqual(
    detectPatterns(stripComments(resolveIposImportAliases(fixture, '.ts'), '.ts')),
    ['drizzle']
  );
});

test('alias: unaliased shapes are still detected unchanged (no regression)', () => {
  const fixture = `
    import { ipos } from '@ipodhan/shared/db/schema';
    await db.update(ipos).set({ status: 'LISTED' }).where(eq(ipos.id, id));
  `;
  assert.deepEqual(
    detectPatterns(stripComments(resolveIposImportAliases(fixture, '.ts'), '.ts')),
    ['drizzle']
  );
});

test('alias: a non-ipos alias (foo as bar) is never flagged', () => {
  const fixture = `
    import { foo as bar } from './other';
    await bar.doSomething();
  `;
  assert.deepEqual(
    detectPatterns(stripComments(resolveIposImportAliases(fixture, '.ts'), '.ts')),
    []
  );
});

test('alias: a namespace import writing schema-qualified alias.ipos is detected', () => {
  const fixture = `
    import * as schema2 from '@ipodhan/shared/db/schema';
    await db.update(schema2.ipos).set({ status: 'LISTED' }).where(eq(schema2.ipos.id, id));
  `;
  assert.deepEqual(
    detectPatterns(stripComments(resolveIposImportAliases(fixture, '.ts'), '.ts')),
    ['drizzle']
  );
});

test('alias: a namespace import accessing an unrelated property is not flagged', () => {
  const fixture = `
    import * as schema2 from '@ipodhan/shared/db/schema';
    await db.update(schema2.subscriptions).set({ count: 1 });
  `;
  assert.deepEqual(
    detectPatterns(stripComments(resolveIposImportAliases(fixture, '.ts'), '.ts')),
    []
  );
});

test('alias: a type-only aliased import of ipos is never rewritten (cannot be a runtime write)', () => {
  const fixture = `
    import type { ipos as IposRow } from '@ipodhan/shared/db/schema';
    function describe(row: IposRow) { return row; }
  `;
  assert.deepEqual(
    detectPatterns(stripComments(resolveIposImportAliases(fixture, '.ts'), '.ts')),
    []
  );
});

test('alias: a type-only named element inside a value import is never rewritten', () => {
  const fixture = `
    import { type ipos as IposRow, fieldSources } from '@ipodhan/shared/db/schema';
    function describe(row: IposRow) { return row; }
  `;
  assert.deepEqual(
    detectPatterns(stripComments(resolveIposImportAliases(fixture, '.ts'), '.ts')),
    []
  );
});

test('alias: a .sql file is returned unchanged (not import-parseable)', () => {
  const fixture = `UPDATE ipos SET lot_size = 100 WHERE id = $1;`;
  assert.equal(resolveIposImportAliases(fixture, '.sql'), fixture);
});

test('alias: a file with no "ipos" substring at all is returned unchanged (short-circuit)', () => {
  const fixture = `export const x = 1;`;
  assert.equal(resolveIposImportAliases(fixture, '.ts'), fixture);
});

test('alias: unparseable content fails open (returned unchanged, no throw)', () => {
  // Deliberately unbalanced/invalid syntax; the TS parser tolerates a lot, but
  // this must never throw regardless.
  const fixture = `import { ipos as iposTable from`;
  assert.doesNotThrow(() => resolveIposImportAliases(fixture, '.ts'));
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

// ---------------------------------------------------------------------------
// #1335: re-export chains of `ipos`. The ratchet used to resolve only the
// WRITING file's own import declarations, so a write through a binding that
// reached `ipos` over one or more re-export hops was invisible. Each test below
// builds a throwaway tree and runs the real scanRepo() over it (not a copy of
// the logic). The chain guard is keyed on the import SOURCE (a schema module
// specifier or a resolved local file that exports `ipos`), never on the local
// identifier text.
// ---------------------------------------------------------------------------
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname } from 'node:path';

function chainTree(files) {
  const root = mkdtempSync(join(tmpdir(), 'ratchet-chain-'));
  for (const [rel, body] of Object.entries(files)) {
    const abs = join(root, ...rel.split('/'));
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, body);
  }
  return root;
}

function scanTree(files) {
  const root = chainTree(files);
  try {
    return scanRepo(root, Object.keys(files));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const SCHEMA = '@ipodhan/shared/db/schema';
const WRITER = `import { iposTable } from './hop';\nexport async function f(db) { await db.update(iposTable).set({}); }\n`;

test('chain: export { ipos as iposTable } from schema, then import + write in another file', () => {
  const found = scanTree({
    'src/hop.ts': `export { ipos as iposTable } from '${SCHEMA}';\n`,
    'src/writer.ts': WRITER,
  });
  assert.deepEqual(found.get('src/writer.ts'), ['drizzle']);
});

test('chain: export { ipos } from schema (no rename) is followed', () => {
  const found = scanTree({
    'src/hop.ts': `export { ipos } from '${SCHEMA}';\n`,
    'src/writer.ts': `import { ipos } from './hop';\nexport const f = (db) => db.delete(ipos);\n`,
  });
  assert.deepEqual(found.get('src/writer.ts'), ['drizzle']);
});

test('chain: export * from schema in a barrel, consumer imports ipos from the barrel', () => {
  const found = scanTree({
    'src/barrel.ts': `export * from '${SCHEMA}';\n`,
    'src/writer.ts': `import { ipos as t } from './barrel';\nexport const f = (db) => db.insert(t).values({});\n`,
  });
  assert.deepEqual(found.get('src/writer.ts'), ['drizzle']);
});

test('chain: multi-hop (a -> b -> c -> schema) with a rename at the middle hop', () => {
  const found = scanTree({
    'src/c.ts': `export { ipos } from '${SCHEMA}';\n`,
    'src/b.ts': `export { ipos as middle } from './c';\n`,
    'src/a.ts': `export * from './b';\n`,
    'src/writer.ts': `import { middle as z } from './a';\nexport const f = (db) => db.update(z);\n`,
  });
  assert.deepEqual(found.get('src/writer.ts'), ['drizzle']);
});

test('chain: barrel index file resolved through a directory import', () => {
  const found = scanTree({
    'src/db/index.ts': `export * from './tables';\n`,
    'src/db/tables.ts': `export { ipos as iposTable } from '${SCHEMA}';\n`,
    'src/writer.ts': `import { iposTable } from './db';\nexport const f = (db) => db.update(iposTable);\n`,
  });
  assert.deepEqual(found.get('src/writer.ts'), ['drizzle']);
});

test('chain: import then export { x as y } (no from) and export const y = x', () => {
  const found = scanTree({
    'src/hop1.ts': `import { ipos as a } from '${SCHEMA}';\nexport { a as viaList };\n`,
    'src/hop2.ts': `import { ipos } from '${SCHEMA}';\nexport const viaConst = ipos;\n`,
    'src/w1.ts': `import { viaList } from './hop1';\nexport const f = (db) => db.update(viaList);\n`,
    'src/w2.ts': `import { viaConst } from './hop2';\nexport const f = (db) => db.update(viaConst);\n`,
  });
  assert.deepEqual(found.get('src/w1.ts'), ['drizzle']);
  assert.deepEqual(found.get('src/w2.ts'), ['drizzle']);
});

test('chain: default export of ipos, default import elsewhere', () => {
  const found = scanTree({
    'src/hop.ts': `import { ipos } from '${SCHEMA}';\nexport default ipos;\n`,
    'src/writer.ts': `import tbl from './hop';\nexport const f = (db) => db.update(tbl);\n`,
  });
  assert.deepEqual(found.get('src/writer.ts'), ['drizzle']);
});

test('chain: namespace import of a barrel, member access ns.renamed', () => {
  const found = scanTree({
    'src/hop.ts': `export { ipos as iposTable } from '${SCHEMA}';\n`,
    'src/writer.ts': `import * as t from './hop';\nexport const f = (db) => db.update(t.iposTable);\n`,
  });
  assert.deepEqual(found.get('src/writer.ts'), ['drizzle']);
});

test('chain: export * as ns from a module, consumer writes ns.member', () => {
  const found = scanTree({
    'src/hop.ts': `export { ipos as iposTable } from '${SCHEMA}';\n`,
    'src/barrel.ts': `export * as tables from './hop';\n`,
    'src/writer.ts': `import { tables } from './barrel';\nexport const f = (db) => db.update(tables.iposTable);\n`,
  });
  assert.deepEqual(found.get('src/writer.ts'), ['drizzle']);
});

test('chain: the @/ alias resolves to web/', () => {
  const found = scanTree({
    'web/lib/tables.ts': `export { ipos as iposTable } from '${SCHEMA}';\n`,
    'web/app/writer.ts': `import { iposTable } from '@/lib/tables';\nexport const f = (db) => db.update(iposTable);\n`,
  });
  assert.deepEqual(found.get('web/app/writer.ts'), ['drizzle']);
});

test('chain: a re-export of some OTHER table is never flagged (no false positive)', () => {
  const found = scanTree({
    'src/hop.ts': `export { users as usersTable } from '${SCHEMA}';\nexport * from 'drizzle-orm';\n`,
    'src/writer.ts': `import { usersTable } from './hop';\nexport const f = (db) => db.update(usersTable);\n`,
  });
  assert.equal(found.has('src/writer.ts'), false);
});

test('chain: guard is by import SOURCE, not identifier text (a local named like the table but from elsewhere)', () => {
  const found = scanTree({
    'src/hop.ts': `export const iposTable = { not: 'the table' };\n`,
    'src/writer.ts': `import { iposTable } from './hop';\nexport const f = (db) => db.update(iposTable);\n`,
  });
  assert.equal(found.has('src/writer.ts'), false);
});

test('chain: a type-only re-export is not a runtime write path', () => {
  const found = scanTree({
    'src/hop.ts': `export type { ipos as iposTable } from '${SCHEMA}';\n`,
    'src/writer.ts': `import { iposTable } from './hop';\nexport const f = (db) => db.update(iposTable);\n`,
  });
  assert.equal(found.has('src/writer.ts'), false);
});

test('fail closed: a write through an import from an UNRESOLVABLE relative module is flagged', () => {
  const found = scanTree({
    'src/writer.ts': `import { iposTable } from './does-not-exist';\nexport const f = (db) => db.update(iposTable);\n`,
  });
  assert.deepEqual(found.get('src/writer.ts'), ['unresolved_reexport']);
});

test('fail closed: a re-export cycle that never reaches the schema is flagged when written through', () => {
  const found = scanTree({
    'src/a.ts': `export * from './b';\n`,
    'src/b.ts': `export * from './a';\n`,
    'src/writer.ts': `import { iposTable } from './a';\nexport const f = (db) => db.update(iposTable);\n`,
  });
  assert.deepEqual(found.get('src/writer.ts'), ['unresolved_reexport']);
});

test('fail closed: export * from an unresolvable relative module makes any imported name unresolved', () => {
  const found = scanTree({
    'src/barrel.ts': `export * from './missing';\n`,
    'src/writer.ts': `import { iposTable } from './barrel';\nexport const f = (db) => db.update(iposTable);\n`,
  });
  assert.deepEqual(found.get('src/writer.ts'), ['unresolved_reexport']);
});

test('fail closed does not fire on a resolvable module that simply does not export ipos', () => {
  const found = scanTree({
    'src/hop.ts': `export const other = 1;\n`,
    'src/writer.ts': `import { other } from './hop';\nexport const f = (db) => db.update(other);\n`,
  });
  assert.equal(found.has('src/writer.ts'), false);
});

test('chain: resolveIposImportAliases without a resolver context keeps the legacy per-file behaviour', () => {
  const src = `import { ipos as t } from './x';\ndb.update(t);\n`;
  assert.match(resolveIposImportAliases(src, '.ts'), /db\.update\(ipos\)/);
});
