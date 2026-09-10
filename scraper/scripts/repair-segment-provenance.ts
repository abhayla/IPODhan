/**
 * Repair: `ipos.segment` provenance for rows a binary test wrote with no
 * record of who said it (lane C item 2, slice 3b).
 *
 * RCA: `ipos.segment` was written by a binary test where "not detected as
 * SME" was *asserted* as MAINBOARD. The write paths were fixed in
 * `2fd8a43b` (merged) — this tool repairs the rows already written before
 * that fix landed.
 *
 * Class: every `ipos` row carrying a non-NULL `segment` with NO
 * `field_sources` row for `segment` — a value with no record of who said
 * it. Measured on production (2026-09-10): 41 rows, all `segment=
 * 'MAINBOARD'`, offering_type IPO 11 / OFS 18 / TENDER 5 / NCD 3 / RIGHTS 3
 * / BUYBACK 1, all CLOSED/LISTED (none live).
 *
 * The two populations, and the honest split (per `schema.ts:278` —
 * "segment ... nullable for RIGHTS/InvITs/REITs" — segment is an IPO-board
 * concept):
 *   1. Non-IPO rows (any offering_type other than 'IPO'): `segment` is
 *      cleared to NULL. No external source is needed — a buyback/OFS/
 *      tender/NCD/rights issue has no IPO board by definition. A
 *      `field_sources` row records the reason.
 *   2. IPO rows: a real, manually-verified source is attempted via
 *      `VERIFIED_IPO_SEGMENT_SOURCES` below (populated per-slug once an
 *      operator has checked NSE/BSE for that specific company — the
 *      `listing_exchanges` field cannot answer this: it names the EXCHANGE
 *      (BSE/NSE), not the BOARD, and BSE runs both a mainboard and BSE SME).
 *      Empty by default. Whatever is not in that map STAYS NULL with the
 *      reason recorded — "no source states it" is a SUCCESSFUL outcome,
 *      never an inferred guess.
 *
 * `offering_type` is re-checked PER ROW from the live query, never trusted
 * from an aggregate count — it is itself a stored (and occasionally wrong)
 * field.
 *
 * dry-run by default; --apply writes (refused against production unless
 * --allow-prod is also given — see scripts/lib/repair-tool.ts). ONE
 * transaction for the whole batch; a field_sources row for every changed
 * value; read-back after write; a per-row decision line even in dry run.
 *
 * Run from scraper/ with tunnel env exported (DATABASE_HOST=127.0.0.1
 * DATABASE_PORT=15432 DATABASE_USER=ipodhan_app DATABASE_PASSWORD=...
 * DATABASE_NAME=ipodhan_staging):
 *   npx tsx scripts/repair-segment-provenance.ts          # dry-run
 *   npx tsx scripts/repair-segment-provenance.ts --apply --allow-prod
 */
import { db } from '@ipodhan/shared';
import * as schema from '@ipodhan/shared/db/schema';
import { and, eq, isNotNull } from 'drizzle-orm';
import { pathToFileURL } from 'node:url';
import logger from '../src/utils/logger.js';
import { openRepairDb, upsertFieldSource, writeLedgerFile } from './lib/repair-tool.js';

const APPLY = process.argv.includes('--apply');
const ALLOW_PROD = process.argv.includes('--allow-prod');
const UPDATED_BY = 'SYSTEM_LANEC_ITEM02_S3B_REPAIR';

export type SegmentValue = 'MAINBOARD' | 'SME' | null;

/**
 * Manually-verified per-slug segment sources for IPO rows, checked against
 * NSE/BSE by an operator (never inferred from `listing_exchanges`, lot
 * economics, or a scraper default). Empty by default — populate a slug here
 * ONLY after independently confirming the board with a real source; every
 * IPO row not listed here stays NULL with `no-source-no-guess` recorded.
 */
export const VERIFIED_IPO_SEGMENT_SOURCES: Record<string, SegmentValue> = {};

export interface SegmentProvenanceRow {
  id: string;
  companyName: string;
  offeringType: string;
  segment: SegmentValue;
  hasSegmentProvenance: boolean;
  /** Only meaningful for offeringType === 'IPO'; a manually-verified value. */
  sourcedSegment?: SegmentValue;
}

export type SegmentRepairAction =
  | 'skip-already-null'
  | 'skip-has-provenance'
  | 'clear-non-ipo'
  | 'apply-sourced'
  | 'no-source-no-guess';

export interface SegmentRepairDecision {
  action: SegmentRepairAction;
  /** Whether this row needs a write (segment change + provenance row). */
  touch: boolean;
  newSegment: SegmentValue;
  reason: string;
}

/**
 * Pure per-row decision — no DB, unit-testable in isolation. Order matters:
 * a row already NULL or already provenanced is left alone before the
 * offering_type / sourcing question is even asked.
 */
export function decideSegmentProvenance(row: SegmentProvenanceRow): SegmentRepairDecision {
  if (row.segment === null) {
    return {
      action: 'skip-already-null',
      touch: false,
      newSegment: null,
      reason: 'segment is already NULL — nothing to repair',
    };
  }
  if (row.hasSegmentProvenance) {
    return {
      action: 'skip-has-provenance',
      touch: false,
      newSegment: row.segment,
      reason: 'field_sources already records who set segment — not touched',
    };
  }
  if (row.offeringType !== 'IPO') {
    return {
      action: 'clear-non-ipo',
      touch: true,
      newSegment: null,
      reason:
        `offering_type=${row.offeringType.toLowerCase()} is not an IPO-board concept ` +
        `(schema.ts: segment nullable for RIGHTS/InvITs/REITs) — cleared to NULL, provenance recorded`,
    };
  }
  if (row.sourcedSegment) {
    return {
      action: 'apply-sourced',
      touch: true,
      newSegment: row.sourcedSegment,
      reason: `sourced value confirms segment=${row.sourcedSegment} (VERIFIED_IPO_SEGMENT_SOURCES)`,
    };
  }
  return {
    action: 'no-source-no-guess',
    touch: true,
    newSegment: null,
    reason:
      'no source states this IPO row\'s segment (no field_sources provenance, no verified entry in ' +
      'VERIFIED_IPO_SEGMENT_SOURCES) — cleared to NULL rather than guessed; NULL is a successful outcome here, not a failure',
  };
}

async function main() {
  console.log('='.repeat(80));
  console.log(`SEGMENT PROVENANCE REPAIR (lane C item 2 slice 3b) — ${APPLY ? 'APPLY' : 'DRY-RUN'}`);
  console.log('='.repeat(80));

  await openRepairDb(db, {
    apply: APPLY,
    allowProd: ALLOW_PROD,
    toolName: 'repair-segment-provenance',
  });

  const candidates = await db
    .select({
      id: schema.ipos.id,
      companyName: schema.ipos.companyName,
      slug: schema.ipos.slug,
      offeringType: schema.ipos.offeringType,
      segment: schema.ipos.segment,
      status: schema.ipos.status,
    })
    .from(schema.ipos)
    .where(isNotNull(schema.ipos.segment));

  const provenanced = await db
    .select({ ipoId: schema.fieldSources.ipoId })
    .from(schema.fieldSources)
    .where(and(eq(schema.fieldSources.tableName, 'ipos'), eq(schema.fieldSources.fieldName, 'segment')));
  const provenancedIds = new Set(provenanced.map((r) => r.ipoId));

  console.log(`ipos rows with segment IS NOT NULL: ${candidates.length}`);
  console.log(`of those, already carrying a field_sources row for segment: ${provenancedIds.size}`);

  const decisions: Array<{ row: (typeof candidates)[number]; decision: SegmentRepairDecision }> = [];
  for (const row of candidates) {
    const hasSegmentProvenance = provenancedIds.has(row.id);
    const sourcedSegment = row.offeringType === 'IPO' ? VERIFIED_IPO_SEGMENT_SOURCES[row.slug] : undefined;
    const decision = decideSegmentProvenance({
      id: row.id,
      companyName: row.companyName,
      offeringType: row.offeringType,
      segment: row.segment,
      hasSegmentProvenance,
      sourcedSegment,
    });
    decisions.push({ row, decision });
    console.log(
      `  - ${row.companyName} [${row.offeringType}, ${row.status}] segment=${row.segment} -> ` +
        `${decision.newSegment ?? 'NULL'} (${decision.action}): ${decision.reason}`
    );
  }

  const toTouch = decisions.filter((d) => d.decision.touch);
  const byAction = toTouch.reduce<Record<string, number>>((acc, d) => {
    acc[d.decision.action] = (acc[d.decision.action] ?? 0) + 1;
    return acc;
  }, {});

  console.log(`\nrows to write: ${toTouch.length} of ${candidates.length} candidates`);
  console.log(`by action: ${JSON.stringify(byAction)}`);
  console.log(
    `rows left NULL-unsourced (no-source-no-guess): ${decisions.filter((d) => d.decision.action === 'no-source-no-guess').length}`
  );

  if (!APPLY) {
    console.log(`\nDRY-RUN: ${toTouch.length} rows WOULD be written. Re-run with --apply (and --allow-prod against production).`);
    console.log('='.repeat(80));
    process.exit(0);
  }

  if (toTouch.length === 0) {
    console.log('\nNothing to write.');
    console.log('='.repeat(80));
    process.exit(0);
  }

  const backupPath = `evidence/${new Date().toISOString().slice(0, 10)}-lane-c-item-02-s3b/before.json`;
  writeLedgerFile(backupPath, { capturedAt: new Date().toISOString(), rows: toTouch.map((d) => d.row) });
  console.log(`backup written: ${backupPath}`);

  await db.transaction(async (tx) => {
    for (const { row, decision } of toTouch) {
      await upsertFieldSource(tx as any, {
        ipoId: row.id,
        fieldName: 'segment',
        source: 'ADMIN',
        confidence: 100,
        previousValue: row.segment,
        dataLineage: {
          reason: decision.reason,
          action: decision.action,
          repairedBy: UPDATED_BY,
          repairedAt: new Date().toISOString(),
        },
        updatedBy: UPDATED_BY,
      });
      await tx
        .update(schema.ipos)
        .set({ segment: decision.newSegment as any })
        .where(eq(schema.ipos.id, row.id));
    }
  });

  // read back the full changed set individually (avoids building an OR chain for a variable-length id list)
  const readBack = [];
  for (const { row } of toTouch) {
    const [r] = await db
      .select({ id: schema.ipos.id, companyName: schema.ipos.companyName, segment: schema.ipos.segment })
      .from(schema.ipos)
      .where(eq(schema.ipos.id, row.id))
      .limit(1);
    readBack.push(r);
  }
  console.log('\nread-back after write:');
  console.log(JSON.stringify(readBack, null, 1));

  const ledgerPath = `evidence/${new Date().toISOString().slice(0, 10)}-lane-c-item-02-s3b/applied.json`;
  writeLedgerFile(ledgerPath, {
    appliedAt: new Date().toISOString(),
    written: toTouch.length,
    decisions: toTouch.map((d) => ({ id: d.row.id, companyName: d.row.companyName, action: d.decision.action, newSegment: d.decision.newSegment })),
  });
  console.log(`ledger written: ${ledgerPath}`);

  console.log('\nAPPLY complete.');
  console.log('='.repeat(80));
  process.exit(0);
}

const isMain = import.meta.url === pathToFileURL(process.argv[1] ?? '').href;
if (isMain) {
  main().catch((e) => {
    logger.error({ error: e instanceof Error ? e.message : String(e) }, 'repair-segment-provenance crashed');
    console.error(e);
    process.exit(1);
  });
}
