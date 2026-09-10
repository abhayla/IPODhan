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
 *   --dedupe    deletes surplus rows that share `(ipo_id, heading_hash)`.
 *               LOWEST `seq` survives, so the row that appeared earliest in
 *               the document is the one kept and display order is stable.
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
 */
import { db } from '@ipodhan/shared';
import { ipoRiskFactors } from '@ipodhan/shared/db/schema';
import { headingHashForRiskFactor } from '@ipodhan/shared/utils/risk-factor-heading-key';
import { eq, sql } from 'drizzle-orm';
import { pathToFileURL } from 'node:url';
import { openRepairDb, writeLedgerFile } from './lib/repair-tool.js';

const APPLY = process.argv.includes('--apply');
const ALLOW_PROD = process.argv.includes('--allow-prod');
const DO_BACKFILL = process.argv.includes('--backfill');
const DO_DEDUPE = process.argv.includes('--dedupe');

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
    // Surplus = every row of a (ipo_id, heading_hash) group except the lowest
    // seq. Selected by the DB so the choice cannot drift from the constraint
    // the gated file is about to add.
    const surplus = await db.execute(sql`
      SELECT id, ipo_id, seq, heading FROM (
        SELECT id, ipo_id, seq, heading,
               row_number() OVER (PARTITION BY ipo_id, heading_hash ORDER BY seq ASC, id ASC) AS rn
        FROM ipo_risk_factors WHERE heading_hash <> ''
      ) ranked WHERE rn > 1
    `);
    const victims = (surplus.rows ?? []) as { id: string; ipo_id: string; seq: number; heading: string }[];
    if (APPLY) {
      for (const victim of victims) {
        await db.delete(ipoRiskFactors).where(eq(ipoRiskFactors.id, victim.id));
      }
    }
    ledger.dedupe = { surplus: victims.length, rows: victims };
    console.log(`dedupe: ${APPLY ? 'deleted' : 'would delete'}=${victims.length} surplus rows`);
    for (const victim of victims.slice(0, 20)) {
      console.log(`  ipo=${victim.ipo_id} seq=${victim.seq} "${victim.heading.slice(0, 60)}"`);
    }
  }

  console.log(`ledger: ${writeLedgerFile(`logs/repair-risk-factor-heading-hash-${Date.now()}.json`, ledger)}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().then(() => process.exit(process.exitCode ?? 0));
}
