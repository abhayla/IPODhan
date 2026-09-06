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
// (staging) data, invisible to the coverage test above (which only checks a
// column is selected SOMEWHERE, not that its alias is declared). This test
// statically parses the declared table aliases (FROM/JOIN <table> <alias>,
// including LATERAL subquery aliases) and asserts every `<alias>.<column>`
// reference in the query uses one of them — `i.issue_type` would have failed
// this test before the column existed on `i` at all.
function extractDeclaredAliases(sql) {
  const aliases = new Set();
  // `FROM ipos i` / `JOIN listing_performance lp` / `) d ON true`
  const fromJoinRe = /\b(?:FROM|JOIN)\s+[a-z_][a-z0-9_]*\s+(?:AS\s+)?([a-z][a-z0-9_]*)\b/gi;
  let m;
  while ((m = fromJoinRe.exec(sql)) !== null) aliases.add(m[1].toLowerCase());
  // `) d ON true` — LATERAL subquery close-paren alias
  const lateralRe = /\)\s+([a-z][a-z0-9_]*)\s+ON\b/gi;
  while ((m = lateralRe.exec(sql)) !== null) aliases.add(m[1].toLowerCase());
  return aliases;
}

function extractReferencedAliases(sql) {
  const refs = new Set();
  const re = /\b([a-z][a-z0-9_]*)\.[a-z_][a-z0-9_]*/gi;
  let m;
  const sqlKeywordAliases = new Set(['select', 'from', 'join', 'where', 'lateral', 'left', 'inner']);
  while ((m = re.exec(sql)) !== null) {
    const alias = m[1].toLowerCase();
    if (!sqlKeywordAliases.has(alias)) refs.add(alias);
  }
  return refs;
}

test('every <alias>.<column> in the rows query references a declared table/LATERAL alias', () => {
  const auditSource = readFileSync(AUDIT_FILE, 'utf8');
  const rowsSql = extractRowsSql(auditSource);
  const declared = extractDeclaredAliases(rowsSql);
  // 'i', 'lp', 'd' must all be present given the current shape - a canary
  // that the regex above still matches the real query shape.
  assert.ok(declared.has('i'), 'expected alias "i" (ipos) to be declared in FROM/JOIN');
  assert.ok(declared.has('lp'), 'expected alias "lp" (listing_performance) to be declared in FROM/JOIN');
  assert.ok(declared.has('d'), 'expected alias "d" (LATERAL ipo_details) to be declared');

  const referenced = extractReferencedAliases(rowsSql);
  const undeclared = [...referenced].filter((a) => !declared.has(a));
  assert.deepEqual(
    undeclared,
    [],
    `rows query references alias(es) not declared in FROM/JOIN: ${undeclared.join(', ')} ` +
      '(e.g. i.issue_type when issue_type actually lives on ipo_details, aliased d)'
  );
});
