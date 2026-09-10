import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import {
  normalizeCompanyNameForMatching,
  compactCompanyNameKey,
  normalizedCompanyNameSql,
  compactNormalizedCompanyNameSql,
} from '@ipodhan/shared/utils/company-name-normalizer';

/**
 * Item 12 slice B. NOTHING IN CI CHECKED THAT THE TWO NORMALISERS AGREE.
 *
 * Measured before this test existed: `scripts/tests/normalize-company-name-parity.test.mjs`
 * contains ZERO occurrences of "sql" — it compares a hand-copied JS normaliser
 * against the TypeScript SSOT, which says nothing about the SQL twin. The only
 * TS-vs-SQL test in the repo read `web/.env.local` and reached production
 * through a tunnel, so it could never run in CI at all; slice 12-B deletes it
 * and ships this instead.
 *
 * This runs against the job's own Postgres service via DATABASE_URL — never a
 * tunnel, never web/.env.local, never production. It reads no table: every
 * assertion evaluates the SQL expression over a BOUND LITERAL, so it needs a
 * connection but not a schema.
 *
 * WHY IT MATTERS: `findByNormalizedName` matches a JS-computed key against the
 * SQL-computed key of every stored row. If the two drift, a re-scrape stops
 * finding the row it should update and inserts a duplicate instead — silently.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const SKIP_REASON = 'DATABASE_URL not set';

let pool: Pool;
let db: NodePgDatabase<Record<string, never>>;

beforeAll(async () => {
  if (!DATABASE_URL) return;
  pool = new Pool({ connectionString: DATABASE_URL, max: 2, options: '-c timezone=UTC' });
  db = drizzle(pool);
});

afterAll(async () => {
  if (pool) await pool.end();
});

/**
 * Real Indian company names, deliberately covering the shapes that broke before:
 * the ARCIL suffix pair (12-B's target), period-joined suffixes, ampersand
 * variants, mid-string parentheticals, hyphen-vs-space compounds, trailing
 * status codes, and near-miss names that must NOT collapse together.
 */
const FIXTURE: readonly string[] = [
  'ASSET RECONSTRUCTION COMPANY (INDIA) LIMITED',
  'Asset Reconstruction Co.(India) Ltd.',
  'IC Electricals Co.Ltd.',
  'IC Electricals Company',
  'Sun Pharmaceutical Industries Ltd',
  'Sunrise Pharmaceutical Industries Ltd',
  'Atharva Polyplast Limited',
  'Atharva Polymers Limited',
  'Indo-MIM Limited',
  'INDO MIM LTD',
  'Gulf Lloyds (India) Ltd',
  'Gulf Lloyds India Limited',
  'Jay Bee Laminations Ltd. O',
  'Vikran Engineering Ltd',
  'Neochem Bio Ventures Limited',
  'ESDS Software Solution Limited',
  'Kwality Walls (India) Ltd',
  'Morganite Crucible India Ltd',
  'Windlas Biotech Ltd',
  'CMS Info Systems Ltd',
  'Muthoot Fincorp Limited',
  'Nirbhay Colours India Ltd',
  'Sanmitra Commercial Ltd',
  'Shipwaves Online Limited',
  'Western Overseas Study Abroad Limited',
  'Maruti Interior Products Ltd',
  'Twinkle Papers',
  'Tata Consultancy Services Private Limited',
  'Bajaj Finance & Holdings Ltd',
  'Bajaj Finance and Holdings Limited',
  'Cocoa Traders Limited',
  'Corporate Park Ltd',
  'Coal India Limited',
];

describe.skipIf(!DATABASE_URL)(`normaliser: TypeScript and SQL agree (${SKIP_REASON})`, () => {
  it('agrees on every fixture name for the SPACED key', async () => {
    const divergences: string[] = [];
    for (const name of FIXTURE) {
      const js = normalizeCompanyNameForMatching(name);
      const res = (await db.execute(
        sql`SELECT ${normalizedCompanyNameSql(sql`${name}`)} AS norm`,
      )) as unknown as { rows: Array<{ norm: string }> };
      if (res.rows[0].norm !== js) divergences.push(`"${name}" -> JS="${js}" SQL="${res.rows[0].norm}"`);
    }
    expect(divergences, `JS<->SQL spaced-key divergences:\n${divergences.join('\n')}`).toEqual([]);
  });

  it('agrees on every fixture name for the COMPACT key', async () => {
    // The spaced twin agreeing does NOT prove the compact one does: it has its
    // own SQL expression with its own escaping to get right.
    const divergences: string[] = [];
    for (const name of FIXTURE) {
      const js = compactCompanyNameKey(name);
      const res = (await db.execute(
        sql`SELECT ${compactNormalizedCompanyNameSql(sql`${name}`)} AS compact`,
      )) as unknown as { rows: Array<{ compact: string }> };
      if (res.rows[0].compact !== js) divergences.push(`"${name}" -> JS="${js}" SQL="${res.rows[0].compact}"`);
    }
    expect(divergences, `JS<->SQL compact-key divergences:\n${divergences.join('\n')}`).toEqual([]);
  });

  it('agrees on a JUNK-ONLY name and a BLANK name — the wrapper-only cases', async () => {
    // `rowKeyForName` gives a junk-only name a `junk:<sha1>` key and a blank
    // name `null`. NEITHER is expressible in SQL — the twin returns '' for both.
    // That asymmetry is deliberate and lives in rowKeyForName, ABOVE these two
    // functions, so what must agree here is the underlying normaliser only.
    for (const name of ['---', '   ', '']) {
      const js = normalizeCompanyNameForMatching(name);
      const res = (await db.execute(
        sql`SELECT ${normalizedCompanyNameSql(sql`${name}`)} AS norm`,
      )) as unknown as { rows: Array<{ norm: string }> };
      expect(res.rows[0].norm, `wrapper-only case ${JSON.stringify(name)}`).toBe(js);
    }
  });

  it('the ARCIL pair reaches ONE key in BOTH implementations', async () => {
    const a = 'ASSET RECONSTRUCTION COMPANY (INDIA) LIMITED';
    const b = 'Asset Reconstruction Co.(India) Ltd.';
    expect(normalizeCompanyNameForMatching(a)).toBe(normalizeCompanyNameForMatching(b));
    const res = (await db.execute(
      sql`SELECT ${normalizedCompanyNameSql(sql`${a}`)} AS x, ${normalizedCompanyNameSql(sql`${b}`)} AS y`,
    )) as unknown as { rows: Array<{ x: string; y: string }> };
    expect(res.rows[0].x).toBe(res.rows[0].y);
  });

  it('near-miss names stay APART in BOTH implementations', async () => {
    const pairs: Array<[string, string]> = [
      ['Sun Pharmaceutical Industries Ltd', 'Sunrise Pharmaceutical Industries Ltd'],
      ['Atharva Polyplast Limited', 'Atharva Polymers Limited'],
    ];
    for (const [a, b] of pairs) {
      expect(normalizeCompanyNameForMatching(a)).not.toBe(normalizeCompanyNameForMatching(b));
      const res = (await db.execute(
        sql`SELECT ${normalizedCompanyNameSql(sql`${a}`)} AS x, ${normalizedCompanyNameSql(sql`${b}`)} AS y`,
      )) as unknown as { rows: Array<{ x: string; y: string }> };
      expect(res.rows[0].x, `${a} vs ${b}`).not.toBe(res.rows[0].y);
    }
  });
});
