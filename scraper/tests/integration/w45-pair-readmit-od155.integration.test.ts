/**
 * OD-155 (#1245 item 2) on the real database (ipodhan_test only).
 *
 * A W-45-refused pair (price band ad + RHP, `extraction_error` starting `w45_disagreement`, neither series
 * written) is re-read as a PAIR when EITHER file's bytes change, and never otherwise (OD-33: no timer).
 * Runs the real `selectPendingFilings` over real `documents` rows written with the real `classifyFailure` tag.
 *
 *   npx vitest run --config vitest.integration.config.ts tests/integration/w45-pair-readmit-od155.integration.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import * as schema from '../../../packages/shared/src/db/schema';
import { classifyFailure, selectPendingFilings, type CandidateDocument } from '../../src/services/filing-auto-persist';

const DATABASE_URL = process.env.DATABASE_URL;
const VERSION = 'test-version-od155';
const rows = (r: any) => (r.rows ?? r) as any[];
const sha = (c: string) => c.repeat(64);

const CASES = [
  { n: 'a', status: 'UPCOMING', segment: 'MAINBOARD' },
  { n: 'b', status: 'OPEN', segment: 'SME' },
  { n: 'c', status: 'CLOSED', segment: 'MAINBOARD' },
  { n: 'd', status: 'LISTED', segment: 'SME' },
] as const;
const ipoId = (n: string) => `00000000-0000-4000-8000-0000000155${n}0`;

let pool: Pool;
let db: ReturnType<typeof drizzle<typeof schema>>;

async function refuse(documentId: string, currentSha: string) {
  const c = classifyFailure(0, VERSION, 'w45_disagreement: price band 100 vs 120', { sha256: currentSha });
  await db.execute(sql`UPDATE documents SET extraction_status = ${c.status}, extraction_error = ${c.error}, sha256 = ${currentSha} WHERE id = ${documentId}::uuid`);
}
async function load(ipo: string): Promise<CandidateDocument[]> {
  const r = rows(await db.execute(sql`SELECT id, type, sha256, extraction_status, extracted_at, retry_count, updated_at, extraction_error FROM documents WHERE ipo_id = ${ipo}::uuid`));
  return r.map((x) => ({ id: x.id, type: x.type, sha256: x.sha256, extractionStatus: x.extraction_status, extractedAt: x.extracted_at, retryCount: x.retry_count ?? 0, updatedAt: x.updated_at, extractionError: x.extraction_error }));
}
const pendingTypes = async (ipo: string) =>
  selectPendingFilings(ipo, await load(ipo), [], { version: VERSION, fileExists: () => true }).pending.map((d) => d.type).sort();

describe.skipIf(!DATABASE_URL)('OD-155: new bytes on either side of a W-45-refused pair re-admit both (ipodhan_test)', () => {
  const ids: Record<string, { ad: string; rhp: string }> = {};
  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL, max: 2, options: '-c timezone=UTC' });
    db = drizzle(pool, { schema });
    const name = rows(await db.execute(sql`SELECT current_database() AS d`))[0].d;
    if (name !== 'ipodhan_test') throw new Error(`refusing to run against ${name}`);
    for (const c of CASES) {
      await db.execute(sql`DELETE FROM ipos WHERE id = ${ipoId(c.n)}::uuid`);
      await db.execute(sql`INSERT INTO ipos (id, company_name, slug, status, segment) VALUES (${ipoId(c.n)}::uuid, ${'W45 Pair ' + c.n}, ${'w45-pair-od155-' + c.n}, ${c.status}, ${c.segment})`);
      const ins = async (type: string) =>
        rows(await db.execute(sql`INSERT INTO documents (ipo_id, type, title, url, extraction_status, sha256) VALUES (${ipoId(c.n)}::uuid, ${type}, ${type}, ${'https://example.test/od155-' + c.n + type + Math.random().toString(36).slice(2) + '.pdf'}, 'PENDING', ${sha('1')}) RETURNING id`))[0].id as string;
      ids[c.n] = { ad: await ins('PRICE_BAND_AD'), rhp: await ins('RHP') };
      await refuse(ids[c.n].ad, sha('a'));
      await refuse(ids[c.n].rhp, sha('b'));
    }
  });
  afterAll(async () => {
    if (!pool) return;
    for (const c of CASES) await db.execute(sql`DELETE FROM ipos WHERE id = ${ipoId(c.n)}::uuid`);
    await pool.end();
  });

  for (const c of CASES) {
    it(`${c.status}/${c.segment}: refused pair is held; new RHP bytes re-admit BOTH once; a refusal at the new bytes holds again`, async () => {
      const ipo = ipoId(c.n);
      const { ad, rhp } = ids[c.n];
      expect(await pendingTypes(ipo)).toEqual([]);
      expect(await pendingTypes(ipo)).toEqual([]); // no timer: a second cycle with no change readmits nothing
      await db.execute(sql`UPDATE documents SET sha256 = ${sha('c')} WHERE id = ${rhp}::uuid`);
      expect(await pendingTypes(ipo)).toEqual(['PRICE_BAND_AD', 'RHP']);
      // The pair is read and refused again: both rows are tagged with the CURRENT bytes.
      await refuse(ad, sha('a'));
      await refuse(rhp, sha('c'));
      expect(await pendingTypes(ipo)).toEqual([]);
      // New bytes on the AD side re-admit both too.
      await db.execute(sql`UPDATE documents SET sha256 = ${sha('d')} WHERE id = ${ad}::uuid`);
      expect(await pendingTypes(ipo)).toEqual(['PRICE_BAND_AD', 'RHP']);
      await refuse(ad, sha('d'));
      expect(await pendingTypes(ipo)).toEqual([]);
    });
  }

  it('a counterpart that failed for another reason is not re-admitted by new bytes on a different pair member', async () => {
    const ipo = ipoId('a');
    const { ad, rhp } = ids.a;
    await refuse(ad, sha('d'));
    await db.execute(sql`UPDATE documents SET extraction_error = 'extractor: exited 1 @failed-at:${sql.raw(VERSION)}#${sql.raw(sha('c').slice(0, 16))}' WHERE id = ${rhp}::uuid`);
    await db.execute(sql`UPDATE documents SET sha256 = ${sha('e')} WHERE id = ${rhp}::uuid`);
    // RHP's own bytes changed (its own gate admits it) but it is not a W-45 refusal, so the AD stays held.
    expect(await pendingTypes(ipo)).toEqual(['RHP']);
  });
});
