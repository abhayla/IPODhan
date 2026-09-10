/**
 * Re-key repair for `ipo_risk_factors` — item 1 slice s6.
 *
 * Two phases, each dry-run by default, run in this order against a slot before
 * the gated file `_gated/E2_risk_factor_heading_hash_key.sql` is applied:
 *
 *   --backfill  fills `heading_hash` on every existing row, computed from the
 *               row's own `heading` by `headingHashForRiskFactor` — the SAME
 *               function `IpoRiskFactorsRepository.replaceForIpo` uses at
 *               insert time. One implementation, not a second one for the
 *               backfill.
 *   --dedupe    collapses rows that share `(ipo_id, heading_hash)`. The row
 *               with the MOST non-null content survives, lowest `seq` breaking
 *               the tie - never "lowest seq regardless of content". A group
 *               whose rows carry DIFFERING non-null content is not resolved at
 *               all: it is reported by slug/heading/row-id with a preview of
 *               each row and left untouched for a human, and the run exits
 *               non-zero. NULL-versus-present is a safe automatic choice;
 *               present-versus-different is a human decision. See `planDedupe`.
 *
 * Class: every row of `ipo_risk_factors` on every slot — all IPO statuses
 * (UPCOMING/OPEN/CLOSED/LISTED/WITHDRAWN), both segments, rows written before
 * this change and rows the pipeline writes after it. Not slug-scoped.
 *
 * Usage (from scraper/, tunnel env per docs/ops/prod-ops-recipes.md §1 and §8d):
 *   npx tsx scripts/repair-risk-factor-heading-hash.ts --backfill
 *   npx tsx scripts/repair-risk-factor-heading-hash.ts --backfill --apply
 *   npx tsx scripts/repair-risk-factor-heading-hash.ts --dedupe
 *   npx tsx scripts/repair-risk-factor-heading-hash.ts --dedupe --apply
 *
 * Idempotent: a row whose stored hash already equals the recomputed one is not
 * touched, and a second --dedupe pass deletes 0.
 *
 * Exit code: non-zero when --dedupe found at least one conflicted group, so a
 * caller cannot read "deleted=N" as "the slot is now clean" (signal-ownership
 * R6 - a gate prints its reason before a non-zero exit).
 */
import { db } from '@ipodhan/shared';
import { ipoRiskFactors } from '@ipodhan/shared/db/schema';
import { headingHashForRiskFactor } from '@ipodhan/shared/utils/risk-factor-heading-key';
import { eq, sql } from 'drizzle-orm';
import { pathToFileURL } from 'node:url';
import { openRepairDb, writeLedgerFile } from './lib/repair-tool.js';

/**
 * Flag parsing as a pure function so "dry run is the DEFAULT" is a tested
 * property and not a claim about an expression at module scope. Deleting the
 * `--apply` requirement turns a named test red.
 */
export function parseFlags(argv: string[]): {
  apply: boolean;
  allowProd: boolean;
  backfill: boolean;
  dedupe: boolean;
} {
  return {
    apply: argv.includes('--apply'),
    allowProd: argv.includes('--allow-prod'),
    backfill: argv.includes('--backfill'),
    dedupe: argv.includes('--dedupe'),
  };
}

const FLAGS = parseFlags(process.argv);
const APPLY = FLAGS.apply;
const ALLOW_PROD = FLAGS.allowProd;
const DO_BACKFILL = FLAGS.backfill;
const DO_DEDUPE = FLAGS.dedupe;

export interface HashRepairRow {
  id: string;
  heading: string;
  currentHash: string | null;
  recomputedHash: string | null;
}

/** Pure decision, unit-testable without a DB. */
export function planHashRepair(rows: HashRepairRow[]): {
  toWrite: { id: string; headingHash: string }[];
  alreadyCorrect: number;
  nullKey: string[];
} {
  const toWrite: { id: string; headingHash: string }[] = [];
  const nullKey: string[] = [];
  let alreadyCorrect = 0;

  for (const row of rows) {
    const recomputed = headingHashForRiskFactor(row.heading);
    if (recomputed === null) {
      // A row whose heading carries no content has no identity. It is NOT
      // written with an invented key and NOT silently dropped from the
      // report — it gets its own counted category for a human to resolve.
      nullKey.push(row.id);
      continue;
    }
    if (row.currentHash === recomputed) {
      alreadyCorrect += 1;
      continue;
    }
    toWrite.push({ id: row.id, headingHash: recomputed });
  }

  return { toWrite, alreadyCorrect, nullKey };
}

export interface DedupeRow {
  id: string;
  ipoId: string;
  ipoSlug: string;
  seq: number;
  heading: string;
  headingHash: string;
  body: string | null;
  kpis: unknown;
}

export interface DedupeConflict {
  ipoId: string;
  ipoSlug: string;
  headingHash: string;
  heading: string;
  reason: string;
  rowIds: string[];
  /** One truncated preview per row, so the report shows WHAT differs, not just that it does. */
  previews: { id: string; seq: number; body: string; kpis: string }[];
}

export interface DedupePlan {
  /** Rows safe to delete: NULL-versus-present only, survivor carries the content. */
  deletes: DedupeRow[];
  /** Groups deliberately NOT resolved - reported by identity, every row left in place. */
  conflicts: DedupeConflict[];
  /** Groups that had a surplus and were safely collapsed. */
  collapsedGroups: number;
}

function canonicalKpis(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return JSON.stringify(value);
}

function preview(value: string | null, limit = 120): string {
  if (value === null) return '(null)';
  return value.length > limit ? `${value.slice(0, limit)}...` : value;
}

/** How much content a row carries. Half one of the survivor rule. */
function contentScore(row: DedupeRow): number {
  return (row.body !== null ? 1 : 0) + (row.kpis !== null && row.kpis !== undefined ? 1 : 0);
}

/**
 * Pure de-duplication decision - the whole reason this is no longer a raw SQL
 * `row_number() ... ORDER BY seq`.
 *
 * Tier A review finding (2026-09-10): ordering by `seq` alone keeps the
 * LOWEST-seq row regardless of what it holds, so a group whose seq=1 row has
 * `body=NULL, kpis=NULL` and whose seq=2 row has a real body and a real KPI
 * table deleted the row carrying the data. No such group exists on any slot
 * today, but this tool is meant to be re-runnable and the rows change nightly.
 *
 * The rule has two halves, and the second is the one an ordering alone cannot
 * express:
 *
 *   HALF ONE - the ordering. The survivor is the row with the MOST non-null
 *   content (`body` and `kpis` each count 1), tie-broken on lowest `seq`, then
 *   id. A row with a body always beats an empty one whatever its position.
 *
 *   HALF TWO - the refusal. An ordering still picks a winner when two rows
 *   BOTH carry content and the content DIFFERS. Choosing the lower `seq` there
 *   is not de-duplication, it is deciding which paragraph to delete by an
 *   arbitrary rule with no record. So when a group holds two differing non-null
 *   `body` values (or two differing non-null `kpis`), the group is ABORTED:
 *   nothing in it is deleted, and it is reported by slug, heading, row ids and
 *   a truncated preview of each row's content for a human to resolve. Other
 *   groups in the same run still process; one unresolvable group does not block
 *   the rest. The run then exits non-zero so it cannot read as a clean success.
 *
 * A third, rarer shape is aborted for the same reason: a group where `body`
 * lives on one row and `kpis` on another, so no single row can survive without
 * dropping the other's fact. Not a differing-value conflict, but equally a
 * human decision rather than a safe automatic one.
 *
 * The distinction: NULL-versus-present is a safe automatic choice;
 * present-versus-different is a human decision.
 */
export function planDedupe(rows: DedupeRow[]): DedupePlan {
  const groups = new Map<string, DedupeRow[]>();
  for (const row of rows) {
    const key = `${row.ipoId}::${row.headingHash}`;
    const bucket = groups.get(key);
    if (bucket) bucket.push(row);
    else groups.set(key, [row]);
  }

  const plan: DedupePlan = { deletes: [], conflicts: [], collapsedGroups: 0 };

  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const head = group[0];

    const bodies = new Set(group.map((r) => r.body).filter((b): b is string => b !== null));
    const kpis = new Set(
      group.map((r) => canonicalKpis(r.kpis)).filter((k): k is string => k !== null)
    );

    const abort = (reason: string): void => {
      plan.conflicts.push({
        ipoId: head.ipoId,
        ipoSlug: head.ipoSlug,
        headingHash: head.headingHash,
        heading: head.heading,
        reason,
        rowIds: group.map((r) => r.id),
        previews: group.map((r) => ({
          id: r.id,
          seq: r.seq,
          body: preview(r.body),
          kpis: preview(canonicalKpis(r.kpis)),
        })),
      });
    };

    if (bodies.size > 1 || kpis.size > 1) {
      abort(
        `rows carry differing content (${bodies.size} distinct non-null body value(s), ` +
          `${kpis.size} distinct non-null kpis value(s)) - present-versus-different is a human ` +
          `decision, not a de-duplication`
      );
      continue;
    }

    // HALF ONE: most content wins, lowest seq breaks the tie.
    const ranked = [...group].sort(
      (a, b) =>
        contentScore(b) - contentScore(a) ||
        a.seq - b.seq ||
        (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
    );
    const survivor = ranked[0];

    // The split-fields shape: the winner still does not carry everything present.
    const survivorScore = contentScore(survivor);
    const unionScore = (bodies.size === 1 ? 1 : 0) + (kpis.size === 1 ? 1 : 0);
    if (survivorScore < unionScore) {
      abort(
        'no single row carries every field present in the group (body and kpis live on ' +
          'different rows) - collapsing would drop one of them'
      );
      continue;
    }

    for (const row of group) {
      if (row.id !== survivor.id) plan.deletes.push(row);
    }
    plan.collapsedGroups += 1;
  }

  return plan;
}

/**
 * The run's exit code, as a pure decision. A dedupe run that left groups
 * unresolved MUST NOT read as a clean success - "deleted=14" with three
 * aborted groups still sitting there is a slot that E2 will refuse
 * (signal-ownership R6: a gate prints its reason before a non-zero exit).
 */
export function dedupeExitCode(plan: DedupePlan): number {
  return plan.conflicts.length > 0 ? 1 : 0;
}

async function main(): Promise<void> {
  if (!DO_BACKFILL && !DO_DEDUPE) {
    console.error('Pick a phase: --backfill or --dedupe (see this file\'s header).');
    process.exitCode = 1;
    return;
  }

  // Prod guard. `openRepairDb` prints its own refusal reason and exits the
  // process when it refuses, so reaching the next line means the slot is
  // writable under the flags given (dry runs are always allowed).
  const opened = await openRepairDb(db, {
    apply: APPLY,
    allowProd: ALLOW_PROD,
    toolName: 'repair-risk-factor-heading-hash',
  });
  console.log(`slot: ${opened.dbName}${opened.isProd ? ' (PRODUCTION)' : ''}, apply=${APPLY}`);

  const ledger: Record<string, unknown> = { apply: APPLY, at: new Date().toISOString() };

  if (DO_BACKFILL) {
    // Read and write inside ONE transaction: a row a live scraper cycle
    // inserts between the plan and the write would otherwise be missed while
    // the ledger still reported full coverage (E1 backfill, Tier A finding).
    const result = await db.transaction(async (tx) => {
      const rows = await tx
        .select({ id: ipoRiskFactors.id, heading: ipoRiskFactors.heading, currentHash: ipoRiskFactors.headingHash })
        .from(ipoRiskFactors);
      const plan = planHashRepair(rows as HashRepairRow[]);
      if (APPLY) {
        for (const row of plan.toWrite) {
          await tx.update(ipoRiskFactors).set({ headingHash: row.headingHash }).where(eq(ipoRiskFactors.id, row.id));
        }
      }
      return { scanned: rows.length, ...plan };
    });
    ledger.backfill = { scanned: result.scanned, written: result.toWrite.length, alreadyCorrect: result.alreadyCorrect, nullKey: result.nullKey };
    console.log(`backfill: scanned=${result.scanned} ${APPLY ? 'written' : 'would write'}=${result.toWrite.length} alreadyCorrect=${result.alreadyCorrect} nullKey=${result.nullKey.length}`);
  }

  if (DO_DEDUPE) {
    // Read every hashed row of every colliding group - NOT just the surplus a
    // SQL window would pick. `planDedupe` needs the whole group's content to
    // decide whether collapsing it loses anything.
    const grouped = await db.execute(sql`
      SELECT rf.id, rf.ipo_id, i.slug AS ipo_slug, rf.seq, rf.heading,
             rf.heading_hash, rf.body, rf.kpis
      FROM ipo_risk_factors rf
      JOIN ipos i ON i.id = rf.ipo_id
      WHERE rf.heading_hash <> ''
        AND (rf.ipo_id, rf.heading_hash) IN (
          SELECT ipo_id, heading_hash FROM ipo_risk_factors
          WHERE heading_hash <> ''
          GROUP BY ipo_id, heading_hash HAVING count(*) > 1
        )
      ORDER BY rf.ipo_id, rf.heading_hash, rf.seq ASC, rf.id ASC
    `);
    const rows: DedupeRow[] = ((grouped.rows ?? []) as Record<string, unknown>[]).map((r) => ({
      id: String(r.id),
      ipoId: String(r.ipo_id),
      ipoSlug: String(r.ipo_slug ?? ''),
      seq: Number(r.seq),
      heading: String(r.heading ?? ''),
      headingHash: String(r.heading_hash ?? ''),
      body: r.body === null || r.body === undefined ? null : String(r.body),
      kpis: r.kpis ?? null,
    }));

    const plan = planDedupe(rows);
    if (APPLY) {
      for (const victim of plan.deletes) {
        await db.delete(ipoRiskFactors).where(eq(ipoRiskFactors.id, victim.id));
      }
    }
    ledger.dedupe = {
      surplus: plan.deletes.length,
      collapsedGroups: plan.collapsedGroups,
      rows: plan.deletes,
      conflicts: plan.conflicts,
    };
    console.log(
      `dedupe: ${APPLY ? 'deleted' : 'would delete'}=${plan.deletes.length} surplus rows ` +
        `across ${plan.collapsedGroups} collapsed group(s); conflicted groups=${plan.conflicts.length}`
    );
    for (const victim of plan.deletes.slice(0, 20)) {
      console.log(`  delete ipo=${victim.ipoSlug} seq=${victim.seq} "${victim.heading.slice(0, 60)}"`);
    }
    for (const conflict of plan.conflicts) {
      console.log(
        `  CONFLICT ipo=${conflict.ipoSlug} (${conflict.ipoId}) hash=${conflict.headingHash} ` +
          `heading="${conflict.heading.slice(0, 80)}" - ${conflict.reason}`
      );
      for (const row of conflict.previews) {
        console.log(`      row ${row.id} seq=${row.seq} body=${row.body} kpis=${row.kpis}`);
      }
    }
    const exitCode = dedupeExitCode(plan);
    if (exitCode !== 0) {
      console.error(
        `dedupe: ${plan.conflicts.length} group(s) left UNRESOLVED because collapsing them would ` +
          `lose content (listed above with their row ids and a preview of each row). The slot is ` +
          `NOT clean and the gated file E2 will still fail its ADD CONSTRAINT until a human ` +
          `resolves them.`
      );
      process.exitCode = exitCode;
    }
  }

  console.log(`ledger: ${writeLedgerFile(`logs/repair-risk-factor-heading-hash-${Date.now()}.json`, ledger)}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().then(() => process.exit(process.exitCode ?? 0));
}
