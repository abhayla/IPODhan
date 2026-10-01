import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import type { Pool } from 'pg';
import { sql } from 'drizzle-orm';
import { getTestDb, cleanupTestDb } from '../test-utils/db';
import { reconcileMarketHolidayYear, type NseFetchResult } from '../../src/services/market-holidays-reconcile';

/**
 * F-220 / F-221 / #1380: market_holidays 2026 reconciled to NSE's own list, against a REAL Postgres
 * (ipodhan_test), with the REAL NSE answer captured 2026-10-02 and the REAL staging 2026 shape
 * (the 20 BOTH/TRADING rows F-221 measured, which are web/scripts/seed-market-holidays.ts' typed
 * 2026 block). One test per NSE answer state (spec-verified-recommendations rule 10).
 *
 * The year's existing rows are saved before and restored after, so the shared test DB is left as
 * found. SKIPS when no database is configured.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const YEAR = 2026;
const FIXTURE = path.resolve(__dirname, '../fixtures/nse/holiday-master-trading-2026-10-02.json');
const NSE_BODY = fs.readFileSync(FIXTURE, 'utf8');

/** F-221: the 20 staging rows of 2026 (all BOTH/TRADING). */
const STAGING_2026: Array<[string, string]> = [
  ['2026-01-26', 'Republic Day'],
  ['2026-02-16', 'Maha Shivratri'],
  ['2026-03-03', 'Holi'],
  ['2026-03-21', 'Id-Ul-Fitr (Ramadan Eid)'],
  ['2026-03-26', 'Ram Navami'],
  ['2026-03-30', 'Mahavir Jayanti'],
  ['2026-04-03', 'Good Friday'],
  ['2026-04-14', 'Dr. Baba Saheb Ambedkar Jayanti'],
  ['2026-05-01', 'Maharashtra Day'],
  ['2026-05-01', 'Buddha Purnima'],
  ['2026-05-28', 'Bakri Id'],
  ['2026-06-26', 'Muharram'],
  ['2026-08-15', 'Independence Day'],
  ['2026-09-05', 'Ganesh Chaturthi'],
  ['2026-10-02', 'Mahatma Gandhi Jayanti'],
  ['2026-10-10', 'Dussehra'],
  ['2026-10-29', 'Diwali Laxmi Pujan'],
  ['2026-10-30', 'Diwali Balipratipada'],
  ['2026-11-25', 'Gurunanak Jayanti'],
  ['2026-12-25', 'Christmas'],
];

/** The 15 broker-published weekday dates (F-221) plus NSE's own 15-Jan-2026 election closure. */
const NSE_WEEKDAYS_2026 = [
  '2026-01-15', '2026-01-26', '2026-03-03', '2026-03-26', '2026-03-31', '2026-04-03', '2026-04-14', '2026-05-01',
  '2026-05-28', '2026-06-26', '2026-09-14', '2026-10-02', '2026-10-20', '2026-11-10', '2026-11-24', '2026-12-25',
];
const NSE_ALL_2026 = [...NSE_WEEKDAYS_2026, '2026-02-15', '2026-03-21', '2026-08-15', '2026-11-08'].sort();

type Row = { id: string; date: string; description: string; exchange: string; type: string; year: number };

describe.runIf(!!DATABASE_URL)('market_holidays reconcile to NSE (F-220/F-221, live ipodhan_test)', () => {
  let pool: Pool;
  let db: Awaited<ReturnType<typeof getTestDb>>;
  let saved: Row[] = [];

  const readYear = async (): Promise<Row[]> => {
    const r = await pool.query(
      `SELECT id::text AS id, to_char(date,'YYYY-MM-DD') AS date, description, exchange::text AS exchange, type::text AS type, year
         FROM market_holidays WHERE date >= '2026-01-01' AND date <= '2026-12-31' ORDER BY date, description`
    );
    return r.rows as Row[];
  };
  const clearYear = () => pool.query(`DELETE FROM market_holidays WHERE date >= '2026-01-01' AND date <= '2026-12-31'`);
  const seedStaging = async (extra: Array<[string, string, string]> = []) => {
    await clearYear();
    for (const [date, description] of STAGING_2026) {
      await pool.query(`INSERT INTO market_holidays (date, description, exchange, type, year) VALUES ($1::date, $2, 'BOTH', 'TRADING', 2026)`, [date, description]);
    }
    for (const [date, description, exchange] of extra) {
      await pool.query(`INSERT INTO market_holidays (date, description, exchange, type, year) VALUES ($1::date, $2, $3, 'TRADING', 2026)`, [date, description, exchange]);
    }
  };
  const run = (answer: NseFetchResult, apply: boolean, afterWrites?: (tx: never) => Promise<void>, acceptPlan?: string) =>
    reconcileMarketHolidayYear({ db: db as never, year: YEAR, apply, answer, log: () => {}, afterWrites: afterWrites as never, acceptPlan });
  /** The operator's two steps: read the dry run's sha, then apply with it. */
  const applyAccepted = async (answer: NseFetchResult, afterWrites?: (tx: never) => Promise<void>) => {
    const dry = await run(answer, false);
    return run(answer, true, afterWrites, dry.planSha);
  };
  const truncated = (keep: number) => {
    const j = JSON.parse(NSE_BODY) as { CM: Array<{ weekDay: string }> };
    j.CM = j.CM.filter((r) => !/^(Saturday|Sunday)/.test(r.weekDay)).slice(0, keep);
    return JSON.stringify(j);
  };

  beforeAll(async () => {
    db = await getTestDb();
    pool = (db as unknown as { $client: Pool }).$client;
    const current = (await pool.query('select current_database() as d')).rows[0].d as string;
    if (current !== 'ipodhan_test') throw new Error(`Refusing to run: connected to '${current}', not 'ipodhan_test'.`);
    saved = await readYear();
  });

  afterAll(async () => {
    if (!pool) return;
    await clearYear();
    for (const r of saved) {
      await pool.query(
        `INSERT INTO market_holidays (id, date, description, exchange, type, year) VALUES ($1::uuid, $2::date, $3, $4, $5, $6)`,
        [r.id, r.date, r.description, r.exchange, r.type, r.year]
      );
    }
    await cleanupTestDb();
  });

  beforeEach(async () => {
    await seedStaging();
  });

  it('state list, dry run: plans the F-221 repair and writes nothing', async () => {
    const before = await readYear();
    const out = await run({ ok: true, body: NSE_BODY }, false);
    expect(out.exitCode).toBe(0);
    expect(out.state).toBe('list');
    const count = (k: string) => out.actions.filter((a) => a.kind === k).length;
    expect({ insert: count('insert'), move: count('move'), update: count('update'), retire: count('retire') }).toEqual({
      insert: 1,
      move: 7,
      update: 1,
      retire: 1,
    });
    expect(out.actions.find((a) => a.kind === 'insert')?.date).toBe('2026-01-15');
    expect(out.actions.filter((a) => a.kind === 'move').map((a) => `${a.from}->${a.date}`).sort()).toEqual([
      '2026-02-16->2026-02-15',
      '2026-03-30->2026-03-31',
      '2026-09-05->2026-09-14',
      '2026-10-10->2026-10-20',
      '2026-10-29->2026-11-08',
      '2026-10-30->2026-11-10',
      '2026-11-25->2026-11-24',
    ]);
    expect(await readYear()).toEqual(before);
  });

  it('state list, apply: the year equals NSE CM exactly — every exchange label reconciled, one BOTH row per date', async () => {
    // A false NSE-labelled row and a false BSE-labelled row from other writers, plus an NSE-labelled
    // duplicate on a true date: all must go, whatever their label.
    await seedStaging([
      ['2026-07-07', 'Not a holiday (NSE writer)', 'NSE'],
      ['2026-07-08', 'Not a holiday (BSE writer)', 'BSE'],
      ['2026-12-25', 'Christmas', 'NSE'],
    ]);
    const out = await applyAccepted({ ok: true, body: NSE_BODY });
    expect(out.exitCode).toBe(0);
    expect(out.applied).toBe(true);
    const after = await readYear();
    expect(after.map((r) => r.date)).toEqual(NSE_ALL_2026);
    const weekdays = after.filter((r) => ![0, 6].includes(new Date(`${r.date}T00:00:00Z`).getUTCDay())).map((r) => r.date);
    expect(weekdays).toEqual(NSE_WEEKDAYS_2026);
    expect(new Set(after.map((r) => `${r.exchange}/${r.type}`))).toEqual(new Set(['BOTH/TRADING']));
    expect(after.find((r) => r.date === '2026-11-24')?.description).toBe('Prakash Gurpurb Sri Guru Nanak Dev');
    expect(after.find((r) => r.date === '2026-03-31')?.description).toBe('Shri Mahavir Jayanti');
    expect(after.every((r) => r.year === 2026)).toBe(true);

    const again = await run({ ok: true, body: NSE_BODY }, true);
    expect(again.actions).toEqual([]);
  });

  it('state fetch-failed (HTTP error / timeout / blocked): changes nothing, exit 3 with the cause', async () => {
    const before = await readYear();
    const out = await run({ ok: false, cause: 'NSE holiday-master answered HTTP 403' }, true);
    expect(out.exitCode).toBe(3);
    expect(out.cause).toContain('HTTP 403');
    expect(await readYear()).toEqual(before);
  });

  it('state malformed (non-JSON body): changes nothing, exit 3', async () => {
    const before = await readYear();
    const out = await run({ ok: true, body: '<html>Access Denied</html>' }, true);
    expect(out.exitCode).toBe(3);
    expect(out.state).toBe('malformed');
    expect(await readYear()).toEqual(before);
  });

  it('state no-rows-for-year: valid JSON without a 2026 row changes nothing for 2026, exit 4', async () => {
    const before = await readYear();
    const only2027 = NSE_BODY.replace(/-2026"/g, '-2027"');
    const out = await run({ ok: true, body: only2027 }, true);
    expect(out.exitCode).toBe(4);
    expect(out.state).toBe('no-rows-for-year');
    expect(await readYear()).toEqual(before);
  });

  it('state unparseable-rows: a 2026 row with a bad date changes nothing for 2026, exit 5, row reported', async () => {
    const before = await readYear();
    const bad = NSE_BODY.replaceAll('"tradingDate":"14-Sep-2026"', '"tradingDate":"31-Sep-2026"');
    expect(bad).not.toBe(NSE_BODY);
    const out = await run({ ok: true, body: bad }, true);
    expect(out.exitCode).toBe(5);
    expect(out.cause).toContain('31-Sep-2026');
    expect(await readYear()).toEqual(before);
  });

  it('apply is ONE transaction: a failure after the writes leaves the year exactly as it was', async () => {
    const before = await readYear();
    await expect(
      applyAccepted({ ok: true, body: NSE_BODY }, async () => {
        throw new Error('injected failure after writes');
      })
    ).rejects.toThrow('injected failure after writes');
    expect(await readYear()).toEqual(before);
  });

  it('the post-apply equality check is real: an extra row appearing after the writes rolls the whole transaction back', async () => {
    const before = await readYear();
    await expect(
      applyAccepted({ ok: true, body: NSE_BODY }, async (tx: { execute: (q: unknown) => Promise<unknown> }) => {
        await tx.execute(sql`INSERT INTO market_holidays (date, description, exchange, type, year) VALUES ('2026-07-07'::date, 'Extra after writes', 'BOTH', 'TRADING', 2026)`);
      })
    ).rejects.toThrow(/does not equal NSE's 2026 list.*rolled back/);
    expect(await readYear()).toEqual(before);
  });

  it('state implausibly_short: a valid answer with 3 of 20 CM rows changes nothing, exit 6, even with a matching accept sha (no 17-row delete plan is ever built)', async () => {
    const before = await readYear();
    const answer = { ok: true as const, body: truncated(3) };
    const out = await run(answer, true, undefined, 'a'.repeat(64));
    expect(out.exitCode).toBe(6);
    expect(out.state).toBe('implausibly_short');
    expect(out.actions).toEqual([]);
    expect(await readYear()).toEqual(before);
  });

  it('plan-acceptance guard: the real F-221 plan (9 retire+move of 20) is refused without a sha and with a wrong sha, and applies with the dry run sha', async () => {
    const before = await readYear();
    const answer = { ok: true as const, body: NSE_BODY };
    const none = await run(answer, true);
    expect(none.exitCode).toBe(7);
    expect(none.applied).toBe(false);
    expect(await readYear()).toEqual(before);
    const wrong = await run(answer, true, undefined, '0'.repeat(64));
    expect(wrong.exitCode).toBe(7);
    expect(await readYear()).toEqual(before);
    const dry = await run(answer, false);
    expect(dry.planSha).toMatch(/^[0-9a-f]{64}$/);
    const ok = await run(answer, true, undefined, dry.planSha);
    expect(ok.exitCode).toBe(0);
    expect(ok.applied).toBe(true);
    expect((await readYear()).map((r) => r.date)).toEqual(NSE_ALL_2026);
  });

  it('a sha computed for a different plan is refused (the sha binds the plan, not the year)', async () => {
    const dry = await run({ ok: true, body: NSE_BODY }, false);
    await seedStaging([['2026-07-07', 'Not a holiday (NSE writer)', 'NSE']]);
    const before = await readYear();
    const out = await run({ ok: true, body: NSE_BODY }, true, undefined, dry.planSha);
    expect(out.exitCode).toBe(7);
    expect(await readYear()).toEqual(before);
  });
});
