// Item 1 slice s8 — unit proof for the row-key coverage detection check.
//
// This check has nothing to catch on today's real data (no production caller
// passes a non-empty rowKey yet), so a green nightly run proves nothing on its
// own. THESE TESTS are what make the green meaningful: they show the check
// actually catches the defect on constructed data, per guard.
//
//   node --test scripts/tests/row-key-coverage-checks.test.mjs
//
// The DB-backed twin (row-key-coverage.db.test.mjs) runs the SAME classifier
// through the SAME SQL against seeded rows in ipodhan_test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyRowKeyCoverage,
  deriveChildRowKey,
  collectRowKeyCoverage,
  ROW_KEYED_CHILD_TABLES,
  CHILD_ROW_SQL,
  PROVENANCE_KEYS_SQL,
} from '../lib/row-key-coverage-checks.mjs';

const IPO = '11111111-1111-1111-1111-111111111111';
const IPO2 = '22222222-2222-2222-2222-222222222222';

const fin = (ipoId, rowKey) => ({ ipoId, companyName: 'Acme Ltd', tableName: 'financial_statements', rowKey });
const prov = (ipoId, tableName, rowKey) => ({ ipoId, tableName, rowKey });

// ---- GUARD: per-pair join ---------------------------------------------------

test('FAIL: a keyed pair whose second child row has no field_sources entry is named', () => {
  const r = classifyRowKeyCoverage({
    childRows: [fin(IPO, '2023:RESTATED'), fin(IPO, '2024:RESTATED')],
    provenanceKeys: [prov(IPO, 'financial_statements', '2023:RESTATED')],
  });
  assert.equal(r.status, 'FAIL');
  assert.equal(r.offenders.length, 1);
  assert.match(r.offenders[0], /Acme Ltd/);
  assert.match(r.offenders[0], /financial_statements/);
  assert.match(r.offenders[0], /'2024:RESTATED'/);
});

test('PASS: a keyed pair with a field_sources entry for every child row key is clean, and says so', () => {
  const r = classifyRowKeyCoverage({
    childRows: [fin(IPO, '2023:RESTATED'), fin(IPO, '2024:RESTATED')],
    provenanceKeys: [
      prov(IPO, 'financial_statements', '2023:RESTATED'),
      prov(IPO, 'financial_statements', '2024:RESTATED'),
    ],
  });
  assert.equal(r.status, 'PASS');
  assert.equal(r.offenders.length, 0);
  assert.equal(r.enforcedPairCount, 1);
  assert.match(r.detail, /checked and clean/);
});

test('the join is scoped to the pair — another IPO\'s provenance under the same key does not satisfy this one', () => {
  const r = classifyRowKeyCoverage({
    childRows: [fin(IPO, '2023:RESTATED'), fin(IPO, '2024:RESTATED')],
    provenanceKeys: [
      prov(IPO, 'financial_statements', '2023:RESTATED'),
      prov(IPO2, 'financial_statements', '2024:RESTATED'),
    ],
  });
  assert.equal(r.status, 'FAIL');
  assert.match(r.offenders[0], /'2024:RESTATED'/);
});

test('the join is scoped to the table — a provenance row on a different table does not satisfy this one', () => {
  const r = classifyRowKeyCoverage({
    childRows: [fin(IPO, '2023:RESTATED'), fin(IPO, '2024:RESTATED')],
    provenanceKeys: [
      prov(IPO, 'financial_statements', '2023:RESTATED'),
      prov(IPO, 'promoters', '2024:RESTATED'),
    ],
  });
  assert.equal(r.status, 'FAIL');
});

// ---- GUARD: enforced / not-yet-keyed split ----------------------------------

test("UNVERIFIABLE, never PASS: every multi-row pair carries provenance only under the '' catch-all (today's real state)", () => {
  const r = classifyRowKeyCoverage({
    childRows: [fin(IPO, '2023:RESTATED'), fin(IPO, '2024:RESTATED')],
    provenanceKeys: [prov(IPO, 'financial_statements', '')],
  });
  assert.equal(r.status, 'UNVERIFIABLE');
  assert.equal(r.notYetKeyedPairCount, 1);
  assert.equal(r.enforcedPairCount, 0);
  assert.match(r.detail, /NOT a pass/);
});

test('a pair with NO field_sources rows at all is also not-yet-keyed, not a silent pass', () => {
  const r = classifyRowKeyCoverage({
    childRows: [fin(IPO, '2023:RESTATED'), fin(IPO, '2024:RESTATED')],
    provenanceKeys: [],
  });
  assert.equal(r.status, 'UNVERIFIABLE');
  assert.equal(r.notYetKeyedPairCount, 1);
});

test('one non-empty row_key flips that pair into enforcement — a half-keyed writer FAILs, it does not stay unverifiable', () => {
  const r = classifyRowKeyCoverage({
    childRows: [fin(IPO, '2023:RESTATED'), fin(IPO, '2024:RESTATED')],
    provenanceKeys: [
      prov(IPO, 'financial_statements', '2023:RESTATED'),
      prov(IPO, 'financial_statements', ''),
    ],
  });
  assert.equal(r.status, 'FAIL');
  assert.equal(r.enforcedPairCount, 1);
  assert.match(r.offenders[0], /'2024:RESTATED'/);
});

test('a keyed pair and an unkeyed pair together: PASS on the judged one, and the detail says the other was NOT judged', () => {
  const r = classifyRowKeyCoverage({
    childRows: [
      fin(IPO, '2023:RESTATED'), fin(IPO, '2024:RESTATED'),
      fin(IPO2, '2023:RESTATED'), fin(IPO2, '2024:RESTATED'),
    ],
    provenanceKeys: [
      prov(IPO, 'financial_statements', '2023:RESTATED'),
      prov(IPO, 'financial_statements', '2024:RESTATED'),
      prov(IPO2, 'financial_statements', ''),
    ],
  });
  assert.equal(r.status, 'PASS');
  assert.equal(r.enforcedPairCount, 1);
  assert.equal(r.notYetKeyedPairCount, 1);
  assert.match(r.detail, /not row-keyed yet and were not judged/);
});

// ---- GUARD: multi-row filter ------------------------------------------------

test('a single-row pair with zero provenance is out of the class — but "nothing to check" is worded differently from "checked and clean"', () => {
  const r = classifyRowKeyCoverage({
    childRows: [fin(IPO, '2024:RESTATED')],
    provenanceKeys: [],
  });
  assert.equal(r.status, 'PASS');
  assert.equal(r.multiRowPairCount, 0);
  assert.match(r.detail, /nothing to check/);
  assert.doesNotMatch(r.detail, /checked and clean/);
});

test('two rows is already "more than one" — the boundary is >1, not >2', () => {
  const r = classifyRowKeyCoverage({
    childRows: [fin(IPO, '2023:RESTATED'), fin(IPO, '2024:RESTATED')],
    provenanceKeys: [prov(IPO, 'financial_statements', '2023:RESTATED')],
  });
  assert.equal(r.multiRowPairCount, 1);
  assert.equal(r.status, 'FAIL');
});

// ---- GUARD: table list ------------------------------------------------------

test('all four multi-row child tables named by the item-01 card are swept', () => {
  assert.deepEqual([...ROW_KEYED_CHILD_TABLES].sort(), [
    'financial_statements', 'ipo_intermediaries', 'peer_companies', 'promoters',
  ]);
  for (const t of ROW_KEYED_CHILD_TABLES) {
    assert.ok(CHILD_ROW_SQL[t], `no CHILD_ROW_SQL entry for ${t}`);
  }
});

test('a defect in EACH of the four tables is caught (dropping one from the list would leave it un-audited)', () => {
  const rows = [
    { ipoId: IPO, companyName: 'Acme Ltd', tableName: 'financial_statements', rowKey: '2024:RESTATED' },
    { ipoId: IPO, companyName: 'Acme Ltd', tableName: 'promoters', rowKey: 'jane roe' },
    { ipoId: IPO, companyName: 'Acme Ltd', tableName: 'ipo_intermediaries', rowKey: 'BRLM:jm financial' },
    { ipoId: IPO, companyName: 'Acme Ltd', tableName: 'peer_companies', rowKey: 'beta corp' },
  ];
  for (const t of ROW_KEYED_CHILD_TABLES) {
    const mine = rows.filter((r) => r.tableName === t)[0];
    const r = classifyRowKeyCoverage({
      childRows: [{ ...mine, rowKey: 'seeded:one' }, mine],
      provenanceKeys: [prov(IPO, t, 'seeded:one')],
    });
    assert.equal(r.status, 'FAIL', `${t} defect not caught — is ${t} still in ROW_KEYED_CHILD_TABLES?`);
    assert.match(r.offenders[0], new RegExp(t));
  }
});

// ---- GUARD: row-key derivation ----------------------------------------------

test('financial_statements key is fiscalYear:basis — two bases in one year are two different rows', () => {
  const a = deriveChildRowKey('financial_statements', { fiscalYear: 2024, basis: 'RESTATED' });
  const b = deriveChildRowKey('financial_statements', { fiscalYear: 2024, basis: 'STANDALONE' });
  assert.equal(a, '2024:RESTATED');
  assert.notEqual(a, b);
});

test('promoters key is the normalized name — a suffix/punctuation variant is the SAME promoter', () => {
  assert.equal(
    deriveChildRowKey('promoters', { name: 'Sunrise Holdings Limited' }),
    deriveChildRowKey('promoters', { name: 'Sunrise Holdings Ltd' })
  );
});

test('ipo_intermediaries key is role:normalizedName — the same firm in two roles is two rows, two firms in one role are two rows', () => {
  const brlmJm = deriveChildRowKey('ipo_intermediaries', { role: 'BRLM', name: 'JM Financial Limited' });
  const registrarJm = deriveChildRowKey('ipo_intermediaries', { role: 'REGISTRAR', name: 'JM Financial Limited' });
  const brlmAxis = deriveChildRowKey('ipo_intermediaries', { role: 'BRLM', name: 'Axis Capital Ltd' });
  assert.equal(brlmJm, 'BRLM:jm financial');
  assert.notEqual(brlmJm, registrarJm);
  assert.notEqual(brlmJm, brlmAxis);
});

test('peer_companies key is the normalized peer company name', () => {
  assert.equal(deriveChildRowKey('peer_companies', { companyName: 'Beta Industries Limited' }), 'beta industries');
});

test('an unknown child table throws rather than silently deriving an empty key', () => {
  assert.throws(() => deriveChildRowKey('anchor_investors', {}), /unknown child table/);
});

// ---- the SQL the audit actually runs ----------------------------------------

test('collectRowKeyCoverage reads all four child tables and the provenance keys, and classifies the result', async () => {
  const seen = [];
  const fakeQ = async (sql, params) => {
    seen.push({ sql, params });
    if (sql === PROVENANCE_KEYS_SQL) {
      return [{ ipoId: IPO, tableName: 'financial_statements', rowKey: '2023:RESTATED' }];
    }
    if (sql === CHILD_ROW_SQL.financial_statements) {
      return [
        { ipoId: IPO, companyName: 'Acme Ltd', fiscalYear: 2023, basis: 'RESTATED' },
        { ipoId: IPO, companyName: 'Acme Ltd', fiscalYear: 2024, basis: 'RESTATED' },
      ];
    }
    return [];
  };
  const r = await collectRowKeyCoverage(fakeQ);
  assert.equal(seen.length, ROW_KEYED_CHILD_TABLES.length + 1);
  assert.deepEqual(seen.at(-1).params, [ROW_KEYED_CHILD_TABLES]);
  assert.equal(r.status, 'FAIL');
  assert.match(r.offenders[0], /'2024:RESTATED'/);
});

test('peer_companies rows are keyed on the PEER company name, not on the IPO company name', async () => {
  const fakeQ = async (sql) => {
    if (sql === CHILD_ROW_SQL.peer_companies) {
      return [
        { ipoId: IPO, companyName: 'Acme Ltd', companyNameOfPeer: 'Beta Corp Limited' },
        { ipoId: IPO, companyName: 'Acme Ltd', companyNameOfPeer: 'Gamma Industries Ltd' },
      ];
    }
    if (sql === PROVENANCE_KEYS_SQL) return [{ ipoId: IPO, tableName: 'peer_companies', rowKey: 'beta corp' }];
    return [];
  };
  const r = await collectRowKeyCoverage(fakeQ);
  assert.equal(r.status, 'FAIL');
  assert.match(r.offenders[0], /'gamma industries'/);
  assert.doesNotMatch(r.offenders[0], /'acme'/);
});
