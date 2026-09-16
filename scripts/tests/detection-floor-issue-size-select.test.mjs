// The static caller/predicate agreement instrument, for the DETECTION-FLOOR pair.
//
// WHY THIS FILE EXISTS. `scripts/tests/audit-substance-plausibility.test.mjs`
// already asserts that every `row.<col>` a SUBSTANCE predicate reads is present
// in `audit-substance-plausibility.mjs`'s SELECT. That instrument covers ONE of
// the two places `checkIssueSizeSegmentFloor` is implemented.
//
// There are two independent implementations of that predicate with the same name:
//
//   scripts/lib/substance-checks.mjs        <- run by audit-substance-plausibility.mjs
//   scripts/lib/detection-floor-checks.mjs  <- run by audit-detection-floor.mjs (NIGHTLY)
//
// They do not import each other. #608 corrected the message in the first one and
// the nightly audit went on emitting the uncorrected message, because no
// instrument watched this second pair. A fix that lands on one copy of a
// duplicated predicate and silently misses the other is the defect class here;
// this test is the missing half of the detection.
//
// Scope is deliberately checkC's query and checkC's predicates. A blanket
// "every predicate in detection-floor-checks.mjs" version cannot work: that file
// holds 37 predicates fed by a dozen different queries with different row
// shapes, so a global assertion would compare columns across unrelated SELECTs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AUDIT_FILE = path.join(__dirname, '..', 'audit-detection-floor.mjs');
const CHECKS_FILE = path.join(__dirname, '..', 'lib', 'detection-floor-checks.mjs');

// The predicates checkC feeds from its own `rows` query.
const CHECK_C_PREDICATES = ['checkIssueSizeSegmentFloor', 'checkIssueSizeSharesConsistency'];

function extractCheckCSql(auditSource) {
  const fnStart = auditSource.indexOf('async function checkC()');
  assert.ok(fnStart !== -1, 'checkC() not found in audit-detection-floor.mjs — renamed or moved?');
  const marker = 'SELECT id, company_name';
  const start = auditSource.indexOf(marker, fnStart);
  assert.ok(start !== -1, "checkC's rows query not found — its opening text changed?");
  const end = auditSource.indexOf('`', start);
  assert.ok(end !== -1, "could not locate the end of checkC's rows query");
  return auditSource.slice(start, end);
}

/** Balance braces from a named `export function <name>(` to get just that body. */
function extractFunctionBody(source, name) {
  const decl = `export function ${name}(`;
  const declStart = source.indexOf(decl);
  assert.ok(declStart !== -1, `could not find "${decl}" in detection-floor-checks.mjs`);
  const braceStart = source.indexOf('{', declStart);
  assert.ok(braceStart !== -1, `could not find the body opening brace for ${name}`);
  let depth = 0;
  for (let i = braceStart; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') {
      depth--;
      if (depth === 0) return source.slice(braceStart, i + 1);
    }
  }
  assert.fail(`unbalanced braces while scanning ${name}`);
}

function extractRowFieldReads(body) {
  const names = new Set();
  const re = /\brow\.([A-Za-z_][A-Za-z0-9_]*)\b/g;
  let m;
  while ((m = re.exec(body)) !== null) names.add(m[1]);
  return names;
}

function sqlSelectsColumn(sql, col) {
  const asAlias = new RegExp('\\bAS\\s+"?' + col + '"?', 'i');
  const bareOrQualified = new RegExp('(^|[\\s,.])' + col + '\\b', 'i');
  return asAlias.test(sql) || bareOrQualified.test(sql);
}

test("every row.<col> read by checkC's predicates is selected by checkC's query", () => {
  const auditSource = readFileSync(AUDIT_FILE, 'utf8');
  const checksSource = readFileSync(CHECKS_FILE, 'utf8');
  const sql = extractCheckCSql(auditSource);

  const fieldsRead = new Set();
  for (const name of CHECK_C_PREDICATES) {
    for (const f of extractRowFieldReads(extractFunctionBody(checksSource, name))) fieldsRead.add(f);
  }

  // POSITIVE CONTROL. An extractor that silently matched nothing would make this
  // test pass for every possible SELECT, which is the failure mode it exists to
  // prevent. Assert it actually read something, and something known.
  assert.ok(fieldsRead.size >= 3, `extractor found only ${fieldsRead.size} row.<col> read(s) — it has drifted from the source shape`);
  assert.ok(fieldsRead.has('issueSize'), 'canary: row.issueSize not seen — the field-read regex drifted');
  assert.ok(fieldsRead.has('segment'), 'canary: row.segment not seen — the field-read regex drifted');

  const missing = [...fieldsRead].filter((col) => !sqlSelectsColumn(sql, col));
  assert.deepEqual(
    missing,
    [],
    `checkC's query is missing column(s) its predicates read: ${missing.join(', ')}. ` +
      'Add them to the SELECT in audit-detection-floor.mjs, or the predicate silently sees undefined on every row.'
  );
});

// The reason the whole file exists, asserted directly rather than left implicit:
// the nightly copy must not assert a mechanism it has not tested. "looks like a
// share count stored as rupees" was emitted for NIRBHAY COLOURS and PIYUSH on
// production, whose issue_size was independently verified CORRECT against the
// BSE source (lane C item 14 slice 2, issue #472). A message that names one
// mechanism for a population with more than one sends a triager to the wrong
// write path, which is why #608 removed that claim from the other copy.
test('the nightly floor message does not assert the share-count mechanism unconditionally', () => {
  const checksSource = readFileSync(CHECKS_FILE, 'utf8');
  const body = extractFunctionBody(checksSource, 'checkIssueSizeSegmentFloor');
  const claim = /looks like a share count stored as rupees/;
  if (claim.test(body)) {
    assert.match(
      body,
      /authoritative_issue_price|authoritativeIssuePrice/,
      'checkIssueSizeSegmentFloor asserts "looks like a share count stored as rupees" without ever ' +
        'consulting an authoritative price — the claim is untested for the row it is printed about.'
    );
  }
});
