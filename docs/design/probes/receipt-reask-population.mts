// Issue #1498 proof, READ-ONLY: runs the REAL `IpoFieldPlanRepository.listReceiptNewerRows` (the same predicate as
// the claim query's receipt_newer leg) on ipodhan_staging for every IPO that has a plan, and prints the rows a newer
// document record would re-open, by IPO / state / rank-1 source. The pool is default_transaction_read_only.
// Run (from scraper/, staging tunnel open): npx tsx ../docs/design/probes/receipt-reask-population.mts [slug]
import { drizzle } from 'drizzle-orm/node-postgres';
import { IpoFieldPlanRepository } from '../../../packages/shared/src/repositories/ipo-field-plan-repository.ts';
import { openReadOnlyPool } from './_lib.mjs';

const pool = await openReadOnlyPool('ipodhan_staging');
const repo = new IpoFieldPlanRepository(drizzle(pool) as never, {} as never);
const only = process.argv[2];
const ipos = (
  await pool.query(
    `SELECT DISTINCT i.id, i.slug, i.status::text AS status FROM ipos i JOIN ipo_field_plan p ON p.ipo_id = i.id
      WHERE ($1::text IS NULL OR i.slug = $1) ORDER BY i.slug`,
    [only ?? null]
  )
).rows;
const byState: Record<string, number> = {};
let total = 0;
let ipoCount = 0;
let rank1DocBlank = 0;
for (const ipo of ipos) {
  const rows = await repo.listReceiptNewerRows({ ipoId: ipo.id });
  if (rows.length === 0) continue;
  ipoCount++;
  total += rows.length;
  const ids = rows.map((r) => r.id);
  const r1 = (await pool.query(`SELECT count(*)::int n FROM ipo_field_plan WHERE id = ANY($1::uuid[]) AND rank1_source='DOC' AND row_key=''`, [ids])).rows[0].n;
  rank1DocBlank += r1;
  for (const r of rows) byState[r.state] = (byState[r.state] ?? 0) + 1;
  if (only || ipoCount <= 5) {
    console.log(`${ipo.slug} (${ipo.status}): ${rows.length} rows`, rows.slice(0, 8).map((r) => `${r.tableName}.${r.fieldName} ${r.state}/${r.attempts}`).join('; '));
  }
}
console.log(JSON.stringify({ ipos: ipoCount, rows: total, rank1DocRowKeyBlank: rank1DocBlank, byState }));
await pool.end();
