/**
 * Merge duplicate IPO rows (#16) — dry-run default, --apply gated.
 *
 * Duplicate rows arise from status-code-suffix name variants ("...Ltd. CT" /
 * "...Ltd. O" / all-caps) created before the canonical normalizer. They share a
 * normalized name but have distinct slugs, and the `ipos_slug_unique` constraint
 * makes a scraper's update collide (BSE enrichment fails: records_failed=N).
 *
 * Strategy: per normalized-name cluster, KEEP the richest row (most populated
 * structural fields, tie-break oldest) and DELETE the rest. The dry-run reports
 * each cluster + the child rows that ON DELETE CASCADE would remove, so any data
 * loss is visible BEFORE applying. Apply runs in a single transaction.
 *
 * Usage (tunnel: DATABASE_HOST=localhost DATABASE_PORT=15432):
 *   npx tsx --tsconfig tsx.tsconfig.json scripts/merge-duplicate-ipos.ts [--apply]
 */

import { db } from '@ipodhan/shared/db';
import { ipos } from '@ipodhan/shared/db/schema';
import { sql } from 'drizzle-orm';
import { pathToFileURL } from 'node:url';
import { normalizeCompanyNameForMatching } from '../src/services/data-persister.js';

const APPLY = process.argv.includes('--apply');

// Data-bearing child tables worth reporting before a CASCADE delete.
const CHILD_TABLES = [
  'subscriptions', 'gmp_records', 'field_sources', 'anchor_investors',
  'financial_data', 'ipo_details', 'listing_performance', 'ipo_reviews',
  'documents', 'peer_companies', 'user_watchlist',
];

export interface Row {
  id: string; companyName: string; slug: string;
  issueSize: string | null; lotSize: number | null; priceRangeMax: number | null;
  registrar: string | null; createdAt: Date | null;
}

export function completeness(r: Row): number {
  let n = 0;
  if (r.issueSize && Number(r.issueSize) > 0) n++;
  if (r.lotSize && r.lotSize > 0) n++;
  if (r.priceRangeMax && r.priceRangeMax > 0) n++;
  if (r.registrar) n++;
  return n;
}

/**
 * Rank a duplicate cluster and return the row to KEEP (T-277F checker finding
 * #4). Priority: field-COMPLETENESS first (a CASCADE-losing decision is about
 * losing the record's OWN data — issue size, lot size, price band, registrar
 * — none of which the apply step ever repoints), then real-child-history
 * count as a tiebreak (subscriptions/gmp_records are REPOINTED to whichever
 * row is `keep` before the CASCADE delete — see the apply transaction below
 * — so child count does NOT protect against data loss the way completeness
 * does; it is a fine tiebreak, never the primary signal), then oldest
 * (stable history).
 *
 * Before this fix, child-history count ranked FIRST, which kept the LESS
 * complete row in 2 real prod clusters (shree-balaji-mala-textiles c=2 over
 * c=4; cube-highways-trust c=1 over c=2) purely because it happened to have
 * a stray gmp/subscription row — losing lot_size/registrar on the deleted,
 * more-complete sibling.
 */
export function pickKeeper(rows: Row[], realChildValue: Map<string, number>): Row {
  const ranked = [...rows].sort((a, b) =>
    (completeness(b) - completeness(a)) ||
    ((realChildValue.get(b.id) ?? 0) - (realChildValue.get(a.id) ?? 0)) ||
    ((a.createdAt?.getTime() ?? 0) - (b.createdAt?.getTime() ?? 0)));
  return ranked[0];
}

/** Real (non-rebuildable) child data a CASCADE delete would lose. */
async function realChildValue(ipoId: string): Promise<number> {
  let v = 0;
  for (const t of ['gmp_records', 'subscriptions']) {
    try {
      const r: any = await db.execute(sql.raw(`SELECT count(*)::int n FROM ${t} WHERE ipo_id = '${ipoId}'`));
      v += (r.rows ?? r)[0]?.n ?? 0;
    } catch { /* ignore */ }
  }
  return v;
}

async function childCounts(ipoId: string): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const t of CHILD_TABLES) {
    try {
      const r: any = await db.execute(sql.raw(`SELECT count(*)::int n FROM ${t} WHERE ipo_id = '${ipoId}'`));
      const n = (r.rows ?? r)[0]?.n ?? 0;
      if (n > 0) out[t] = n;
    } catch { /* table may not exist in this env */ }
  }
  return out;
}

async function main() {
  console.log(`\nMERGE DUPLICATE IPOs — ${APPLY ? 'APPLY (transaction)' : 'DRY-RUN (no writes)'}`);
  const all = (await db
    .select({
      id: ipos.id, companyName: ipos.companyName, slug: ipos.slug,
      issueSize: ipos.issueSize, lotSize: ipos.lotSize, priceRangeMax: ipos.priceRangeMax,
      registrar: ipos.registrar, createdAt: ipos.createdAt,
    })
    .from(ipos)) as Row[];

  const clusters = new Map<string, Row[]>();
  for (const r of all) {
    const key = normalizeCompanyNameForMatching(r.companyName);
    if (!key) continue;
    (clusters.get(key) ?? clusters.set(key, []).get(key)!).push(r);
  }
  const dupClusters = [...clusters.entries()].filter(([, rs]) => rs.length > 1);

  console.log(`Total IPOs: ${all.length} · clusters: ${clusters.size} · DUP clusters: ${dupClusters.length}\n${'='.repeat(80)}`);

  const merges: { keep: string; dup: string }[] = [];
  const toDelete: string[] = [];
  for (const [key, rs] of dupClusters) {
    const val = new Map<string, number>();
    for (const r of rs) val.set(r.id, await realChildValue(r.id));
    const keep = pickKeeper(rs, val);
    const dups = rs.filter((r) => r.id !== keep.id);
    console.log(`\n● "${key}" (${rs.length})  KEEP id=${keep.id.slice(0, 8)} slug=${keep.slug} [c=${completeness(keep)}]`);
    for (const dpRow of dups) {
      const kids = await childCounts(dpRow.id);
      const kidStr = Object.keys(kids).length ? Object.entries(kids).map(([t, n]) => `${t}:${n}`).join(', ') : 'no children';
      console.log(`    DELETE id=${dpRow.id.slice(0, 8)} slug=${dpRow.slug} [c=${completeness(dpRow)}]  repoint gmp/subs → keep, then CASCADE: ${kidStr}`);
      merges.push({ keep: keep.id, dup: dpRow.id });
      toDelete.push(dpRow.id);
    }
  }

  console.log(`\n${'='.repeat(80)}\n${toDelete.length} duplicate rows to delete across ${dupClusters.length} clusters.`);

  if (!APPLY) {
    console.log('DRY-RUN — no writes. Re-run with --apply to merge (single transaction).');
    return;
  }
  if (toDelete.length === 0) { console.log('Nothing to do.'); return; }

  await db.transaction(async (tx) => {
    for (const { keep, dup } of merges) {
      // subscriptions: only UNIQUE(id) -> plain repoint is safe.
      await tx.execute(sql.raw(`UPDATE subscriptions SET ipo_id = '${keep}' WHERE ipo_id = '${dup}'`));
      // gmp_records: UNIQUE(ipo_id, timestamp, source) -> drop dup rows that would
      // collide with the survivor's same (timestamp, source), then repoint the rest.
      await tx.execute(sql.raw(
        `DELETE FROM gmp_records d WHERE d.ipo_id = '${dup}' AND EXISTS (` +
        `SELECT 1 FROM gmp_records k WHERE k.ipo_id = '${keep}' ` +
        `AND k."timestamp" = d."timestamp" AND k.source = d.source)`));
      await tx.execute(sql.raw(`UPDATE gmp_records SET ipo_id = '${keep}' WHERE ipo_id = '${dup}'`));
    }
    for (const id of toDelete) {
      await tx.execute(sql.raw(`DELETE FROM ipos WHERE id = '${id}'`));
    }
  });
  console.log(`APPLIED — repointed gmp/subscriptions to survivors, deleted ${toDelete.length} duplicate rows (CASCADE removed rebuildable children).`);
}

// Guard so `pickKeeper`/`completeness` can be imported by unit tests without
// executing `main()` (which touches the real DB) as an import side effect.
// MUST use pathToFileURL, not a hand-rolled `file://${argv[1]}` template — that
// pattern silently never matches on Windows (T-223 / PR #116 — see
// tests/unit/utils/cli-entry-guard.test.ts) and main() would never run in prod.
const isMain = import.meta.url === pathToFileURL(process.argv[1] ?? '').href;
if (isMain) {
  main().then(() => process.exit(0)).catch((e) => { console.error('merge failed:', e?.message || e); process.exit(1); });
}
