// F-240 (#1500 point 3) proof, READ-ONLY: runs the REAL DOC fetcher (buildDocFetcher) over every
// (IPO, table, field) of a DOC-readable table (ipos, ipo_details) whose stored column is EMPTY, that has
// NO field_sources row, and whose COMPLETED document holds a non-empty receipt -- on ipodhan_staging --
// and prints the answer state per row. No write: the pool is default_transaction_read_only and the
// fetcher only reads.
// Run (from scraper/): npx tsx ../docs/design/probes/f240-doc-receipt-empty-column.mts [slug]
import { loadFieldManifest } from '../../../scraper/src/config/field-manifest-loader.ts';
import { buildDocFetcher, DOC_READABLE_TABLES } from '../../../scraper/src/services/field-plan-walk-doc-fetcher.ts';
import { openReadOnlyPool } from './_lib.mjs';

const manifest = loadFieldManifest();
const camel = (s: string) => s.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());
const snake = (s: string) => s.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
const camelRow = (r: Record<string, unknown> | undefined) =>
  r ? Object.fromEntries(Object.entries(r).map(([k, v]) => [camel(k), v])) : null;
const short = (v: unknown) => {
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  return s && s.length > 80 ? `${s.slice(0, 80)}…` : s;
};
const onlySlug = process.argv[2] ?? null;

const pool = await openReadOnlyPool('ipodhan_staging');
const q = async (text: string, params: unknown[] = []) => (await pool.query(text, params)).rows;

const candidates = await q(
  `SELECT DISTINCT d.ipo_id, i.slug, r.table_name, r.field_name
     FROM document_field_receipts r
     JOIN documents d ON d.id = r.document_id AND d.extraction_status = 'COMPLETED' AND d.is_active IS NOT FALSE
     JOIN ipos i ON i.id = d.ipo_id
    WHERE r.table_name = ANY($1) AND r.row_key = '' AND r.value IS NOT NULL AND r.value <> ''
      AND NOT EXISTS (SELECT 1 FROM field_sources fs WHERE fs.ipo_id = d.ipo_id AND fs.table_name = r.table_name
                       AND fs.row_key = r.row_key AND fs.field_name = r.field_name)
      AND ($2::text IS NULL OR i.slug = $2)
    ORDER BY i.slug, r.table_name, r.field_name`,
  [DOC_READABLE_TABLES, onlySlug]
);

const readRow = async (t: string, id: string) =>
  t === 'ipos'
    ? camelRow((await q(`SELECT * FROM ipos WHERE id=$1`, [id]))[0])
    : camelRow((await q(`SELECT * FROM ipo_details WHERE ipo_id=$1`, [id]))[0]);

const fetcher = buildDocFetcher({
  fieldSources: {
    findByField: async (ipoId: string, t: string, f: string, rk: string) => {
      const rows = await q(`SELECT source::text AS source, data_lineage FROM field_sources WHERE ipo_id=$1 AND table_name=$2 AND field_name=$3 AND row_key=$4`, [ipoId, t, f, rk]);
      return rows[0] ? { source: rows[0].source, dataLineage: rows[0].data_lineage } : null;
    },
  } as never,
  ipoRepository: { findById: (id: string) => readRow('ipos', id) } as never,
  documentRepository: {
    findByIPO: async (id: string) =>
      q(`SELECT id, type::text AS type, extraction_status::text AS "extractionStatus", is_active AS "isActive", sha256, filing_date AS "filingDate" FROM documents WHERE ipo_id=$1`, [id]),
  } as never,
  manifestDocumentType: (t, f) => manifest.fields[`${t}.${f}`]?.documentType,
  isDocCapable: (t, f) => manifest.fields[`${t}.${f}`]?.capability?.DOC?.capable === true,
  ipoDetailsReader: { findByIpoId: (id: string) => readRow('ipo_details', id) },
  receiptReader: async (ipoId: string) => {
    const m = new Map<string, Map<string, string | null>>();
    for (const r of await q(`SELECT r.document_id, r.table_name, r.row_key, r.field_name, r.value FROM document_field_receipts r JOIN documents d ON d.id=r.document_id WHERE d.extraction_status='COMPLETED' AND d.ipo_id=$1`, [ipoId])) {
      const k = String(r.document_id);
      if (!m.has(k)) m.set(k, new Map());
      m.get(k)!.set(`${r.table_name}|${r.row_key ?? ''}|${r.field_name}`, r.value ?? null);
    }
    return m;
  },
  receiptMarkReader: async (docId, t, rk, f) =>
    (await q(`SELECT source_text FROM document_field_receipts WHERE document_id=$1 AND table_name=$2 AND row_key=$3 AND field_name=$4`, [docId, t, rk, f]))[0]?.source_text ?? null,
});

const tally: Record<string, number> = {};
const rows: Array<Record<string, unknown>> = [];
let emptyColumn = 0;
const reasons: Record<string, number> = {};
for (const c of candidates) {
  const row = await readRow(String(c.table_name), String(c.ipo_id));
  const stored = row ? row[String(c.field_name)] : undefined;
  if (stored !== null && stored !== undefined && stored !== '') continue;
  emptyColumn += 1;
  const a: any = await fetcher(String(c.ipo_id), String(c.table_name), '', snake(String(c.field_name)));
  const state = `${a.outcome}${a.gap ? `:${a.gap}` : ''}${a.adminListing ? ':LISTED' : ''}`;
  const key = `${c.table_name} ${state}`;
  tally[key] = (tally[key] ?? 0) + 1;
  if (a.outcome !== 'SUPPLIED') {
    const why = `${c.table_name}.${c.field_name}: ${String(a.reason ?? a.outcome).replace(/[0-9a-f-]{36}/g, '<id>')}`;
    reasons[why] = (reasons[why] ?? 0) + 1;
  }
  rows.push({ slug: c.slug, table: c.table_name, field: c.field_name, state, value: short(a.value ?? null), documentType: a.documentType ?? null, reason: a.reason ?? null });
}
const ipos = new Set(rows.map((r) => r.slug));
// One IPO asked: also print its receipts for the measured fields in full (the unit-test fixture source).
const receipts = onlySlug
  ? await q(
      `SELECT d.type::text AS doc_type, d.filing_date, r.table_name, r.field_name, r.source_text AS mark, r.value
         FROM document_field_receipts r JOIN documents d ON d.id = r.document_id JOIN ipos i ON i.id = d.ipo_id
        WHERE i.slug = $1 AND r.table_name = ANY($2) AND r.field_name = ANY($3) ORDER BY d.type, r.field_name`,
      [onlySlug, DOC_READABLE_TABLES, rows.map((r) => r.field)]
    )
  : [];
if (onlySlug) console.log(JSON.stringify({ receipts }, null, 1));
console.log(JSON.stringify({ measuredAt: new Date().toISOString(), candidatesNoProvenance: candidates.length, emptyColumn, ipos: ipos.size, tally, reasons, rows: onlySlug ? rows : rows.slice(0, 25) }, null, 1));
await pool.end();
