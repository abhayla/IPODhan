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
