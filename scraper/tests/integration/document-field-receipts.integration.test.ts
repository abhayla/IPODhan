/**
 * Item 6 (spec §2.5, OD-91) on the real database (ipodhan_test only):
 * the COMPLETED-transaction helper writes a document's receipt and reopens
 * SUPPLIED -> PENDING (superseded_by set) only the plan rows the document
 * outranks AND whose field is in its receipt. A row whose field is not in the
 * receipt, and a row chosen from a CORRIGENDUM-outranked prospectus, stay put.
 *
 *   DATABASE_URL=postgresql://ipodhan_app:<pw>@127.0.0.1:15432/ipodhan_test REDIS_HOST=127.0.0.1 \
 *     npx vitest run --config vitest.integration.config.ts tests/integration/document-field-receipts.integration.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import * as schema from '../../../packages/shared/src/db/schema';
import { writeReceiptAndReopen } from '../../src/services/filing-auto-persist';

const DATABASE_URL = process.env.DATABASE_URL;
const IPO = '00000000-0000-4000-8000-0000000d6a01';
let pool: Pool;
let db: ReturnType<typeof drizzle<typeof schema>>;
const rows = (r: any) => (r.rows ?? r) as any[];

async function doc(type: string): Promise<string> {
  const r = await db.execute(sql`
    INSERT INTO documents (ipo_id, type, title, url, extraction_status, sequence_number)
    VALUES (${IPO}::uuid, ${type}, ${'item6 ' + type}, ${'https://example.test/item6-' + type + '-' + Math.random().toString(36).slice(2) + '.pdf'}, 'COMPLETED',
            (SELECT coalesce(max(sequence_number), 0) + 1 FROM documents WHERE ipo_id = ${IPO}::uuid))
    RETURNING id`);
  return rows(r)[0].id;
}
async function plan(table: string, field: string, chosen: string, type: string): Promise<string> {
  const r = await db.execute(sql`
    INSERT INTO ipo_field_plan (ipo_id, table_name, row_key, field_name, state, chosen_document_id, chosen_document_type, manifest_version)
    VALUES (${IPO}::uuid, ${table}, '', ${field}, 'SUPPLIED', ${chosen}::uuid, ${type}, 2) RETURNING id`);
  return rows(r)[0].id;
}
async function state(id: string) {
  return rows(await db.execute(sql`SELECT state::text AS state, superseded_by FROM ipo_field_plan WHERE id = ${id}::uuid`))[0];
}

describe.skipIf(!DATABASE_URL)('document_field_receipts + reopen on the COMPLETED path (ipodhan_test)', () => {
  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL, max: 2, options: '-c timezone=UTC' });
    db = drizzle(pool, { schema });
    const name = rows(await db.execute(sql`SELECT current_database() AS d`))[0].d;
    if (name !== 'ipodhan_test') throw new Error(`refusing to run against ${name}`);
    await db.execute(sql`DELETE FROM ipos WHERE id = ${IPO}::uuid`);
    await db.execute(sql`
      INSERT INTO ipos (id, company_name, slug, status, segment)
      VALUES (${IPO}::uuid, 'Item Six Receipts Ltd', 'item-six-receipts-ltd', 'UPCOMING', 'MAINBOARD')`);
  });
  afterAll(async () => {
    if (!pool) return;
    await db.execute(sql`DELETE FROM ipos WHERE id = ${IPO}::uuid`);
    await pool.end();
  });

  it('prospectus-reopens-only-receipted-fields, in one call; a corrigendum reopens nothing', async () => {
    const rhp = await doc('RHP');
    const pba = await doc('PRICE_BAND_AD');
    const desc = await plan('ipos', 'company_description', rhp, 'RHP');
    const face = await plan('ipo_details', 'face_value', pba, 'PRICE_BAND_AD');
    const fresh = await plan('ipo_details', 'fresh_issue', pba, 'PRICE_BAND_AD');

    const corr = await doc('CORRIGENDUM');
    const none = await writeReceiptAndReopen(
      db as never,
      { id: corr, ipoId: IPO, type: 'CORRIGENDUM', filingDate: '2026-09-20', sha256: null },
      [{ tableName: 'ipos', rowKey: '', fieldName: 'companyDescription' }]
    );
    expect(none.reopenedIds).toEqual([]);

    const pro = await doc('PROSPECTUS');
    const res = await writeReceiptAndReopen(
      db as never,
      { id: pro, ipoId: IPO, type: 'PROSPECTUS', filingDate: null, sha256: null },
      [
        { tableName: 'ipos', rowKey: '', fieldName: 'companyDescription' },
        { tableName: 'ipo_details', rowKey: '', fieldName: 'faceValue' },
      ]
    );
    expect(res.reopenedIds.sort()).toEqual([desc, face].sort());
    expect(await state(desc)).toEqual({ state: 'PENDING', superseded_by: pro });
    expect(await state(face)).toEqual({ state: 'PENDING', superseded_by: pro });
    expect(await state(fresh)).toEqual({ state: 'SUPPLIED', superseded_by: null });

    const receipt = rows(
      await db.execute(sql`SELECT table_name, field_name FROM document_field_receipts WHERE document_id = ${pro}::uuid ORDER BY 1, 2`)
    );
    expect(receipt).toEqual([
      { table_name: 'ipo_details', field_name: 'faceValue' },
      { table_name: 'ipos', field_name: 'companyDescription' },
    ]);
  });

  it('the REAL setDocumentExtractionState commits status + receipt + reopen together, and rolls all back together', async () => {
    const { buildAutoPersistDeps } = await import('../../src/services/filing-auto-persist');
    const deps = buildAutoPersistDeps({} as never);
    const rhp = await doc('RHP');
    const row = await plan('ipos', 'cin', rhp, 'RHP');
    const pro = rows(await db.execute(sql`
      INSERT INTO documents (ipo_id, type, title, url, extraction_status, sequence_number)
      VALUES (${IPO}::uuid, 'PROSPECTUS', 'item6 tx', 'https://example.test/item6-tx.pdf', 'IN_PROGRESS',
              (SELECT coalesce(max(sequence_number), 0) + 1 FROM documents WHERE ipo_id = ${IPO}::uuid))
      RETURNING id`))[0].id;

    // A receipt that cannot be written (field_name longer than varchar(100)) must roll back the
    // COMPLETED status and the reopen with it — they are one transaction.
    await expect(
      deps.setDocumentExtractionState({
        documentId: pro,
        status: 'COMPLETED',
        error: null,
        retryCount: 0,
        receiptFields: [
          { tableName: 'ipos', rowKey: '', fieldName: 'cin', value: 'L1' },
          { tableName: 'ipos', rowKey: '', fieldName: 'x'.repeat(150), value: null },
        ],
      })
    ).rejects.toThrow();
    const after = rows(await db.execute(sql`SELECT extraction_status FROM documents WHERE id = ${pro}::uuid`))[0];
    expect(after.extraction_status).toBe('IN_PROGRESS');
    expect(await state(row)).toEqual({ state: 'SUPPLIED', superseded_by: null });
    expect(rows(await db.execute(sql`SELECT 1 FROM document_field_receipts WHERE document_id = ${pro}::uuid`)).length).toBe(0);

    await deps.setDocumentExtractionState({
      documentId: pro,
      status: 'COMPLETED',
      error: null,
      retryCount: 0,
      receiptFields: [{ tableName: 'ipos', rowKey: '', fieldName: 'cin', value: 'L1' }],
    });
    const done = rows(await db.execute(sql`SELECT extraction_status FROM documents WHERE id = ${pro}::uuid`))[0];
    expect(done.extraction_status).toBe('COMPLETED');
    expect(await state(row)).toEqual({ state: 'PENDING', superseded_by: pro });
    expect(rows(await db.execute(sql`SELECT value FROM document_field_receipts WHERE document_id = ${pro}::uuid`))).toEqual([{ value: 'L1' }]);
  });

  it('jsonb round-trip: a receipt value equals the column read back, whatever key order Postgres returns', async () => {
    const { normalizeReceiptValue } = await import('../../config/plan-supersession-rule.mjs');
    const extracted = { qib: 50, nii: 15, retail: 35, nested: { z: [3, 1], a: 1 } };
    await db.execute(sql`DELETE FROM ipo_details WHERE ipo_id = ${IPO}::uuid`);
    await db.insert(schema.ipoDetails).values({ ipoId: IPO, dataSource: 'DRHP', allocationPct: extracted } as never);
    const [readBack] = await db
      .select({ allocationPct: schema.ipoDetails.allocationPct })
      .from(schema.ipoDetails)
      .where(sql`${schema.ipoDetails.ipoId} = ${IPO}::uuid`);
    // Postgres jsonb reorders keys (shorter first), so a plain JSON.stringify of each side differs.
    expect(JSON.stringify(readBack.allocationPct)).not.toBe(JSON.stringify(extracted));
    expect(normalizeReceiptValue(readBack.allocationPct)).toBe(normalizeReceiptValue(extracted));
    // Array order is data and still counts.
    expect(normalizeReceiptValue({ a: [1, 2] })).not.toBe(normalizeReceiptValue({ a: [2, 1] }));
  });
});
