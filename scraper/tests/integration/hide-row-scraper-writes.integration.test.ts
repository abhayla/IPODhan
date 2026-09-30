/**
 * §9.2 item 23 (OD-116, OD-118, OD-150), write side, on ipodhan_test with the REAL functions:
 * a HIDDEN IPO gets zero scraper writes through every door that reads the lock, and a VISIBLE IPO
 * still gets them (the proof discriminates). Doors: the lock gate the GMP orchestrator and
 * BaseScraperOrchestrator ask (FieldProtectionService.isIPOLocked), the field-hold path every
 * repository upsert and IPORepository.update go through (insert AND update), the row-keyed hold
 * (peer_companies), the identity bind (resolveIpoRow), the anchor door, and the scraper's
 * candidate selection (post-listing price, closed-IPO job).
 *
 * To run (from scraper/):
 *   DATABASE_URL=postgresql://ipodhan_app:<pw>@localhost:15432/ipodhan_test \
 *     npx vitest run -c vitest.integration.config.ts tests/integration/hide-row-scraper-writes.integration.test.ts
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { sql, inArray } from 'drizzle-orm';
import * as schema from '@ipodhan/shared/db/schema';
import { IPORepository, FinancialDataRepository, resolveIpoRow } from '@ipodhan/shared';
import { configureUtcTimestampParsing } from '@ipodhan/shared/db';
import { FieldProtectionService } from '@ipodhan/shared/admin/field-protection-checker';
import { lockAndReadRowHolds } from '@ipodhan/shared/services/field-hold';
import { persistAnchorReport } from '../../src/services/anchor-persister';
import { selectPriceCandidates } from '../../src/scheduler/post-listing-price';
import { closedIpoCandidatesQuery } from '../../src/scheduler/closed-ipo-job';

const DATABASE_URL = process.env.DATABASE_URL;
const HIDDEN = '00000000-0000-4000-9123-000000000001';
const VISIBLE = '00000000-0000-4000-9123-000000000002';
const IDS = [HIDDEN, VISIBLE];
const NOW = new Date('2026-09-30T06:00:00Z');

const noRedis = {
  get: async () => null,
  set: async () => 'OK',
  setex: async () => 'OK',
  del: async () => 0,
  keys: async () => [],
  scan: async () => ['0', []],
} as never;

describe.skipIf(!DATABASE_URL)('§9.2 item 23: a hidden IPO gets zero scraper writes; a visible one still does', () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let repo: IPORepository;

  async function cleanup() {
    await db.delete(schema.financialData).where(inArray(schema.financialData.ipoId, IDS));
    await db.delete(schema.peerCompanies).where(inArray(schema.peerCompanies.ipoId, IDS));
    await db.delete(schema.fieldSources).where(inArray(schema.fieldSources.ipoId, IDS));
    await db.delete(schema.ipos).where(inArray(schema.ipos.id, IDS));
  }

  beforeAll(async () => {
    configureUtcTimestampParsing();
    pool = new Pool({ connectionString: DATABASE_URL, max: 4, options: '-c timezone=UTC' });
    const { rows } = await pool.query('select current_database() as d');
    if (rows[0].d !== 'ipodhan_test') throw new Error(`Refusing to run against ${rows[0].d}`);
    db = drizzle(pool, { schema });
    repo = new IPORepository(db as never, noRedis);
    await cleanup();
    // Both LISTED 10 days before NOW and closed before today: each is a price-job and closed-job candidate unless hidden.
    await db.execute(sql`
      INSERT INTO ipos (id, company_name, slug, offering_type, segment, category, status, open_date, close_date, listing_date, symbol, hidden_at, hidden_reason)
      VALUES
        (${HIDDEN}::uuid, 'Item23 Write Probe Hidden Ltd', 'item23-write-probe-hidden-ltd', 'IPO', 'MAINBOARD', 'MAINBOARD', 'LISTED', '2026-09-15', '2026-09-17', '2026-09-20', 'I23WHID', '2026-09-29T00:00:00Z', 'Not an IPO (test)'),
        (${VISIBLE}::uuid, 'Item23 Write Probe Visible Ltd', 'item23-write-probe-visible-ltd', 'IPO', 'MAINBOARD', 'MAINBOARD', 'LISTED', '2026-09-15', '2026-09-17', '2026-09-20', 'I23WVIS', NULL, NULL)
    `);
  }, 60000);

  afterAll(async () => {
    if (!db) return;
    await cleanup();
    await pool.end();
  }, 60000);

  it('the lock gate (GMP orchestrator, BaseScraperOrchestrator) refuses hidden, allows visible', async () => {
    const protection = new FieldProtectionService(db as never, null);
    expect(await protection.isIPOLocked(HIDDEN)).toBe(true);
    expect(await protection.isIPOLocked(VISIBLE)).toBe(false);
  });

  it('field-hold: a repository upsert INSERTS nothing for hidden (IpoHiddenError), inserts for visible', async () => {
    const fin = new FinancialDataRepository(db as never, noRedis);
    await expect(fin.upsert({ ipoId: HIDDEN } as never)).rejects.toMatchObject({ cause: expect.objectContaining({ name: 'IpoHiddenError' }) });
    await fin.upsert({ ipoId: VISIBLE } as never);
    const rows = await pool.query('SELECT ipo_id FROM financial_data WHERE ipo_id = ANY($1::uuid[])', [IDS]);
    expect(rows.rows.map((r) => r.ipo_id)).toEqual([VISIBLE]);
  });

  it('field-hold: IPORepository.update writes nothing to a hidden ipos row, writes to a visible one', async () => {
    await expect(repo.update(HIDDEN, { symbol: 'CHANGED' } as never)).rejects.toMatchObject({ cause: expect.objectContaining({ name: 'IpoHiddenError' }) });
    await repo.update(VISIBLE, { symbol: 'I23WVS2' } as never);
    const rows = await pool.query('SELECT id, symbol FROM ipos WHERE id = ANY($1::uuid[]) ORDER BY id', [IDS]);
    expect(rows.rows).toEqual([
      { id: HIDDEN, symbol: 'I23WHID' },
      { id: VISIBLE, symbol: 'I23WVS2' },
    ]);
  });

  it('row-keyed hold (peer_companies writer) refuses hidden, reads visible', async () => {
    await expect(db.transaction((tx) => lockAndReadRowHolds(tx as never, HIDDEN, 'peer_companies'))).rejects.toMatchObject({ name: 'IpoHiddenError' });
    const v = await db.transaction((tx) => lockAndReadRowHolds(tx as never, VISIBLE, 'peer_companies'));
    expect(v).toMatchObject({ exists: true, writeBlocked: false, hidden: false });
  });

  it('identity bind: a record carrying the hidden row\'s symbol BINDS it (nothing recreated) and writes nothing', async () => {
    await expect(resolveIpoRow(repo as never, { companyName: 'Item23 Write Probe Hidden Ltd', symbol: 'I23WHID' } as never)).rejects.toMatchObject({
      name: 'IpoHiddenError',
      ipoId: HIDDEN,
    });
    // Discriminates: the same call for the visible row does not refuse (it binds or finds nothing, never IpoHiddenError).
    await expect(resolveIpoRow(repo as never, { companyName: 'Item23 Write Probe Visible Ltd', symbol: 'I23WVS2' } as never)).resolves.not.toThrow();
    const n = await pool.query(`SELECT count(*)::int AS n FROM ipos WHERE company_name LIKE 'Item23 Write Probe%'`);
    expect(n.rows[0].n).toBe(2);
  });

  it('anchor door refuses hidden before reading the report; visible reaches the report read', async () => {
    const scrape = vi.fn(async () => null);
    const persist = vi.fn();
    const deps = { scrapeAnchorReport: scrape, anchorInvestorRepository: {}, ipoRepository: repo, persist } as never;
    const hidden = await persistAnchorReport(HIDDEN, { companyName: 'Item23 Write Probe Hidden Ltd', apply: true } as never, deps);
    expect(hidden.refusedKind).toBe('scraper_write_blocked');
    expect(scrape).not.toHaveBeenCalled();
    await persistAnchorReport(VISIBLE, { companyName: 'Item23 Write Probe Visible Ltd', apply: true } as never, deps);
    expect(scrape).toHaveBeenCalledTimes(1);
    expect(persist).not.toHaveBeenCalled();
  });

  it('candidate selection: the post-listing price job and the closed-IPO job do not walk a hidden row', async () => {
    const price = (await selectPriceCandidates(db as never, NOW)).map((c) => c.id).filter((id) => IDS.includes(id));
    expect(price).toEqual([VISIBLE]);
    const closed = await db.execute(closedIpoCandidatesQuery('item23-test-version', 10000));
    const closedIds = (closed.rows as Array<{ id: string }>).map((r) => r.id).filter((id) => IDS.includes(id));
    expect(closedIds).toEqual([VISIBLE]);
  });
});
