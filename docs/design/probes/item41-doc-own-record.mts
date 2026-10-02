// Item 41 (OD-161) core proof, READ-ONLY: runs the REAL DOC fetcher (buildDocFetcher) over every
// document receipt on an `ipos` field whose stored value a non-document source owns, on ipodhan_staging,
// and prints the answer state per row. No write: the pool is default_transaction_read_only, the fetcher
// only reads, and the admin listing is captured in memory (never inserted).
// Run (from scraper/): npx tsx ../docs/design/probes/item41-doc-own-record.mts
import { loadFieldManifest } from '../../../scraper/src/config/field-manifest-loader.ts';
import { registryRanksFor, resolveIpoTypeKey } from '@ipodhan/shared/services/field-plan-generator';
import { buildDocFetcher } from '../../../scraper/src/services/field-plan-walk-doc-fetcher.ts';
import { openReadOnlyPool } from './_lib.mjs';

const manifest = loadFieldManifest();
const camel = (s: string) => s.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());
const snake = (s: string) => s.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
const camelRow = (r: Record<string, unknown> | undefined) =>
  r ? Object.fromEntries(Object.entries(r).map(([k, v]) => [camel(k), v])) : null;

const pool = await openReadOnlyPool('ipodhan_staging');
const q = async (text: string, params: unknown[] = []) => (await pool.query(text, params)).rows;

const population = await q(`
  SELECT DISTINCT d.ipo_id, i.slug, r.field_name, fs.source::text AS owner
    FROM document_field_receipts r
    JOIN documents d ON d.id = r.document_id AND d.extraction_status = 'COMPLETED'
    JOIN ipos i ON i.id = d.ipo_id
    JOIN field_sources fs ON fs.ipo_id = d.ipo_id AND fs.table_name = r.table_name
                         AND fs.row_key = r.row_key AND fs.field_name = r.field_name
   WHERE r.table_name = 'ipos' AND r.value IS NOT NULL AND fs.source::text <> 'DRHP'
   ORDER BY i.slug, r.field_name`);
const receiptRows = await q(`
  SELECT COUNT(*)::int AS n FROM document_field_receipts r
    JOIN documents d ON d.id = r.document_id AND d.extraction_status = 'COMPLETED'
    JOIN field_sources fs ON fs.ipo_id = d.ipo_id AND fs.table_name = r.table_name
                         AND fs.row_key = r.row_key AND fs.field_name = r.field_name
   WHERE r.table_name = 'ipos' AND r.value IS NOT NULL AND fs.source::text <> 'DRHP'`);

const listings: unknown[] = [];
const fetcher = buildDocFetcher({
  fieldSources: {
    findByField: async (ipoId: string, t: string, f: string, rk: string) => {
      const rows = await q(`SELECT source::text AS source, data_lineage FROM field_sources WHERE ipo_id=$1 AND table_name=$2 AND field_name=$3 AND row_key=$4`, [ipoId, t, f, rk]);
      return rows[0] ? { source: rows[0].source, dataLineage: rows[0].data_lineage } : null;
    },
  } as never,
  ipoRepository: { findById: async (id: string) => camelRow((await q(`SELECT * FROM ipos WHERE id=$1`, [id]))[0]) } as never,
  documentRepository: {
    findByIPO: async (id: string) =>
      (await q(`SELECT id, type::text AS type, extraction_status::text AS "extractionStatus", is_active AS "isActive", sha256, filing_date AS "filingDate" FROM documents WHERE ipo_id=$1`, [id])),
  } as never,
  manifestDocumentType: (t, f) => manifest.fields[`${t}.${f}`]?.documentType,
  isDocCapable: (t, f) => manifest.fields[`${t}.${f}`]?.capability?.DOC?.capable === true,
  ipoDetailsReader: { findByIpoId: async (id: string) => camelRow((await q(`SELECT issue_type FROM ipo_details WHERE ipo_id=$1`, [id]))[0]) },
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

const out: Array<Record<string, unknown>> = [];
const tally: Record<string, number> = {};
for (const p of population) {
  const field = snake(String(p.field_name));
  const plan = (await q(`SELECT rank1_source, rank2_source, rank3_source FROM ipo_field_plan WHERE ipo_id=$1 AND table_name='ipos' AND row_key='' AND field_name=$2`, [p.ipo_id, field]))[0];
  // No plan row: take the rank list from the field manifest for the IPO's own type key (never copied).
  let ranks: Array<string | null> | undefined;
  if (plan) ranks = [plan.rank1_source, plan.rank2_source, plan.rank3_source];
  else {
    const ipo = camelRow((await q(`SELECT segment::text AS segment, listing_exchanges FROM ipos WHERE id=$1`, [p.ipo_id]))[0]) as any;
    const entry = manifest.fields[`ipos.${field}`];
    ranks = (entry && ipo ? registryRanksFor(entry as never, resolveIpoTypeKey(ipo)) : null) ?? undefined;
  }
  const a: any = await fetcher(String(p.ipo_id), 'ipos', '', field, { ranks });
  const state =
    a.outcome === 'SUPPLIED' && a.credited ? 'CREDITED_EQUAL'
    : a.outcome === 'SUPPLIED' ? 'REPLACE_TEXT'
    : a.adminListing ? 'KEPT_LISTED'
    : a.outcome === 'CHECK_FAILED' && /OD-161 kept/.test(a.reason) ? 'KEPT_OUTRANKED'
    : `${a.outcome}${a.gap ? `:${a.gap}` : ''}`;
  tally[`${state} (owner ${p.owner})`] = (tally[`${state} (owner ${p.owner})`] ?? 0) + 1;
  if (a.adminListing) listings.push(a.adminListing);
  if (state !== 'CREDITED_EQUAL') {
    out.push({ slug: p.slug, field, owner: p.owner, ranks: ranks?.join('>'), state, value: a.value ?? null, listing: a.adminListing ?? null, reason: a.reason ?? null });
  }
}
console.log(JSON.stringify({ receiptRows: receiptRows[0].n, distinctIpoFields: population.length, tally, nonEqualRows: out }, null, 1));
await pool.end();
