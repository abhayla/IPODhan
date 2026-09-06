// Mutation-proof coverage test for the substance-gate query in
// scripts/audit-ipo-coverage.mjs.
//
// RCA: the `subRows` SELECT (the rows fed into SUBSTANCE_CHECKS) omitted
// `i.segment`. Every predicate that reads `row.segment` — most notably
// checkIssueSizeSegmentFloor — then silently saw `undefined` for every row
// and returned null (no violation) for ALL rows, so the segment-floor and
// lot-band checks printed PASS with 0 violations on a live database that
// actually had ~23 share-count-stored-as-rupees rows. The detection-floor
// audit (a completely separate query/pipeline) caught the same rows fine,
// which is how the gap was found — this test guards the substance-gate
// query specifically, since it silently regressed once already.
//
// Static extraction: read both source files AS TEXT (no live DB, no import
// side effects) and verify every `row.<col>` the SUBSTANCE_CHECKS predicates
// read is present as a selected column/alias in the subRows SQL. Deleting
// `i.segment` (or any other selected column a predicate reads) from the
// query must turn this test red without needing a database.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { checkIssueSizeSegmentFloor } from '../lib/substance-checks.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AUDIT_FILE = path.join(__dirname, '..', 'audit-ipo-coverage.mjs');
const CHECKS_FILE = path.join(__dirname, '..', 'lib', 'substance-checks.mjs');

function extractSubRowsSql(auditSource) {
  const marker = 'const subRows = await q(';
  const start = auditSource.indexOf(marker);
  assert.ok(start !== -1, 'subRows query not found in audit-ipo-coverage.mjs — has it been renamed/moved?');
  // The query is a single template-literal argument to q(...). Grab everything
  // up to the matching `WHERE i.${REAL_IPO}` close, which is stable across edits.
  const end = auditSource.indexOf('WHERE i.${REAL_IPO}`', start);
  assert.ok(end !== -1, 'could not locate the end of the subRows query');
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
// competing alias renaming it away. We check for either form.
function sqlSelectsColumn(sql, col) {
  const asAlias = new RegExp(`\\bAS\\s+"?${col}"?`, 'i');
  const bareOrQualified = new RegExp(`(^|[\\s,.])${col}\\b`, 'i');
  return asAlias.test(sql) || bareOrQualified.test(sql);
}

test('every row.<col> read by a SUBSTANCE_CHECKS predicate is selected by the subRows query', () => {
  const auditSource = readFileSync(AUDIT_FILE, 'utf8');
  const checksSource = readFileSync(CHECKS_FILE, 'utf8');

  const subRowsSql = extractSubRowsSql(auditSource);
  const fieldsRead = extractRowFieldReads(checksSource);

  // gmp_value is attached to rows in JS after the query (byId.get), not by
  // SQL — it is deliberately not part of the SELECT contract this test checks.
  fieldsRead.delete('gmp_value');

  const missing = [...fieldsRead].filter((col) => !sqlSelectsColumn(subRowsSql, col));

  assert.deepEqual(
    missing,
    [],
    `subRows query is missing column(s) read by substance predicates: ${missing.join(', ')}. ` +
      'Add them to the SELECT in audit-ipo-coverage.mjs or the check silently no-ops on every row.'
  );
});

test('checkIssueSizeSegmentFloor: flags a share-count-shaped MAINBOARD row', () => {
  const violation = checkIssueSizeSegmentFloor({
    issue_size: 17647058,
    price_range_max: 429,
    segment: 'MAINBOARD',
  });
  assert.notEqual(violation, null);
  assert.match(violation, /issue_size/);
});

test('checkIssueSizeSegmentFloor: returns null (no-op) when segment is undefined — documents the failure shape', () => {
  const violation = checkIssueSizeSegmentFloor({
    issue_size: 17647058,
    price_range_max: 429,
    segment: undefined,
  });
  assert.equal(violation, null);
});
