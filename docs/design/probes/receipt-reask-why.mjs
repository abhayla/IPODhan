// Issue #1498 step 1, READ-ONLY: for one IPO, every DOC rank-1 plan row (row_key '') that is not
// SUPPLIED, next to the newest document_field_receipts row for the same field (camelCase field_name),
// with the claim-leg inputs of IpoFieldPlanRepository.claimNextDueField (state, attempts, last
// attempt vs the slot boundary, gap/held-read stamps). Timestamps are read as text (naive UTC).
// Run: node docs/design/probes/receipt-reask-why.mjs [slug] [table.field ...]
import { openReadOnlyPool } from './_lib.mjs';
const slug = process.argv[2] ?? 'nityas-gems-and-jewellery-ltd';
const only = process.argv.slice(3);
const pool = await openReadOnlyPool('ipodhan_staging');
const q = async (t, p = []) => (await pool.query(t, p)).rows;
const [ipo] = await q(`SELECT id, slug, status::text, (SELECT count(*) FROM documents d WHERE d.ipo_id=i.id AND d.extraction_status='COMPLETED') AS completed_docs FROM ipos i WHERE slug=$1`, [slug]);
console.log('ipo', JSON.stringify(ipo), 'db now (UTC text)', (await q(`SELECT now()::timestamp::text AS t`))[0].t);
const rows = await q(`
  SELECT p.table_name||'.'||p.field_name AS f, p.state, p.attempts, p.last_attempt_at::text AS last_at,
         p.next_due_at::text AS next_due, left(p.cause, 110) AS cause
    FROM ipo_field_plan p
   WHERE p.ipo_id=$1 AND p.state <> 'SUPPLIED' AND p.rank1_source='DOC' AND p.row_key=''
   ORDER BY 1`, [ipo.id]);
const camel = (s) => s.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());
let withNewer = 0;
for (const r of rows) {
  const [t, f] = r.f.split('.');
  if (only.length && !only.includes(r.f)) continue;
  const [rc] = await q(`SELECT r.created_at::text AS receipt_at, left(r.value::text, 80) AS v, r.ocr_confidence, d.type::text AS doc_type
                          FROM document_field_receipts r JOIN documents d ON d.id = r.document_id
                         WHERE d.ipo_id=$1 AND r.table_name=$2 AND r.field_name=$3 ORDER BY r.created_at DESC LIMIT 1`, [ipo.id, t, camel(f)]);
  const newer = rc && (!r.last_at || rc.receipt_at > r.last_at);
  if (newer) withNewer++;
  if (only.length || newer) console.log(JSON.stringify({ f: r.f, state: r.state, attempts: r.attempts, last_at: r.last_at, next_due: r.next_due, cause: r.cause, receipt: rc ?? null, newer }));
}
console.log('rows', rows.length, 'with newer receipt', withNewer);
await pool.end();
