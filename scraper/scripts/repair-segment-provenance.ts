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
 *   1. Non-IPO rows (any offering_type other than 'IPO'): `segment` IS
 *      MEANINGLESS, not merely unsourced — a buyback/OFS/tender/NCD/rights
 *      issue has no IPO board by definition. These are the ONLY rows this
 *      tool writes: cleared to NULL, with a `field_sources` row recording
 *      the reason.
 *   2. IPO rows: a real, manually-verified source is attempted via
 *      `VERIFIED_IPO_SEGMENT_SOURCES` below (populated per-slug once an
 *      operator has checked NSE/BSE for that specific company — the
 *      `listing_exchanges` field cannot answer this: it names the EXCHANGE
 *      (BSE/NSE), not the BOARD, and BSE runs both a mainboard and BSE SME).
 *      Empty by default. An IPO row NOT in that map is left COMPLETELY
 *      UNTOUCHED and only REPORTED (`report-unprovenanced-ipo`) — a
 *      sourced value and a guessed value are NOT indistinguishable, because
 *      the database already distinguishes them: a sourced value has a
 *      `field_sources` row, a guessed one does not, and that is exactly the
 *      query this tool runs. Clearing these labels to NULL would destroy
 *      probably-correct information (measured on staging: 33 of 62
 *      candidates are genuine IPO rows) to express something the missing
 *      provenance row already expresses. The gap left open by "we don't
 *      have a source for this label" is closed by the `d_segment_provenance`
 *      nightly detection check below, never by erasing the label.
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
 *
 * `--blank-unsourced` (decision 4 / delta-2 ruling 32, 2026-09-16): for a
 * row this tool already classifies `report-unprovenanced-ipo` — an IPO row
 * with NO field_sources provenance AND no source in either exchange master —
 * set `segment` to NULL instead of leaving the guessed value in place. This
 * is a DIFFERENT population than slice 3b's default mode: default mode
 * treats "sourced vs not" as already expressed by the missing provenance row
 * and leaves the label untouched; `--blank-unsourced` is for the subset of
 * those rows the owner has separately confirmed can NEVER be sourced (never
 * listed, so absent from both exchange masters permanently) — see ruling 32.
 * Writes NO field_sources row for the blanked field: the ABSENCE is what
 * `d_segment_provenance` detects, and a reason row would defeat that (lane
 * C's board ruling, O-16 / #658: "delete-only", never a placeholder marker).
 * A row whose oracle outcome is `unresolved-group` (BSE group X/TS) is
 * REFUSED, not blanked — the group's meaning is unresolved, not the
 * company's sourceability; printed separately from the blanked set.
 */
import { db } from '@ipodhan/shared';
import * as schema from '@ipodhan/shared/db/schema';
import { and, eq, isNotNull } from 'drizzle-orm';
import { pathToFileURL } from 'node:url';
import logger from '../src/utils/logger.js';
import { assertNoSchemaDrift, openRepairDb, upsertFieldSource, writeLedgerFile } from './lib/repair-tool.js';
import { fetchNseEquityMasters } from '../src/scrapers/nse-equity-master.js';
import { resolveSegmentFromMasters, type SegmentResolution } from '../src/scrapers/exchange-segment-oracle.js';
import { fetchBseScripMaster, toOracleScrips } from '../src/scrapers/bse-scrip-master.js';

const APPLY = process.argv.includes('--apply');
const ALLOW_PROD = process.argv.includes('--allow-prod');
const BLANK_UNSOURCED = process.argv.includes('--blank-unsourced');
const UPDATED_BY = 'SYSTEM_LANEC_ITEM02_S3B_REPAIR';
const BLANK_UPDATED_BY = 'SYSTEM_DECISION4_BLANK_UNSOURCED';

export type SegmentValue = 'MAINBOARD' | 'SME' | null;

/**
 * Manually-verified per-slug segment sources for IPO rows, checked against
 * NSE/BSE by an operator (never inferred from `listing_exchanges`, lot
 * economics, or a scraper default). Empty by default — populate a slug here
 * ONLY after independently confirming the board with a real source; every
 * IPO row not listed here is left untouched and REPORTED
 * (`report-unprovenanced-ipo`) — never cleared, never guessed.
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
  /** Where sourcedSegment came from, for the reason line: an oracle `via` or the map. */
  sourcedVia?: string;
}

export type SegmentRepairAction =
  | 'skip-already-null'
  | 'skip-has-provenance'
  | 'clear-non-ipo'
  | 'apply-sourced'
  | 'report-unprovenanced-ipo';

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
      reason:
        `sourced value confirms segment=${row.sourcedSegment} ` +
        `(${row.sourcedVia ?? 'VERIFIED_IPO_SEGMENT_SOURCES'})`,
    };
  }
  return {
    action: 'report-unprovenanced-ipo',
    touch: false,
    newSegment: row.segment,
    reason:
      'no source states this IPO row\'s segment (no field_sources provenance, no verified entry in ' +
      'VERIFIED_IPO_SEGMENT_SOURCES) — REPORTED ONLY, never written. Clearing it would destroy a ' +
      'probably-correct label to express something the missing provenance row already expresses; the ' +
      'gap is closed by the d_segment_provenance detection check, not by guessing or by erasing',
  };
}

export type BlankUnsourcedAction =
  | 'blank'
  | 'refuse-unresolved-group'
  | 'refuse-ambiguous-name'
  | 'refuse-unresolved'
  | 'skip';

export interface BlankUnsourcedDecision {
  action: BlankUnsourcedAction;
  reason: string;
}

/**
 * Pure per-row decision for `--blank-unsourced` (ruling 32) — no DB,
 * unit-testable in isolation. Only rows the DEFAULT mode already classified
 * `report-unprovenanced-ipo` are candidates at all; everything else (already
 * NULL, already provenanced, non-IPO, sourced) is `skip` here because the
 * default decision already handled it correctly.
 *
 * `blank` is a positive allowlist, not a default: only an oracle outcome the
 * caller has explicitly confirmed means "not sourceable" reaches it. Every
 * other outcome — including no resolution at all — REFUSES rather than
 * falling through to blank (T-714 / PR #714 review): an `ambiguous-name`
 * resolution (the company's name is held by more than one listed company)
 * is a refusal to pick between candidates, not evidence the row can never be
 * sourced, exactly like `unresolved-group`'s refusal to pick a board for an
 * unmapped BSE group. A `resolution === undefined` row never ran the oracle
 * at all (the map-only path) and refusing it, rather than blanking it, means
 * a future wiring bug that stops calling the oracle fails closed (nothing
 * gets blanked) instead of silently blanking every unprovenanced IPO row.
 */
export function decideBlankUnsourced(
  decision: SegmentRepairDecision,
  resolution: SegmentResolution | undefined
): BlankUnsourcedDecision {
  if (decision.action !== 'report-unprovenanced-ipo') {
    return { action: 'skip', reason: 'not an unprovenanced IPO row — default mode already decided this one' };
  }
  if (!resolution) {
    return {
      action: 'refuse-unresolved',
      reason:
        'no oracle resolution was recorded for this row (unresolved, not unsourceable) — refusing to blank it ' +
        'without positive evidence the company cannot be sourced',
    };
  }
  if (resolution.outcome === 'unresolved-group') {
    return {
      action: 'refuse-unresolved-group',
      reason:
        `BSE group is not in the evidenced MAINBOARD/SME mapping (${resolution.reason}) — this is unresolved ` +
        'MEANING, not an unsourceable company; refusing to blank it',
    };
  }
  if (resolution.outcome === 'ambiguous-name') {
    return {
      action: 'refuse-ambiguous-name',
      reason:
        `name held by more than one listed company (${resolution.reason}) — this is a refusal to pick, not an ` +
        'unsourceable row; refusing to blank it',
    };
  }
  if (resolution.outcome !== 'no-source') {
    return {
      action: 'refuse-unresolved',
      reason: `oracle outcome '${resolution.outcome}' is not the evidenced no-source case — refusing to blank it`,
    };
  }
  return {
    action: 'blank',
    reason: 'no source in any register (neither exchange master, no verified override) — blanking to NULL, no provenance row written',
  };
}

async function main() {
  console.log('='.repeat(80));
  console.log(`SEGMENT PROVENANCE REPAIR (lane C item 2 slice 3b) — ${APPLY ? 'APPLY' : 'DRY-RUN'}${BLANK_UNSOURCED ? ' [--blank-unsourced]' : ''}`);
  console.log('='.repeat(80));

  await openRepairDb(db, {
    apply: APPLY,
    allowProd: ALLOW_PROD,
    toolName: 'repair-segment-provenance',
  });
  await assertNoSchemaDrift(db, { apply: APPLY, toolName: 'repair-segment-provenance' });

  const candidates = await db
    .select({
      id: schema.ipos.id,
      companyName: schema.ipos.companyName,
      slug: schema.ipos.slug,
      offeringType: schema.ipos.offeringType,
      segment: schema.ipos.segment,
      status: schema.ipos.status,
      isin: schema.ipos.isin,
    })
    .from(schema.ipos)
    .where(isNotNull(schema.ipos.segment));

  const provenanced = await db
    .select({ ipoId: schema.fieldSources.ipoId })
    .from(schema.fieldSources)
    .where(and(eq(schema.fieldSources.tableName, 'ipos'), eq(schema.fieldSources.fieldName, 'segment')));
  const provenancedIds = new Set(provenanced.map((r) => r.ipoId));

  // COUNT THE INTERSECTION, NOT THE TABLE. `provenancedIds.size` is every ipo_id with a
  // segment provenance row anywhere - including rows whose segment is NULL, which are not
  // candidates at all. Printing it after "of those" claims a subset relationship that does
  // not hold. Measured on staging 2026-09-16: 348 candidates, 348 provenanced ids, but only
  // 319 candidates actually carry one - 29 provenanced ids point at NULL-segment rows. The
  // two 348s are a coincidence that made a wrong line read as right.
  const candidatesWithProvenance = candidates.filter((r) => provenancedIds.has(r.id)).length;
  console.log(`ipos rows with segment IS NOT NULL: ${candidates.length}`);
  console.log(`of those, already carrying a field_sources row for segment: ${candidatesWithProvenance}`);
  console.log(
    `(field_sources segment rows overall: ${provenancedIds.size}; ` +
    `${provenancedIds.size - candidatesWithProvenance} of them point at rows whose segment is NULL)`
  );

  // The exchanges' own listed-security masters, fetched ONCE for the whole batch.
  // This is what replaces the hand-filled VERIFIED_IPO_SEGMENT_SOURCES map for IPO
  // rows: membership of NSE's two files IS the board. A fetch failure is fatal rather
  // than silently degrading to "nothing is sourceable", which would look identical to
  // an honest run in which no row could be sourced.
  const nseMasters = await fetchNseEquityMasters();
  // EVERY parsed row, not `byName.values()`. The name index holds one entry per name key
  // and now deliberately EXCLUDES any key claimed by more than one row, so building the
  // two board lists from it dropped exactly the rows that matter: a company present in
  // BOTH NSE files used to collapse to its MAIN row (the oracle never saw the SME twin),
  // and now would vanish from both lists. `rows` is the population; the index is an
  // identity lookup, and they are not interchangeable.
  const nseRows = nseMasters.rows;
  const nse = {
    mainboard: nseRows.filter((r) => r.board === 'MAIN').map((r) => ({ isin: r.isin, name: r.name })),
    sme: nseRows.filter((r) => r.board === 'SME').map((r) => ({ isin: r.isin, name: r.name })),
  };
  if (nse.mainboard.length === 0 || nse.sme.length === 0) {
    throw new Error(
      `NSE masters came back empty (mainboard ${nse.mainboard.length}, sme ${nse.sme.length}) — ` +
      'refusing to run: an empty master resolves every row to no-source, which is indistinguishable ' +
      'from an honest run where nothing was sourceable'
    );
  }
  console.log(`NSE masters: ${nse.mainboard.length} mainboard, ${nse.sme.length} SME`);

  // BSE's active-scrip list, with each scrip's GROUP (slice 2-S3b3). Like the NSE half
  // above, a fetch failure is fatal: `fetchBseScripMaster` throws rather than returning
  // an empty master, because an empty master resolves every BSE company to `no-source`,
  // which is indistinguishable from an honest run in which nothing was sourceable.
  const bseMaster = await fetchBseScripMaster();
  const bse = toOracleScrips(bseMaster);
  console.log(`BSE scrip master: ${bse.length} active equity scrips`);

  const decisions: Array<{
    row: (typeof candidates)[number];
    decision: SegmentRepairDecision;
    resolution?: SegmentResolution;
  }> = [];
  for (const row of candidates) {
    const hasSegmentProvenance = provenancedIds.has(row.id);
    let resolution: SegmentResolution | undefined;
    let sourcedSegment: SegmentValue | undefined;
    if (row.offeringType === 'IPO') {
      // A hand-verified entry still wins: an operator who checked a specific company
      // outranks a master lookup, and the map is the documented override path.
      sourcedSegment = VERIFIED_IPO_SEGMENT_SOURCES[row.slug];
      if (sourcedSegment === undefined) {
        resolution = resolveSegmentFromMasters(
          { isin: row.isin, companyName: row.companyName },
          { nse, bse }
        );
        sourcedSegment = resolution.segment ?? undefined;
      }
    }
    const decision = decideSegmentProvenance({
      id: row.id,
      companyName: row.companyName,
      offeringType: row.offeringType,
      segment: row.segment,
      hasSegmentProvenance,
      sourcedSegment,
      sourcedVia: resolution?.via ?? undefined,
    });
    decisions.push({ row, decision, resolution });
    const label = decision.touch
      ? `WOULD-WRITE segment=${row.segment} -> ${decision.newSegment ?? 'NULL'}`
      : `REPORTED (no write)  segment stays ${row.segment}`;
    // Print WHY the oracle could not source a reported IPO row. A bare "no source"
    // cannot be acted on; "in neither exchange master" and "BSE group TS is not in the
    // evidenced mapping" point at different next steps.
    const oracleNote =
      !decision.touch && resolution && resolution.outcome !== 'resolved'
        ? `  [oracle: ${resolution.outcome} — ${resolution.reason}]`
        : '';
    console.log(
      `  - ${row.companyName} [${row.offeringType}, ${row.status}] ${label} (${decision.action}): ${decision.reason}${oracleNote}`
    );
  }

  const toTouch = decisions.filter((d) => d.decision.touch);
  const toReport = decisions.filter((d) => !d.decision.touch && d.decision.action === 'report-unprovenanced-ipo');
  const byAction = toTouch.reduce<Record<string, number>>((acc, d) => {
    acc[d.decision.action] = (acc[d.decision.action] ?? 0) + 1;
    return acc;
  }, {});

  console.log(`\nrows that WOULD BE WRITTEN: ${toTouch.length} of ${candidates.length} candidates`);
  console.log(`by write action: ${JSON.stringify(byAction)}`);
  console.log(
    `rows REPORTED ONLY, never written (report-unprovenanced-ipo — unsourced IPO labels left as-is): ${toReport.length}`
  );

  if (BLANK_UNSOURCED) {
    const blankDecisions = toReport.map((d) => ({ ...d, blank: decideBlankUnsourced(d.decision, d.resolution) }));
    const toBlank = blankDecisions.filter((d) => d.blank.action === 'blank');
    const refusedGroup = blankDecisions.filter((d) => d.blank.action === 'refuse-unresolved-group');

    console.log(`\n--blank-unsourced: ${toReport.length} unprovenanced IPO rows considered`);
    for (const d of blankDecisions) {
      if (d.blank.action === 'skip') continue;
      console.log(`  - ${d.row.companyName} [${d.blank.action}]: ${d.blank.reason}`);
    }
    console.log(`rows that WOULD be blanked to NULL (no provenance row): ${toBlank.length}`);
    console.log(`rows REFUSED (unresolved BSE group, not unsourceable): ${refusedGroup.length}`);

    if (!APPLY) {
      console.log(`\nDRY-RUN: ${toBlank.length} rows WOULD be blanked. Re-run with --apply --blank-unsourced (and --allow-prod against production).`);
      console.log('='.repeat(80));
      process.exit(0);
    }

    if (toBlank.length === 0) {
      console.log('\nNothing to blank.');
      console.log('='.repeat(80));
      process.exit(0);
    }

    const blankBackupPath = `evidence/${new Date().toISOString().slice(0, 10)}-decision4-blank-unsourced/before.json`;
    writeLedgerFile(blankBackupPath, {
      tool: 'repair-segment-provenance',
      mode: 'apply',
      generatedAt: new Date().toISOString(),
      changes: toBlank.map((d) => ({ table: 'ipos', rowKey: d.row.id, field: 'segment', before: d.row.segment, after: null })),
      capturedAt: new Date().toISOString(),
      rows: toBlank.map((d) => d.row),
    });
    console.log(`backup written: ${blankBackupPath}`);

    await db.transaction(async (tx) => {
      for (const { row } of toBlank) {
        // No provenance row: the ABSENCE of a field_sources row for this field is
        // exactly what d_segment_provenance detects, and lane C's board ruling
        // (O-16 / #658) is "delete-only" — never write a reason/placeholder row.
        await tx
          .update(schema.ipos)
          .set({ segment: null })
          .where(eq(schema.ipos.id, row.id));
      }
    });

    const blankReadBack = [];
    for (const { row } of toBlank) {
      const [r] = await db
        .select({ id: schema.ipos.id, companyName: schema.ipos.companyName, segment: schema.ipos.segment })
        .from(schema.ipos)
        .where(eq(schema.ipos.id, row.id))
        .limit(1);
      blankReadBack.push(r);
    }
    console.log('\nread-back after blank:');
    console.log(JSON.stringify(blankReadBack, null, 1));

    const blankLedgerPath = `evidence/${new Date().toISOString().slice(0, 10)}-decision4-blank-unsourced/applied.json`;
    writeLedgerFile(blankLedgerPath, {
      tool: 'repair-segment-provenance',
      mode: 'apply',
      generatedAt: new Date().toISOString(),
      changes: toBlank.map((d) => ({ table: 'ipos', rowKey: d.row.id, field: 'segment', before: d.row.segment, after: null })),
      appliedAt: new Date().toISOString(),
      updatedBy: BLANK_UPDATED_BY,
      written: toBlank.length,
      decisions: toBlank.map((d) => ({ id: d.row.id, companyName: d.row.companyName })),
    });
    console.log(`ledger written: ${blankLedgerPath}`);

    console.log('\nAPPLY complete.');
    console.log('='.repeat(80));
    process.exit(0);
  }

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
  writeLedgerFile(backupPath, {
    tool: 'repair-segment-provenance',
    mode: 'apply',
    generatedAt: new Date().toISOString(),
    changes: toTouch.map((d) => ({ table: 'ipos', rowKey: d.row.id, field: 'segment', before: d.row.segment, after: d.decision.newSegment })),
    capturedAt: new Date().toISOString(),
    rows: toTouch.map((d) => d.row),
  });
  console.log(`backup written: ${backupPath}`);

  await db.transaction(async (tx) => {
    for (const { row, decision, resolution } of toTouch) {
      // The provenance row must name where the value ACTUALLY came from. A row the
      // oracle resolved is sourced by the exchange master, not by an admin; recording
      // 'ADMIN' for it would make a machine-sourced value indistinguishable from a
      // hand-entered one, and the whole point of this field is that distinction.
      const sourcedByOracle = decision.action === 'apply-sourced' && resolution?.outcome === 'resolved';
      await upsertFieldSource(tx as any, {
        ipoId: row.id,
        fieldName: 'segment',
        source: sourcedByOracle ? 'NSE' : 'ADMIN',
        confidence: 100,
        previousValue: row.segment,
        dataLineage: {
          reason: decision.reason,
          action: decision.action,
          ...(resolution
            ? { oracle: { outcome: resolution.outcome, via: resolution.via, reason: resolution.reason } }
            : {}),
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
    tool: 'repair-segment-provenance',
    mode: 'apply',
    generatedAt: new Date().toISOString(),
    changes: toTouch.map((d) => ({ table: 'ipos', rowKey: d.row.id, field: 'segment', before: d.row.segment, after: d.decision.newSegment })),
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
