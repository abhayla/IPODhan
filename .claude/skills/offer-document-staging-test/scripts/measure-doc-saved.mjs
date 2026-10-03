#!/usr/bin/env node
// Read-only: what ONE offer document saved on staging.
// Usage (DB tunnel on localhost:15432 via scripts/ops/db-tunnel.sh start):
//   DATABASE_HOST=localhost DATABASE_PORT=15432 DATABASE_NAME=ipodhan_staging DATABASE_USER=ipodhan_app //   DATABASE_PASSWORD=<from GLOBAL.env IPODHAN_APP_DB_PASSWORD> node measure-doc-saved.mjs <ipo-slug> [--doc <id>] [--json out.json]
// Without --doc it lists the IPO's documents in test order. Refuses any database other than ipodhan_staging.
// Never prints the password or a connection URL.
import fs from 'node:fs';
import { createUtcPool, installUtcTimestampParsing, assertUtcSession } from '../../../../scripts/lib/pg-utc.mjs';
import { resolveDiscreteDbParams } from '../../../../scripts/lib/pg-connection-params.mjs';

const TYPE_ORDER = ['DRHP', 'ADDENDUM_DRHP', 'RHP', 'ADDENDUM_RHP', 'PRICE_BAND_AD', 'CORRIGENDUM', 'PROSPECTUS'];
const OFFER_TYPES = new Set(['DRHP', 'RHP', 'PROSPECTUS', 'PRICE_BAND_AD']);

function arg(name) {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const slug = process.argv[2];
  if (!slug || slug.startsWith('--')) throw new Error('usage: measure-doc-saved.cjs <ipo-slug> [--doc <id>] [--json out.json]');
  installUtcTimestampParsing();
  const c = createUtcPool({ ...resolveDiscreteDbParams(process.env), ssl: false, max: 2 });
  await assertUtcSession(c);
  const db = (await c.query('select current_database() d')).rows[0].d;
  if (db !== 'ipodhan_staging') throw new Error(`refusing: connected to ${db}, not ipodhan_staging`);

  const ipo = (await c.query('select id, slug, status, segment from ipos where slug = $1', [slug])).rows[0];
  if (!ipo) throw new Error(`no IPO with slug ${slug} on staging`);
  const docs = (await c.query(
    `select id, type, title, url, exchange, filing_date, created_at, extraction_status, extracted_at, extraction_error
       from documents where ipo_id = $1`, [ipo.id])).rows;
  // filing_date is often null (6 of 7 NSE rows, 2026-10-03), so type order is the main key, then filing/created date.
  docs.sort((a, b) =>
    (TYPE_ORDER.indexOf(a.type) + 99 * (TYPE_ORDER.indexOf(a.type) < 0)) - (TYPE_ORDER.indexOf(b.type) + 99 * (TYPE_ORDER.indexOf(b.type) < 0)) ||
    new Date(a.filing_date || a.created_at) - new Date(b.filing_date || b.created_at));

  const docId = arg('--doc');
  if (!docId) {
    console.log(`IPO ${ipo.slug} (${ipo.status}, ${ipo.segment}) — documents in test order:`);
    for (const d of docs) {
      console.log(`${OFFER_TYPES.has(d.type) ? '*' : ' '} ${d.id} ${d.type} ${d.extraction_status} filed=${d.filing_date ? d.filing_date.toISOString().slice(0, 10) : '-'} ` +
        `extracted=${d.extracted_at ? d.extracted_at.toISOString() : '-'} ${d.title}`);
    }
    console.log('* = offer document in scope. Re-run with --doc <id>.');
    await c.end();
    return;
  }
  const doc = docs.find((d) => d.id === docId);
  if (!doc) throw new Error(`document ${docId} does not belong to ${slug}`);

  // Layer 1: per-field receipts the extractor recorded for this document (ipos / ipo_details only, F-225).
  const receipts = (await c.query(
    `select table_name, row_key, field_name, value, source_text, ocr_confidence
       from document_field_receipts where document_id = $1 order by table_name, field_name, row_key`, [docId])).rows;
  // Layer 2: shown values whose provenance names THIS document (data_lineage.documentId).
  // NOT field_sources.source: every filing type (DRHP, RHP, PROSPECTUS, PRICE_BAND_AD) saves as source 'DRHP'
  // (filing-persister.ts SOURCE ENUM NOTE), so a source-type match mixes documents (669 "DRHP" rows on NSE, 3 its own).
  const prov = (await c.query(
    `select table_name, field_name, row_key, source::text as source, updated_by,
            data_lineage->>'documentId' as lineage_doc, verdict
       from field_sources
      where ipo_id = $1 and data_lineage->>'documentId' = $2
      order by table_name, field_name, row_key`, [ipo.id, docId])).rows;
  // Layer 3 (context): document-path rows with NO document id at all - nobody can tell which document wrote them.
  const orphan = (await c.query(
    `select table_name, count(*)::int n from field_sources
      where ipo_id = $1 and source::text = 'DRHP' and data_lineage->>'documentId' is null
      group by 1 order by 1`, [ipo.id])).rows;
  const byTable = {};
  for (const p of prov) {
    const t = (byTable[p.table_name] ||= { rows: new Set(), fields: new Set(), n: 0, withLineage: 0 });
    t.n++; t.fields.add(p.field_name); t.rows.add(p.row_key || '');
    if (p.lineage_doc) t.withLineage++;
  }
  console.log(`IPO ${ipo.slug} — document ${doc.type} ${docId} (${doc.extraction_status}, extracted ${doc.extracted_at ? doc.extracted_at.toISOString() : '-'})`);
  console.log(`receipts: ${receipts.length}`);
  for (const r of receipts) console.log(`  R ${r.table_name}.${r.field_name}${r.row_key ? '[' + r.row_key + ']' : ''} = ${String(r.value).slice(0, 80)} (${r.source_text}${r.ocr_confidence ? ' ocr ' + r.ocr_confidence : ''})`);
  console.log(`shown values whose lineage names this document: ${prov.length}`);
  for (const [t, v] of Object.entries(byTable)) {
    console.log(`  P ${t}: ${v.n} rows, ${v.rows.size} row keys, ${v.withLineage} naming this document, fields: ${[...v.fields].join(', ')}`);
  }
  console.log(`document-path values with no document id (unattributable, IPO-wide): ${orphan.map((o) => o.table_name + ' ' + o.n).join(', ') || 'none'}`);
  const out = arg('--json');
  if (out) {
    fs.writeFileSync(out, JSON.stringify({ measuredAt: new Date().toISOString(), ipo, document: doc, receipts, provenance: prov, unattributable: orphan }, null, 2));
    console.log(`wrote ${out}`);
  }
  await c.end();
}

main().catch((e) => { console.error('ERR', e.message); process.exit(1); });
