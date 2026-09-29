/**
 * §9.2 item 27 (OD-120), item 28(c), §2.9 on the real database (ipodhan_test only).
 *
 * A POSTPONED IPO's relaunch filing completes (the REAL COMPLETED-transaction helper
 * `writeReceiptAndReopen`). Admin values on its DOCUMENT fields are cleared with the rest: the value
 * is emptied, the hold released, the ADMIN provenance removed, the plan row re-asked, and an audit row
 * keeps the old value. ONE alert lists each cleared value with a re-apply link, and an admin EMPTY
 * value reads "you had blanked X; the new filing says Y". Exchange (E-1) and non-document fields keep
 * their admin value. The re-apply writes the value back through `writeAdminFieldValue` with a fresh
 * version token.
 *
 *   DATABASE_URL=postgresql://ipodhan_app:<pw>@127.0.0.1:15432/ipodhan_test REDIS_URL=redis://127.0.0.1:6379/15 \
 *     npx vitest run --config vitest.integration.config.ts tests/integration/relaunch-clears-admin.integration.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import * as schema from '../../../packages/shared/src/db/schema';
import { writeAdminFieldValue, readAdminFieldVersion } from '../../../packages/shared/src/services/admin-field-write';
import { buildRelaunchReapplyInput, RELAUNCH_CLEARED_AUDIT_ACTION } from '../../../packages/shared/src/services/relaunch-reapply';
import { writeReceiptAndReopen } from '../../src/services/filing-auto-persist';
import { sendRelaunchClearedAlert } from '../../src/services/admin-alerts';

const DATABASE_URL = process.env.DATABASE_URL;
const IPO = '00000000-0000-4000-8000-0000000a2701';
const LIVE = '00000000-0000-4000-8000-0000000a2702';
const actor = { name: 'Item27 Admin', adminId: 'item27-admin' };
let pool: Pool;
let db: ReturnType<typeof drizzle<typeof schema>>;
const rows = (r: any) => (r.rows ?? r) as any[];

async function adminWrite(ipoId: string, tableName: string, fieldName: string, opts: { value?: unknown; empty?: string }) {
  const v = await readAdminFieldVersion(db as never, ipoId, tableName, fieldName);
  const res = await writeAdminFieldValue(db as never, {
    ipoId,
    tableName,
    fieldName,
    value: opts.value,
    empty: opts.empty ? { reason: opts.empty } : undefined,
    mode: { kind: 'typed', sourceNote: 'RHP p.12 (item 27 test)' },
    overrideReason: 'item 27 test value',
    expectedVersion: v!.version,
    actor,
    entryPoint: 'item27-test',
  });
  expect(res.kind).toBe('OK');
}
async function newDoc(ipoId: string, type: string): Promise<string> {
  const r = await db.execute(sql`
    INSERT INTO documents (ipo_id, type, title, url, extraction_status, sequence_number)
    VALUES (${ipoId}::uuid, ${type}, ${'item27 ' + type}, ${'https://example.test/item27-' + Math.random().toString(36).slice(2) + '.pdf'}, 'COMPLETED',
            (SELECT coalesce(max(sequence_number), 0) + 1 FROM documents WHERE ipo_id = ${ipoId}::uuid))
    RETURNING id`);
  return rows(r)[0].id;
}
const holds = async (ipoId: string) =>
  rows(await db.execute(sql`SELECT table_name, field_name FROM field_protection_metadata WHERE ipo_id = ${ipoId}::uuid AND is_protected ORDER BY 1, 2`));

describe.skipIf(!DATABASE_URL)('relaunch clears admin document-field values (OD-120, ipodhan_test)', () => {
  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL, max: 2, options: '-c timezone=UTC' });
    db = drizzle(pool, { schema });
    const name = rows(await db.execute(sql`SELECT current_database() AS d`))[0].d;
    if (name !== 'ipodhan_test') throw new Error(`refusing to run against ${name}`);
    for (const id of [IPO, LIVE]) await db.execute(sql`DELETE FROM ipos WHERE id = ${id}::uuid`);
    await db.execute(sql`
      INSERT INTO ipos (id, company_name, slug, status, segment, issue_size, open_date)
      VALUES (${IPO}::uuid, 'Item Twenty Seven Seeds Ltd', 'item-twenty-seven-seeds-ltd', 'POSTPONED', 'SME', 267300000, '2026-06-23'),
             (${LIVE}::uuid, 'Item Twenty Seven Live Ltd', 'item-twenty-seven-live-ltd', 'UPCOMING', 'MAINBOARD', 100000000, NULL)`);
  });
  afterAll(async () => {
    if (!pool) return;
    for (const id of [IPO, LIVE]) {
      await db.execute(sql`DELETE FROM audit_logs WHERE ipo_id = ${id}::uuid`);
      await db.execute(sql`DELETE FROM ipos WHERE id = ${id}::uuid`);
    }
    await pool.end();
  });

  it('clears typed and EMPTY admin values on document fields, keeps E-1 and non-document ones, audits, and alerts once', async () => {
    await adminWrite(IPO, 'ipos', 'issueSize', { value: '300000000' });
    await adminWrite(IPO, 'ipo_details', 'freshIssue', { empty: 'the draft figure did not apply' });
    await adminWrite(IPO, 'ipos', 'openDate', { value: '2026-06-24' }); // E-1: never cleared here
    await adminWrite(IPO, 'listing_performance', 'listingPrice', { value: '101' }); // not a document field
    await db.execute(sql`
      INSERT INTO ipo_field_plan (ipo_id, table_name, row_key, field_name, state, manifest_version)
      VALUES (${IPO}::uuid, 'ipos', '', 'issue_size', 'SUPPLIED', 2)`);
    // Admin writes land before the relaunch filing is discovered.
    await new Promise((r) => setTimeout(r, 20));
    const rhp = await newDoc(IPO, 'RHP');

    const out = await writeReceiptAndReopen(
      db as never,
      { id: rhp, ipoId: IPO, type: 'RHP', filingDate: '2026-08-10', sha256: null },
      [
        { tableName: 'ipos', rowKey: '', fieldName: 'issueSize', value: '267300000' },
        { tableName: 'ipo_details', rowKey: '', fieldName: 'freshIssue', value: '2700000' },
      ]
    );

    // Values emptied, holds released on the two document fields only.
    const ipo = rows(await db.execute(sql`SELECT issue_size, open_date::text AS open_date FROM ipos WHERE id = ${IPO}::uuid`))[0];
    expect(ipo.issue_size).toBeNull();
    expect(ipo.open_date).toBe('2026-06-24');
    const lp = rows(await db.execute(sql`SELECT listing_price::text AS p FROM listing_performance WHERE ipo_id = ${IPO}::uuid`))[0];
    expect(Number(lp.p)).toBe(101);
    expect(await holds(IPO)).toEqual([
      { table_name: 'ipos', field_name: 'openDate' },
      { table_name: 'listing_performance', field_name: 'listingPrice' },
    ]);
    const prov = rows(await db.execute(sql`
      SELECT table_name, field_name FROM field_sources WHERE ipo_id = ${IPO}::uuid AND source = 'ADMIN' ORDER BY 1, 2`));
    expect(prov).toEqual([
      { table_name: 'ipos', field_name: 'openDate' },
      { table_name: 'listing_performance', field_name: 'listingPrice' },
    ]);
    const planRow = rows(await db.execute(sql`
      SELECT state::text AS state FROM ipo_field_plan WHERE ipo_id = ${IPO}::uuid AND field_name = 'issue_size'`))[0];
    expect(planRow.state).toBe('PENDING');

    // Audit rows keep the old values.
    const audit = rows(await db.execute(sql`
      SELECT id, table_name, field_name, old_value, new_value, details FROM audit_logs
      WHERE ipo_id = ${IPO}::uuid AND action_type = ${RELAUNCH_CLEARED_AUDIT_ACTION} ORDER BY field_name`));
    expect(audit.map((a) => [a.table_name, a.field_name, a.old_value, a.new_value])).toEqual([
      ['ipo_details', 'freshIssue', null, null],
      ['ipos', 'issueSize', '300000000.00', null],
    ]);
    expect(audit[0].details.adminEmpty).toBe(true);
    expect(audit[0].details.emptyReason).toBe('the draft figure did not apply');
    expect(audit[0].details.newFilingValue).toBe('2700000');
    expect(audit[1].details.documentId).toBe(rhp);

    // Exactly one alert lists both, with a re-apply link each.
    expect(out.relaunchCleared?.cleared.length).toBe(2);
    const sends: Array<{ title: string; body?: string; dedupeKey?: string }> = [];
    const claims = new Set<string>();
    const deps = {
      env: 'test',
      isClaimed: async (k: string) => claims.has(k),
      claim: async (k: string) => void claims.add(k),
      send: async (_s: 'P2', title: string, o: { body?: string; dedupeKey?: string }) => {
        sends.push({ title, ...o });
        return { sent: true } as never;
      },
      record: async () => undefined,
      baseUrl: 'https://staging.ipodhan.com',
    };
    const first = await sendRelaunchClearedAlert(out.relaunchCleared!, deps);
    const again = await sendRelaunchClearedAlert(out.relaunchCleared!, deps);
    expect(first.outcome).toBe('sent');
    expect(again.outcome).toBe('already-sent');
    expect(sends).toHaveLength(1);
    expect(sends[0].body).toContain('you had blanked ipo_details.freshIssue; the new filing says 2700000');
    expect(sends[0].body).toContain('ipos.issueSize: you had 300000000.00; the new filing says 267300000');
    for (const a of audit) expect(sends[0].body).toContain(`https://staging.ipodhan.com/api/admin/relaunch-reapply?audit=${a.id}`);

    // Re-apply the issue size through the ONE admin write with a fresh version token.
    const input = await buildRelaunchReapplyInput(db as never, audit[1].id, actor);
    expect(input.ok).toBe(true);
    if (!input.ok) return;
    const res = await writeAdminFieldValue(db as never, input.input);
    expect(res.kind).toBe('OK');
    const back = rows(await db.execute(sql`SELECT issue_size::text AS s FROM ipos WHERE id = ${IPO}::uuid`))[0];
    expect(Number(back.s)).toBe(300000000);
    expect((await holds(IPO)).map((h) => h.field_name)).toContain('issueSize');
    // The empty one re-applies as an admin EMPTY with its reason.
    const inputEmpty = await buildRelaunchReapplyInput(db as never, audit[0].id, actor);
    expect(inputEmpty.ok && inputEmpty.input.empty?.reason).toContain('the draft figure did not apply');
    // A second re-apply of the same cleared value is refused.
    const twice = await buildRelaunchReapplyInput(db as never, audit[1].id, actor);
    expect(twice.ok).toBe(false);

    // A later filing while still POSTPONED does not clear the re-applied value (set after the relaunch filing).
    const addendum = await newDoc(IPO, 'ADDENDUM');
    const later = await writeReceiptAndReopen(
      db as never,
      { id: addendum, ipoId: IPO, type: 'ADDENDUM', filingDate: '2026-08-12', sha256: null },
      [{ tableName: 'ipos', rowKey: '', fieldName: 'issueSize', value: '267300000' }]
    );
    expect(later.relaunchCleared?.cleared ?? []).toEqual([]);
    expect(Number(rows(await db.execute(sql`SELECT issue_size::text AS s FROM ipos WHERE id = ${IPO}::uuid`))[0].s)).toBe(300000000);
  });

  it('a filing on an IPO that is not POSTPONED clears nothing', async () => {
    await adminWrite(LIVE, 'ipos', 'issueSize', { value: '120000000' });
    await new Promise((r) => setTimeout(r, 20));
    const rhp = await newDoc(LIVE, 'RHP');
    const out = await writeReceiptAndReopen(
      db as never,
      { id: rhp, ipoId: LIVE, type: 'RHP', filingDate: '2026-08-10', sha256: null },
      [{ tableName: 'ipos', rowKey: '', fieldName: 'issueSize', value: '100000000' }]
    );
    expect(out.relaunchCleared?.cleared ?? []).toEqual([]);
    expect(Number(rows(await db.execute(sql`SELECT issue_size::text AS s FROM ipos WHERE id = ${LIVE}::uuid`))[0].s)).toBe(120000000);
  });
});
