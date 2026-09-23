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
import * as schema from '@ipodhan/shared/db/schema';
import { logger } from '../utils/logger.js';
import {
  processPendingFilings,
  MAX_EXTRACTION_ATTEMPTS,
  type AutoPersistDeps,
  type AutoPersistResult,
} from '../services/filing-auto-persist.js';

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
  companyName?: string | null;
  slug?: string | null;
  segment?: string | null;
  /** True when the IPO already has a `closed_ipo_resourcing` row (a carried-over re-pick). */
  isRepick?: boolean | null;
}

export interface ClosedIpoResourceResult {
  outcome: ClosedIpoOutcome;
  causeClass?: ClosedIpoCauseClass;
  causeDetail?: string;
  fieldsWritten: number;
  fieldsLeftEmpty: number;
  /**
   * False when this pass never actually tried to read a document (every unread
   * one was inside its own retry backoff, or the extraction lock was held).
   * Such a night does not spend one of the IPO's transient attempts (review
   * round 2 MINOR-1): the document's own cap is what bounds it, and spending
   * the IPO's budget on nights nothing was retried strands the IPO below that
   * cap. Undefined (a worker that does not say) counts as attempted.
   */
  documentReadAttempted?: boolean;
}

export interface ClosedIpoJobDeps {
  db: NodePgDatabase<typeof schema>;
  /** True while the data job holds `scraper:cycle` — the job refuses to start. */
  isCycleLockHeld: () => Promise<boolean>;
  /**
   * Resource one IPO. Supplied by the caller so this module never imports the
   * walk directly. The candidate row is passed as well: the worker needs the
   * company name and segment to drive the document extraction the IPO was
   * selected for (#717).
   */
  resourceIpo: (ipoId: string, candidate: ClosedIpoCandidate) => Promise<ClosedIpoResourceResult>;
  /**
   * How many EXTRACTABLE documents of this IPO are still UNREAD -- any status
   * other than COMPLETED, MANUAL_REVIEW or NOT_EXTRACTABLE -- split into those
   * awaiting a retry on their own backoff (FAILED, IN_PROGRESS) and the rest
   * (PENDING). Read AFTER the worker returns, because that count is the reason
   * the IPO was selected: a DONE with it still non-zero is the #717 false-DONE,
   * and is downgraded. Defaults to the real query against `db`.
   */
  countUnreadExtractableDocuments?: (ipoId: string) => Promise<UnreadDocumentCount>;
  /**
   * Restrict selection to these IPO ids. For an operator run on named IPOs
   * (and the integration proof); the selection rules still all apply.
   */
  restrictToIpoIds?: string[];
  /** Stamped onto every row so a later version can re-select an IPO this version gave up on. */
  resourcedAtVersion: string;
  now?: Date;
  cap?: number;
  /** Override of `CLOSED_IPO_JOB_REPICK_SLOTS` (tests). */
  repickSlots?: number;
  /** Override of `CLOSED_IPO_MAX_TRANSIENT_ATTEMPTS` (tests). */
  maxTransientAttempts?: number;
}

export interface ClosedIpoJobSummary {
  candidatesConsidered: number;
  attempted: number;
  outcomes: Record<ClosedIpoOutcome, number>;
  /**
   * Non-DONE outcomes per cause LABEL (`closedIpoCauseLabel`), so the run line
   * tells a document waiting on its retry apart from a source that is down.
   */
  causes: Record<string, number>;
  skippedCycleLockHeld: boolean;
}

export const CLOSED_IPO_JOB_DEFAULT_CAP = 10;

/**
 * Of the nightly slots, at most this many go to CARRIED-OVER IPOs (ones that
 * already hold a `closed_ipo_resourcing` row and are re-picked as transient or
 * at a new version). Newly-eligible IPOs are taken first and get every other
 * slot; a slot they leave unused is back-filled by carry-overs. Without this a
 * carry-over, re-picked every night, could hold every slot and every one of
 * the run's extraction spawns while a newly closed IPO never got its turn
 * (spec section 6.2.1, review round 1 MAJOR-4).
 */
export const CLOSED_IPO_JOB_REPICK_SLOTS = 3;

/**
 * A transient outcome (cause class SOURCE_UNREACHABLE) is re-picked at the
 * SAME version only while the row's `attempts` at that version is below this.
 * Equal to the per-document cap (`MAX_EXTRACTION_ATTEMPTS`; OD-32: re-read if
 * previous reads were not successful): the job re-visits an IPO at most as
 * often as its documents may themselves be retried. A version bump resets the
 * count (spec section 6.2.1).
 */
export const CLOSED_IPO_MAX_TRANSIENT_ATTEMPTS = MAX_EXTRACTION_ATTEMPTS;

/**
 * Document statuses after which there is nothing left for this job to read.
 * Everything else -- PENDING, FAILED awaiting retry, IN_PROGRESS left by a
 * crashed run, a NULL status -- is UNREAD (review round 1 MAJOR-1).
 */
export const CLOSED_IPO_TERMINAL_DOC_STATUSES = ['COMPLETED', 'MANUAL_REVIEW', 'NOT_EXTRACTABLE'] as const;

export interface UnreadDocumentCount {
  /** PENDING (or NULL-status) extractable documents. */
  pending: number;
  /** FAILED or IN_PROGRESS extractable documents: retried on their own backoff. */
  retrying: number;
}

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
 * ORDER BY is by NEED, not recency (#873). The first version sorted
 * `close_date DESC` alone, and measured against staging that pointed the job
 * away from its own purpose: of 343 eligible IPOs, the 74 holding a stuck
 * PENDING PROSPECTUS sit at ranks 156-294, because they are OLD -- which is
 * exactly why nothing re-visited them. At ten a night the job reached zero of
 * them on night 1, zero by night 10, the first on night 16. And it would not
 * have been merely idle: it writes a ledger row per attempt and excludes DONE
 * ones, so fifteen nights of slots would have gone to IPOs needing nothing,
 * each marked DONE, while the log read `attempted=10 done=10`.
 *
 * The count is restricted to the four EXTRACTABLE types. Ordering by all
 * pending documents would rank an IPO by rows whose types have no extractor
 * at all (#869) -- work this job cannot do however many times it visits.
 *
 * This constant is the READABLE copy, asserted by the unit tests. The executed
 * query is the bound `sql` template in `runClosedIpoJob` — the rules live here
 * in one place, and nothing interpolates this string into a query.
 */
export const CLOSED_IPO_CANDIDATES_SQL = `
  WITH eligible AS (
    SELECT i.id, i.close_date AS "closeDate", i.status::text AS status,
           i.company_name AS "companyName", i.slug, i.segment::text AS segment,
           (r.ipo_id IS NOT NULL) AS "isRepick",
           (SELECT count(*) FROM documents d
             WHERE d.ipo_id = i.id
               AND COALESCE(d.extraction_status, 'PENDING') NOT IN ('COMPLETED', 'MANUAL_REVIEW', 'NOT_EXTRACTABLE')
               AND d.type::text IN ('PRICE_BAND_AD', 'RHP', 'DRHP', 'PROSPECTUS')) AS need
      FROM ipos i
      LEFT JOIN closed_ipo_resourcing r ON r.ipo_id = i.id
     WHERE upper(i.status::text) IN ('LISTED', 'CLOSED')
       AND i.close_date < CURRENT_DATE
       AND (
         r.ipo_id IS NULL
         OR (r.outcome IN ('PARTIAL', 'FAILED')
             AND (r.resourced_at_version IS DISTINCT FROM $1
                  OR (r.cause_class = 'SOURCE_UNREACHABLE' AND r.attempts < $3)))
       )
  ), ranked AS (
    SELECT e.*, row_number() OVER (PARTITION BY e."isRepick"
                                   ORDER BY e.need DESC, e."closeDate" DESC) AS rn
      FROM eligible e
  )
  SELECT * FROM ranked WHERE rn <= $2 ORDER BY "isRepick", rn
`;

/**
 * Split the nightly slots between newly-eligible IPOs and carry-overs
 * (spec section 6.2.1). Carry-overs are guaranteed at most `repickSlots`;
 * fresh IPOs take every other slot, and a slot they leave unused goes back to
 * the carry-overs. Fresh ones are returned FIRST so they also reach the run's
 * extraction spawn budget first.
 */
export function allocateClosedIpoSlots(
  rows: ClosedIpoCandidate[],
  cap: number,
  repickSlots: number = CLOSED_IPO_JOB_REPICK_SLOTS
): ClosedIpoCandidate[] {
  const isRepick = (r: ClosedIpoCandidate) => r.isRepick === true || String(r.isRepick) === 'true';
  const fresh = rows.filter((r) => !isRepick(r));
  const repicks = rows.filter(isRepick);
  const reservedForRepicks = Math.min(Math.max(0, repickSlots), repicks.length, cap);
  const freshTaken = fresh.slice(0, Math.max(0, cap - reservedForRepicks));
  const repicksTaken = repicks.slice(0, Math.max(0, cap - freshTaken.length));
  return [...freshTaken, ...repicksTaken];
}

export async function runClosedIpoJob(deps: ClosedIpoJobDeps): Promise<ClosedIpoJobSummary> {
  const summary: ClosedIpoJobSummary = {
    candidatesConsidered: 0,
    attempted: 0,
    outcomes: { DONE: 0, PARTIAL: 0, FAILED: 0 },
    causes: {},
    skippedCycleLockHeld: false,
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
  const restrictIds = deps.restrictToIpoIds ? sql.param(deps.restrictToIpoIds) : null;
  const maxTransient = deps.maxTransientAttempts ?? CLOSED_IPO_MAX_TRANSIENT_ATTEMPTS;
  const countUnread =
    deps.countUnreadExtractableDocuments ?? ((ipoId: string) => countUnreadExtractableDocuments(deps.db, ipoId));

  // Parameters are BOUND, never interpolated. `resourcedAtVersion` is an
  // internal string today, but a query built by string-replacement is the
  // wrong shape regardless of who supplies the value.
  const result = await deps.db.execute(
    sql`
      WITH eligible AS (
        SELECT i.id, i.close_date AS "closeDate", i.status::text AS status,
               i.company_name AS "companyName", i.slug, i.segment::text AS segment,
               (r.ipo_id IS NOT NULL) AS "isRepick",
               (SELECT count(*) FROM documents d
                 WHERE d.ipo_id = i.id
                   AND COALESCE(d.extraction_status, 'PENDING') NOT IN ('COMPLETED', 'MANUAL_REVIEW', 'NOT_EXTRACTABLE')
                   AND d.type::text IN ('PRICE_BAND_AD', 'RHP', 'DRHP', 'PROSPECTUS')) AS need
          FROM ipos i
          LEFT JOIN closed_ipo_resourcing r ON r.ipo_id = i.id
         WHERE upper(i.status::text) IN ('LISTED', 'CLOSED')
           AND i.close_date < CURRENT_DATE
           AND (
             r.ipo_id IS NULL
             OR (r.outcome IN ('PARTIAL', 'FAILED')
                 AND (r.resourced_at_version IS DISTINCT FROM ${deps.resourcedAtVersion}
                      OR (r.cause_class = 'SOURCE_UNREACHABLE' AND r.attempts < ${maxTransient})))
           )
           AND (${restrictIds}::uuid[] IS NULL OR i.id = ANY(${restrictIds}::uuid[]))
      ), ranked AS (
        SELECT e.*, row_number() OVER (PARTITION BY e."isRepick"
                                       ORDER BY e.need DESC, e."closeDate" DESC) AS rn
          FROM eligible e
      )
      SELECT * FROM ranked WHERE rn <= ${cap} ORDER BY "isRepick", rn
    `
  );
  const candidates = allocateClosedIpoSlots(
    ((result as { rows?: unknown[] }).rows ?? result) as unknown as ClosedIpoCandidate[],
    cap,
    deps.repickSlots ?? CLOSED_IPO_JOB_REPICK_SLOTS
  );
  summary.candidatesConsidered = candidates.length;

  for (const candidate of candidates) {
    let outcome: ClosedIpoOutcome;
    let causeClass: ClosedIpoCauseClass | undefined;
    let causeDetail: string | undefined;
    let fieldsWritten = 0;
    let fieldsLeftEmpty = 0;
    // Review round 2 MINOR-1: an attempt is spent only when a document read was
    // actually attempted, or when there is no unread document to wait for (a
    // pure source failure must stay bounded by the attempt cap).
    let countsAsAttempt = true;

    try {
      const r = await deps.resourceIpo(candidate.id, candidate);
      const unread = await countUnread(candidate.id);
      countsAsAttempt = r.documentReadAttempted !== false || unread.pending + unread.retrying === 0;
      const guarded = applyPendingDocumentGuard(r, unread);
      outcome = guarded.outcome;
      causeClass = guarded.causeClass;
      causeDetail = guarded.causeDetail;
      fieldsWritten = guarded.fieldsWritten;
      fieldsLeftEmpty = guarded.fieldsLeftEmpty;
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
    if (outcome !== 'DONE') {
      const label = closedIpoCauseLabel(causeClass, causeDetail);
      summary.causes[label] = (summary.causes[label] ?? 0) + 1;
    }

    await deps.db
      .insert(schema.closedIpoResourcing)
      .values({
        ipoId: candidate.id,
        firstAttemptAt: now,
        lastAttemptAt: now,
        attempts: countsAsAttempt ? 1 : 0,
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
          // `attempts` counts attempts AT THIS VERSION (spec section 6.2.1):
          // the transient re-pick bound reads it, and a version bump re-opens
          // the IPO with a fresh budget rather than one it already spent.
          attempts: countsAsAttempt
            ? sql`CASE WHEN ${schema.closedIpoResourcing.resourcedAtVersion} = ${deps.resourcedAtVersion}
                       THEN ${schema.closedIpoResourcing.attempts} + 1 ELSE 1 END`
            : sql`CASE WHEN ${schema.closedIpoResourcing.resourcedAtVersion} = ${deps.resourcedAtVersion}
                       THEN ${schema.closedIpoResourcing.attempts} ELSE 0 END`,
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
      {
        ipoId: candidate.id,
        outcome,
        causeClass,
        cause: outcome === 'DONE' ? undefined : closedIpoCauseLabel(causeClass, causeDetail),
        causeDetail,
        attemptCounted: countsAsAttempt,
        fieldsWritten,
        fieldsLeftEmpty,
      },
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
      causes: summary.causes,
    },
    'closed-IPO job: run complete'
  );
  return summary;
}

/**
 * The four document types an extractor exists for. Kept equal to
 * `EXTRACTABLE_DOC_TYPES` by a unit test, because the selection ORDER BY above
 * and the guard below must count the same population.
 */
export const CLOSED_IPO_EXTRACTABLE_TYPES = ['PRICE_BAND_AD', 'RHP', 'DRHP', 'PROSPECTUS'] as const;

/**
 * The selection signal, re-read after the worker: UNREAD extractable documents
 * of one IPO (review round 1 MAJOR-1). A FAILED document awaiting its own
 * retry, or one left IN_PROGRESS by a crashed run, is exactly as unread as a
 * PENDING one -- `selectPendingFilings` skips it while it backs off, so a pass
 * over it looks clean, and counting PENDING alone wrote such IPOs DONE.
 */
export async function countUnreadExtractableDocuments(
  db: NodePgDatabase<typeof schema>,
  ipoId: string
): Promise<UnreadDocumentCount> {
  const res = await db.execute(
    sql`SELECT count(*) FILTER (WHERE COALESCE(d.extraction_status, 'PENDING') NOT IN ('FAILED', 'IN_PROGRESS'))::int AS pending,
               count(*) FILTER (WHERE d.extraction_status IN ('FAILED', 'IN_PROGRESS'))::int AS retrying
          FROM documents d
         WHERE d.ipo_id = ${ipoId}
           AND COALESCE(d.extraction_status, 'PENDING') NOT IN ('COMPLETED', 'MANUAL_REVIEW', 'NOT_EXTRACTABLE')
           AND d.type::text IN ('PRICE_BAND_AD', 'RHP', 'DRHP', 'PROSPECTUS')`
  );
  const rows = ((res as { rows?: unknown[] }).rows ?? (res as unknown as unknown[])) as Array<{
    pending?: unknown;
    retrying?: unknown;
  }>;
  const num = (v: unknown) => {
    const n = Number(v ?? 0);
    return Number.isFinite(n) ? n : 0;
  };
  return { pending: num(rows[0]?.pending), retrying: num(rows[0]?.retrying) };
}

/** Marker at the start of every transient cause_detail, so a reader can tell it from the source-down case. */
export const TRANSIENT_DETAIL_PREFIX = 'transient:';

/**
 * Review round 2 MINOR-2: `cause_class` is a Postgres enum with no value for
 * "a document is waiting on its own retry" or "the extractor crashed", so both
 * are recorded as SOURCE_UNREACHABLE (the one re-pickable class) with a
 * `transient:` detail. The run report groups by THIS label, never by the bare
 * class, so a SOURCE_UNREACHABLE count never reads as "the source is down" when
 * it is a document backing off or an extractor crash (signal-ownership R6).
 */
export function closedIpoCauseLabel(causeClass?: ClosedIpoCauseClass | null, causeDetail?: string | null): string {
  if (!causeClass) return 'none';
  if (causeClass === 'SOURCE_UNREACHABLE' && (causeDetail ?? '').startsWith(TRANSIENT_DETAIL_PREFIX)) {
    return 'SOURCE_UNREACHABLE/transient';
  }
  return causeClass;
}

/**
 * #717: DONE requires the reason the IPO was selected to be resolved, and
 * (review round 2 MAJOR) a PERMANENT outcome requires every unread document to
 * be permanently out of reach.
 *
 * The job selects an IPO because it holds an unread extractable document. The
 * class rule, applied to every outcome the worker can return:
 *
 *  - ANY unread document still awaiting its own retry (FAILED / IN_PROGRESS)
 *    makes the row RE-PICKABLE: cause SOURCE_UNREACHABLE with a `transient:`
 *    detail, whatever the worker said. DONE becomes PARTIAL; PARTIAL/FAILED
 *    keep their outcome; a permanent worker cause (DOCUMENT_UNOBTAINABLE,
 *    WRITE_SKIPPED, ...) is kept in the detail, never allowed to bury the
 *    document. Round 1 did this for DONE only, so a walk returning
 *    PARTIAL/DOCUMENT_UNOBTAINABLE stranded a document that was only backing
 *    off. The document's own cap then decides when it stops: at
 *    MAX_EXTRACTION_ATTEMPTS it becomes MANUAL_REVIEW, which is terminal here.
 *  - only PENDING documents left and the worker said DONE: the pass could not
 *    get at them (no stored file, no sha, an SME gate), so the worker's cause
 *    is kept, or DOCUMENT_UNOBTAINABLE -- permanent until the version changes.
 *  - a worker PARTIAL/FAILED with nothing retrying is left as it reported.
 */
export function applyPendingDocumentGuard(
  r: ClosedIpoResourceResult,
  unread: UnreadDocumentCount
): ClosedIpoResourceResult {
  const total = unread.pending + unread.retrying;
  if (total <= 0) return r;
  if (unread.retrying > 0) {
    if (r.outcome !== 'DONE' && closedIpoCauseLabel(r.causeClass, r.causeDetail) === 'SOURCE_UNREACHABLE/transient') {
      return r;
    }
    // With no extractor (ENABLE_FILING_AUTO_PERSIST off) no document is
    // retriable by this job, so the permanent cause is the true one.
    if (r.outcome !== 'DONE' && r.causeClass === 'EXTRACTOR_MISSING') return r;
    const note =
      `${TRANSIENT_DETAIL_PREFIX} ${unread.retrying} extractable document(s) awaiting retry on their own backoff` +
      (unread.pending > 0 ? `, ${unread.pending} still PENDING` : '');
    const kept = r.causeClass ? `also ${r.causeClass}${r.causeDetail ? `: ${r.causeDetail}` : ''}` : r.causeDetail;
    return {
      ...r,
      outcome: r.outcome === 'DONE' ? 'PARTIAL' : r.outcome,
      causeClass: 'SOURCE_UNREACHABLE',
      causeDetail: kept ? `${note}; ${kept}` : note,
    };
  }
  if (r.outcome !== 'DONE') return r;
  const note = `${unread.pending} extractable document(s) still PENDING after this pass`;
  return {
    ...r,
    outcome: 'PARTIAL',
    causeClass: r.causeClass ?? 'DOCUMENT_UNOBTAINABLE',
    causeDetail: r.causeDetail ? `${note}; ${r.causeDetail}` : note,
  };
}

/** What happened when the job tried to extract the IPO's pending documents. */
export type ClosedIpoExtractionPass =
  | { attempted: false; causeClass: ClosedIpoCauseClass; reason: string }
  | { attempted: true; result: AutoPersistResult };

const OUTCOME_RANK: Record<ClosedIpoOutcome, number> = { DONE: 0, PARTIAL: 1, FAILED: 2 };

/**
 * Map one extraction pass to a ledger outcome.
 *
 *   not attempted (flag off, lock held,   -> PARTIAL with the caller's cause
 *     budget spent, document load threw)     (transient ones: SOURCE_UNREACHABLE).
 *   a document failed extraction/persist  -> FAILED (PARTIAL if another
 *                                            persisted) / SOURCE_UNREACHABLE:
 *                                            transient, the document retries
 *                                            on its own backoff and cap.
 *   documents left for the spawn budget   -> PARTIAL / SOURCE_UNREACHABLE
 *                                            (transient: re-picked next run).
 *   otherwise                             -> DONE, which the pending-document
 *                                            guard still has to agree with.
 */
export function classifyExtractionPass(pass: ClosedIpoExtractionPass): {
  outcome: ClosedIpoOutcome;
  causeClass?: ClosedIpoCauseClass;
  causeDetail?: string;
  documentReadAttempted: boolean;
} {
  // Explicit casts: scraper/ compiles with strict off, where a boolean-literal
  // discriminant does not narrow the union.
  if (!pass.attempted) {
    const skip = pass as Extract<ClosedIpoExtractionPass, { attempted: false }>;
    return {
      outcome: 'PARTIAL',
      causeClass: skip.causeClass,
      causeDetail: `extraction not run: ${skip.reason}`,
      documentReadAttempted: false,
    };
  }
  const r = (pass as Extract<ClosedIpoExtractionPass, { attempted: true }>).result;
  // A document read was attempted when anything was spawned, extracted,
  // persisted or failed. A pass whose only effect was skipping documents inside
  // their backoff read nothing (review round 2 MINOR-1).
  const documentReadAttempted =
    (r.spawned ?? 0) + (r.anchorsSpawned ?? 0) + (r.extracted ?? 0) + (r.persisted ?? 0) + (r.failed ?? 0) > 0;
  const skipped = r.skipped.slice(0, 5).join('; ');
  if (r.failed > 0) {
    // Review round 1 MAJOR-2: an extractor failure (a timeout, a crash, a
    // persist throw, a W-45 refusal) is NOT a verdict on the IPO. The document
    // is FAILED with its own retry count and backoff, and is retried until
    // MAX_EXTRACTION_ATTEMPTS makes it MANUAL_REVIEW. So the IPO is recorded
    // transient (SOURCE_UNREACHABLE: the only re-pickable class the enum has)
    // and the detail says what really happened.
    return {
      outcome: r.persisted > 0 ? 'PARTIAL' : 'FAILED',
      causeClass: 'SOURCE_UNREACHABLE',
      causeDetail: `${TRANSIENT_DETAIL_PREFIX} ${r.failed} document(s) failed extraction or persist; each retries on its own backoff up to ${MAX_EXTRACTION_ATTEMPTS} attempts${skipped ? `; ${skipped}` : ''}`,
      documentReadAttempted,
    };
  }
  if (r.skippedBudget > 0) {
    return {
      outcome: 'PARTIAL',
      causeClass: 'SOURCE_UNREACHABLE',
      causeDetail: `${TRANSIENT_DETAIL_PREFIX} ${r.skippedBudget} document(s) left for the next run: spawn budget spent`,
      documentReadAttempted,
    };
  }
  return { outcome: 'DONE', documentReadAttempted };
}

/**
 * Worst of two outcomes; the cause travels with the worse one -- except that a
 * TRANSIENT half (SOURCE_UNREACHABLE) keeps the combined row re-pickable:
 * otherwise a permanent walk cause would bury a document that is only
 * waiting for its retry, and the IPO would never be picked for it again.
 */
export function combineClosedIpoOutcomes(
  a: { outcome: ClosedIpoOutcome; causeClass?: ClosedIpoCauseClass; causeDetail?: string },
  b: { outcome: ClosedIpoOutcome; causeClass?: ClosedIpoCauseClass; causeDetail?: string }
): { outcome: ClosedIpoOutcome; causeClass?: ClosedIpoCauseClass; causeDetail?: string } {
  const worse = OUTCOME_RANK[b.outcome] > OUTCOME_RANK[a.outcome] ? b : a;
  const other = worse === a ? b : a;
  if (
    worse.outcome !== 'DONE' &&
    other.outcome !== 'DONE' &&
    other.causeClass === 'SOURCE_UNREACHABLE' &&
    worse.causeClass !== 'SOURCE_UNREACHABLE'
  ) {
    return {
      outcome: worse.outcome,
      causeClass: 'SOURCE_UNREACHABLE',
      causeDetail: [other.causeDetail, worse.causeClass ? `also ${worse.causeClass}: ${worse.causeDetail ?? ''}` : worse.causeDetail]
        .filter(Boolean)
        .join('; '),
    };
  }
  return worse;
}

/**
 * #717: extract the IPO's pending documents through the SAME entry point the
 * document cycle uses (`processPendingFilings`), never a second extractor.
 * That entry point already refuses to re-read a document COMPLETED at the
 * current extractor version (OD-33: a document is read once) and applies each
 * document's own retry gate, so calling it here cannot double-read.
 */
export async function extractClosedIpoDocuments(
  candidate: ClosedIpoCandidate,
  deps: AutoPersistDeps
): Promise<ClosedIpoExtractionPass> {
  // Review round 1 MAJOR-2: `processPendingFilings` has two early returns that
  // hand back an all-zero result indistinguishable from "nothing to do": every
  // spawn budget already spent, and a throw while loading the documents. Both
  // are TRANSIENT facts about this run, so they are detected here and reported
  // as not attempted with SOURCE_UNREACHABLE -- never left to read as clean.
  const filingBudgetExhausted = deps.spawnBudget !== undefined && deps.spawnBudget.remaining <= 0;
  const anchorBudgetAvailable = deps.anchorSpawnBudget === undefined || deps.anchorSpawnBudget.remaining > 0;
  if (filingBudgetExhausted && !anchorBudgetAvailable) {
    return {
      attempted: false,
      causeClass: 'SOURCE_UNREACHABLE',
      reason: `${TRANSIENT_DETAIL_PREFIX} this run's extraction spawn budget was spent before this IPO`,
    };
  }
  let loadError: string | undefined;
  const capture =
    <A extends unknown[], R>(fn: (...args: A) => Promise<R>) =>
    async (...args: A): Promise<R> => {
      try {
        return await fn(...args);
      } catch (error) {
        loadError = error instanceof Error ? error.message : String(error);
        throw error;
      }
    };
  const result = await processPendingFilings(
    {
      id: candidate.id,
      companyName: candidate.companyName ?? '',
      slug: candidate.slug ?? null,
      segment: candidate.segment ?? null,
    },
    // Same object identity for the budgets: they are shared across the run.
    { ...deps, loadDocuments: capture(deps.loadDocuments), loadStates: capture(deps.loadStates) }
  );
  if (loadError !== undefined) {
    return {
      attempted: false,
      causeClass: 'SOURCE_UNREACHABLE',
      reason: `${TRANSIENT_DETAIL_PREFIX} could not load the IPO's documents: ${loadError}`,
    };
  }
  return { attempted: true, result };
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
