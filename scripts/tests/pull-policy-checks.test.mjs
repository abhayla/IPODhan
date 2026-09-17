// Planted-violation self-tests for item 3 slice S6's three checks
// (PULL-POLICY, PULL-WRITE-POLICY, PULL-PLAN-RANK). Imports the ACTUAL
// predicates from scripts/lib/pull-policy-checks.mjs — never a
// re-implementation — so a weakened/deleted check turns these fixtures RED.
// Run: node --test scripts/tests/pull-policy-checks.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  checkPlanRankMatchesPolicy,
  checkWriteSourceInPolicy,
  checkManifestMatchesGenerator,
  lookupManifestRanks,
  ipoTypeKey,
  checkOverrideRow,
  validateOverrideRankSet,
} from '../lib/pull-policy-checks.mjs';

// ---- PULL-PLAN-RANK ---------------------------------------------------------

test('PULL-PLAN-RANK FAILS when a plan row ranks BSE at rank2 but the policy ranks CHITTORGARH', () => {
  const plan = {
    tableName: 'ipos', fieldName: 'issueSize', rowKey: '', manifestVersion: 2,
    rank1Source: 'DOC', rank2Source: 'BSE', rank3Source: null,
  };
  const policyRanks = ['DOC', 'CHITTORGARH'];
  assert.ok(checkPlanRankMatchesPolicy(plan, policyRanks) !== null);
});

test('PULL-PLAN-RANK FAILS when the plan has an extra trailing rank the policy does not', () => {
  const plan = {
    tableName: 'ipos', fieldName: 'issueSize', rowKey: '', manifestVersion: 2,
    rank1Source: 'DOC', rank2Source: 'CHITTORGARH', rank3Source: 'BSE',
  };
  const policyRanks = ['DOC', 'CHITTORGARH'];
  assert.ok(checkPlanRankMatchesPolicy(plan, policyRanks) !== null);
});

test('PULL-PLAN-RANK PASSES when the plan ranks match the policy exactly, in order', () => {
  const plan = {
    tableName: 'ipos', fieldName: 'issueSize', rowKey: '', manifestVersion: 2,
    rank1Source: 'DOC', rank2Source: 'CHITTORGARH', rank3Source: null,
  };
  const policyRanks = ['DOC', 'CHITTORGARH'];
  assert.equal(checkPlanRankMatchesPolicy(plan, policyRanks), null);
});

// ---- PULL-WRITE-POLICY ------------------------------------------------------

test('PULL-WRITE-POLICY FAILS when field_sources.source is below a capable higher rank not present in policy', () => {
  const row = { tableName: 'ipos', fieldName: 'issueSize', rowKey: '', source: 'MONEYCONTROL' };
  const policyRanks = ['DOC', 'CHITTORGARH']; // MONEYCONTROL retired from this field's ranks
  assert.ok(checkWriteSourceInPolicy(row, policyRanks) !== null);
});

test('PULL-WRITE-POLICY PASSES when the write source is ADMIN regardless of policy ranks', () => {
  const row = { tableName: 'ipos', fieldName: 'issueSize', rowKey: '', source: 'ADMIN' };
  const policyRanks = ['DOC', 'CHITTORGARH'];
  assert.equal(checkWriteSourceInPolicy(row, policyRanks), null);
});

test('PULL-WRITE-POLICY PASSES when the write source is in the policy ranks', () => {
  const row = { tableName: 'ipos', fieldName: 'issueSize', rowKey: '', source: 'CHITTORGARH' };
  const policyRanks = ['DOC', 'CHITTORGARH'];
  assert.equal(checkWriteSourceInPolicy(row, policyRanks), null);
});

// ---- PULL-POLICY -------------------------------------------------------------

test('PULL-POLICY FAILS when the generator --check exits non-zero (manifest drifted from spec)', () => {
  const runCheckFn = () => ({ exitCode: 1, output: 'DRIFT — committed file differs from the generator.\nsymbol MAINBOARD: [DOC,NSE,BSE] -> [DOC,NSE]' });
  assert.ok(checkManifestMatchesGenerator(runCheckFn) !== null);
});

test('PULL-POLICY PASSES when the generator --check exits 0 (manifest matches spec)', () => {
  const runCheckFn = () => ({ exitCode: 0, output: 'field-manifest.json matches the generator exactly.' });
  assert.equal(checkManifestMatchesGenerator(runCheckFn), null);
});

// ---- helpers: lookupManifestRanks / ipoTypeKey --------------------------------

test('lookupManifestRanks returns the ranks for a known field.ipoType', () => {
  const manifest = { fields: { 'ipos.issueSize': { rank: { MAINBOARD: ['DOC', 'CHITTORGARH'] } } } };
  assert.deepEqual(lookupManifestRanks(manifest, 'ipos', 'issueSize', 'MAINBOARD'), ['DOC', 'CHITTORGARH']);
});

test('lookupManifestRanks returns null for an unknown field key', () => {
  const manifest = { fields: {} };
  assert.equal(lookupManifestRanks(manifest, 'ipos', 'nonexistent', 'MAINBOARD'), null);
});

test('ipoTypeKey: MAINBOARD for a non-SME segment', () => {
  assert.equal(ipoTypeKey('MAINBOARD', null), 'MAINBOARD');
});

test('ipoTypeKey: SME_NSE when segment is SME and listingExchanges includes NSE', () => {
  assert.equal(ipoTypeKey('SME', ['NSE']), 'SME_NSE');
});

test('ipoTypeKey: SME_BSE when segment is SME and listingExchanges is missing/does not include NSE', () => {
  assert.equal(ipoTypeKey('SME', null), 'SME_BSE');
  assert.equal(ipoTypeKey('SME', ['BSE']), 'SME_BSE');
});

// ---- PULL-OVERRIDES (item 3 slice S4) ---------------------------------------------------------

const REAL_MANIFEST_ISSUE_SIZE = {
  fields: {
    'ipos.issue_size': {
      class: 'D',
      rank: { MAINBOARD: ['DOC', 'CHITTORGARH'] },
      capability: { DOC: { capable: true }, CHITTORGARH: { capable: true }, BSE: { capable: false, reason: 'measured wrong' } },
    },
    'ipos.open_date': {
      class: 'T',
      rank: { MAINBOARD: ['NSE', 'BSE'] },
      capability: { NSE: { capable: true }, BSE: { capable: true } },
    },
  },
};

test('PULL-OVERRIDES: an active, valid override reports no violation and stays time-active', () => {
  const row = {
    id: 'ov-1', tableName: 'ipos', fieldName: 'issue_size', ipoId: null,
    rank1Source: 'CHITTORGARH', rank2Source: 'DOC', rank3Source: null,
    reason: 'valid', expiresAt: new Date(Date.now() + 86400000).toISOString(),
  };
  const result = checkOverrideRow(row, new Date(), (c) => validateOverrideRankSet(REAL_MANIFEST_ISSUE_SIZE, c.table, c.column, c.ranks));
  assert.equal(result.violation, null);
  assert.equal(result.stillTimeActive, true);
});

test('PULL-OVERRIDES FAILS a row past expires_at with no expired_at set', () => {
  const row = {
    id: 'ov-2', tableName: 'ipos', fieldName: 'issue_size', ipoId: null,
    rank1Source: 'DOC', rank2Source: null, rank3Source: null,
    reason: 'stale', expiresAt: new Date(Date.now() - 86400000).toISOString(),
  };
  const result = checkOverrideRow(row, new Date(), (c) => validateOverrideRankSet(REAL_MANIFEST_ISSUE_SIZE, c.table, c.column, c.ranks));
  assert.ok(result.violation !== null);
  assert.equal(result.stillTimeActive, false);
});

test('PULL-OVERRIDES FAILS an active row that ranks a now-incapable source (manifest drifted since it was set)', () => {
  const row = {
    id: 'ov-3', tableName: 'ipos', fieldName: 'issue_size', ipoId: null,
    rank1Source: 'BSE', rank2Source: null, rank3Source: null,
    reason: 'was valid once', expiresAt: new Date(Date.now() + 86400000).toISOString(),
  };
  const result = checkOverrideRow(row, new Date(), (c) => validateOverrideRankSet(REAL_MANIFEST_ISSUE_SIZE, c.table, c.column, c.ranks));
  assert.ok(result.violation !== null);
  assert.equal(result.stillTimeActive, true);
});

test('PULL-OVERRIDES FAILS an active row that ranks DOC on an E-1/class-T field (S-05 drift)', () => {
  const row = {
    id: 'ov-4', tableName: 'ipos', fieldName: 'open_date', ipoId: null,
    rank1Source: 'DOC', rank2Source: 'NSE', rank3Source: null,
    reason: 'was valid once', expiresAt: new Date(Date.now() + 86400000).toISOString(),
  };
  const result = checkOverrideRow(row, new Date(), (c) => validateOverrideRankSet(REAL_MANIFEST_ISSUE_SIZE, c.table, c.column, c.ranks));
  assert.ok(result.violation !== null);
});

test('validateOverrideRankSet returns null for a capable, non-class-T ranking', () => {
  assert.equal(validateOverrideRankSet(REAL_MANIFEST_ISSUE_SIZE, 'ipos', 'issue_size', ['CHITTORGARH']), null);
});

// ---- MAJOR-3 fix (S4 review round 2): pin the KNOWN DUPLICATION in lockstep --------------------
// `validateOverrideRankSet` (this file's .mjs mirror) and `validateOverrideCandidate` (the real TS
// module the CLI uses) are two implementations by necessity (plain .mjs test scripts cannot import
// scraper/src TS modules with capability/S-05 logic bundled with a manifest LOADER -- see this
// file's own header). This test imports the REAL TS validator directly (Node 22's native TS
// stripping, same pattern as scripts/tests/heading-hash-current.test.mjs) and asserts BOTH
// validators agree on capable/incapable/S-05 outcomes for the same candidates -- so a future
// divergence (one adds a rule the other doesn't) fails HERE, not silently in production.
import { validateOverrideCandidate } from '../../scraper/src/config/field-source-override-validation.ts';

const PARITY_MANIFEST = {
  version: 1,
  fields: {
    'ipos.issue_size': {
      class: 'D',
      rank: { MAINBOARD: ['DOC', 'CHITTORGARH'] },
      capability: { DOC: { capable: true }, CHITTORGARH: { capable: true }, BSE: { capable: false, reason: 'measured wrong' } },
    },
    'ipos.open_date': {
      class: 'T',
      rank: { MAINBOARD: ['NSE', 'BSE'] },
      capability: { NSE: { capable: true }, BSE: { capable: true }, DOC: { capable: true } },
    },
  },
};

const PARITY_CASES = [
  { table: 'ipos', column: 'issue_size', ranks: ['CHITTORGARH'], label: 'capable, non-class-T' },
  { table: 'ipos', column: 'issue_size', ranks: ['BSE'], label: 'incapable source' },
  { table: 'ipos', column: 'open_date', ranks: ['DOC'], label: 'S-05 document-on-timetable-field' },
  { table: 'ipos', column: 'open_date', ranks: ['NSE'], label: 'capable, class-T, non-document source' },
];

for (const c of PARITY_CASES) {
  test(`MUTATION TARGET: validateOverrideCandidate and validateOverrideRankSet agree (${c.label})`, () => {
    const tsResult = validateOverrideCandidate(
      { table: c.table, column: c.column, ranks: c.ranks, reason: 'a reason at least twenty chars long' },
      PARITY_MANIFEST
    );
    const mjsResult = validateOverrideRankSet(PARITY_MANIFEST, c.table, c.column, c.ranks);
    // Agreement is on PASS/FAIL, not on the exact message shape (the TS validator also runs
    // reason-length/duplicate-rank checks the .mjs mirror deliberately omits -- see this file's
    // header -- so only the capability/S-05 verdict is compared, which both implement).
    assert.equal(tsResult === null, mjsResult === null, `TS=${JSON.stringify(tsResult)} vs mjs=${JSON.stringify(mjsResult)}`);
  });
}
