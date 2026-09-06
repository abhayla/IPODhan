// Mutation-proof coverage test for the `rows` query in
// scripts/audit-substance-plausibility.mjs — the same defect class as
// audit-ipo-coverage.test.mjs (T-297 round: `i.segment` omitted there silently
// no-opped every predicate reading `row.segment`).
//
// Residue found here: this script's own `rows` SELECT omitted `i.issue_type`,
// so checkFixedPriceDegenerateBand / checkFixedPriceHybridDegenerateBand
// (which read `row.issue_type`) silently saw `undefined` for EVERY row and
// never flagged a degenerate price band on a non-fixed-price issue.
//
// Static extraction: read both source files AS TEXT (no live DB) and verify
// every `row.<col>` a SUBSTANCE_CHECKS predicate reads is present as a
// selected column/alias in the `rows` SQL. Deleting a selected column a
// predicate reads must turn this test red without needing a database.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AUDIT_FILE = path.join(__dirname, '..', 'audit-substance-plausibility.mjs');
const CHECKS_FILE = path.join(__dirname, '..', 'lib', 'substance-checks.mjs');

function extractRowsSql(auditSource) {
  // NOTE: `const rows = await q(` is NOT unique — tableExists() also
  // declares a local `rows`. Anchor on the query's own opening text instead.
  const marker = 'SELECT i.id, i.company_name';
  const start = auditSource.indexOf(marker);
  assert.ok(start !== -1, 'rows query not found in audit-substance-plausibility.mjs — has it been renamed/moved?');
  const end = auditSource.indexOf('WHERE i.${REAL_IPO}`', start);
  assert.ok(end !== -1, 'could not locate the end of the rows query');
  return auditSource.slice(start, end + 'WHERE i.${REAL_IPO}`'.length);
}

function extractRowFieldReads(checksSource) {
  const names = new Set();
  const re = /\brow\.([A-Za-z_][A-Za-z0-9_]*)\b/g;
  let m;
  while ((m = re.exec(checksSource)) !== null) names.add(m[1]);
  return names;
}

// A column is "selected" if the query aliases it (`AS "<name>"` / `AS <name>`)
// or selects it bare / qualified (`<alias>.<name>` or bare `<name>`) without a
// competing alias renaming it away.
function sqlSelectsColumn(sql, col) {
  const asAlias = new RegExp(`\\bAS\\s+"?${col}"?`, 'i');
  const bareOrQualified = new RegExp(`(^|[\\s,.])${col}\\b`, 'i');
  return asAlias.test(sql) || bareOrQualified.test(sql);
}

test('every row.<col> read by a SUBSTANCE_CHECKS predicate is selected by the rows query', () => {
  const auditSource = readFileSync(AUDIT_FILE, 'utf8');
  const checksSource = readFileSync(CHECKS_FILE, 'utf8');

  const rowsSql = extractRowsSql(auditSource);
  const fieldsRead = extractRowFieldReads(checksSource);

  // gmp_value is attached to rows in JS after the query (latestGmpByIpo.get),
  // not by SQL — deliberately not part of the SELECT contract this test checks.
  fieldsRead.delete('gmp_value');

  const missing = [...fieldsRead].filter((col) => !sqlSelectsColumn(rowsSql, col));

  assert.deepEqual(
    missing,
    [],
    `rows query is missing column(s) read by substance predicates: ${missing.join(', ')}. ` +
      'Add them to the SELECT in audit-substance-plausibility.mjs or the check silently no-ops on every row.'
  );
});

test('audit-substance-plausibility.mjs prints "evaluated N rows"', () => {
  const auditSource = readFileSync(AUDIT_FILE, 'utf8');
  assert.match(auditSource, /evaluated \$\{rows\.length\} rows/);
});

// Round-3 residue: the `rows` query selected `i.issue_type`, but `issue_type`
// is a column of `ipo_details`, NOT `ipos` — Postgres error 42703 on real
// (staging) data. Round 4: an alias-DECLARATION test (does the query declare
// an "i" alias at all) cannot catch this — `i` WAS declared, it just doesn't
// have that column. This is a real COLUMN-MEMBERSHIP check instead: parse
// the actual `ipos`/`listing_performance` column definitions out of
// packages/shared/src/db/schema.ts (the single source of truth) and assert
// every `i.<col>` / `lp.<col>` referenced in the query is a real column of
// that table. Reintroducing `i.issue_type` must turn this red.
const SCHEMA_FILE = path.join(__dirname, '..', '..', 'packages', 'shared', 'src', 'db', 'schema.ts');

/**
 * Extract the SQL column names declared inside one `pgTable(...)` call,
 * identified by its exported const name (e.g. `ipos`, `listingPerformance`).
 * Strips comments first (stray braces in prose would unbalance a naive brace
 * counter), then balances braces from the first `{` after `pgTable(` to find
 * the columns-object boundary — this correctly ignores the nested `{ length:
 * 255 }` / `.$type<...>()` shapes without needing a real parser.
 */
function extractTableColumns(schemaSource, constName) {
  const noComments = schemaSource
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
  const declMarker = `export const ${constName} = pgTable(`;
  const declStart = noComments.indexOf(declMarker);
  assert.ok(declStart !== -1, `could not find "export const ${constName} = pgTable(" in schema.ts`);
  const braceStart = noComments.indexOf('{', declStart);
  assert.ok(braceStart !== -1, `could not find the columns object opening brace for ${constName}`);

  let depth = 0;
  let end = -1;
  for (let i = braceStart; i < noComments.length; i++) {
    if (noComments[i] === '{') depth++;
    else if (noComments[i] === '}') {
      depth--;
      if (depth === 0) { end = i; break; }
    }
  }
  assert.ok(end !== -1, `unbalanced braces while scanning ${constName}'s columns object`);
  const block = noComments.slice(braceStart + 1, end);

  // Generic, not an allowlist of builder names — every Drizzle column
  // definition is `<builderFn>('sql_col_name', ...)` (varchar/uuid/integer/
  // timestamp/jsonb/*Enum/etc.), and this codebase's enum builders are
  // per-domain names (e.g. segmentEnum, offeringTypeEnum) an allowlist would
  // have to be kept in sync with by hand. A bare `'...'` option value (e.g.
  // `{ onDelete: 'cascade' }`, `mode: 'number'`) never has an identifier
  // directly followed by `(` immediately before its quote, so this stays
  // precise without one.
  const columns = new Set();
  const colRe = /\b[A-Za-z_][A-Za-z0-9_]*\(\s*'([a-z][a-z0-9_]*)'/g;
  let m;
  while ((m = colRe.exec(block)) !== null) columns.add(m[1]);
  return columns;
}

function extractColumnRefs(sql, alias) {
  const refs = new Set();
  const re = new RegExp(`\\b${alias}\\.([a-z_][a-z0-9_]*)`, 'g');
  let m;
  while ((m = re.exec(sql)) !== null) refs.add(m[1]);
  return refs;
}

test('every i.<col> in the rows query is a real column of the ipos table (schema.ts SSOT)', () => {
  const auditSource = readFileSync(AUDIT_FILE, 'utf8');
  const schemaSource = readFileSync(SCHEMA_FILE, 'utf8');
  const rowsSql = extractRowsSql(auditSource);

  const iposColumns = extractTableColumns(schemaSource, 'ipos');
  assert.ok(iposColumns.size > 20, `expected many ipos columns, parsed only ${iposColumns.size} — extractor likely drifted from schema.ts's shape`);
  assert.ok(iposColumns.has('segment'), 'canary: "segment" column not found on ipos — column extraction regex drifted');
  assert.ok(!iposColumns.has('issue_type'), 'canary: "issue_type" unexpectedly found on ipos in schema.ts — has the schema changed?');

  const referenced = extractColumnRefs(rowsSql, 'i');
  const bogus = [...referenced].filter((c) => !iposColumns.has(c));
  assert.deepEqual(
    bogus,
    [],
    `rows query references i.<col> not present on the real ipos table: ${bogus.join(', ')} ` +
      '(e.g. i.issue_type — that column lives on ipo_details, selected via the LATERAL alias d)'
  );
});

test('every lp.<col> in the rows query is a real column of the listing_performance table (schema.ts SSOT)', () => {
  const auditSource = readFileSync(AUDIT_FILE, 'utf8');
  const schemaSource = readFileSync(SCHEMA_FILE, 'utf8');
  const rowsSql = extractRowsSql(auditSource);

  const lpColumns = extractTableColumns(schemaSource, 'listingPerformance');
  assert.ok(lpColumns.size > 5, `expected several listing_performance columns, parsed only ${lpColumns.size}`);

  const referenced = extractColumnRefs(rowsSql, 'lp');
  const bogus = [...referenced].filter((c) => !lpColumns.has(c));
  assert.deepEqual(bogus, [], `rows query references lp.<col> not present on listing_performance: ${bogus.join(', ')}`);
});
