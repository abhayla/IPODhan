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
 * P2-2b (round-4 review, T-293): clustering is now TWO-TIER — exact normalized
 * key (as before) UNIONED with a Levenshtein-typo check (>=0.85 similarity AND
 * <=3 absolute edits — see `company-name-similarity.ts` for why both bars are
 * needed, not percentage alone). This is the POST-INSERT convergence sweep: a
 * pair that slips past the create-time check in `upsertIPO` (a different insert
 * path, a race, a bug) still converges when this script next runs, instead of
 * living forever. Run this script periodically (see
 * `scheduler/jobs/duplicate-sweep.ts`, gated OFF by default) as well as ad hoc.
 *
 * ROUTED THROUGH THE SHARED WRITE PATH (issue #807 piece 1). The apply step
 * used to hand-roll `db.execute(sql.raw(...))` UPDATE/DELETE statements
 * against `ipos`/`subscriptions`/`gmp_records` directly — a second raw-SQL
 * writer of `ipos`, grandfathered into the write ratchet
 * (config/write-ratchet-baseline.json:97) only because it predates the R0
 * rule (docs/architecture/write-path-hardening.md), same class the singular
 * tool (`repair-merge-duplicate-ipo.ts`, PR #432/#433) was built to retire.
 * `applyMerges` below now calls `IPORepository.mergeDuplicateInto` once per
 * cluster pair — the SAME method the singular tool calls, which performs the
 * identical symbol/isin backfill, subscriptions/gmp_records repoint, slug
 * redirect and dropped-row delete entirely through the Drizzle query
 * builder, inside one transaction per pair, behind the same prod-write guard.
 * `forceDifferentName: true` is passed because this tool's own two-tier
 * clustering (exact key + typo similarity, above) is a stricter duplicate
 * test than `mergeDuplicateInto`'s simple name-fold eligibility check — a
 * pair already accepted into one of this tool's clusters has already cleared
 * a bar at least as strict, so re-refusing on name-fold here would be a
 * regression, not a safety check.
 *
 * Usage (tunnel: DATABASE_HOST=localhost DATABASE_PORT=15432):
 *   npx tsx --tsconfig tsx.tsconfig.json scripts/merge-duplicate-ipos.ts [--apply]
 */

import { db, getRedisClient, IPORepository } from '@ipodhan/shared';
import { ipos } from '@ipodhan/shared/db/schema';
import { sql } from 'drizzle-orm';
import { pathToFileURL } from 'node:url';
import { normalizeCompanyNameForMatching } from '../src/services/data-persister.js';
import { levenshteinSimilarity } from '@ipodhan/shared/utils/company-name-similarity';

const APPLY = process.argv.includes('--apply');
const FUZZY_THRESHOLD = 0.85;
const MAX_TYPO_EDIT_DISTANCE = 3;

function levenshteinDistanceRaw(a: string, b: string): number {
  const matrix: number[][] = [];
  for (let i = 0; i <= b.length; i++) matrix[i] = [i];
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      matrix[i][j] = b.charAt(i - 1) === a.charAt(j - 1)
        ? matrix[i - 1][j - 1]
        : Math.min(matrix[i - 1][j - 1] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j] + 1);
    }
  }
  return matrix[b.length][a.length];
}

/** Union-Find over normalized-name KEYS: exact equality OR typo-similarity. */
export function buildDuplicateKeyGroups(keys: string[]): Map<string, string[]> {
  const parent = new Map<string, string>();
  const find = (k: string): string => {
    if (!parent.has(k)) parent.set(k, k);
    let root = k;
    while (parent.get(root) !== root) root = parent.get(root)!;
    let cur = k;
    while (parent.get(cur) !== root) {
      const next = parent.get(cur)!;
      parent.set(cur, root);
      cur = next;
    }
    return root;
  };
  const union = (a: string, b: string) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };

  const unique = [...new Set(keys)];
  for (const k of unique) find(k);

  for (let i = 0; i < unique.length; i++) {
    for (let j = i + 1; j < unique.length; j++) {
      const a = unique[i];
      const b = unique[j];
      if (a === b) {
        union(a, b);
        continue;
      }
      const distance = levenshteinDistanceRaw(a, b);
      if (distance > MAX_TYPO_EDIT_DISTANCE) continue;
      if (levenshteinSimilarity(a, b) >= FUZZY_THRESHOLD) union(a, b);
    }
  }

  const groups = new Map<string, string[]>();
  for (const k of unique) {
    const root = find(k);
    (groups.get(root) ?? groups.set(root, []).get(root)!).push(k);
  }
  return groups;
}

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

  const byExactKey = new Map<string, Row[]>();
  for (const r of all) {
    const key = normalizeCompanyNameForMatching(r.companyName);
    if (!key) continue;
    (byExactKey.get(key) ?? byExactKey.set(key, []).get(key)!).push(r);
  }
  // P2-2b (T-293): union exact-key clusters that are ALSO typo-similar to
  // each other, so a pair like "dhanwel hybird seeds" / "dhanwel hybrid
  // seeds" — two different exact keys — converges into one cluster.
  const keyGroups = buildDuplicateKeyGroups([...byExactKey.keys()]);
  const clusters = new Map<string, Row[]>();
  for (const [root, keys] of keyGroups) {
    const rows = keys.flatMap((k) => byExactKey.get(k) ?? []);
    clusters.set(root, rows);
  }
  const dupClusters = [...clusters.entries()].filter(([, rs]) => rs.length > 1);

  console.log(`Total IPOs: ${all.length} · clusters: ${clusters.size} · DUP clusters: ${dupClusters.length}\n${'='.repeat(80)}`);

  const merges: { keep: string; dup: string; dupSlug: string }[] = [];
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
      merges.push({ keep: keep.id, dup: dpRow.id, dupSlug: dpRow.slug });
      toDelete.push(dpRow.id);
    }
  }

  console.log(`\n${'='.repeat(80)}\n${toDelete.length} duplicate rows to delete across ${dupClusters.length} clusters.`);

  if (!APPLY) {
    console.log('DRY-RUN — no writes. Re-run with --apply to merge (single transaction).');
    return;
  }
  if (toDelete.length === 0) { console.log('Nothing to do.'); return; }

  const redis = getRedisClient();
  const repo = new IPORepository(db, redis);
  await applyMerges(repo, merges, { allowProd: process.argv.includes('--allow-prod') });
  console.log(`APPLIED — repointed gmp/subscriptions to survivors, wrote ${merges.length} slug redirect(s), deleted ${toDelete.length} duplicate rows (CASCADE removed rebuildable children) via IPORepository.mergeDuplicateInto.`);
}

/**
 * Minimal shape of `IPORepository` this function needs — lets the unit test
 * pass a fake without constructing a real DB pool/Redis client.
 */
export interface MergeDuplicateIntoRepo {
  mergeDuplicateInto(
    keepId: string,
    dropId: string,
    opts: { apply: boolean; forceDifferentName?: boolean; allowProd?: boolean }
  ): Promise<unknown>;
}

/**
 * Applies every planned {keep, dup} pair through the shared write path
 * (`IPORepository.mergeDuplicateInto`) — one call, one transaction, per pair
 * — instead of the single hand-rolled multi-pair transaction the raw-SQL
 * version used. A refusal (prod guard, eligibility check) on one pair throws
 * and stops the run rather than being swallowed; the caller sees exactly
 * which pair and why, same as any other `mergeDuplicateInto` caller.
 */
export async function applyMerges(
  repo: MergeDuplicateIntoRepo,
  merges: { keep: string; dup: string; dupSlug: string }[],
  opts: { allowProd: boolean }
): Promise<void> {
  for (const { keep, dup } of merges) {
    await repo.mergeDuplicateInto(keep, dup, {
      apply: true,
      forceDifferentName: true,
      allowProd: opts.allowProd,
      // Item 19 / #807: named here, never inferred inside the repository — the log has to
      // say which tool consumed the row, and only the caller knows that.
      mergedBy: 'merge-duplicate-ipos.ts',
    });
  }
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
