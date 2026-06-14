import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  normalizeCompanyNameForMatching,
  normalizedCompanyNameSql,
} from '@ipodhan/shared/utils/company-name-normalizer';

/**
 * A3 — the JS normalizer and the SQL normalizer are two faces of ONE definition
 * (company-name-normalizer.ts). This test runs a ≥30-name fixture through BOTH
 * and FAILS on any divergence, so the two can never silently drift apart again.
 *
 * Uses the prod DB via the SSH tunnel (localhost:15432, from web/.env.local) —
 * a read-only SELECT of the normalizer applied to bound literals (no table read).
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function tunnelDatabaseUrl(): string {
  const envPath = path.resolve(__dirname, '../../../web/.env.local');
  const txt = fs.readFileSync(envPath, 'utf8');
  const m = txt.match(/^DATABASE_URL=(.+)$/m);
  if (!m) throw new Error('DATABASE_URL not found in web/.env.local');
  return m[1].trim();
}

// ≥30 real-shaped names: multi-suffix (Ltd/Limited/Pvt Ltd/Private Limited/Inc/
// Corp/LLP/PLC), IPO/FPO suffix, status-code artifacts (#16), punctuation, "&",
// SME-style and suffix-less names.
const FIXTURE: string[] = [
  'Midwest Ltd',
  'Midwest Limited',
  'Midwest Ltd. IPO',
  'Acme Industries Limited',
  'Acme Industries Pvt Ltd',
  'Acme Industries Private Limited',
  'Tata Technologies Ltd',
  'Reliance Power Limited',
  'XYZ Corp',
  'XYZ Corporation',
  'ABC Inc',
  'ABC Incorporated',
  'Foo Holdings LLC',
  'Bar Advisors LLP',
  'Baz Global PLC',
  'Stallion India Fluorochemicals Ltd',
  'M&B Engineering Ltd',
  'K.P. Energy Limited',
  'Jay Bee Laminations Ltd. O',
  'Northern Arc Capital Ltd. LT',
  'Bajaj Housing Finance Limited',
  'Premier Energies Pvt. Ltd.',
  'Saraswati Saree Depot',
  'Manba Finance',
  'Gala Precision Engineering Ltd',
  'Unicommerce eSolutions Limited',
  'Akums Drugs & Pharmaceuticals Ltd',
  'Ola Electric Mobility Limited',
  'Brainbees Solutions Ltd',
  'Ceigall India Ltd',
  'Emcure Pharmaceuticals Ltd',
  'Bansal Wire Industries Limited',
  'Tolins Tyres Ltd FPO',
  'Orient Technologies Pvt',
];

describe('company-name normalizer — JS ↔ SQL agreement (A3)', () => {
  let pool: pg.Pool;
  let db: NodePgDatabase;

  beforeAll(() => {
    pool = new pg.Pool({ connectionString: tunnelDatabaseUrl(), max: 2 });
    db = drizzle(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  it('covers at least 30 names', () => {
    expect(FIXTURE.length).toBeGreaterThanOrEqual(30);
  });

  it('actually normalizes (not a passthrough)', () => {
    expect(normalizeCompanyNameForMatching('Midwest Ltd. IPO')).toBe('midwest');
    expect(normalizeCompanyNameForMatching('Acme Industries Private Limited')).toBe('acme industries');
    expect(normalizeCompanyNameForMatching('Jay Bee Laminations Ltd. O')).toBe('jay bee laminations');
  });

  it('every fixture name normalizes IDENTICALLY in JS and SQL', async () => {
    const divergences: string[] = [];
    for (const name of FIXTURE) {
      const js = normalizeCompanyNameForMatching(name);
      const res = (await db.execute(
        sql`SELECT ${normalizedCompanyNameSql(sql`${name}`)} AS norm`,
      )) as unknown as { rows: Array<{ norm: string }> };
      const sqlNorm = res.rows[0].norm;
      if (sqlNorm !== js) {
        divergences.push(`"${name}" → JS="${js}"  SQL="${sqlNorm}"`);
      }
    }
    expect(divergences, `JS↔SQL normalizer divergences:\n${divergences.join('\n')}`).toEqual([]);
  });
});
