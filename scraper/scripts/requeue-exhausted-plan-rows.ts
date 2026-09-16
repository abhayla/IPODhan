/**
 * Re-queue `ipo_field_plan` rows wrongly retired EXHAUSTED by RCA2 (review
 * round 2, staging wake 619660c3) — the DOC fetcher answered NOT_PRINTED on
 * mere ABSENCE of a `field_sources` provenance row, which is an extractor
 * gap (item 13, a general DOC -> field_sources backfill, is not built), not
 * evidence the document does not print the field. field-plan-walk-doc-fetcher.ts
 * now answers CHECK_FAILED transient in that case (never NOT_PRINTED), but
 * the 13 rows the first real staging walk retired under the BUGGY code are
 * still sitting in `state = 'EXHAUSTED'` (terminal, `next_due_at = NULL`,
 * nothing reopens them on its own).
 *
 *     npx tsx scripts/requeue-exhausted-plan-rows.ts --expect-db <name> [--apply]
 *
 * SCOPE IS COMPUTED, NEVER TYPED (defect-fix-contract.md item 4). The class
 * this tool resets is `state = 'EXHAUSTED' AND chosen_source IS NULL AND
 * attempts <= 1`:
 *   - `chosen_source IS NULL` -- a row that reached EXHAUSTED with no source
 *     ever having claimed it. The RCA2 bug produced exactly this shape: every
 *     rank answered a "no" (DOC's buggy NOT_PRINTED, or BSE/CHITTORGARH not
 *     carrying the field), never a SUPPLIED that got overwritten -- so a row
 *     retired by three REAL, DEFINITIVE "no" answers is DIFFERENT from this
 *     class only by `chosen_source` also being null in both cases; the
 *     `attempts <= 1` bound is what separates them (see next point).
 *   - `attempts <= 1` -- the buggy DOC fetcher answered NOT_PRINTED on the
 *     FIRST attempt (no retry loop involved; NOT_PRINTED is definitive, so
 *     F1's transient-retry backoff never fired for it). A row that genuinely
 *     exhausted every source across several real attempts has `attempts`
 *     accumulated from CHECK_FAILED backoff cycles before finally landing on
 *     three definitive "no"s -- that is a real exhaustion, left untouched.
 * This is a NECESSARY, not sufficient, filter for "retired by the absence
 * bug" -- it is also, DELIBERATELY, wider than "must be one of the 13 named
 * rows": any OTHER row anywhere on this database that fell into the exact
 * same shape (EXHAUSTED, no chosen source, one attempt) is the SAME class,
 * and leaving it EXHAUSTED because it was not on a hand-typed list would be
 * exactly the "instance, not the class" mistake this repo's lessons warn
 * against. Every row this tool touches is printed by IPO slug + field, never
 * a bare count (signal-ownership R1).
 *
 * Reset: `state -> 'PENDING'`, `next_due_at -> now()`, `attempts` UNTOUCHED
 * (the row's own attempt history is real and stays), `chosen_*` columns stay
 * null (they already are, by the filter). Dry run by default; `--apply`
 * writes, refused against production unless `--allow-prod` is also given
 * (`lib/repair-tool.ts`). `--expect-db <name>` is MANDATORY.
 */
// Item 1 slice s14 -- FIRST import on purpose (see lib/repair-tool.ts).
import '../../scripts/lib/alias-preflight-auto.mjs';
import { db } from '@ipodhan/shared';
import * as schema from '@ipodhan/shared/db/schema';
import { and, eq, inArray, sql } from 'drizzle-orm';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  openRepairDb,
  queryCurrentDatabase,
  writeLedgerFile,
  type ExecuteLike,
} from './lib/repair-tool';
import { mapManifestSourceToScraperSource } from '../src/services/field-plan-walk.js';
import { columnToCamelCase } from '@ipodhan/shared/utils/duplicate-ipo-merge';

/** The state a row retired by the RCA2 absence bug sits in, and the one it is reset to. */
export const RETIRED_STATE = 'EXHAUSTED';
export const REQUEUED_STATE = 'PENDING';

/** The class filter, as a pure predicate — unit-tested without a database. */
export interface ExhaustedPlanRow {
  id: string;
  ipoId: string;
  ipoSlug: string | null;
  ipoName: string | null;
  tableName: string;
  rowKey: string;
  fieldName: string;
  state: string;
  chosenSource: string | null;
  attempts: number;
}

export interface RequeueDecision {
  row: ExhaustedPlanRow;
  requeue: boolean;
  reason: string;
}

/**
 * Pure on purpose (defect-fix-contract.md item 3): the unit test drives real
 * row shapes through this without a database, so deleting or loosening the
 * filter turns a named test red instead of silently widening what the tool
 * resets.
 */
export function decideRequeue(row: ExhaustedPlanRow): RequeueDecision {
  if (row.state !== RETIRED_STATE) {
    return { row, requeue: false, reason: `state is ${row.state}, not ${RETIRED_STATE}` };
  }
  if (row.chosenSource !== null) {
    // A row EXHAUSTED with a chosen_source recorded was retired AFTER a real
    // provisional/earlier write — a different history than the absence-bug
    // class, which never had any rank answer SUPPLIED. Left alone.
    return { row, requeue: false, reason: 'chosen_source is set — not the absence-bug shape' };
  }
  if (row.attempts > 1) {
    // More than one attempt means the row went through at least one
    // CHECK_FAILED backoff cycle before landing on EXHAUSTED — a real
    // multi-attempt exhaustion, not the buggy DOC fetcher's first-attempt
    // definitive "no". Left alone.
    return { row, requeue: false, reason: `attempts is ${row.attempts} (>1) — a real multi-attempt exhaustion` };
  }
  return { row, requeue: true, reason: 'EXHAUSTED, no chosen_source, attempts <= 1 — the RCA2 absence-bug shape' };
}

/** One printable identity line per row — never a bare count (signal-ownership R1). */
export function formatDecision(d: RequeueDecision): string {
  const row = d.row;
  const who = row.ipoSlug ?? row.ipoName ?? row.ipoId;
  const mark = d.requeue ? 'REQUEUE' : 'HOLD   ';
  return `${mark} ${who} :: ${row.tableName}.${row.fieldName}${row.rowKey ? `[${row.rowKey}]` : ''} (attempts=${row.attempts}) — ${d.reason}`;
}

/**
 * Review round 5, item B: SUPPLIED rows whose plan `chosen_source` disagrees
 * with the `field_sources` provenance row the consolidator actually wrote —
 * the class review round 5's item A fix (field-plan-walk.ts's
 * `checkConsolidatorAgreed`) now prevents going forward, but does not
 * retroactively fix rows the PRE-fix walk already recorded SUPPLIED.
 */
export interface SuppliedPlanRow {
  id: string;
  ipoId: string;
  ipoSlug: string | null;
  ipoName: string | null;
  tableName: string;
  rowKey: string;
  fieldName: string;
  /** The manifest word the plan row recorded ('DOC' | 'BSE' | 'CHITTORGARH' | ...). */
  chosenSource: string;
  /** `field_sources.source` for this exact (ipoId, tableName, rowKey, fieldName) — the enum value, or null if no provenance row exists at all. */
  provenanceSource: string | null;
}

export interface FalseSuppliedDecision {
  row: SuppliedPlanRow;
  requeue: boolean;
  reason: string;
}

/**
 * Pure predicate (defect-fix-contract.md item 3). Uses the SAME
 * manifest<->enum mapping the walk's own agreement check uses
 * (`mapManifestSourceToScraperSource` from field-plan-walk.ts) — DOC<->DRHP
 * is agreement, never flagged as a mismatch.
 */
export function decideFalseSupplied(row: SuppliedPlanRow): FalseSuppliedDecision {
  if (row.provenanceSource === null) {
    // Nothing to compare against — a missing provenance row is a SEPARATE
    // class (review round 2, RCA2's extractor-gap fix), never guessed at
    // here as a mismatch.
    return { row, requeue: false, reason: 'no provenance row found for this field — cannot compare, not flagged' };
  }
  const wantedSource = mapManifestSourceToScraperSource(row.chosenSource);
  if (wantedSource !== row.provenanceSource) {
    return {
      row,
      requeue: true,
      reason: `chosen_source ${row.chosenSource} (${wantedSource}) disagrees with field_sources.source ${row.provenanceSource}`,
    };
  }
  return { row, requeue: false, reason: `chosen_source ${row.chosenSource} agrees with field_sources.source ${row.provenanceSource}` };
}

/** One printable identity line per row — never a bare count (signal-ownership R1). */
export function formatFalseSuppliedDecision(d: FalseSuppliedDecision): string {
  const row = d.row;
  const who = row.ipoSlug ?? row.ipoName ?? row.ipoId;
  const mark = d.requeue ? 'REQUEUE' : 'HOLD   ';
  return `${mark} ${who} :: ${row.tableName}.${row.fieldName}${row.rowKey ? `[${row.rowKey}]` : ''} (chosen=${row.chosenSource}, provenance=${row.provenanceSource ?? 'none'}) — ${d.reason}`;
}

interface Cli {
  apply: boolean;
  allowProd: boolean;
  expectDb: string | null;
  falseSupplied: boolean;
}

export function parseArgs(argv: readonly string[]): Cli {
  const at = argv.indexOf('--expect-db');
  return {
    apply: argv.includes('--apply'),
    allowProd: argv.includes('--allow-prod'),
    expectDb: at >= 0 && argv[at + 1] && !argv[at + 1].startsWith('--') ? argv[at + 1] : null,
    falseSupplied: argv.includes('--false-supplied'),
  };
}

const TOOL = 'requeue-exhausted-plan-rows';

/** `scraper/scripts/` -> `scraper/`, so the ledger path is correct regardless
 *  of whether this tool is invoked with cwd=repo-root or cwd=scraper/ (both
 *  are valid per the anchor tool's own header convention). */
const SCRAPER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Review round 5, item B: `--false-supplied` mode. Reads every SUPPLIED plan
 * row alongside its `field_sources` provenance row (LEFT JOIN — a missing
 * provenance row is its own "cannot compare" answer, never guessed at) and
 * flags exactly the class review round 5's item A fix now prevents going
 * forward: `chosen_source` disagreeing with what the consolidator actually
 * wrote provenance for.
 */
async function runFalseSupplied(cli: Cli, actual: string): Promise<void> {
  // Two-step, never a single SQL join on field_name: `ipo_field_plan.field_name`
  // is the manifest's raw SNAKE_CASE key (`issue_size`); `field_sources.field_name`
  // is CAMELCASE (`issueSize`) — the SAME mismatch documented across this repo's
  // walk code (columnToCamelCase's own doc comment). A JOIN on the raw columns
  // silently matches ZERO rows (found while building this tool: the first run
  // showed `provenance=none` for every row, including known BSE-vs-CHITTORGARH
  // cases) rather than erroring, so it is caught here in code, not left to a
  // reviewer to notice a suspiciously-empty result.
  const planRows = await (db as any)
    .select({
      id: schema.ipoFieldPlan.id,
      ipoId: schema.ipoFieldPlan.ipoId,
      ipoSlug: schema.ipos.slug,
      ipoName: schema.ipos.companyName,
      tableName: schema.ipoFieldPlan.tableName,
      rowKey: schema.ipoFieldPlan.rowKey,
      fieldName: schema.ipoFieldPlan.fieldName,
      chosenSource: schema.ipoFieldPlan.chosenSource,
    })
    .from(schema.ipoFieldPlan)
    .leftJoin(schema.ipos, eq(schema.ipos.id, schema.ipoFieldPlan.ipoId))
    .where(eq(schema.ipoFieldPlan.state, 'SUPPLIED' as any));

  const rows: SuppliedPlanRow[] = [];
  for (const p of planRows) {
    const camelFieldName = columnToCamelCase(p.fieldName);
    const [provenance] = await (db as any)
      .select({ source: schema.fieldSources.source })
      .from(schema.fieldSources)
      .where(
        and(
          eq(schema.fieldSources.ipoId, p.ipoId),
          eq(schema.fieldSources.tableName, p.tableName),
          eq(schema.fieldSources.rowKey, p.rowKey),
          eq(schema.fieldSources.fieldName, camelFieldName)
        )
      );
    rows.push({ ...p, provenanceSource: provenance?.source ?? null });
  }

  const decisions = rows.map(decideFalseSupplied);
  for (const d of decisions) console.log(formatFalseSuppliedDecision(d));

  const requeue = decisions.filter((d) => d.requeue);
  const held = decisions.filter((d) => !d.requeue);
  console.log(
    `\n${TOOL} --false-supplied: ${requeue.length} to re-queue, ${held.length} held, of ${decisions.length} SUPPLIED plan rows in "${actual}".`
  );

  const ledger = {
    tool: `${TOOL}--false-supplied`,
    database: actual,
    apply: cli.apply,
    at: new Date().toISOString(),
    requeued: requeue.map((d) => ({
      planRowId: d.row.id,
      ipoId: d.row.ipoId,
      ipoSlug: d.row.ipoSlug,
      ipoName: d.row.ipoName,
      tableName: d.row.tableName,
      rowKey: d.row.rowKey,
      fieldName: d.row.fieldName,
      chosenSource: d.row.chosenSource,
      provenanceSource: d.row.provenanceSource,
      matchedClass: d.reason,
    })),
    held: held.map((d) => ({
      planRowId: d.row.id,
      ipoSlug: d.row.ipoSlug,
      tableName: d.row.tableName,
      fieldName: d.row.fieldName,
      reason: d.reason,
    })),
  };
  const ledgerPath = writeLedgerFile(
    path.join(SCRAPER_ROOT, 'evidence', `${TOOL}-false-supplied-${cli.apply ? 'applied' : 'dryrun'}-${Date.now()}.json`),
    ledger
  );
  console.log(`${TOOL} --false-supplied: ledger written to ${ledgerPath}`);

  if (!cli.apply) {
    console.log(`${TOOL} --false-supplied: DRY RUN — nothing was written. Re-run with --apply to reset the ${requeue.length} listed above.`);
    return;
  }
  if (requeue.length === 0) {
    console.log(`${TOOL} --false-supplied: nothing to re-queue.`);
    return;
  }

  // next_due_at -> now(); state -> PENDING. attempts, chosen_source and every
  // other chosen_* column are DELIBERATELY left as-is here: they are the
  // audit trail of what the walk wrongly recorded, and the row is about to
  // be re-walked, which will overwrite chosen_source on its own next SUPPLIED
  // (or leave it stale-but-harmless if the next attempt lands CHECK_FAILED).
  await (db as any)
    .update(schema.ipoFieldPlan)
    .set({ state: REQUEUED_STATE, nextDueAt: sql`now()`, updatedAt: sql`now()` })
    .where(inArray(schema.ipoFieldPlan.id, requeue.map((d) => d.row.id)));

  console.log(`${TOOL} --false-supplied: reset ${requeue.length} plan rows to ${REQUEUED_STATE}:`);
  for (const d of requeue) {
    console.log(`  ${d.row.ipoSlug ?? d.row.ipoId} :: ${d.row.tableName}.${d.row.fieldName}`);
  }
}

async function main(): Promise<void> {
  const cli = parseArgs(process.argv.slice(2));
  if (!cli.expectDb) {
    console.error(
      `${TOOL}: --expect-db <name> is required on every run (dry or applied); refusing to guess the target database.`
    );
    process.exit(1);
  }

  try {
    const actual = await queryCurrentDatabase(db as ExecuteLike);
    if (actual.toLowerCase() !== cli.expectDb.toLowerCase()) {
      console.error(
        `${TOOL}: --expect-db said "${cli.expectDb}" but this pool is connected to "${actual}" — refusing before any read or write.`
      );
      process.exit(1);
    }

    await openRepairDb(db as ExecuteLike, {
      apply: cli.apply,
      allowProd: cli.allowProd,
      toolName: TOOL,
    });

    if (cli.falseSupplied) {
      await runFalseSupplied(cli, actual);
      return;
    }

    const rows = await (db as any)
      .select({
        id: schema.ipoFieldPlan.id,
        ipoId: schema.ipoFieldPlan.ipoId,
        ipoSlug: schema.ipos.slug,
        ipoName: schema.ipos.companyName,
        tableName: schema.ipoFieldPlan.tableName,
        rowKey: schema.ipoFieldPlan.rowKey,
        fieldName: schema.ipoFieldPlan.fieldName,
        state: schema.ipoFieldPlan.state,
        chosenSource: schema.ipoFieldPlan.chosenSource,
        attempts: schema.ipoFieldPlan.attempts,
      })
      .from(schema.ipoFieldPlan)
      .leftJoin(schema.ipos, eq(schema.ipos.id, schema.ipoFieldPlan.ipoId))
      .where(eq(schema.ipoFieldPlan.state, RETIRED_STATE as any));

    const decisions = (rows as ExhaustedPlanRow[]).map(decideRequeue);
    for (const d of decisions) console.log(formatDecision(d));

    const requeue = decisions.filter((d) => d.requeue);
    const held = decisions.filter((d) => !d.requeue);
    console.log(
      `\n${TOOL}: ${requeue.length} to re-queue, ${held.length} held, of ${decisions.length} ${RETIRED_STATE} plan rows in "${actual}".`
    );

    const ledger = {
      tool: TOOL,
      database: actual,
      apply: cli.apply,
      at: new Date().toISOString(),
      // The BACKUP: each row's prior state, so an applied run can be
      // reversed from this file alone.
      requeued: requeue.map((d) => ({
        planRowId: d.row.id,
        ipoId: d.row.ipoId,
        ipoSlug: d.row.ipoSlug,
        ipoName: d.row.ipoName,
        tableName: d.row.tableName,
        rowKey: d.row.rowKey,
        fieldName: d.row.fieldName,
        previousState: d.row.state,
        attempts: d.row.attempts,
        matchedClass: d.reason,
      })),
      held: held.map((d) => ({
        planRowId: d.row.id,
        ipoSlug: d.row.ipoSlug,
        tableName: d.row.tableName,
        fieldName: d.row.fieldName,
        reason: d.reason,
      })),
    };
    const ledgerPath = writeLedgerFile(
      path.join(SCRAPER_ROOT, 'evidence', `${TOOL}-${cli.apply ? 'applied' : 'dryrun'}-${Date.now()}.json`),
      ledger
    );
    console.log(`${TOOL}: ledger written to ${ledgerPath}`);

    if (!cli.apply) {
      console.log(`${TOOL}: DRY RUN — nothing was written. Re-run with --apply to reset the ${requeue.length} listed above.`);
      return;
    }
    if (requeue.length === 0) {
      console.log(`${TOOL}: nothing to re-queue.`);
      return;
    }

    // attempts is deliberately NOT touched — see the header. chosen_* columns
    // are already null for every row this filter selects.
    await (db as any)
      .update(schema.ipoFieldPlan)
      .set({ state: REQUEUED_STATE, nextDueAt: sql`now()`, updatedAt: sql`now()` })
      .where(inArray(schema.ipoFieldPlan.id, requeue.map((d) => d.row.id)));

    console.log(`${TOOL}: reset ${requeue.length} plan rows to ${REQUEUED_STATE}:`);
    for (const d of requeue) {
      console.log(`  ${d.row.ipoSlug ?? d.row.ipoId} :: ${d.row.tableName}.${d.row.fieldName}`);
    }
  } finally {
    // The shared pool is process-wide; a repair tool that closed it would
    // break any caller importing this module for its pure parts.
  }
}

// Only run when invoked directly, so the unit test can import the pure parts.
const isMain = import.meta.url === pathToFileURL(process.argv[1] ?? '').href;
if (isMain) {
  main().catch((e) => {
    console.error(`${TOOL}: ${e?.message ?? e}`);
    process.exit(1);
  });
}
