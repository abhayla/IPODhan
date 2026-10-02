// docs/design/probes/pull-noop-pull-write.mjs -- read-only staging proof for #1490.
// Runs the SQL of the floor checks pull_noop and pull_write (scripts/audit-detection-floor.mjs) and feeds
// the rows to the same pure functions the checks use (scripts/lib/pull-write-noop-checks.mjs), against
// ipodhan_staging. Reports the OLD reading (any updated_at = a write; global table.field set) beside the NEW.
import { openReadOnlyPool, saveOutput } from './_lib.mjs';
import { classifyNoopWrites, evaluatePullWrite, toCamel } from '../../../scripts/lib/pull-write-noop-checks.mjs';

const pool = await openReadOnlyPool('ipodhan_staging');
const q = (sql, p) => pool.query(sql, p).then((r) => r.rows);
const out = { database: 'ipodhan_staging', measuredAt: new Date().toISOString() };
try {
  const [{ reasked, newDocuments }] = await q(
    `SELECT (SELECT count(*) FROM ipo_field_plan WHERE last_attempt_at > now() - interval '24 hours')::int AS "reasked",
            (SELECT count(*) FROM documents WHERE created_at > now() - interval '24 hours')::int AS "newDocuments"`);
  const touched = await q(
    `SELECT fs.previous_value AS "previousValue", fs.previous_source::text AS "previousSource", fs.source::text AS "source",
            EXISTS (SELECT 1 FROM document_field_receipts r JOIN documents d ON d.id = r.document_id
                     WHERE d.ipo_id = fs.ipo_id AND r.created_at > now() - interval '24 hours') AS "hasReceipt",
            EXISTS (SELECT 1 FROM ipos i WHERE i.id = fs.ipo_id AND i.answers_round_at > now() - interval '24 hours') AS "answersRound"
       FROM field_sources fs WHERE fs.updated_at > now() - interval '24 hours'`);
  const c = classifyNoopWrites(touched);
  out.pull_noop = { reasked, newDocuments, ...c,
    oldRatio: reasked ? +(touched.length / reasked).toFixed(4) : null,
    newRatio: reasked ? +(c.unexplained / reasked).toFixed(4) : null };

  const planRows = await q(
    `SELECT p.ipo_id AS "ipoId", i.slug, p.table_name AS "tableName", p.row_key AS "rowKey", p.field_name AS "fieldName",
            p.chosen_source::text AS "chosenSource", p.answers
       FROM ipo_field_plan p JOIN ipos i ON i.id = p.ipo_id
      WHERE p.state = 'SUPPLIED' AND i.offering_type = 'IPO' AND i.status IN ('OPEN','UPCOMING')`);
  const wr = await q(`SELECT ipo_id AS "ipoId", table_name AS "tableName", row_key AS "rowKey", field_name AS "fieldName" FROM field_sources`);
  const written = new Set(wr.map((w) => `${w.ipoId}|${w.tableName}|${w.rowKey}|${w.fieldName}`));
  const globalSet = new Set(wr.map((w) => `${w.tableName}.${w.fieldName}`));
  const oldMissing = planRows.filter((r) => !globalSet.has(`${r.tableName}.${toCamel(r.fieldName)}`));
  const { missing, credited } = await evaluatePullWrite(planRows, written, q);
  out.pull_write = { supplied: planRows.length, oldMissing: oldMissing.length, newMissing: missing.length, credited,
    newMissingSample: missing.slice(0, 10).map((m) => `${m.slug}:${m.tableName}[${m.rowKey}].${m.fieldName} (${m.why})`) };
} finally {
  await pool.end();
}
console.log(JSON.stringify(out, null, 2));
saveOutput('pull-noop-pull-write', out);
