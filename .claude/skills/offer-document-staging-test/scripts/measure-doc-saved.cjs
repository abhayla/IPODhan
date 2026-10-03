#!/usr/bin/env node
// Read-only: what ONE offer document saved on staging.
// Usage: PW=<ipodhan_app password> node measure-doc-saved.cjs <ipo-slug> [--doc <document-id>] [--json out.json]
// Without --doc it lists the IPO's documents in filing order (the order the skill tests them in).
// Needs the DB tunnel on localhost:15432 (scripts/ops/db-tunnel.sh start). Never prints the password or a URL.
const path = require('path');
const fs = require('fs');
const repo = path.resolve(__dirname, '..', '..', '..', '..');
const { Client } = require(require.resolve('pg', { paths: [repo, 'D:/Abhay/Ventures/IPODhan'] }));

const TYPE_ORDER = ['DRHP', 'ADDENDUM_DRHP', 'RHP', 'ADDENDUM_RHP', 'PRICE_BAND_AD', 'CORRIGENDUM', 'PROSPECTUS'];
const OFFER_TYPES = new Set(['DRHP', 'RHP', 'PROSPECTUS', 'PRICE_BAND_AD']);

function arg(name) {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
}

(async () => {
  const slug = process.argv[2];
  if (!slug || slug.startsWith('--')) throw new Error('usage: measure-doc-saved.cjs <ipo-slug> [--doc <id>] [--json out.json]');
  if (!process.env.PW) throw new Error('PW env var (ipodhan_app password) is not set');
  const c = new Client({ host: 'localhost', port: 15432, user: 'ipodhan_app', password: process.env.PW, database: 'ipodhan_staging' });
  await c.connect();
  await c.query("SET TIME ZONE 'UTC'");
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
  // Layer 2: provenance rows whose source is this document's type. data_lineage.documentId is set on few rows
  // (3 of 698 for the NSE DRHP), so the type is the usable key; rows naming ANOTHER document id are excluded.
  const prov = (await c.query(
    `select table_name, field_name, row_key, source::text as source, updated_by,
            data_lineage->>'documentId' as lineage_doc, verdict
       from field_sources
      where ipo_id = $1 and source::text = $2
        and (data_lineage->>'documentId' is null or data_lineage->>'documentId' = $3)
      order by table_name, field_name, row_key`, [ipo.id, doc.type, docId])).rows;

  const byTable = {};
  for (const p of prov) {
    const t = (byTable[p.table_name] ||= { rows: new Set(), fields: new Set(), n: 0, withLineage: 0 });
    t.n++; t.fields.add(p.field_name); t.rows.add(p.row_key || '');
    if (p.lineage_doc) t.withLineage++;
  }
  console.log(`IPO ${ipo.slug} — document ${doc.type} ${docId} (${doc.extraction_status}, extracted ${doc.extracted_at ? doc.extracted_at.toISOString() : '-'})`);
  console.log(`receipts: ${receipts.length}`);
  for (const r of receipts) console.log(`  R ${r.table_name}.${r.field_name}${r.row_key ? '[' + r.row_key + ']' : ''} = ${String(r.value).slice(0, 80)} (${r.source_text}${r.ocr_confidence ? ' ocr ' + r.ocr_confidence : ''})`);
  console.log(`field_sources with source=${doc.type}: ${prov.length}`);
  for (const [t, v] of Object.entries(byTable)) {
    console.log(`  P ${t}: ${v.n} rows, ${v.rows.size} row keys, ${v.withLineage} naming this document, fields: ${[...v.fields].join(', ')}`);
  }
  const out = arg('--json');
  if (out) {
    fs.writeFileSync(out, JSON.stringify({ measuredAt: new Date().toISOString(), ipo, document: doc, receipts, provenance: prov }, null, 2));
    console.log(`wrote ${out}`);
  }
  await c.end();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
