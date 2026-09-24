/**
 * OD-97 (item 22, spec §2.2.1 OD-36 "Image-only pages go to OCR, marked") on the real
 * database (ipodhan_test only), through the real processPendingFilings with the real
 * persister deps, the real receipt writer and the real OCR-precedence reader:
 *   - a real OCR'd document's receipts carry source_text 'OCR' + ocr_confidence;
 *   - its ipo_details provenance carries dataLineage.ocr (lotMultiple, page 0);
 *   - its OCR-only band cap (Rs 81) does NOT overwrite the stored Rs 83 that a
 *     text-layer read of a SAME-RANK document (a price band ad of the same filing
 *     day) supports; its agreeing values still write;
 *   - its OCR-only lot (185) DOES overwrite a stored 190 that only a DRHP text read
 *     supports: a lower-ranked document's text never beats a better document (OD-30).
 *
 * The document is SteamHouse India's price band advertisement (all 4 pages OCR'd).
 * Default: the extractor is replaced by its real captured envelope
 * (fixtures/ocr/steamhouse-price-band-ad.envelope.json). With OCR_PROOF_PDF set to the
 * real PDF (sha 9dcfc5f0...), the real python extractor runs on it instead.
 *
 * Migration 0062 is applied idempotently (ADD COLUMN IF NOT EXISTS) because
 * ipodhan_test has migration drift (#1006).
 *
 *   DATABASE_URL=postgresql://ipodhan_app:<pw>@127.0.0.1:15432/ipodhan_test REDIS_HOST=127.0.0.1 \
 *     npx vitest run --config vitest.integration.config.ts tests/integration/ocr-loses-disagreement.integration.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import * as schema from '../../../packages/shared/src/db/schema';

const DATABASE_URL = process.env.DATABASE_URL;
const IPO = '00000000-0000-4000-8000-0000000d6096';
const SHA = '9dcfc5f07f89563839092e55b0c327396266ae752db5a564844e2071a7a9f8ef';
const FIXTURE = resolve(__dirname, '../fixtures/ocr/steamhouse-price-band-ad.envelope.json');
const MIGRATION = resolve(__dirname, '../../../web/drizzle/migrations/0062_document_field_receipts_ocr_mark.sql');
let pool: Pool;
let db: ReturnType<typeof drizzle<typeof schema>>;
let storeDir: string;
const rows = (r: any) => (r.rows ?? r) as any[];

describe.skipIf(!DATABASE_URL)('OD-97 OCR-only value loses to a text read (ipodhan_test)', () => {
  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL, max: 2, options: '-c timezone=UTC' });
    db = drizzle(pool, { schema });
    const name = rows(await db.execute(sql`SELECT current_database() AS d`))[0].d;
    if (name !== 'ipodhan_test') throw new Error(`refusing to run against ${name}`);
    for (const stmt of readFileSync(MIGRATION, 'utf-8').split('--> statement-breakpoint')) {
      const body = stmt.replace(/^--.*$/gm, '').trim();
      if (body) await db.execute(sql.raw(body));
    }
    await db.execute(sql`DELETE FROM ipos WHERE id = ${IPO}::uuid`);
    await db.execute(sql`
      INSERT INTO ipos (id, company_name, slug, status, segment, price_range_min, price_range_max, lot_size)
      VALUES (${IPO}::uuid, 'Od Ninety Six Ocr Ltd', 'od-ninety-six-ocr-ltd', 'UPCOMING', 'MAINBOARD', 77, 83, 190)`);
    // A TEXT-layer read of a same-rank document (a price band ad filed the same day) that printed Rs 83.
    const sameRank = rows(await db.execute(sql`
      INSERT INTO documents (ipo_id, type, title, url, extraction_status, sequence_number, filing_date)
      VALUES (${IPO}::uuid, 'PRICE_BAND_AD', 'od97 text ad', ${'https://example.test/od97-text-ad-' + Date.now() + '.pdf'}, 'COMPLETED', 1, '2026-09-05')
      RETURNING id`))[0].id;
    await db.execute(sql`
      INSERT INTO document_field_receipts (document_id, table_name, row_key, field_name, value, source_text)
      VALUES (${sameRank}::uuid, 'ipos', '', 'priceRangeMax', '83', 'TEXT')`);
    // A TEXT-layer read of a LOWER-ranked document (the DRHP) that printed a lot of 190.
    const drhp = rows(await db.execute(sql`
      INSERT INTO documents (ipo_id, type, title, url, extraction_status, sequence_number, filing_date)
      VALUES (${IPO}::uuid, 'DRHP', 'od97 text drhp', ${'https://example.test/od97-drhp-' + Date.now() + '.pdf'}, 'COMPLETED', 0, '2026-05-01')
      RETURNING id`))[0].id;
    await db.execute(sql`
      INSERT INTO document_field_receipts (document_id, table_name, row_key, field_name, value, source_text)
      VALUES (${drhp}::uuid, 'ipos', '', 'lotSize', '190', 'TEXT')`);
    // The OCR'd price band advertisement, pending extraction.
    await db.execute(sql`
      INSERT INTO documents (ipo_id, type, title, url, extraction_status, sequence_number, sha256, filing_date)
      VALUES (${IPO}::uuid, 'PRICE_BAND_AD', 'od96 ocr ad', ${'https://example.test/od96-ad-' + Date.now() + '.pdf'}, 'PENDING', 2, ${SHA}, '2026-09-05')`);
    storeDir = mkdtempSync(join(tmpdir(), 'od96-store-'));
  });

  afterAll(async () => {
    if (!pool) return;
    await db.execute(sql`DELETE FROM ipos WHERE id = ${IPO}::uuid`);
    await pool.end();
    if (storeDir) rmSync(storeDir, { recursive: true, force: true });
  });

  it('marks the receipts and provenance, and keeps the text-supported cap', async () => {
    const { processPendingFilings, buildAutoPersistDeps, defaultExtractorRunner } = await import(
      '../../src/services/filing-auto-persist'
    );
    const { documentPath } = await import('../../src/services/document-store');
    const pdf = documentPath(IPO, 'PRICE_BAND_AD', SHA, storeDir);
    mkdirSync(join(storeDir, IPO), { recursive: true });
    const proofPdf = process.env.OCR_PROOF_PDF;
    if (proofPdf) copyFileSync(proofPdf, pdf);
    else writeFileSync(pdf, '%PDF-1.4 placeholder: the extractor is replaced by the captured envelope\n');

    const deps = buildAutoPersistDeps();
    deps.storeDir = storeDir;
    // The ad also prints timetable dates. Those are E-1 exchange-owned fields, and
    // field_sources refuses a document-path write of them (#862), which fails the
    // whole document's persist. That refusal is a separate class, not this one, so
    // the dates are taken out of the envelope here (both modes) and every other
    // field goes through unchanged.
    const E1 = ['open_date', 'close_date', 'listing_date', 'basis_of_allotment_date', 'refund_date', 'credit_date', 'anchor_bid_date'];
    const withoutE1 = (env: { fields: Record<string, unknown> }) => {
      for (const k of E1) delete env.fields[k];
      return env;
    };
    const real = defaultExtractorRunner;
    deps.runExtractor = ((args: Parameters<typeof real>[0]) => {
      if (proofPdf) {
        const out = real(args) as { ok: boolean; extraction?: { fields: Record<string, unknown> } };
        if (out.ok && out.extraction) withoutE1(out.extraction);
        return out;
      }
      return { ok: true, extraction: withoutE1(JSON.parse(readFileSync(FIXTURE, 'utf-8'))) };
    }) as unknown as typeof defaultExtractorRunner;
    const result = await processPendingFilings(
      { id: IPO, companyName: 'Od Ninety Six Ocr Ltd', slug: 'od-ninety-six-ocr-ltd', segment: 'MAINBOARD' },
      deps
    );
    expect(result).toMatchObject({ persisted: 1, failed: 0 });

    const receipts = rows(await db.execute(sql`
      SELECT r.table_name, r.field_name, r.value, r.source_text, r.ocr_confidence::text AS conf
        FROM document_field_receipts r JOIN documents d ON d.id = r.document_id
       WHERE d.ipo_id = ${IPO}::uuid AND d.type = 'PRICE_BAND_AD' ORDER BY 1, 2`));
    const byKey = new Map(receipts.map((r) => [`${r.table_name}.${r.field_name}`, r]));
    expect(byKey.get('ipos.priceRangeMax')).toMatchObject({ value: '81', source_text: 'OCR', conf: '0.7456' });
    expect(byKey.get('ipos.lotSize')).toMatchObject({ value: '185', source_text: 'OCR' });
    expect(receipts.every((r) => r.source_text !== null)).toBe(true);

    const ipo = rows(await db.execute(sql`
      SELECT price_range_min::text AS min, price_range_max::text AS max, lot_size FROM ipos WHERE id = ${IPO}::uuid`))[0];
    expect(Number(ipo.max)).toBe(83);
    expect(Number(ipo.min)).toBe(77);
    // The DRHP's text read of 190 is outranked by the ad: the OCR-only 185 is written.
    expect(ipo.lot_size).toBe(185);

    const lineage = rows(await db.execute(sql`
      SELECT data_lineage->'ocr' AS ocr FROM field_sources
       WHERE ipo_id = ${IPO}::uuid AND table_name = 'ipo_details' AND field_name = 'lotMultiple'`))[0];
    expect(lineage?.ocr).toEqual({ sourceText: 'OCR', confidence: 0.7456 });
  }, 900_000);
});
