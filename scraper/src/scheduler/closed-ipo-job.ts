/**
 * Item 17 (OD-22): the closed-IPO job.
 *
 * Owner instruction, 2026-09-09: "Closed IPOs are in the build, drained by the
 * 22:00 job, not deferred behind preconditions."
 *
 * What it is for, measured on staging 2026-09-20 rather than assumed: 74
 * PROSPECTUS documents sit `extraction_status = PENDING`, every one on a LISTED
 * IPO, the oldest filed 2026-06-16. Ten documents of the SAME type on the SAME
 * status are COMPLETED, and PROSPECTUS is in EXTRACTABLE_DOC_TYPES -- so the
 * extractor is not the gap. Nothing walks a LISTED IPO a second time to read a
 * prospectus filed after the initial DRHP/RHP-era pass. This job is that
 * consumer.
 *
 * Three rules it does not get to bend:
 *
 *  1. It never runs while the data job holds `scraper:cycle`. A second walker
 *     on the same rows is how two writers race, and the live-figure job always
 *     wins the slot.
 *  2. At most ten IPOs per run. The backlog is drained steadily, not in one
 *     sweep that competes with the live path for the same sources.
 *  3. Every attempt is recorded, including the failures, with a cause CLASS
 *     rather than a message. "Why did this IPO not finish" has to be countable
 *     per class (signal-ownership R1), not a string someone greps.
 */

import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import * as schema from '@ipodhan/shared/db/schema';
import { logger } from '../utils/logger.js';

export type ClosedIpoOutcome = 'DONE' | 'PARTIAL' | 'FAILED';

export type ClosedIpoCauseClass =
  | 'DOCUMENT_UNOBTAINABLE'
  | 'EXTRACTOR_MISSING'
  | 'VALIDATION_REJECTED'
  | 'SOURCE_UNREACHABLE'
  | 'WRITE_SKIPPED';

export interface ClosedIpoCandidate {
  id: string;
  closeDate: Date | string | null;
  status: string;
}

export interface ClosedIpoJobDeps {
  db: NodePgDatabase<typeof schema>;
  /** True while the data job holds `scraper:cycle` — the job refuses to start. */
  isCycleLockHeld: () => Promise<boolean>;
  /** Resource one IPO. Supplied by the caller so this module never imports the walk directly. */
  resourceIpo: (ipoId: string) => Promise<{
    outcome: ClosedIpoOutcome;
    causeClass?: ClosedIpoCauseClass;
    causeDetail?: string;
    fieldsWritten: number;
    fieldsLeftEmpty: number;
  }>;
  /**
   * Stamped onto every row so a later version can re-select an IPO this version gave up on.
   * Production passes `closedIpoResourcingVersion(...)` -- the manifest + extractor version (§6.2).
   */
  resourcedAtVersion: string;
  /**
   * F-31 (§6.4): take the `field_sources` snapshot for the IPOs about to be walked,
   * BEFORE the first of them is walked. It is the only thing that makes "roll back
   * per field" true past the first overwrite (§7.2). A throw aborts the run with no
   * IPO walked -- a walk without its snapshot is exactly what F-31 forbids.
   */
  snapshotFieldSources: (ipoIds: string[]) => Promise<{ path: string; rows: number }>;
  now?: Date;
  cap?: number;
}

export interface ClosedIpoJobSummary {
  candidatesConsidered: number;
  attempted: number;
  outcomes: Record<ClosedIpoOutcome, number>;
  skippedCycleLockHeld: boolean;
  /** Where the F-31 snapshot for this run was written; null when nothing was selected. */
  snapshot: { path: string; rows: number } | null;
}

export const CLOSED_IPO_JOB_DEFAULT_CAP = 10;

/**
 * The selection query, per the build card's four ordered rules.
 *
 * `close_date < CURRENT_DATE` is strict on purpose: an IPO that closed TODAY is
 * still settling, and re-reading it the same evening competes with the live
 * path for the same sources.
 *
 * The `IS DISTINCT FROM` on cause_class is what stops a permanently-stuck IPO
 * consuming a slot every night: a FAILED row is re-selected only when the
 * version that failed it has changed, so "we already tried this and it did not
 * work" is a fact about the evidence rather than a retry counter someone can
 * reset.
 *
 * ORDER BY is `close_date DESC` -- newest closed first -- per spec §6.1 rule 3
 * (the owner's sequence, OD-22). #873 had re-ordered by the count of PENDING
 * extractable documents; OD-76 (2026-09-23) removed the premise: the walk this
 * job runs never reads a document (reading a PENDING one stays the document
 * cycle's job, OD-33), so a PENDING-document count ranks IPOs by work this job
 * cannot do. `i.id` is only a deterministic tie-break.
 *
 * `resourced_at_version` is the EXTRACTOR/MANIFEST version (§6.2), built by
 * `closedIpoResourcingVersion` -- not a hand-bumped job constant. A manifest
 * rank change or an extractor bump is what can change a PARTIAL/FAILED IPO's
 * cause, so it is what makes that IPO eligible again.
 *
 * This constant is the READABLE copy, asserted by the unit tests. The executed
 * query is the bound `sql` template in `runClosedIpoJob` — the rules live here
 * in one place, and nothing interpolates this string into a query.
 */
export const CLOSED_IPO_CANDIDATES_SQL = `
  SELECT i.id, i.close_date AS "closeDate", i.status::text AS status
    FROM ipos i
    LEFT JOIN closed_ipo_resourcing r ON r.ipo_id = i.id
   WHERE upper(i.status::text) IN ('LISTED', 'CLOSED')
     AND i.close_date < CURRENT_DATE
     AND (
       r.ipo_id IS NULL
       OR (r.outcome IN ('PARTIAL', 'FAILED') AND r.resourced_at_version IS DISTINCT FROM $1)
     )
   ORDER BY i.close_date DESC, i.id
   LIMIT $2
`;

/**
 * The executed selection (§6.1 rules 1-4 + §6.2 retry), bound parameters only.
 * Exported so the integration test runs THIS query against ipodhan_test rather
 * than a copy of it.
 */
export async function selectClosedIpoCandidates(
  db: Pick<NodePgDatabase<typeof schema>, 'execute'>,
  resourcedAtVersion: string,
  cap: number
): Promise<ClosedIpoCandidate[]> {
  // Parameters are BOUND, never interpolated. `resourcedAtVersion` is an
  // internal string today, but a query built by string-replacement is the
  // wrong shape regardless of who supplies the value.
  const result = await db.execute(
    sql`
      SELECT i.id, i.close_date AS "closeDate", i.status::text AS status
        FROM ipos i
        LEFT JOIN closed_ipo_resourcing r ON r.ipo_id = i.id
       WHERE upper(i.status::text) IN ('LISTED', 'CLOSED')
         AND i.close_date < CURRENT_DATE
         AND (
           r.ipo_id IS NULL
           OR (r.outcome IN ('PARTIAL', 'FAILED') AND r.resourced_at_version IS DISTINCT FROM ${resourcedAtVersion})
         )
       ORDER BY i.close_date DESC, i.id
       LIMIT ${cap}
    `
  );
  return (result.rows ?? result) as unknown as ClosedIpoCandidate[];
}

export async function runClosedIpoJob(deps: ClosedIpoJobDeps): Promise<ClosedIpoJobSummary> {
  const summary: ClosedIpoJobSummary = {
    candidatesConsidered: 0,
    attempted: 0,
    outcomes: { DONE: 0, PARTIAL: 0, FAILED: 0 },
    skippedCycleLockHeld: false,
    snapshot: null,
  };

  if (await deps.isCycleLockHeld()) {
    // Not an error and not a failure: the data job owns the slot, and this one
    // waits for the next wake. Reported so a silent no-op is distinguishable
    // from a run that found nothing to do.
    summary.skippedCycleLockHeld = true;
    logger.info('closed-IPO job: scraper:cycle held by the data job — skipping this wake');
    return summary;
  }

  const cap = deps.cap ?? CLOSED_IPO_JOB_DEFAULT_CAP;
  const now = deps.now ?? new Date();

  const candidates = await selectClosedIpoCandidates(deps.db, deps.resourcedAtVersion, cap);
  summary.candidatesConsidered = candidates.length;

  if (candidates.length > 0) {
    // F-31: before the FIRST IPO is walked, never after. A failure here throws
    // out of the job (the caller records the step as failed and does not stamp
    // the cadence, so the next wake retries) with no IPO touched.
    try {
      summary.snapshot = await deps.snapshotFieldSources(candidates.map((c) => c.id));
    } catch (error) {
      const cause = error instanceof Error ? error.message : String(error);
      throw new Error(`closed-IPO job: F-31 field_sources snapshot failed, no IPO walked: ${cause}`);
    }
    logger.info(
      { path: summary.snapshot.path, rows: summary.snapshot.rows, ipos: candidates.length },
      'closed-IPO job: F-31 field_sources snapshot written before the first walk'
    );
  }

  for (const candidate of candidates) {
    let outcome: ClosedIpoOutcome;
    let causeClass: ClosedIpoCauseClass | undefined;
    let causeDetail: string | undefined;
    let fieldsWritten = 0;
    let fieldsLeftEmpty = 0;

    try {
      const r = await deps.resourceIpo(candidate.id);
      outcome = r.outcome;
      causeClass = r.causeClass;
      causeDetail = r.causeDetail;
      fieldsWritten = r.fieldsWritten;
      fieldsLeftEmpty = r.fieldsLeftEmpty;
    } catch (error) {
      // A throw is this minute's fact about the source, not a verdict on the
      // IPO. It is recorded as FAILED with its cause so the next run at a new
      // version re-selects it (signal-ownership R6: failures carry their cause).
      outcome = 'FAILED';
      causeClass = 'SOURCE_UNREACHABLE';
      causeDetail = error instanceof Error ? error.message : String(error);
    }

    summary.attempted += 1;
    summary.outcomes[outcome] += 1;

    await deps.db
      .insert(schema.closedIpoResourcing)
      .values({
        ipoId: candidate.id,
        firstAttemptAt: now,
        lastAttemptAt: now,
        attempts: 1,
        outcome,
        causeClass: causeClass ?? null,
        causeDetail: causeDetail ?? null,
        fieldsWritten,
        fieldsLeftEmpty,
        resourcedAtVersion: deps.resourcedAtVersion,
      })
      .onConflictDoUpdate({
        target: schema.closedIpoResourcing.ipoId,
        set: {
          lastAttemptAt: now,
          attempts: sql`${schema.closedIpoResourcing.attempts} + 1`,
          outcome,
          causeClass: causeClass ?? null,
          causeDetail: causeDetail ?? null,
          fieldsWritten,
          fieldsLeftEmpty,
          resourcedAtVersion: deps.resourcedAtVersion,
          updatedAt: now,
        },
      });

    logger.info(
      { ipoId: candidate.id, outcome, causeClass, fieldsWritten, fieldsLeftEmpty },
      'closed-IPO job: IPO resourced'
    );
  }

  logger.info(
    {
      candidatesConsidered: summary.candidatesConsidered,
      attempted: summary.attempted,
      done: summary.outcomes.DONE,
      partial: summary.outcomes.PARTIAL,
      failed: summary.outcomes.FAILED,
    },
    'closed-IPO job: run complete'
  );
  return summary;
}

/**
 * The walk counters `resourceClosedIpo` reads -- the slice of
 * `FieldPlanWalkResult` (services/field-plan-walk.ts) it needs, restated so
 * this module does not import the walk.
 */
export interface ClosedIpoWalkCounters {
  fieldsAttempted: number;
  fieldsSupplied: number;
  fieldsExhausted: number;
  fieldsCheckFailed: number;
  fieldsWriteSkipped: number;
  fieldsNotAvailableYet: number;
  outcomesFailed: number;
  stoppedReason: 'NO_DUE_FIELDS' | 'BUDGET_EXHAUSTED' | 'CLAIM_SUPERSEDED';
  droppedWrites: Array<{ tableName: string; fieldName: string; source: string; skipReason: string }>;
  exhaustedFields: Array<{ tableName: string; fieldName: string }>;
}

export interface ResourceClosedIpoDeps {
  /** How many `ipo_field_plan` rows this IPO already has. */
  countPlanRows: (ipoId: string) => Promise<number>;
  /** The EXISTING plan generator + upsert (`plantFieldPlanForIpo`), exactly as for a live IPO. */
  plantPlan: (ipoId: string) => Promise<{ rowsGenerated: number; inserted: number; updated: number }>;
  /** The EXISTING §2.4 walk (`walkFieldPlanForIPO`) over this IPO's plan. */
  walk: (ipoId: string) => Promise<ClosedIpoWalkCounters>;
  /**
   * This IPO's plan rows NOT yet settled, counted per state. Settled = a terminal
   * state (SUPPLIED, NOT_PRINTED, EXHAUSTED: `TERMINAL_STATES` in
   * ipo-field-plan-repository.ts -- "no further attempt is ever scheduled"),
   * which is where OD-73's rank rule leaves a field. Read AFTER the walk.
   */
  countUnsettledPlanRows: (ipoId: string) => Promise<Partial<Record<UnsettledPlanState, number>>>;
}

/** The three non-terminal `field_plan_state` values. */
export type UnsettledPlanState = 'PENDING' | 'NOT_AVAILABLE_YET' | 'CHECK_FAILED';

export interface ClosedIpoResourceResult {
  outcome: ClosedIpoOutcome;
  causeClass?: ClosedIpoCauseClass;
  causeDetail?: string;
  fieldsWritten: number;
  fieldsLeftEmpty: number;
}

/**
 * OD-76 "plan, then walk" -- the real work behind one closed-IPO row.
 *
 * WHY: on 2026-09-23 the job's first staging run picked 10 LISTED IPOs, every
 * one with 0 `ipo_field_plan` rows (238 of 274 LISTED IPOs on staging have no
 * plan: plans exist only for IPOs live after the generator was switched on).
 * The walk found nothing due and each was recorded DONE -- and DONE is never
 * re-picked (§6.2), so all ten left the backlog having had nothing done.
 *
 * WHAT (spec §6.1 as rewritten by OD-76): if the IPO has no plan, run the
 * EXISTING generator for it first; then the SAME §2.4 walk a live IPO gets.
 * One code path -- no separate document-reading path (#912 was closed for
 * adding one).
 *
 * NEVER DONE WITHOUT A WALK. Each line below is a way to reach the end with
 * nothing walked, and each maps to PARTIAL/FAILED with a cause:
 *   - generation threw                  -> FAILED / WRITE_SKIPPED (the DB was the problem)
 *   - generation produced 0 rows        -> FAILED / EXTRACTOR_MISSING (the manifest ranks
 *                                          no field for this IPO's type: nothing CAN be asked)
 *   - the walk asked nothing            -> DONE only if every plan row is settled (OD-73);
 *                                          else PARTIAL / SOURCE_UNREACHABLE when a row is
 *                                          CHECK_FAILED, PARTIAL / DOCUMENT_UNOBTAINABLE when
 *                                          rows are only waiting on a source (nearest class)
 *   - the walk stopped before finishing -> PARTIAL / SOURCE_UNREACHABLE (budget or superseded
 *                                          claim: the unwalked rest must not be sealed DONE)
 * Past those, the walk's own counters decide, exactly as before OD-76:
 *   - settle calls threw   -> FAILED / WRITE_SKIPPED
 *   - writes dropped       -> PARTIAL / WRITE_SKIPPED
 *   - transient failures   -> PARTIAL / SOURCE_UNREACHABLE
 *   - all exhausted, none supplied -> PARTIAL / DOCUMENT_UNOBTAINABLE
 *   - otherwise            -> DONE (every due field was asked and settled).
 */
export async function resourceClosedIpo(ipoId: string, deps: ResourceClosedIpoDeps): Promise<ClosedIpoResourceResult> {
  const existing = await deps.countPlanRows(ipoId);
  if (existing === 0) {
    let planted: { rowsGenerated: number; inserted: number };
    try {
      planted = await deps.plantPlan(ipoId);
    } catch (error) {
      return {
        outcome: 'FAILED',
        causeClass: 'WRITE_SKIPPED',
        causeDetail: `plan generation threw: ${error instanceof Error ? error.message : String(error)}`,
        fieldsWritten: 0,
        fieldsLeftEmpty: 0,
      };
    }
    if (planted.rowsGenerated === 0) {
      return {
        outcome: 'FAILED',
        causeClass: 'EXTRACTOR_MISSING',
        causeDetail: 'plan generation produced 0 rows for this IPO: the manifest ranks no field for its type, so the walk has nothing to ask',
        fieldsWritten: 0,
        fieldsLeftEmpty: 0,
      };
    }
  }

  const walk = await deps.walk(ipoId);
  const fieldsWritten = walk.fieldsSupplied;
  const fieldsLeftEmpty =
    walk.fieldsExhausted + walk.fieldsCheckFailed + walk.fieldsWriteSkipped + walk.fieldsNotAvailableYet;

  if (walk.fieldsAttempted === 0 && walk.stoppedReason === 'NO_DUE_FIELDS') {
    // OD-76 as corrected (§6.1): a walk that asked nothing is DONE only when
    // every plan row is already settled (OD-73) -- then there is genuinely
    // nothing left to ask. Rows still open mean the IPO is not finished.
    const open = await deps.countUnsettledPlanRows(ipoId);
    const checkFailed = open.CHECK_FAILED ?? 0;
    const waiting = (open.PENDING ?? 0) + (open.NOT_AVAILABLE_YET ?? 0);
    if (checkFailed + waiting === 0) {
      return { outcome: 'DONE', fieldsWritten: 0, fieldsLeftEmpty: 0 };
    }
    const breakdown = `PENDING ${open.PENDING ?? 0}, NOT_AVAILABLE_YET ${open.NOT_AVAILABLE_YET ?? 0}, CHECK_FAILED ${checkFailed}`;
    // Cause classes are the EXISTING five (a new enum value is a schema change).
    // CHECK_FAILED rows are a source check that failed and is backing off:
    // SOURCE_UNREACHABLE is literally true. Otherwise every open row is waiting
    // on a ranked source that has not supplied it -- for a closed IPO, almost
    // always the offer document not yet extracted -- and DOCUMENT_UNOBTAINABLE
    // is the nearest existing class; the detail says which it is.
    return {
      outcome: 'PARTIAL',
      causeClass: checkFailed > 0 ? 'SOURCE_UNREACHABLE' : 'DOCUMENT_UNOBTAINABLE',
      causeDetail:
        `the walk asked nothing, but ${checkFailed + waiting} plan row(s) are not settled (${breakdown}); ` +
        `plan rows before this run: ${existing}`,
      fieldsWritten,
      fieldsLeftEmpty: checkFailed + waiting,
    };
  }
  if (walk.outcomesFailed > 0) {
    return {
      outcome: 'FAILED',
      causeClass: 'WRITE_SKIPPED',
      causeDetail: `${walk.outcomesFailed} settle call(s) threw (DB unreachable); claims released`,
      fieldsWritten,
      fieldsLeftEmpty,
    };
  }
  if (walk.stoppedReason !== 'NO_DUE_FIELDS') {
    return {
      outcome: 'PARTIAL',
      causeClass: 'SOURCE_UNREACHABLE',
      causeDetail: `the walk stopped ${walk.stoppedReason} after ${walk.fieldsAttempted} field(s); the rest were not asked`,
      fieldsWritten,
      fieldsLeftEmpty,
    };
  }
  if (walk.fieldsWriteSkipped > 0) {
    return {
      outcome: 'PARTIAL',
      causeClass: 'WRITE_SKIPPED',
      causeDetail: walk.droppedWrites
        .slice(0, 5)
        .map((d) => `${d.tableName}.${d.fieldName} (${d.source}: ${d.skipReason})`)
        .join('; '),
      fieldsWritten,
      fieldsLeftEmpty,
    };
  }
  if (walk.fieldsCheckFailed > 0) {
    return {
      outcome: 'PARTIAL',
      causeClass: 'SOURCE_UNREACHABLE',
      causeDetail: `${walk.fieldsCheckFailed} field(s) failed transiently; re-asked after backoff`,
      fieldsWritten,
      fieldsLeftEmpty,
    };
  }
  if (walk.fieldsExhausted > 0 && walk.fieldsSupplied === 0) {
    return {
      outcome: 'PARTIAL',
      causeClass: 'DOCUMENT_UNOBTAINABLE',
      causeDetail: walk.exhaustedFields
        .slice(0, 5)
        .map((e) => `${e.tableName}.${e.fieldName}`)
        .join('; '),
      fieldsWritten,
      fieldsLeftEmpty,
    };
  }
  return { outcome: 'DONE', fieldsWritten, fieldsLeftEmpty };
}

/**
 * `closed_ipo_resourcing.resourced_at_version` (§6.2): "the extractor/manifest
 * version it was done under, so a later version can legitimately re-do it".
 *
 * Built from the three things that can change a PARTIAL/FAILED IPO's cause:
 * the manifest's schema version, a hash of its field ranks (a rank change
 * without a schema-version bump is the common case -- `version` is 1 or 2),
 * and the filing extractor's version. NOT a hand-edited job constant: that was
 * review round 1 MAJOR-1, where a re-pick depended on someone remembering to
 * bump a string.
 *
 * Kept <= 39 characters so the repair tool's `repair-717:` prefix still fits
 * varchar(50); an input that would overflow collapses to a hash of itself.
 */
export const CLOSED_IPO_VERSION_MAX_LENGTH = 39;

export function closedIpoResourcingVersion(input: {
  manifestVersion: number;
  manifestFieldsHash: string;
  extractorVersion: string;
}): string {
  const extractor = input.extractorVersion.replace(/^extract_filing\.py@/, 'x');
  const readable = `m${input.manifestVersion}.${input.manifestFieldsHash.slice(0, 8)}+${extractor}`;
  if (readable.length <= CLOSED_IPO_VERSION_MAX_LENGTH) return readable;
  return `h-${createHash('sha256').update(readable).digest('hex').slice(0, 32)}`;
}

/** Hash of a manifest's field ranks -- the input `closedIpoResourcingVersion` keys on. */
export function manifestFieldsHash(fields: unknown): string {
  return createHash('sha256').update(JSON.stringify(fields)).digest('hex');
}

/** IST is a fixed UTC+5:30 offset (no DST) — same convention as `due-step-cycle.ts`. */
const IST_OFFSET_MINUTES = 5 * 60 + 30;

/**
 * Minutes since IST midnight of the job's single daily boundary: 22:00 IST.
 *
 * Deliberately NOT appended to `DISCOVERY_SLOTS_IST_MINUTES` in
 * `due-step-cycle.ts`. That array is the DATA job's slot list, and adding a
 * fifth entry would make the data job's own due-check treat 22:00 as one of
 * its slots too — the exact overlap OD-19 forbids ("never start while the data
 * job's cycle lock is held" only means something if the two schedules are
 * separate checks, not a shared one).
 */
export const CLOSED_IPO_JOB_SLOT_IST_MINUTES = 22 * 60;

/**
 * The job is due when the most recent 22:00-IST boundary at-or-before `now` is
 * strictly after `lastRunAt`.
 *
 * Catch-up-safe, for the same reason `isDiscoveryDue` is: a wake that misses
 * the boundary (process down, a data cycle that ran long) still fires on the
 * next wake that observes it, rather than losing the night and waiting until
 * tomorrow. A backlog that only drains on perfectly-timed wakes is a backlog
 * that does not drain.
 */
export function isClosedIpoJobDue(now: Date, lastRunAt: Date | null): boolean {
  const istMs = now.getTime() + IST_OFFSET_MINUTES * 60_000;
  const dayIndex = Math.floor(istMs / 86_400_000);
  const minutesOfDay = new Date(istMs).getUTCHours() * 60 + new Date(istMs).getUTCMinutes();

  // Before today's 22:00 the most recent boundary was yesterday's.
  const boundaryEpochMinute =
    minutesOfDay >= CLOSED_IPO_JOB_SLOT_IST_MINUTES
      ? dayIndex * 1440 + CLOSED_IPO_JOB_SLOT_IST_MINUTES
      : (dayIndex - 1) * 1440 + CLOSED_IPO_JOB_SLOT_IST_MINUTES;

  if (lastRunAt === null) return true;
  const lastRunIstMinute = Math.floor((lastRunAt.getTime() + IST_OFFSET_MINUTES * 60_000) / 60_000);
  return boundaryEpochMinute > lastRunIstMinute;
}
