// Item 1 slice s8 — the SEEDED proof for q_field_sources_row_key_coverage.
//
// The unit tests prove the classifier. This proves the SQL: the real SELECTs
// in scripts/lib/row-key-coverage-checks.mjs, run by collectRowKeyCoverage()
// against real rows in a real Postgres, catching the real defect. Without it,
// the check's green on production data is unfalsifiable — today's data cannot
// exercise it, because no caller writes a non-empty row_key yet.
//
// SAFETY: refuses to run unless SELECT current_database() returns a database
// whose name ends in '_test'. Every seeded row is namespaced by a per-run uuid
// and deleted in a finally block. NEVER point this at ipodhan or ipodhan_staging.
//
// Usage (local Postgres 16, the default):
//   ROW_KEY_TEST_DATABASE_URL=postgresql://postgres:<pw>@127.0.0.1:5432/ipodhan_test \
//     node --test scripts/tests/row-key-coverage.db.test.mjs
//
// With no URL configured the tests SKIP loudly (they never silently pass).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

import pg from 'pg';
import { collectRowKeyCoverage } from '../lib/row-key-coverage-checks.mjs';
import { rowKeyForName } from '../lib/normalize-company-name.mjs';

// Explicit only — no fallback that could resolve to a live host. CI already
// exports DATABASE_URL pointing at its ipodhan_test service container.
const CONNECTION_STRING =
  process.env.ROW_KEY_TEST_DATABASE_URL || process.env.TEST_DATABASE_URL || process.env.DATABASE_URL || null;
const RUN = Math.random().toString(36).slice(2, 10);
let client = null;
let skipReason = CONNECTION_STRING ? null : 'no ROW_KEY_TEST_DATABASE_URL / TEST_DATABASE_URL / DATABASE_URL configured';

const ipoIds = [];
const q = (sql, params) => client.query(sql, params).then((r) => r.rows);

async function seedIpo(companyName) {
  const [row] = await q(
    `INSERT INTO ipos (company_name, slug, status, offering_type)
     VALUES ($1, $2, 'UPCOMING', 'IPO') RETURNING id`,
    [companyName, `s8-${RUN}-${ipoIds.length}`]
  );
  ipoIds.push(row.id);
  return row.id;
}

before(async () => {
  if (skipReason) return;
  client = new pg.Client({ connectionString: CONNECTION_STRING, connectionTimeoutMillis: 10000 });
  try {
    await client.connect();
  } catch (e) {
    skipReason = `could not connect: ${e.message}`;
    client = null;
    return;
  }
  // Fail-closed guard: only ever a *_test database.
  const [{ db }] = await q('SELECT current_database() AS db');
  assert.match(db, /_test$/, `REFUSING to run: current_database() is '${db}', not a *_test database`);
});

after(async () => {
  if (!client) return;
  try {
    for (const id of ipoIds) {
      await q('DELETE FROM field_sources WHERE ipo_id = $1', [id]);
      for (const t of ['financial_statements', 'promoters', 'ipo_intermediaries', 'peer_companies']) {
        await q(`DELETE FROM ${t} WHERE ipo_id = $1`, [id]);
      }
      await q('DELETE FROM ipos WHERE id = $1', [id]);
    }
  } finally {
    await client.end();
  }
});

// Every case looks only at the IPO it seeded, so pre-existing rows in
// ipodhan_test cannot make a case pass or fail by accident.
function forIpo(result, ipoId, companyName) {
  return {
    status: result.status,
    mine: result.offenders.filter((o) => o.includes(companyName)),
    ipoId,
  };
}

test('seeded FAIL: a second financial_statements row with no field_sources entry for its row_key is named', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const name = `S8 Fail Case ${RUN} Ltd`;
  const id = await seedIpo(name);
  await q(
    `INSERT INTO financial_statements (ipo_id, fiscal_year, basis, unit)
     VALUES ($1, 2023, 'RESTATED', 'CRORE'), ($1, 2024, 'RESTATED', 'CRORE')`,
    [id]
  );
  // Only FY2023 got provenance — FY2024's write forgot its rowKey.
  await q(
    `INSERT INTO field_sources (ipo_id, table_name, row_key, field_name, source)
     VALUES ($1, 'financial_statements', '2023:RESTATED', 'revenue', 'DRHP')`,
    [id]
  );

  const result = await collectRowKeyCoverage(q);
  const mine = forIpo(result, id, name);
  console.log('  [seeded FAIL] status=%s offenders=%o', mine.status, mine.mine);
  assert.equal(result.status, 'FAIL');
  assert.equal(mine.mine.length, 1);
  assert.match(mine.mine[0], /financial_statements/);
  assert.match(mine.mine[0], /'2024:RESTATED'/);
});

test('seeded PASS: the same two rows with a field_sources entry each are clean', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const name = `S8 Pass Case ${RUN} Ltd`;
  const id = await seedIpo(name);
  await q(
    `INSERT INTO financial_statements (ipo_id, fiscal_year, basis, unit)
     VALUES ($1, 2023, 'RESTATED', 'CRORE'), ($1, 2024, 'RESTATED', 'CRORE')`,
    [id]
  );
  // Two DIFFERENT field names on purpose: ipodhan_test still carries the
  // 3-column unique_field_source_per_ipo (ipo_id, table_name, field_name), so
  // 'revenue' twice under two row_keys is rejected at insert time. That is the
  // very constraint item 1's schema slice widens; seeding around it keeps this
  // proof runnable on both the old and the widened shape.
  await q(
    `INSERT INTO field_sources (ipo_id, table_name, row_key, field_name, source)
     VALUES ($1, 'financial_statements', '2023:RESTATED', 'revenue', 'DRHP'),
            ($1, 'financial_statements', '2024:RESTATED', 'pat', 'DRHP')`,
    [id]
  );

  const result = await collectRowKeyCoverage(q);
  const mine = forIpo(result, id, name);
  console.log('  [seeded PASS] status=%s myOffenders=%d detail=%s', mine.status, mine.mine.length, result.detail);
  assert.equal(mine.mine.length, 0, `this IPO must be clean, got: ${mine.mine.join('; ')}`);
  assert.notEqual(result.status, 'UNVERIFIABLE', 'a row-keyed pair exists, so the run must be judged, not blind');
});

test("seeded FAIL (F-101): two rows whose provenance is all under the '' default are named as unresolved, not read as unverifiable", async (t) => {
  if (skipReason) return t.skip(skipReason);
  const name = `S8 Unresolved Case ${RUN} Ltd`;
  const id = await seedIpo(name);
  await q(
    `INSERT INTO peer_companies (ipo_id, company_name, is_listed)
     VALUES ($1, 'Beta Industries Limited', true), ($1, 'Gamma Industries Ltd', true)`,
    [id]
  );
  await q(
    `INSERT INTO field_sources (ipo_id, table_name, row_key, field_name, source)
     VALUES ($1, 'peer_companies', '', 'peRatio', 'DRHP')`,
    [id]
  );

  const result = await collectRowKeyCoverage(q);
  const mine = forIpo(result, id, name);
  console.log('  [seeded FAIL unresolved] status=%s offenders=%o', mine.status, mine.mine);
  // field_sources rows EXIST for this pair — every one carries the ''
  // catch-all key. A writer ran and wrote unresolved provenance for every
  // row it touched: a real, detectable defect (F-101), not an unknowable
  // "writer never ran" state.
  assert.equal(result.status, 'FAIL');
  assert.equal(mine.mine.length, 1);
  assert.match(mine.mine[0], /peer_companies/);
  assert.match(mine.mine[0], /'beta industries'/);
  assert.match(mine.mine[0], /'gamma industries'/);
});

test('seeded UNVERIFIABLE: a pair with NO field_sources rows at all is not judged as clean (genuinely unknowable, F-101)', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const name = `S8 NoProvenance Case ${RUN} Ltd`;
  const id = await seedIpo(name);
  await q(
    `INSERT INTO peer_companies (ipo_id, company_name, is_listed)
     VALUES ($1, 'Delta Industries Limited', true), ($1, 'Epsilon Industries Ltd', true)`,
    [id]
  );
  // No field_sources rows inserted for this pair at all — genuinely unknown.

  const result = await collectRowKeyCoverage(q);
  const mine = forIpo(result, id, name);
  console.log('  [seeded UNVERIFIABLE no-provenance] status=%s myOffenders=%d', mine.status, mine.mine.length);
  assert.equal(mine.mine.length, 0);
  assert.ok(result.noProvenancePairCount >= 1, 'the un-provenanced pair must be counted as no-provenance');
});

test('seeded cross-table FAIL: a promoter and an intermediary row with no provenance are each named', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const name = `S8 CrossTable Case ${RUN} Ltd`;
  const id = await seedIpo(name);
  await q(
    `INSERT INTO promoters (ipo_id, name) VALUES ($1, 'Sunrise Holdings Limited'), ($1, 'Jane Roe')`,
    [id]
  );
  await q(
    `INSERT INTO ipo_intermediaries (ipo_id, role, name)
     VALUES ($1, 'BRLM', 'JM Financial Limited'), ($1, 'BRLM', 'Axis Capital Ltd')`,
    [id]
  );
  await q(
    `INSERT INTO field_sources (ipo_id, table_name, row_key, field_name, source)
     VALUES ($1, 'promoters', 'sunrise holdings', 'sharesHeld', 'DRHP'),
            ($1, 'ipo_intermediaries', 'BRLM:jm financial', 'sebiRegNo', 'DRHP')`,
    [id]
  );

  const result = await collectRowKeyCoverage(q);
  const mine = forIpo(result, id, name);
  console.log('  [seeded cross-table FAIL] status=%s offenders=%o', mine.status, mine.mine);
  assert.equal(result.status, 'FAIL');
  assert.equal(mine.mine.length, 2, `expected one offender per table, got: ${mine.mine.join('; ')}`);
  assert.ok(mine.mine.some((o) => /promoters/.test(o) && /'jane roe'/.test(o)));
  assert.ok(mine.mine.some((o) => /ipo_intermediaries/.test(o) && /'BRLM:axis capital'/.test(o)));
});

test('seeded junk-named promoter: rowKeyForName derives a stable junk: key, and a missing provenance row for it is named (T-518 fix proof)', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const name = `S8 Junk Case ${RUN} Ltd`;
  const id = await seedIpo(name);
  // A real promoter and a scrape-artifact "----" name (pure punctuation) —
  // this is exactly the class the rowKeyForName re-port (this branch) fixed:
  // the OLD bare-normalizer derivation would have keyed "----" as '', which
  // can never match a real junk:<sha1> provenance row and would false-FAIL
  // forever. The junk key is deterministic — computed here the same way the
  // check computes it, not hand-typed, so a hash-algorithm change fails this
  // test rather than silently drifting.
  await q(
    `INSERT INTO promoters (ipo_id, name) VALUES ($1, 'Jane Roe'), ($1, '----')`,
    [id]
  );
  const junkKey = rowKeyForName('----');
  // Only the real name gets provenance — the junk row's write was forgotten,
  // same shape as the other seeded FAIL cases above.
  await q(
    `INSERT INTO field_sources (ipo_id, table_name, row_key, field_name, source)
     VALUES ($1, 'promoters', 'jane roe', 'sharesHeld', 'DRHP')`,
    [id]
  );

  const result = await collectRowKeyCoverage(q);
  const mine = forIpo(result, id, name);
  console.log('  [seeded junk-named FAIL] status=%s offenders=%o junkKey=%s', mine.status, mine.mine, junkKey);
  assert.equal(result.status, 'FAIL');
  assert.equal(mine.mine.length, 1);
  assert.match(mine.mine[0], /promoters/);
  assert.ok(mine.mine[0].includes(`'${junkKey}'`), `offender line must name the junk: key, got: ${mine.mine[0]}`);
});

test('seeded junk-named promoter with provenance under its junk: key PASSes (proves the fix both ways, not just the FAIL direction)', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const name = `S8 Junk Pass Case ${RUN} Ltd`;
  const id = await seedIpo(name);
  await q(
    `INSERT INTO promoters (ipo_id, name) VALUES ($1, 'Jane Roe'), ($1, '----')`,
    [id]
  );
  const junkKey = rowKeyForName('----');
  await q(
    `INSERT INTO field_sources (ipo_id, table_name, row_key, field_name, source)
     VALUES ($1, 'promoters', 'jane roe', 'sharesHeld', 'DRHP'),
            ($1, 'promoters', $2, 'sharesHeld', 'DRHP')`,
    [id, junkKey]
  );

  const result = await collectRowKeyCoverage(q);
  const mine = forIpo(result, id, name);
  console.log('  [seeded junk-named PASS] status=%s myOffenders=%d', mine.status, mine.mine.length);
  assert.equal(mine.mine.length, 0, `this IPO must be clean, got: ${mine.mine.join('; ')}`);
});
