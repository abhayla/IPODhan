// #1498 follow-up proof, READ-ONLY: runs the REAL `IpoFieldPlanRepository.listReceiptNewerRows` (the same predicate as
// the claim query's receipt leg) on ipodhan_staging with and without the DOC-fetcher logic-change input
// (`buildDocFetcherChangeReask`, DOC_FETCHER_LOGIC_SINCE), and prints the rows the fetcher change ADDS, by state and
// field, plus whether nityas-gems-and-jewellery-ltd ipos.objectives is among them. The pool is default_transaction_read_only.
// Run (from scraper/, staging tunnel open): npx tsx ../docs/design/probes/fetcher-change-reask-population.mts [slug]
import { drizzle } from 'drizzle-orm/node-postgres';
import { IpoFieldPlanRepository } from '../../../packages/shared/src/repositories/ipo-field-plan-repository.ts';
import { loadFieldManifest } from '../../../scraper/src/config/field-manifest-loader.ts';
import { docTypeFamily } from '../../../scraper/config/plan-supersession-rule.mjs';
import { buildDocFetcherChangeReask } from '../../../scraper/src/services/extractor-version-floors.ts';
import { openReadOnlyPool } from './_lib.mjs';

// The same maps PASS 3 passes (buildFieldPlanReceiptDocTypes + buildDocFetcherChangeReask).
const receiptDocTypes: Record<string, string[]> = {};
for (const [k, e] of Object.entries(loadFieldManifest().fields)) {
  const t = (e as { documentType?: string }).documentType;
  if (t) receiptDocTypes[k] = [...docTypeFamily(t)];
}
const fetcherChange = buildDocFetcherChangeReask(receiptDocTypes);

const pool = await openReadOnlyPool('ipodhan_staging');
try {
  const repo = new IpoFieldPlanRepository(drizzle(pool) as never, {} as never);
  const only = process.argv[2];
  const ipos = (
    await pool.query(
      `SELECT DISTINCT i.id, i.slug FROM ipos i JOIN ipo_field_plan p ON p.ipo_id = i.id
        WHERE ($1::text IS NULL OR i.slug = $1) ORDER BY i.slug`,
      [only ?? null]
    )
  ).rows;
  let before = 0;
  let after = 0;
  const added: string[] = [];
  const byState: Record<string, number> = {};
  const byField: Record<string, number> = {};
  const addedIpos = new Set<string>();
  for (const ipo of ipos) {
    const a = await repo.listReceiptNewerRows({ ipoId: ipo.id, receiptDocTypes });
    const b = await repo.listReceiptNewerRows({ ipoId: ipo.id, receiptDocTypes, fetcherChange });
    before += a.length;
    after += b.length;
    const had = new Set(a.map((r) => r.id));
    for (const r of b) {
      if (had.has(r.id)) continue;
      addedIpos.add(ipo.slug);
      byState[r.state] = (byState[r.state] ?? 0) + 1;
      const k = `${r.tableName}.${r.fieldName}`;
      byField[k] = (byField[k] ?? 0) + 1;
      added.push(`${ipo.slug} ${k}${r.rowKey ? `[${r.rowKey}]` : ''} ${r.state}/${r.attempts}`);
    }
  }
  const nityas = added.filter((l) => l.startsWith('nityas-gems-and-jewellery-ltd '));
  console.log(`since=${fetcherChange.since.toISOString()} floors=${JSON.stringify(fetcherChange.currentVersionFloors)}`);
  for (const l of added.slice(0, 40)) console.log(`  + ${l}`);
  console.log(JSON.stringify({ ipos: ipos.length, rowsBefore: before, rowsAfter: after, added: added.length, addedIpos: addedIpos.size, byState, byField, nityas }));
} finally {
  await pool.end();
}
