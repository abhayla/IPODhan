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
  /** Stamped onto every row so a later version can re-select an IPO this version gave up on. */
  resourcedAtVersion: string;
  now?: Date;
  cap?: number;
}

export interface ClosedIpoJobSummary {
  candidatesConsidered: number;
  attempted: number;
  outcomes: Record<ClosedIpoOutcome, number>;
  skippedCycleLockHeld: boolean;
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
   ORDER BY i.close_date DESC
   LIMIT $2
`;

export async function runClosedIpoJob(deps: ClosedIpoJobDeps): Promise<ClosedIpoJobSummary> {
  const summary: ClosedIpoJobSummary = {
    candidatesConsidered: 0,
    attempted: 0,
    outcomes: { DONE: 0, PARTIAL: 0, FAILED: 0 },
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

  // Parameters are BOUND, never interpolated. `resourcedAtVersion` is an
  // internal string today, but a query built by string-replacement is the
  // wrong shape regardless of who supplies the value.
  const result = await deps.db.execute(
    sql`
      SELECT i.id, i.close_date AS "closeDate", i.status::text AS status
        FROM ipos i
        LEFT JOIN closed_ipo_resourcing r ON r.ipo_id = i.id
       WHERE upper(i.status::text) IN ('LISTED', 'CLOSED')
         AND i.close_date < CURRENT_DATE
         AND (
           r.ipo_id IS NULL
           OR (r.outcome IN ('PARTIAL', 'FAILED') AND r.resourced_at_version IS DISTINCT FROM ${deps.resourcedAtVersion})
         )
       ORDER BY i.close_date DESC
       LIMIT ${cap}
    `
  );
  const candidates = (result.rows ?? result) as unknown as ClosedIpoCandidate[];
  summary.candidatesConsidered = candidates.length;

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
