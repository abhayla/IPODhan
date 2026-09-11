// F-101 — the three-state proof for the row-key coverage check.
//
// The check on main cannot distinguish "the row-keyed writer is switched off"
// from "the row-keyed writer ran and failed": both leave a single catch-all
// field_sources row under row_key = '' for the pair. The fix is in the WRITER
// (filing-persister mints `unresolved:<reason>` on every fallback path), not in
// the check.
//
// This file is the measurement of that claim against the REAL
// `classifyRowKeyCoverage` — no re-implementation. It asserts the full state
// table, including the pre-fix state, so a regression in either direction is
// visible:
//
//   flag OFF, working as designed      -> prov {''}                  -> UNVERIFIABLE
//   flag ON, consolidation succeeded   -> prov {derived keys}        -> PASS
//   flag ON, consolidation FAILED      -> prov {'', 'unresolved:..'} -> FAIL
//
//   node --test scripts/tests/row-key-coverage-unresolved-marker.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyRowKeyCoverage } from '../lib/row-key-coverage-checks.mjs';

const IPO = '11111111-1111-1111-1111-111111111111';

/** Two financial_statements rows for one IPO — a multi-row pair, in class. */
const CHILD_ROWS = [
  { ipoId: IPO, companyName: 'Acme Ltd', tableName: 'financial_statements', rowKey: '2023:RESTATED' },
  { ipoId: IPO, companyName: 'Acme Ltd', tableName: 'financial_statements', rowKey: '2024:RESTATED' },
];

const prov = (rowKey) => ({ ipoId: IPO, tableName: 'financial_statements', rowKey });

test('state 1 — flag OFF (catch-all key only): UNVERIFIABLE, never judged', () => {
  const r = classifyRowKeyCoverage({
    childRows: CHILD_ROWS,
    // the legacy trackField('financial_statements', 'rows') row, and nothing else
    provenanceKeys: [prov('')],
  });
  assert.equal(r.status, 'UNVERIFIABLE');
  assert.equal(r.enforcedPairCount, 0);
  assert.equal(r.notYetKeyedPairCount, 1);
  assert.deepEqual(r.offenders, []);
});

test('state 2 — flag ON, consolidation succeeded: PASS', () => {
  const r = classifyRowKeyCoverage({
    childRows: CHILD_ROWS,
    provenanceKeys: [prov(''), prov('2023:RESTATED'), prov('2024:RESTATED')],
  });
  assert.equal(r.status, 'PASS');
  assert.equal(r.enforcedPairCount, 1);
  assert.deepEqual(r.offenders, []);
});

test('state 3 — flag ON, consolidation FAILED: the unresolved marker forces FAIL', () => {
  const r = classifyRowKeyCoverage({
    childRows: CHILD_ROWS,
    // exactly what the writer leaves on the throw path: the legacy catch-all
    // row PLUS the sentinel, and no derived key at all
    provenanceKeys: [
      prov(''),
      prov('unresolved:consolidation-threw: pool exhausted <- ECONNREFUSED 5432'),
    ],
  });
  assert.equal(r.status, 'FAIL');
  assert.equal(r.enforcedPairCount, 1);
  assert.equal(r.notYetKeyedPairCount, 0);
  assert.equal(r.offenders.length, 1);
  assert.match(r.offenders[0], /2 of 2 row key\(s\) have no field_sources entry/);
});

test('state 3b — a PARTIAL failure names only the rows that lost provenance', () => {
  const r = classifyRowKeyCoverage({
    childRows: CHILD_ROWS,
    provenanceKeys: [
      prov(''),
      prov('2023:RESTATED'),
      prov('unresolved:consolidation-skipped: LOWER_RANK'),
    ],
  });
  assert.equal(r.status, 'FAIL');
  assert.match(r.offenders[0], /1 of 2 row key\(s\)/);
  assert.match(r.offenders[0], /'2024:RESTATED'/);
});

test('GUARD (the sentinel is what does the work): without it the SAME failure reads UNVERIFIABLE', () => {
  // This is the defect, stated as a test. Drop the marker from state 3 and the
  // check falls back to silence — which is why the fix had to be in the writer.
  const withoutMarker = classifyRowKeyCoverage({
    childRows: CHILD_ROWS,
    provenanceKeys: [prov('')],
  });
  const withMarker = classifyRowKeyCoverage({
    childRows: CHILD_ROWS,
    provenanceKeys: [prov(''), prov('unresolved:no-consolidator-injected')],
  });
  assert.equal(withoutMarker.status, 'UNVERIFIABLE');
  assert.equal(withMarker.status, 'FAIL');
});

test('GUARD (a pair with one child row stays out of class even with a marker)', () => {
  const r = classifyRowKeyCoverage({
    childRows: [CHILD_ROWS[0]],
    provenanceKeys: [prov(''), prov('unresolved:no-consolidator-injected')],
  });
  assert.equal(r.multiRowPairCount, 0);
  assert.equal(r.status, 'PASS');
  assert.match(r.detail, /nothing to check/);
});
