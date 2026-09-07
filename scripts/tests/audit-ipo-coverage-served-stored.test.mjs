// #186 (T-460): self-test for evaluateServedVsStoredDelta — the served-vs-stored
// row-count delta gate. T-272 P1-2: /api/registrars served 41 rows while the DB
// held 15 (26 unit-test fixture rows stranded in a 7-day Redis key after an
// integration suite pointed at prod). The DB alone looked fine, the page alone
// looked plausible — only the *difference* between them exposed it. This test
// reproduces that exact 41-vs-15 shape against a fake fetch + fake DB query, no
// network and no live DB required, so it runs the same in CI as on a laptop.
//
// Imports the ACTUAL function under test (not a re-implementation) so weakening
// the gate (e.g. loosening `===` to a tolerance) turns this fixture RED.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateServedVsStoredDelta, SERVED_VS_STORED_SURFACES } from '../audit-ipo-coverage.mjs';

function fakeFetch(byPath) {
  return async (url) => {
    const path = url.replace(/^https?:\/\/[^/]+/, '');
    const body = byPath[path];
    if (body === undefined) throw new Error(`fakeFetch: no fixture for ${path}`);
    return { json: async () => body };
  };
}

function fakeQuery(byName, sqlToName) {
  return async (sql) => {
    const name = sqlToName(sql);
    if (!(name in byName)) throw new Error(`fakeQuery: no fixture for SQL matching ${name}: ${sql}`);
    return [{ c: byName[name] }];
  };
}

// Maps a stored-count SQL string back to a fixture key by table name, so the
// fixtures below stay readable without depending on the exact SQL text.
const sqlToName = (sql) => {
  if (/FROM registrars/.test(sql)) return 'registrars';
  if (/FROM ipos WHERE status = 'OPEN'/.test(sql)) return 'ipos.OPEN';
  if (/FROM ipos WHERE status = 'UPCOMING'/.test(sql)) return 'ipos.UPCOMING';
  if (/FROM market_holidays/.test(sql)) return 'market-holidays';
  throw new Error(`sqlToName: unrecognized SQL: ${sql}`);
};

test('exposes exactly the 4 named list surfaces from the plan', () => {
  const names = SERVED_VS_STORED_SURFACES.map((s) => s.name).sort();
  assert.deepEqual(names, ['ipos.OPEN', 'ipos.UPCOMING', 'market-holidays', 'registrars']);
});

// --- RED-before-green: reproduces the T-272 P1-2 41-vs-15 stale-cache shape ---
test('FAILs registrars when served (41, stale cache) != stored (15, real rows) — T-272 P1-2 shape', async () => {
  const fetchImpl = fakeFetch({
    '/api/registrars': { registrars: Array.from({ length: 41 }, (_, i) => ({ id: i })) },
    '/api/ipos?status=OPEN&limit=100': { data: [] },
    '/api/ipos?status=UPCOMING&limit=100': { data: [] },
    [`/api/market-holidays?year=${new Date().getUTCFullYear()}`]: { holidays: [] },
  });
  const query = fakeQuery({ registrars: 15, 'ipos.OPEN': 0, 'ipos.UPCOMING': 0, 'market-holidays': 0 }, sqlToName);

  const results = await evaluateServedVsStoredDelta({ baseUrl: 'https://ipodhan.com', fetchImpl, query });
  const registrars = results.find((r) => r.name === 'registrars');

  assert.equal(registrars.ok, false, 'a 41-vs-15 mismatch MUST fail, not pass or silently round');
  assert.match(registrars.detail, /served 41, stored 15/, 'the failure message must name BOTH numbers, not just pass/fail');
});

test('PASSes every surface when served exactly equals stored', async () => {
  const year = new Date().getUTCFullYear();
  const fetchImpl = fakeFetch({
    '/api/registrars': { registrars: Array.from({ length: 15 }, (_, i) => ({ id: i })) },
    '/api/ipos?status=OPEN&limit=100': { data: Array.from({ length: 3 }, (_, i) => ({ id: i })) },
    '/api/ipos?status=UPCOMING&limit=100': { data: Array.from({ length: 7 }, (_, i) => ({ id: i })) },
    [`/api/market-holidays?year=${year}`]: { holidays: Array.from({ length: 14 }, (_, i) => ({ id: i })) },
  });
  const query = fakeQuery({ registrars: 15, 'ipos.OPEN': 3, 'ipos.UPCOMING': 7, 'market-holidays': 14 }, sqlToName);

  const results = await evaluateServedVsStoredDelta({ baseUrl: 'https://ipodhan.com', fetchImpl, query });
  assert.equal(results.length, 4);
  for (const r of results) assert.equal(r.ok, true, `${r.name} expected to PASS: ${r.detail}`);
});

test('does not silently pass a near-miss (off-by-one is a FAIL, not a tolerance)', async () => {
  const fetchImpl = fakeFetch({
    '/api/registrars': { registrars: Array.from({ length: 16 }, (_, i) => ({ id: i })) },
    '/api/ipos?status=OPEN&limit=100': { data: [] },
    '/api/ipos?status=UPCOMING&limit=100': { data: [] },
    [`/api/market-holidays?year=${new Date().getUTCFullYear()}`]: { holidays: [] },
  });
  const query = fakeQuery({ registrars: 15, 'ipos.OPEN': 0, 'ipos.UPCOMING': 0, 'market-holidays': 0 }, sqlToName);

  const results = await evaluateServedVsStoredDelta({ baseUrl: 'https://ipodhan.com', fetchImpl, query });
  const registrars = results.find((r) => r.name === 'registrars');
  assert.equal(registrars.ok, false);
  assert.match(registrars.detail, /served 16, stored 15/);
});

test('marks a surface unverifiable (ok: null), not a false PASS, when the fetch fails', async () => {
  const fetchImpl = async () => { throw new Error('ECONNREFUSED'); };
  const query = fakeQuery({ registrars: 15, 'ipos.OPEN': 0, 'ipos.UPCOMING': 0, 'market-holidays': 0 }, sqlToName);

  const results = await evaluateServedVsStoredDelta({ baseUrl: 'https://ipodhan.com', fetchImpl, query });
  for (const r of results) {
    assert.equal(r.ok, null, `${r.name}: a fetch failure must be unverifiable, never true`);
    assert.match(r.detail, /fetch .* failed/);
  }
});

test('marks a surface unverifiable (ok: null), not a false PASS, when the DB query fails', async () => {
  const year = new Date().getUTCFullYear();
  const fetchImpl = fakeFetch({
    '/api/registrars': { registrars: [] },
    '/api/ipos?status=OPEN&limit=100': { data: [] },
    '/api/ipos?status=UPCOMING&limit=100': { data: [] },
    [`/api/market-holidays?year=${year}`]: { holidays: [] },
  });
  const query = async () => { throw new Error('connection terminated'); };

  const results = await evaluateServedVsStoredDelta({ baseUrl: 'https://ipodhan.com', fetchImpl, query });
  for (const r of results) {
    assert.equal(r.ok, null, `${r.name}: a DB failure must be unverifiable, never true`);
    assert.match(r.detail, /query failed/);
  }
});
