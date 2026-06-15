/**
 * MAINBOARD duplicate-cluster diagnostic + merge (dry-run default) — #16.
 *
 * Groups MAINBOARD IPOs by the canonical normalized name (the SAME
 * normalizeCompanyNameForMatching the persister uses) and reports clusters of
 * >1 row — the status-code-suffix duplicates (e.g. "...Ltd. CT" / "...Ltd. O" /
 * "...LIMITED"). Dry-run reports only; merge is a separate gated step.
 *
 * Usage (tunnel: DATABASE_HOST=localhost DATABASE_PORT=15432):
 *   npx tsx --tsconfig tsx.tsconfig.json scripts/dedup-bse-mainboard.ts
 */

import { db } from '@ipodhan/shared/db';
import { ipos } from '@ipodhan/shared/db/schema';
import { eq } from 'drizzle-orm';
import { normalizeCompanyNameForMatching } from '../src/services/data-persister.js';

interface Row {
  id: string;
  companyName: string;
  issueSize: string | null;
  lotSize: number | null;
  priceRangeMax: number | null;
  registrar: string | null;
  status: string | null;
  createdAt: Date | null;
}

/** Count populated structural fields — used to pick the "richest" row to keep. */
function completeness(r: Row): number {
  let n = 0;
  if (r.issueSize && Number(r.issueSize) > 0) n++;
  if (r.lotSize && r.lotSize > 0) n++;
  if (r.priceRangeMax && r.priceRangeMax > 0) n++;
  if (r.registrar) n++;
  return n;
}

async function main() {
  const rows = (await db
    .select({
      id: ipos.id,
      companyName: ipos.companyName,
      issueSize: ipos.issueSize,
      lotSize: ipos.lotSize,
      priceRangeMax: ipos.priceRangeMax,
      registrar: ipos.registrar,
      status: ipos.status,
      createdAt: ipos.createdAt,
    })
    .from(ipos)
    .where(eq(ipos.segment, 'MAINBOARD'))) as Row[];

  const clusters = new Map<string, Row[]>();
  for (const r of rows) {
    const key = normalizeCompanyNameForMatching(r.companyName);
    if (!key) continue;
    (clusters.get(key) ?? clusters.set(key, []).get(key)!).push(r);
  }

  const dups = [...clusters.entries()].filter(([, rs]) => rs.length > 1);
  console.log(`\n${'='.repeat(80)}`);
  console.log(`MAINBOARD rows: ${rows.length} · normalized clusters: ${clusters.size} · DUP clusters (>1): ${dups.length}`);
  console.log('='.repeat(80));
  for (const [key, rs] of dups.sort((a, b) => b[1].length - a[1].length)) {
    console.log(`\n● "${key}"  (${rs.length} rows)`);
    for (const r of rs.sort((a, b) => completeness(b) - completeness(a))) {
      const fields = [
        r.issueSize && Number(r.issueSize) > 0 ? `size=₹${(Number(r.issueSize) / 1e7).toFixed(2)}cr` : 'size=∅',
        `lot=${r.lotSize ?? '∅'}`,
        `band≤${r.priceRangeMax ?? '∅'}`,
        r.registrar ? 'reg✓' : 'reg=∅',
        `status=${r.status}`,
      ].join(' ');
      console.log(`    [${completeness(r)}] "${r.companyName}"  ${fields}  id=${r.id.slice(0, 8)}`);
    }
  }
  console.log(`\nDRY-RUN diagnostic only — no writes. Merge is a separate gated step.`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('dedup diagnostic failed:', e instanceof Error ? e.message : String(e));
    process.exit(1);
  });
