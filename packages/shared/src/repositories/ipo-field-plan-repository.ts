/**
 * IPO Field Plan Repository — pull model, design §2.3 (item 5 slice s3).
 *
 * `ipo_field_plan` records what the pull loop ASKED for, not only what it got.
 * This module owns the two writes that make the plan trustworthy, and both are
 * concurrency problems before they are persistence problems:
 *
 *   1. `claimNextDueField` — hands ONE due row to ONE walker. Two walkers
 *      claiming the same row would each fetch the same document and race each
 *      other's writes, and nothing downstream would ever notice. A
 *      select-then-update cannot prevent that: between the select and the
 *      update both transactions see the row unclaimed. So the claim is ONE
 *      statement whose inner select takes `FOR UPDATE SKIP LOCKED` — the
 *      loser's select skips the locked row and returns nothing, so the loser
 *      gets `null` rather than a second copy of the same work.
 *
 *   2. `recordOutcome` — writes an attempt's result back. Two guards:
 *
 *      * **Superseded claim.** A walker that was killed, reclaimed, and then
 *        wakes up must not stamp its stale result over the newer walker's
 *        work. The write is conditional on `claim_token` still matching; when
 *        it does not, NOTHING is written and the caller is told so.
 *
 *      * **Skipped write.** `consolidatedUpsertIPO` returns
 *        `skipped: true, skipReason: 'LOCK_NOT_ACQUIRED'` SILENTLY
 *        (`data-consolidation-orchestrator.ts:137-139`). Design §2.3: "The
 *        plan row is written from the RESULT of the write, never in parallel
 *        with it… a skipped return leaves the row PENDING with `attempts`
 *        untouched." A row marked SUPPLIED against a dropped write is a
 *        false-clean state every downstream check reads as success, and
 *        charging an attempt would burn the field's backoff budget for work
 *        that never happened. Only the claim is released.
 *
 * Deliberately NOT cached, for the same reason as
 * `document-fetch-state-repository.ts`: this table is the walk's memory of
 * what it has already done, and a cached answer would make it redo it. It
 * still extends `BaseRepository` for construction consistency.
 *
 * SCOPE: the repository only. The walk that calls it is item 6; plan-row
 * generation and manifest reconciliation are slices 1/2 and a later slice.
 *
 * Item 5 slice s4 adds `upsertGeneratedRows` — the write path that lets the
 * generator's pure output (`generateFieldPlan`, field-plan-generator.ts)
 * actually reach the table. Design §2.3: "the plan is reconciled when the
 * manifest changes, never regenerated per cycle." A row appears for a NEW
 * (ipo, table, row_key, field) combination — which is exactly what happens
 * on its own when `manifest_version` changes and the generator plans a
 * field under a key it did not plan before — never a duplicate for a key
 * that already exists.
 *
 * Item 3 slice S7 (#732) narrowed that reconciliation: `INSERT ... ON
 * CONFLICT (ipo_id, table_name, row_key, field_name) DO UPDATE` now
 * re-ranks an EXISTING row's `rank1_source` / `rank2_source` / `rank3_source`
 * / `manifest_version` / `policy_origin` in place when the incoming version
 * is strictly higher and the row is not `SUPPLIED` — see the method's own
 * doc comment for the exact contract. Every other column (`state`,
 * `attempts`, `next_due_at`, `claimed_at`, `claim_token`, every `chosen_*`
 * column) is still never carried back in by this call.
 */

import { sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type Redis from 'ioredis';
import { randomUUID } from 'crypto';
import { BaseRepository } from './base-repository';
import type * as schema from '../db/schema';
import { DatabaseError } from '../errors/repository-errors';
import { FIELD_PLAN_GAP_KEY_PREFIX, stampFieldPlanGapCause } from '../utils/field-plan-config-gap';

/**
 * Bind a JS `Date` to a NAIVE `timestamp` column as the instant it actually is.
 *
 * Every timestamp column on `ipo_field_plan` (`next_due_at`, `last_attempt_at`,
 * `claimed_at`, `created_at`, `updated_at`) is a bare
 * `timestamp` — no `withTimezone`. node-postgres serialises a bound `Date`
 * OBJECT using the PROCESS's local zone, so on this project's IST machines a
 * value is stored 5h30m ahead of the instant it represents, while the query it
 * is compared against uses Postgres `now()` in UTC. The two clocks disagree and
 * the comparison is silently wrong.
 *
 * Measured on ipodhan_test, 2026-09-19, a Date one hour in the future:
 *   bind the Date object -> stored `2026-09-19 02:12:58`   (WRONG, +5:30)
 *   bind `.toISOString()` -> stored `2026-09-18 20:42:58`  (correct)
 *   postgres now() (UTC)  ->        `2026-09-18 19:43:00`
 * So a row due in an hour read as already due, and "not yet due" rows were
 * claimed — the five red integration tests this fixes.
 *
 * Per `.claude/rules/ist-timezone.md`: timestamps are STORED in UTC and shown
 * in IST at the edge. This helper is the storage half.
 */
function utc(value: Date): string {
  return value.toISOString();
}

/**
 * A claim older than this is assumed to belong to a killed walk and is
 * reclaimable. Mirrors `IN_PROGRESS_STALE_MINUTES` in
 * `scraper/src/services/document-state-machine.ts:721` — the same recovery
 * convention, deliberately the same number, so a reader does not have to hold
 * two staleness rules in their head.
 */
export const FIELD_PLAN_CLAIM_STALE_MINUTES = 30;

/** Per-field backoff between attempts, doubling, capped. */
export const FIELD_PLAN_BACKOFF_BASE_MINUTES = 15;
export const FIELD_PLAN_BACKOFF_MAX_MINUTES = 6 * 60;

/**
 * #762 (S8): how many times a NOT_AVAILABLE_YET / CHECK_FAILED row is
 * reclaimed by `claimNextDueField` before the re-ask path stops offering it.
 * Mirrors `NOT_FOUND_MAX_ATTEMPTS` in
 * `scraper/src/services/document-state-machine.ts:451` — the same "N
 * transient misses is no longer transient" convention, same shape (a claim
 * filter, not a state transition). A row at or past this ceiling is simply
 * never selected here; it is NOT moved to EXHAUSTED by this query (that
 * would be a `recordOutcome`/state-machine change, out of this fix's scope
 * per the S8 brief) — it just stops churning through every slot forever.
 */
export const FIELD_PLAN_RECLAIM_MAX_ATTEMPTS = 5;

// #884: the gap vocabulary lives in a dependency-free module so the scraper
// walk (which classifies) and this repository (which stamps and claims) read
// ONE definition. Re-exported so existing `@ipodhan/shared` importers see it.
export {
  FIELD_PLAN_CONFIG_GAP_CAUSE_MARKERS,
  FIELD_PLAN_GAP_CODES,
  FIELD_PLAN_GAP_KEY_PREFIX,
  fieldPlanGapKeyOf,
  isFieldPlanConfigGapCause,
  stampFieldPlanGapCause,
  type FieldPlanGapCode,
} from '../utils/field-plan-config-gap';

/**
 * #884 review round 1: is the row's cause gap-stamped (`[gap-key:<k>] ...`)?
 * A FUNCTION returning a FRESH fragment per call — the claim query's own
 * comments record that reusing one drizzle `SQL` object across interpolation
 * points returned rows violating their WHERE clause (drizzle-orm 0.44.7).
 * `left()` compares the fixed prefix exactly; no LIKE wildcards involved.
 */
function gapStampedSql() {
  return sql`(cause IS NOT NULL AND left(cause, ${FIELD_PLAN_GAP_KEY_PREFIX.length}) = ${FIELD_PLAN_GAP_KEY_PREFIX})`;
}

/**
 * #762 (S8): the daily discovery-slot boundaries the field-plan re-ask keys
 * its reclaim on, IN MINUTES SINCE IST MIDNIGHT. Deliberately the SAME
 * values as `DISCOVERY_SLOTS_IST_MINUTES` in
 * `scraper/src/scheduler/due-step-cycle.ts` — that module cannot be
 * imported here (scraper depends on @ipodhan/shared, never the reverse;
 * see `packages/shared/package.json` / `scraper/package.json`), so this is
 * a deliberate duplicate of the CONSTANT and its pure arithmetic, the same
 * pattern `scripts/lib/ist-day.mjs` already uses for
 * `packages/shared/src/utils/ist-day.ts` (plain Node cannot import
 * TypeScript there; here it is a one-way package dependency instead). A
 * test in this package pins these values equal to the scraper module's, so
 * the two can never drift silently.
 *
 * NOT a timer: this only ever answers "has a NEW slot begun since X", never
 * "has N minutes elapsed since X" — the OD-33 / design-doc D12 rule ("no
 * code path schedules a document fetch by elapsed time") governs this claim
 * query exactly as it governs the document-fetch scheduler that named it.
 */
const FIELD_PLAN_SLOT_IST_MINUTES = [8 * 60 + 30, 11 * 60, 14 * 60, 17 * 60 + 30] as const;
const IST_OFFSET_MINUTES = 5 * 60 + 30;

/**
 * The most recent slot boundary at-or-before `now`, as an absolute instant
 * (a `Date`). Pure and clock-injectable — mirrors
 * `mostRecentDiscoverySlotEpochMinute` in `due-step-cycle.ts` exactly (same
 * "day index in IST, minutes-of-day in IST, walk the slots" shape), kept
 * here as its own tiny function so the SQL below can bind ONE timestamp
 * parameter rather than re-deriving the slot inside the query.
 */
export function mostRecentFieldPlanSlotBoundary(now: Date): Date {
  const istMs = now.getTime() + IST_OFFSET_MINUTES * 60_000;
  const dayIndex = Math.floor(istMs / 86_400_000);
  const istDate = new Date(istMs);
  const minutesOfDay = istDate.getUTCHours() * 60 + istDate.getUTCMinutes();

  let dueSlotOfDay: number | null = null;
  for (const slot of FIELD_PLAN_SLOT_IST_MINUTES) {
    if (minutesOfDay >= slot) dueSlotOfDay = slot;
  }

  const epochMinute =
    dueSlotOfDay === null
      ? (dayIndex - 1) * 1440 + FIELD_PLAN_SLOT_IST_MINUTES[FIELD_PLAN_SLOT_IST_MINUTES.length - 1]
      : dayIndex * 1440 + dueSlotOfDay;

  return new Date(epochMinute * 60_000 - IST_OFFSET_MINUTES * 60_000);
}

export type FieldPlanState =
  | 'PENDING'
  | 'SUPPLIED'
  | 'NOT_PRINTED'
  | 'NOT_AVAILABLE_YET'
  | 'CHECK_FAILED'
  | 'EXHAUSTED';

/** States that end the ask — no further attempt is ever scheduled. */
const TERMINAL_STATES: ReadonlySet<FieldPlanState> = new Set([
  'SUPPLIED',
  'NOT_PRINTED',
  'EXHAUSTED',
]);

export interface IpoFieldPlanRow {
  id: string;
  ipoId: string;
  tableName: string;
  rowKey: string;
  fieldName: string;
  rank1Source: string | null;
  rank2Source: string | null;
  rank3Source: string | null;
  state: FieldPlanState;
  chosenSource: string | null;
  chosenRank: number | null;
  chosenDocumentId: string | null;
  chosenDocumentType: string | null;
  chosenSha256: string | null;
  chosenPage: number | null;
  attempts: number;
  lastAttemptAt: Date | null;
  nextDueAt: Date | null;
  claimedAt: Date | null;
  claimToken: string | null;
  manifestVersion: number;
  policyOrigin: string | null;
  /** S4 (#779): the classification of why a not-supplied state was reached. NULL on pre-S4 rows. */
  reasonCode: string | null;
  /** S4 (#779): the raw cause the classification was derived from. NULL on pre-S4 rows. */
  cause: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ClaimNextDueFieldParams {
  /** Narrow the claim to one IPO. Omitted, the whole plan is in scope. */
  ipoId?: string;
  /** Injectable clock, so a test can place `now` either side of the window. */
  now?: Date;
  /** Override the staleness window (minutes). Defaults to the constant. */
  staleMinutes?: number;
  /**
   * #884 review round 2: the CURRENT gap keys PER FIELD, keyed `table.field`
   * (the scraper's `fieldPlanClaimGapKeys`: the field's own manifest-entry
   * content + fetcher coverage + extractor version, and a variant that adds
   * the IPO's COMPLETED documents in the field's family). A gap row whose
   * stamped key is none of its field's current keys is offered — including a
   * row whose field left the manifest. Omitted, no gap row is ever offered.
   */
  gapKeys?: Record<string, readonly string[]>;
  /**
   * #762 (S8) review round 2 CRITICAL fix: row ids this WALK has already
   * settled this pass (`field-plan-walk.ts`'s `settledThisWalk`), excluded
   * from every leg so an un-handleable row (a dropped write left PENDING,
   * or an admin-protection skip that releases without recording — both
   * re-queue the SAME row immediately) does not starve every OTHER due row
   * behind it. Before this param existed, `pri = 0` ranked every PENDING
   * row ahead of every reclaim leg, so a released-but-still-PENDING row was
   * guaranteed to come back as the claim's answer every single time — the
   * walk's own `settledThisWalk` re-claim guard then stopped the WHOLE
   * walk (`stoppedReason = 'NO_DUE_FIELDS'`), discarding every reclaim row
   * ranked below it. Reviewer repro: one un-handleable PENDING row blocked
   * all reclaim rows on the IPO; live on staging (180 PENDING rows, 1 IPO,
   * confirmed live 2026-09-18). Excluding ids here means the SAME row is
   * never re-offered within one walk; the walk keeps draining until either
   * the budget or genuinely-no-due-work stops it, exactly as the original
   * single-branch query's ordering accidentally guaranteed and the
   * restructure broke.
   */
  excludeIds?: string[];
}

/** What won, and on what evidence (design §2.3 — this is what makes §2.5 work). */
export interface ChosenEvidence {
  source?: string | null;
  rank?: number | null;
  documentId?: string | null;
  documentType?: string | null;
  sha256?: string | null;
  page?: number | null;
}

export interface RecordOutcomeParams {
  planRowId: string;
  /** The token this walker was handed by `claimNextDueField`. */
  claimToken: string;
  /**
   * Whether the underlying write actually ran. `false` for a
   * `skipped: true, skipReason: 'LOCK_NOT_ACQUIRED'` return — see the skipped
   * branch in `recordOutcome`.
   */
  writeHappened: boolean;
  skipReason?: string;
  /** The state the attempt concluded in. Ignored entirely when skipped. */
  state?: FieldPlanState;
  chosen?: ChosenEvidence;
  /**
   * 'registry:<version>' | 'override:<id>' — which configuration produced
   * the ranks this attempt walked (S1a review CRITICAL-1). Provided on
   * every non-skipped branch so `policy_origin` tracks the ranks the walk
   * actually asked, not just the generator's original write. Omitted (the
   * skipped branch, where no ranks were walked) leaves the column as-is.
   */
  policyOrigin?: string | null;
  /**
   * S4 (#779): the classification of why this attempt did not end SUPPLIED —
   * one of OD-62's codes, or omitted/null on a branch that computed none
   * (SUPPLIED itself, or an EXHAUSTED settled on a NOT_PRINTED answer that
   * never entered `failures[]`). Provided alongside `cause`, or not at all —
   * see `recordOutcome`'s doc comment for why they are written together.
   */
  reasonCode?: string | null;
  /** S4 (#779): the raw cause string the classification above was derived from. */
  cause?: string | null;
  /**
   * #884 review round 1: set ONLY by the walk, and only when EVERY rank failed
   * with a structured gap code. Marks this CHECK_FAILED as not an attempt and
   * stamps `cause` with the key, so the row is re-offered only when the key
   * changes. Ignored for any other state.
   */
  gapKey?: string | null;
  now?: Date;
}

export interface RecordOutcomeResult {
  /** False ONLY when the write was refused; no column changed in that case. */
  written: boolean;
  /** True when the underlying write was dropped and the row was left PENDING. */
  skipped?: boolean;
  /** Why the write was refused, when it was. */
  reason?: 'CLAIM_SUPERSEDED';
  row?: IpoFieldPlanRow;
}

/** attempts 0 -> 15m, 1 -> 30m, 2 -> 60m … capped at 6h. */
export function fieldPlanBackoffMinutes(attemptsAfterThisOne: number): number {
  const exponent = Math.max(0, attemptsAfterThisOne - 1);
  const minutes = FIELD_PLAN_BACKOFF_BASE_MINUTES * 2 ** exponent;
  return Math.min(minutes, FIELD_PLAN_BACKOFF_MAX_MINUTES);
}

/**
 * One row the generator wants inserted, shaped independently of
 * `field-plan-generator.ts`'s `PlannedFieldRow` (that module lives in
 * `scraper/`, which `packages/shared` cannot import — the caller maps its
 * own `PlannedFieldRow[]` onto this shape). All state is the generator's
 * fresh-row defaults (`PENDING`, zero attempts, nothing chosen) because a
 * row this call inserts is by definition one that did not exist before.
 *
 * For a row that DID already exist: `upsertGeneratedRows` still never
 * carries its LIVE state back in (`state`, `attempts`, `next_due_at`,
 * `claimed_at`, `claim_token`, every `chosen_*` column all keep their
 * on-disk values) — but since item 3 slice S7 (#732) it DOES refresh that
 * row's ranking columns (`rank1/2/3Source`, `manifestVersion`,
 * `policyOrigin`) in place when this row's `manifestVersion` is strictly
 * higher than what is on disk and the row is not `SUPPLIED`. See
 * `upsertGeneratedRows`'s own doc comment for the exact contract.
 */
export interface GeneratedFieldPlanRow {
  ipoId: string;
  tableName: string;
  rowKey: string;
  fieldName: string;
  rank1Source: string | null;
  rank2Source: string | null;
  rank3Source: string | null;
  manifestVersion: number;
  /** 'registry:<version>' | 'override:<id>' — which configuration produced this row's ranks. */
  policyOrigin: string;
}

export interface UpsertGeneratedRowsResult {
  /** How many NEW rows this call actually inserted — never counts a re-rank. */
  inserted: number;
  /**
   * How many EXISTING rows this call re-ranked in place (item 3 slice S7,
   * #732) because the incoming `manifest_version` was strictly higher than
   * the row's own and the row was not `SUPPLIED`. Distinct from `inserted`
   * so a caller that only ever meant "new rows" (the S2 repair tool's
   * missing-row phase, which by construction never hits a conflict) keeps
   * reading the same number it always did.
   */
  updated: number;
}

/**
 * Item 3 slice S2 — one non-terminal, stale-version row, joined with the
 * `ipos` identity fields a repair tool needs to (a) print identities, never a
 * bare count, and (b) resolve the current policy for that IPO's type without
 * a second query per row.
 */
export interface PlanRowBelowVersion {
  id: string;
  ipoId: string;
  tableName: string;
  rowKey: string;
  fieldName: string;
  rank1Source: string | null;
  rank2Source: string | null;
  rank3Source: string | null;
  state: FieldPlanState;
  manifestVersion: number;
  policyOrigin: string | null;
  ipoSlug: string | null;
  ipoName: string | null;
  ipoSegment: 'MAINBOARD' | 'SME' | null;
  ipoListingExchanges: ('NSE' | 'BSE')[] | null;
  /**
   * CRITICAL-2 fix (independent Tier A review, item 3 S2): the row-insert
   * gate needs the SAME fields `isInLiveWindow` reads for the live pipeline
   * (`document-cycle.ts:988-1000` / `document-state-machine.ts:751`), so the
   * repair tool can reuse that predicate instead of re-implementing it.
   */
  ipoStatus: string | null;
  ipoListingDate: Date | null;
}

/** One row's new ranks, resolved by the caller from the current policy. */
export interface PlanRowRankUpdate {
  id: string;
  rank1Source: string | null;
  rank2Source: string | null;
  rank3Source: string | null;
  manifestVersion: number;
  policyOrigin: string;
}

export class IpoFieldPlanRepository extends BaseRepository {
  constructor(db: NodePgDatabase<typeof schema>, redis: Redis) {
    super(db, redis);
  }

  /**
   * Insert the generator's rows for one IPO, RECONCILED never REGENERATED —
   * and, since item 3 slice S7 (#732), RE-RANKED on a version increase
   * rather than left stale forever.
   *
   * `ON CONFLICT (ipo_id, table_name, row_key, field_name) DO UPDATE` now
   * fires when a row already exists at that key, but the UPDATE's own `SET`
   * list and `WHERE` clause narrow it to exactly one thing: refresh the
   * ranking columns (`rank1_source`, `rank2_source`, `rank3_source`,
   * `manifest_version`, `policy_origin`, `updated_at`) when, and ONLY when,
   * the incoming row carries a STRICTLY HIGHER `manifest_version` than the
   * row already on disk, AND that row has not already been `SUPPLIED`.
   * Every other column — `state`, `attempts`, `next_due_at`, `claimed_at`,
   * `claim_token`, every `chosen_*` column — is absent from the `SET` list,
   * so Postgres leaves it byte-for-byte as it was; this DELIBERATELY narrows
   * the prior "never carries an existing row's live state back in" contract
   * to "never carries live state EXCEPT the ranks, and only forward". A
   * SUPPLIED row is still never touched — the ask was already answered, and
   * rewriting its ranks would misrepresent how that answer was actually
   * sourced. A same-version re-run changes nothing (the `<` comparison is
   * false), so the insert stays idempotent per cycle exactly as before. A
   * `manifest_version` bump that adds a field under a key not previously
   * planned still inserts exactly that new row.
   *
   * The `xmax = 0` trick in `RETURNING` is the ONLY reliable way to tell an
   * INSERT from an UPDATE out of one `INSERT ... ON CONFLICT` statement:
   * `xmax` is the system column holding the deleting/locking transaction id
   * for a row version, which is 0 for a version a fresh INSERT just created
   * and non-zero for a version an UPDATE just superseded. Getting this
   * wrong makes `inserted` silently start counting updates too — every
   * caller (`document-cycle.ts` PASS 2.5's cycle summary,
   * `repair-plan-rows-to-manifest-version.ts`'s operator-facing "inserted N
   * rows" line) trusts that number, so `inserted` counts ONLY genuine
   * inserts and `updated` is returned alongside it, never folded in.
   *
   * Empty input is a no-op (an IPO's type key produced zero rows, or the
   * caller was already given an empty array) — never a wasted round trip.
   */
  async upsertGeneratedRows(rows: GeneratedFieldPlanRow[]): Promise<UpsertGeneratedRowsResult> {
    if (rows.length === 0) return { inserted: 0, updated: 0 };

    try {
      const values = sql.join(
        rows.map(
          (r) =>
            sql`(${r.ipoId}::uuid, ${r.tableName}, ${r.rowKey}, ${r.fieldName}, ${r.rank1Source}, ${r.rank2Source}, ${r.rank3Source}, ${r.manifestVersion}, ${r.policyOrigin})`
        ),
        sql`, `
      );

      const result = await this.db.execute(sql`
        INSERT INTO ipo_field_plan (
          ipo_id, table_name, row_key, field_name,
          rank1_source, rank2_source, rank3_source, manifest_version, policy_origin
        )
        VALUES ${values}
        ON CONFLICT (ipo_id, table_name, row_key, field_name) DO UPDATE
          SET rank1_source     = EXCLUDED.rank1_source,
              rank2_source     = EXCLUDED.rank2_source,
              rank3_source     = EXCLUDED.rank3_source,
              manifest_version = EXCLUDED.manifest_version,
              policy_origin    = EXCLUDED.policy_origin,
              updated_at       = now()
          WHERE ipo_field_plan.state <> 'SUPPLIED'
            AND ipo_field_plan.manifest_version < EXCLUDED.manifest_version
        RETURNING id, (xmax = 0) AS inserted
      `);

      const returned = (result as unknown as { rows: { inserted: boolean }[] }).rows ?? [];
      const inserted = returned.filter((r) => r.inserted === true).length;
      const updated = returned.filter((r) => r.inserted === false).length;
      return { inserted, updated };
    } catch (error) {
      throw new DatabaseError(
        `Failed to upsert generated field plan rows${rows[0] ? ` for IPO ${rows[0].ipoId}` : ''}`,
        undefined,
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Item 3 slice S2 — the rows a manifest-version reconciliation must look at:
   * every row whose `manifest_version` is older than the current registry
   * version AND whose state is non-terminal (`state <> 'SUPPLIED'`). A
   * SUPPLIED row already answered the ask; re-ranking it would let a manifest
   * bump silently discard a value that was already delivered, which is a
   * regression the tool must never cause (card DoD: "SUPPLIED rows are never
   * touched"). The other five states (PENDING, NOT_PRINTED,
   * NOT_AVAILABLE_YET, CHECK_FAILED, EXHAUSTED) are all still in scope: each
   * one is an ask that has not been definitively answered by SUPPLYING a
   * value, so a stale rank list on any of them can walk the wrong sources on
   * the next attempt.
   *
   * Joined to `ipos` for the identity fields the tool prints (slug, name,
   * segment, listing_exchanges) — signal-ownership R1: a repair prints
   * identities, never a bare count.
   */
  async listBelowVersion(currentVersion: number): Promise<PlanRowBelowVersion[]> {
    try {
      const result = await this.db.execute(sql`
        SELECT p.id, p.ipo_id, p.table_name, p.row_key, p.field_name,
               p.rank1_source, p.rank2_source, p.rank3_source,
               p.state, p.manifest_version, p.policy_origin,
               i.slug AS ipo_slug, i.company_name AS ipo_name,
               i.segment AS ipo_segment, i.listing_exchanges AS ipo_listing_exchanges,
               i.status AS ipo_status, i.listing_date AS ipo_listing_date
          FROM ipo_field_plan p
          JOIN ipos i ON i.id = p.ipo_id
         WHERE p.manifest_version < ${currentVersion}
           AND p.state <> 'SUPPLIED'
         ORDER BY i.slug, p.table_name, p.field_name, p.row_key
      `);
      const rows = (result as unknown as { rows: Record<string, unknown>[] }).rows ?? [];
      return rows.map(mapBelowVersionRow);
    } catch (error) {
      throw new DatabaseError(
        'Failed to list ipo_field_plan rows below the current manifest version',
        undefined,
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Item 3 slice S2 — re-rank a batch of non-terminal rows to the current
   * policy in ONE statement (a `VALUES` list joined back onto the table),
   * never a per-row round trip. Every row is matched by its primary key
   * (`id`), so a row that changed state between `listBelowVersion` reading it
   * and this call running (e.g. a live walk just recorded SUPPLIED) is
   * re-guarded here too: the `WHERE` clause repeats `state <> 'SUPPLIED'` so
   * a race can never overwrite a rank list on a row that became SUPPLIED in
   * between the read and the write.
   *
   * `policy_origin` is written from the SAME resolved policy that produced
   * the new ranks (never re-derived here) so the row's provenance always
   * matches its actual rank1/2/3.
   */
  async updateRanksForVersion(rows: PlanRowRankUpdate[]): Promise<{ updated: number }> {
    if (rows.length === 0) return { updated: 0 };

    try {
      const values = sql.join(
        rows.map(
          (r) =>
            sql`(${r.id}::uuid, ${r.rank1Source}, ${r.rank2Source}, ${r.rank3Source}, ${r.manifestVersion}, ${r.policyOrigin})`
        ),
        sql`, `
      );

      const result = await this.db.execute(sql`
        UPDATE ipo_field_plan AS p
           SET rank1_source = v.rank1_source,
               rank2_source = v.rank2_source,
               rank3_source = v.rank3_source,
               manifest_version = v.manifest_version::int,
               policy_origin = v.policy_origin,
               updated_at = now()
          FROM (VALUES ${values}) AS v(id, rank1_source, rank2_source, rank3_source, manifest_version, policy_origin)
         WHERE p.id = v.id::uuid
           AND p.state <> 'SUPPLIED'
        RETURNING p.id
      `);

      const updated = ((result as unknown as { rows: unknown[] }).rows ?? []).length;
      return { updated };
    } catch (error) {
      throw new DatabaseError(
        `Failed to update ipo_field_plan ranks for version${rows[0] ? ` (first row ${rows[0].id})` : ''}`,
        undefined,
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Claim exactly one due plan row, in ONE statement. "Due" is the item-5
   * build card's four-way OR (`docs/design/build-cards/item-05-ipo-field-plan-table.md:232-237`),
   * restored here after #762 found it had shipped as a single AND-only
   * branch (`state = 'PENDING'`) that left NOT_AVAILABLE_YET and
   * CHECK_FAILED rows — 12,480 of them on staging — permanently unclaimed:
   *
   *   1. `state = 'PENDING'` — never attempted (unchanged).
   *   2. `state = 'NOT_AVAILABLE_YET'` AND a new SLOT has begun since
   *      `last_attempt_at` — the field was asked before its own authoritative
   *      source had published, so a later slot is worth a re-ask.
   *   3. `state = 'CHECK_FAILED'` AND a new SLOT has begun since
   *      `last_attempt_at` — the walk's own comments call this "transient,
   *      re-asked after backoff" (`field-plan-walk.ts:384, 581`); restored
   *      the same way as trigger 2, not as a separate mechanism.
   *   S2 (docs/design/s2-witnesses-plan.md) DROPPED `verify_state` and
   *   `verify_due_at` from `ipo_field_plan` entirely — the trigger-4 leg
   *   that read them (`verify_due_leg`, dead code since it was written: this
   *   codebase never wrote either column) is removed in the same change.
   *   The consensus model's own re-verification design lives elsewhere now
   *   (OD-56 supersedes the §3 plan this trigger was reserved for).
   *   Plus the stale-claim reclaim (`claimed_at` null or older than the
   *   staleness window), unconditional on which of the four triggers made
   *   the row due — a crashed walk's claim is released the same way either way.
   *
   * Triggers 2 and 3 key on `last_attempt_at` crossing a SLOT boundary
   * (`mostRecentFieldPlanSlotBoundary`, mirroring
   * `scraper/src/scheduler/due-step-cycle.ts`'s
   * `DISCOVERY_SLOTS_IST_MINUTES`), NEVER on `next_due_at` or an elapsed
   * interval — `next_due_at` is written by `recordOutcome` using
   * `fieldPlanBackoffMinutes`, a TIMED doubling backoff the design doc
   * explicitly marks for deletion (`docs/design/data-sourcing-pull-model.md:971`,
   * OD-21/OD-33/D12: "no code path schedules a document fetch by elapsed
   * time"). This fix does not touch `recordOutcome` or that column (out of
   * the S8 brief's scope) — it simply never reads `next_due_at` for triggers
   * 2/3, so a slot-based reclaim is not blocked by (or dependent on) a
   * still-running timer the design says should not exist.
   *
   * Churn guard (S8, no design-mandated shape existed): trigger 3
   * (CHECK_FAILED) is bounded by `attempts < FIELD_PLAN_RECLAIM_MAX_ATTEMPTS`
   * — a row that has failed that many times stops being offered by this
   * query at all, so a permanently-broken field cannot churn through every
   * slot forever. This is a claim-time FILTER, never a state transition —
   * the row is not moved to EXHAUSTED (that is `recordOutcome`'s job and
   * out of scope here).
   *
   * Trigger 2 (NOT_AVAILABLE_YET) is deliberately left WITHOUT an attempts
   * cap (review round 1, MAJOR-4). A "not available yet" field is, by
   * definition, waiting on a real external event (a document that has not
   * published) — the walk's own comment calls this explicit: "the field
   * keeps being re-asked until the authoritative source answers"
   * (`field-plan-walk.ts:696` area). Capping it at 5 like CHECK_FAILED would
   * stop asking a live, pre-listing IPO whether its GMP or listing date has
   * published yet — the exact case the design protects (a lower-ranked
   * aggregator can carry a provisional value before the exchange posts the
   * authoritative one). An uncapped NOT_AVAILABLE_YET is not the same churn
   * risk as an uncapped CHECK_FAILED: CHECK_FAILED means every source
   * DISAGREED or errored — a signal the field itself may be broken — while
   * NOT_AVAILABLE_YET means every source agreed "not yet", which resolves
   * itself the moment the IPO's lifecycle moves (LISTED/WITHDRAWN) or the
   * document actually publishes. What stops the churn instead: (a) the
   * walk's own `settledThisWalk` set already stops ONE walk from re-claiming
   * a row it just released, bounding in-cycle churn to one attempt per row
   * per walk; (b) the natural ceiling is the IPO's own lifecycle — once an
   * IPO is LISTED or WITHDRAWN with a field still NOT_AVAILABLE_YET, that is
   * a genuinely different, out-of-scope defect (the writer/outcome-recording
   * path should stop re-asking a closed IPO), not a churn-guard question for
   * the claim query. This fix does not add that lifecycle gate — flagging it
   * for the owner/reviewer as the open question MAJOR-4 asked for: should a
   * closed-IPO NOT_AVAILABLE_YET field eventually cap out, and where (the
   * claim query, or `recordOutcome` moving it to EXHAUSTED on IPO close)?
   *
   * `ORDER BY` additionally ranks a PENDING row (genuinely new work) ahead
   * of every reclaim trigger via `pri`, so a single walk drains new work
   * before spending its budget re-asking stale ones.
   *
   * `FOR UPDATE SKIP LOCKED` is the whole point: a concurrent claimer's inner
   * select skips the row this transaction has locked and finds nothing, so it
   * returns null rather than claiming the same row a second time.
   */
  async claimNextDueField(params: ClaimNextDueFieldParams = {}): Promise<IpoFieldPlanRow | null> {
    const now = params.now ?? new Date();
    const staleMinutes = params.staleMinutes ?? FIELD_PLAN_CLAIM_STALE_MINUTES;
    const staleBefore = new Date(now.getTime() - staleMinutes * 60_000);
    const slotBoundary = mostRecentFieldPlanSlotBoundary(now);
    const token = randomUUID();
    const ipoId = params.ipoId ?? null;
    const excludeIds = params.excludeIds ?? [];
    // #884 review round 2: the CURRENT gap keys per field; a gap row stamped with one of its field's is not due.
    const gapKeysJson = params.gapKeys === undefined ? null : JSON.stringify(params.gapKeys);
    // Drizzle's `sql` tagged template SPREADS a plain JS array interpolated
    // into it as a comma-separated parameter list (`$1, $2, ...`), never as
    // a single array-typed bind — `${excludeIds}::uuid[]` therefore compiled
    // to the syntactically invalid `()::uuid[]` for an empty array (and
    // `($1)::uuid[]` for one element, also invalid — Postgres needs
    // `ARRAY[$1]::uuid[]`). Found live: every call in the walk-loop x
    // claim-query starvation test (review round 2 DoD item A) threw
    // "syntax error at or near )" the first time excludeIds was actually
    // exercised end to end — none of round 2's own new tests caught it
    // because they only ever passed a non-empty excludeIds through the
    // FIRST claim of a pair, never round-tripped a fresh empty-default call.
    // Building the literal `ARRAY[...]` expression by hand (guarding the
    // empty case explicitly, since `sql.join` over zero elements produces
    // nothing between the brackets) is the correct drizzle idiom for a
    // dynamic-length array bind.
    // A FUNCTION, called fresh at each use site — never a single shared
    // `SQL` fragment object reused directly. Proven live (review round 3):
    // reusing one `excludeIdsSql` CONST across multiple interpolation
    // points, however the surrounding query was structured (one giant
    // template, or `sql.join`-composed per-leg templates that each still
    // referenced the SAME const), made drizzle-orm 0.44.7 return a row
    // that plainly violated its own WHERE clause. The identical compiled
    // SQL text + params sent via a raw `pg.Pool` bypassing drizzle
    // reproduced CORRECTLY every time — confirming the SQL/params were
    // never wrong. Calling this as `excludeIdsSql()` — a fresh `SQL`
    // instance built on every call — combined with `legFilter()` below also
    // being a fresh-called function (not a fragment built once and reused)
    // is the combination that reproduced CORRECTLY in the scratch
    // verification this fix is based on.
    const excludeIdsSql = () =>
      excludeIds.length === 0
        ? sql`ARRAY[]::uuid[]`
        : sql`ARRAY[${sql.join(
            excludeIds.map((id) => sql`${id}::uuid`),
            sql`, `
          )}]`;
    const legFilter = () => sql`
                 AND (${ipoId}::uuid IS NULL OR ipo_id = ${ipoId}::uuid)
                 AND (claimed_at IS NULL OR claimed_at <= ${utc(staleBefore)}::timestamp)
                 AND NOT (id = ANY(${excludeIdsSql()}))`;

    // Common filter every leg applies (ipoId scope, stale-claim reclaim,
    // excludeIds) — built ONCE and composed via `sql.join` into each leg's
    // own small `sql` fragment, never written inline inside one giant
    // top-level template literal spanning all 7 legs. Found live (review
    // round 3): writing all 7 legs' full text directly inside ONE `sql`
    // template — ~30+ total `${}` interpolations in a single tagged-template
    // call — made drizzle-orm 0.44.7's query builder return a row that
    // plainly violated its own WHERE clause (a PENDING row with next_due_at
    // an hour in the future claimed by the `next_due_at <= now` leg). The
    // IDENTICAL compiled SQL text + params, sent via a raw `pg.Pool`
    // bypassing drizzle's builder, returned the CORRECT (empty) result every
    // time — proving the SQL/params were never wrong, only drizzle's
    // handling of a template this large. Composing smaller `sql` fragments
    // per leg and joining them with `sql.join` (the same pattern this file
    // already uses for `excludeIdsSql`'s own array literal) avoids
    // whatever internal limit/bug this is. Root cause not fully isolated in
    // drizzle's source; this restructuring is the decisive, verified fix —
    // proven correct via the exact scratch reproduction that also proved
    // the previous inline-template shape was broken.
    // CRITICAL-2 fix (S8 review round 1): each trigger is its own small,
    // independently-sargable derived table — `state = <literal>` plus ONE
    // more predicate against an index that covers it, `LIMIT 1 FOR UPDATE
    // SKIP LOCKED` inside EACH leg (Postgres refuses FOR UPDATE across a
    // UNION, so the lock has to happen per-leg, before the union combines
    // the candidates), then an outer `ORDER BY pri, ord LIMIT 1` picks the
    // winner. This is the same four-way-OR semantics as before, restated so
    // the planner can push each condition into an Index Scan instead of
    // evaluating one giant OR as a Filter over a Seq Scan.
    //
    // The `last_attempt_at IS NULL OR last_attempt_at < X` form (and
    // `next_due_at IS NULL OR ... <= X`) is ALSO split into two legs each
    // (a NULL leg and a comparison leg) rather than kept as an OR — an OR
    // inside one leg forces Postgres into a BitmapOr + Recheck + Sort
    // instead of a plain ordered Index Scan that can stop at the first
    // match. Measured on ipodhan_staging (read-only EXPLAIN, pure SELECT
    // form, no write): a REAL Seq Scan over the live 12,554-row backlog
    // costs 6.135ms — review round 2's MINOR correction to round 1's
    // "127.9ms" figure, which was measured on a freshly bulk-inserted,
    // unvacuumed synthetic table and was not representative. The honest,
    // staging-measured improvement is ~6ms -> ~0.66ms (this form, zero Seq
    // Scans, proven on ipodhan_test seeded to staging's exact row shape —
    // see the PR body for both full plans), not 128ms -> 1ms.
    //
    // `pri` ranks a PENDING candidate (0) ahead of every reclaim/verify
    // trigger (1) — genuinely new work drains before a re-ask, same
    // ordering intent the old single `CASE WHEN state='PENDING'` ORDER BY
    // expressed, but now on the OUTER (7-row) combine instead of forcing a
    // sort over the whole table.
    //
    // MINOR (review round 2, recorded not fixed) — RESOLVED by S2: this used
    // to note that `ord` mixed `last_attempt_at` with `verify_due_at` across
    // legs. The verify leg is gone (see above), so `ord` is `last_attempt_at`
    // or `next_due_at` only — comparable within each `pri` band again.
    //
    // review round 2 CRITICAL fix: `excludeIds` (the walk's own
    // `settledThisWalk`) is applied to every leg so a row this walk already
    // took and released (a dropped write left PENDING, or an
    // admin-protection skip) cannot be handed back as the SAME row forever
    // — `pri = 0` otherwise guarantees a released PENDING row outranks
    // every reclaim leg, and the walk's own re-claim guard
    // (`field-plan-walk.ts`) then stopped the ENTIRE walk on the second
    // sight of it, discarding every reclaim row ranked below. See
    // `ClaimNextDueFieldParams.excludeIds`'s own doc comment for the full
    // mechanism and the live-staging reproduction (180 PENDING rows on one
    // IPO, first cycle after deploy would have hit this).
    //
    // review round 2 MAJOR-2 fix: every bound timestamp below is cast to
    // `::timestamp` (naive), never `::timestamptz`. All three compared
    // columns (`next_due_at`, `last_attempt_at`, `claimed_at`) are
    // `timestamp WITHOUT time zone`; casting the bound
    // parameter to `::timestamptz` makes Postgres resolve it through the
    // SESSION timezone before comparing against the naive column — under
    // `Asia/Kolkata` that silently shifts every bound by 5h30m relative to
    // `UTC` (measured: `SET TIME ZONE 'UTC'` gives one answer, `SET TIME
    // ZONE 'Asia/Kolkata'` gives a DIFFERENT one for the identical row —
    // exactly the class this repo's own CLAUDE.md names as "Timestamps off
    // by 5h30m"). The production pool already forces `options: '-c
    // timezone=UTC'` (`packages/shared/src/db/timezone-config.ts`), so this
    // was latent there, but the SQL itself must not depend on that
    // guarantee — `::timestamp` is session-TZ-INDEPENDENT (verified: the
    // same bound Date casts to the identical naive value under both `UTC`
    // and `Asia/Kolkata` sessions), matching how `parseNaiveTimestampAsUtc`
    // already reads these same columns back on the SELECT side. A test
    // pins this under both session timezones.
    try {
      const legs = [
        sql`SELECT id, 0 AS pri, next_due_at AS ord FROM (
              SELECT id, next_due_at FROM ipo_field_plan
               WHERE state = 'PENDING' AND next_due_at IS NULL${legFilter()}
               ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED
            ) pending_null`,
        sql`SELECT id, 0 AS pri, next_due_at AS ord FROM (
              SELECT id, next_due_at FROM ipo_field_plan
               WHERE state = 'PENDING' AND next_due_at <= ${utc(now)}::timestamp${legFilter()}
               ORDER BY next_due_at ASC LIMIT 1 FOR UPDATE SKIP LOCKED
            ) pending_due`,
        sql`SELECT id, 1 AS pri, last_attempt_at AS ord FROM (
              SELECT id, last_attempt_at FROM ipo_field_plan
               WHERE state = 'NOT_AVAILABLE_YET' AND last_attempt_at IS NULL${legFilter()}
               ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED
            ) nay_null`,
        sql`SELECT id, 1 AS pri, last_attempt_at AS ord FROM (
              SELECT id, last_attempt_at FROM ipo_field_plan
               WHERE state = 'NOT_AVAILABLE_YET' AND last_attempt_at < ${utc(slotBoundary)}::timestamp${legFilter()}
               ORDER BY last_attempt_at ASC LIMIT 1 FOR UPDATE SKIP LOCKED
            ) nay_due`,
        sql`SELECT id, 1 AS pri, last_attempt_at AS ord FROM (
              SELECT id, last_attempt_at FROM ipo_field_plan
               WHERE state = 'CHECK_FAILED' AND attempts < ${FIELD_PLAN_RECLAIM_MAX_ATTEMPTS}
                 AND NOT ${gapStampedSql()}
                 AND last_attempt_at IS NULL${legFilter()}
               ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED
            ) cf_null`,
        sql`SELECT id, 1 AS pri, last_attempt_at AS ord FROM (
              SELECT id, last_attempt_at FROM ipo_field_plan
               WHERE state = 'CHECK_FAILED' AND attempts < ${FIELD_PLAN_RECLAIM_MAX_ATTEMPTS}
                 AND NOT ${gapStampedSql()}
                 AND last_attempt_at < ${utc(slotBoundary)}::timestamp${legFilter()}
               ORDER BY last_attempt_at ASC LIMIT 1 FOR UPDATE SKIP LOCKED
            ) cf_due`,
        // #884 review round 1 (MAJOR-1): a gap row (cause stamped
        // `[gap-key:<k>]` by recordOutcome) asked nothing that could fail, so
        // re-asking it under the SAME key gives the same answer every slot —
        // 6,220 staging rows re-asked forever, because claims are per-IPO and
        // a lower priority only orders rows WITHIN one IPO's walk. It is
        // claimable again ONLY when its field's current gap keys (review
        // round 2: the field's own manifest-entry content + fetcher coverage
        // + extractor version, and for a NO_DOCUMENT_PROVENANCE row the IPO's
        // COMPLETED documents in the field's family) no longer include the
        // one it was recorded under — §2.3 "reconciled when the manifest changes", OD-78
        // "same cause, same outcome, no retry". No slot condition: the key
        // change IS the event. No key supplied → gap rows are never offered.
        // `last_attempt_at` NULL or not (MINOR-6): the key alone decides.
        sql`SELECT id, 2 AS pri, last_attempt_at AS ord FROM (
              SELECT id, last_attempt_at FROM ipo_field_plan
               WHERE state = 'CHECK_FAILED' AND attempts < ${FIELD_PLAN_RECLAIM_MAX_ATTEMPTS}
                 AND ${gapStampedSql()}
                 AND ${gapKeysJson}::jsonb IS NOT NULL
                 AND left(cause, strpos(cause, ']')) NOT IN (
                       SELECT ${FIELD_PLAN_GAP_KEY_PREFIX}::text || k || ']'
                         FROM jsonb_array_elements_text((${gapKeysJson}::jsonb) -> (table_name || '.' || field_name)) AS k
                     )${legFilter()}
               ORDER BY last_attempt_at ASC NULLS FIRST LIMIT 1 FOR UPDATE SKIP LOCKED
            ) cf_gap_key_changed`,
        // verify_due_leg REMOVED in S2 — verify_state/verify_due_at no longer exist on
        // ipo_field_plan (see the method doc comment above).
      ];
      const unionedLegs = sql.join(legs, sql` UNION ALL `);

      // review round 3 RCA (recorded so the next reader does not repeat the
      // investigation): this query briefly APPEARED to return a row that
      // violated its own WHERE clause during round-3 debugging. Root cause
      // was NOT the query or drizzle's `db.execute()` — it was the TEST
      // FIXTURE. drizzle's `timestamp()` column mapper serializes a JS
      // `Date` via `.toISOString()` before binding
      // (node_modules/drizzle-orm/pg-core/columns/timestamp.js); binding
      // that STRING (vs a `Date` OBJECT) to a naive `timestamp` column
      // shifts it by the local Node process's UTC offset on write — a
      // node-postgres client-side quirk, reproducible even with the pool's
      // session forced to UTC. A fixture seeded with `Date.now() - X`
      // (every pre-existing test in this file) tolerates the shift; one
      // seeded with `Date.now() + X` (a "not yet due" row) does not — the
      // shift can turn a future timestamp into a past one. Fixed at the
      // fixture (`seedRow`'s own doc comment), not here — this query was
      // proven correct throughout by comparing its exact compiled SQL text
      // and params, executed via a raw `pg.Pool` bypassing drizzle
      // entirely, against `this.db.execute()`: identical result once the
      // fixture bug was accounted for.
      const result = await this.db.execute(sql`
        UPDATE ipo_field_plan
        SET claimed_at = ${utc(now)}::timestamp, claim_token = ${token}, updated_at = ${utc(now)}::timestamp
        WHERE id = (
          SELECT id FROM (${unionedLegs}) candidates
          ORDER BY pri ASC, ord ASC NULLS FIRST
          LIMIT 1
        )
        RETURNING *
      `);

      const rows = (result as unknown as { rows: Record<string, unknown>[] }).rows ?? [];
      if (rows.length === 0) return null;
      return mapRow(rows[0]);
    } catch (error) {
      throw new DatabaseError(
        `Failed to claim next due field plan row${params.ipoId ? ` for IPO ${params.ipoId}` : ''}`,
        undefined,
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Release a claim WITHOUT recording an attempt (item 6, design §2.7).
   *
   * The admin-protection skip is explicit that the walk must "skip; do not
   * store a state" — the field was never asked, so charging an `attempts`
   * increment would burn its backoff budget, and writing any state would put
   * a claim the walk deliberately declined into the plan as if it had been
   * tried. `recordOutcome` cannot express that: every one of its paths writes
   * a state, and the skipped branch additionally forces `PENDING`, which for
   * a row that was already, say, NOT_AVAILABLE_YET would silently rewrite it.
   *
   * So this clears `claimed_at`/`claim_token` and touches nothing else.
   * Conditional on the token, for the same reason `recordOutcome` is: a
   * superseded walker must not release a live claim belonging to the walker
   * that reclaimed the row.
   */
  async releaseClaimUnrecorded(params: {
    planRowId: string;
    claimToken: string;
    now?: Date;
  }): Promise<{ released: boolean; reason?: 'CLAIM_SUPERSEDED' }> {
    const now = params.now ?? new Date();
    try {
      const result = await this.db.execute(sql`
        UPDATE ipo_field_plan
        SET claimed_at = NULL, claim_token = NULL, updated_at = ${utc(now)}::timestamptz
        WHERE id = ${params.planRowId}::uuid
          AND claim_token = ${params.claimToken}
        RETURNING id
      `);
      const rows = (result as unknown as { rows: Record<string, unknown>[] }).rows ?? [];
      if (rows.length === 0) return { released: false, reason: 'CLAIM_SUPERSEDED' };
      return { released: true };
    } catch (error) {
      throw new DatabaseError(
        `Failed to release field plan claim for row ${params.planRowId}`,
        undefined,
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Write an attempt's result back onto the plan row.
   *
   * Every path is conditional on `claim_token` still matching: a superseded
   * walker changes nothing at all (not even `updated_at`), and is told so.
   */
  async recordOutcome(params: RecordOutcomeParams): Promise<RecordOutcomeResult> {
    const now = params.now ?? new Date();

    try {
      // THE SKIPPED BRANCH (design §2.3). The write was dropped, so nothing
      // about the ASK changed: state stays PENDING, `attempts` and
      // `last_attempt_at` are untouched, no evidence is recorded. Only the
      // claim is released, so the row is immediately re-claimable and the
      // dropped work is retried rather than silently recorded as done.
      if (!params.writeHappened) {
        const skipResult = await this.db.execute(sql`
          UPDATE ipo_field_plan
          SET claimed_at = NULL, claim_token = NULL, state = 'PENDING', updated_at = ${utc(now)}::timestamptz
          WHERE id = ${params.planRowId}::uuid
            AND claim_token = ${params.claimToken}
          RETURNING *
        `);
        const skipRows = (skipResult as unknown as { rows: Record<string, unknown>[] }).rows ?? [];
        if (skipRows.length === 0) {
          return { written: false, reason: 'CLAIM_SUPERSEDED' };
        }
        return { written: true, skipped: true, row: mapRow(skipRows[0]) };
      }

      const state: FieldPlanState = params.state ?? 'PENDING';
      const terminal = TERMINAL_STATES.has(state);

      // Evidence is ONE FACT about ONE winning source, so it is written
      // all-or-nothing: `chosen` provided at all (even partially) replaces
      // every one of the six columns from THAT object (fields it omits
      // become NULL), never merged column-by-column with whatever source's
      // evidence happened to be sitting there before. Six independent
      // COALESCE(new, existing) expressions let a partial evidence object
      // from source B splice onto stale columns still holding source A's
      // document/sha256/page -- a false provenance record ("B supplied this,
      // backed by A's document") that every downstream check reads as clean.
      // `chosen` omitted entirely (params.chosen undefined) leaves all six
      // columns exactly as they were -- there is no new fact to record.
      const hasChosen = params.chosen !== undefined;
      const chosen = params.chosen ?? {};
      const hasPolicyOrigin = params.policyOrigin !== undefined;
      // S4 (#779): same all-or-nothing-per-field CASE pattern as policy_origin
      // above -- omitted (undefined) leaves the column exactly as it was
      // (SUPPLIED writes neither), provided (even null) replaces it.
      const hasReasonCode = params.reasonCode !== undefined;
      const hasCause = params.cause !== undefined;
      // #884: a CHECK_FAILED the walk DECLARED a gap (`gapKey` set: every
      // rank failed with a structured gap code — no mapping, no documentType,
      // no fetcher, no column read, no document provenance) asked nothing
      // that could fail, so it is not charged against
      // FIELD_PLAN_RECLAIM_MAX_ATTEMPTS. Its cause is stamped with the key it
      // was asked under; claimNextDueField offers it again only under a
      // different key. `last_attempt_at` is still stamped.
      const isGap = state === 'CHECK_FAILED' && typeof params.gapKey === 'string' && params.gapKey.length > 0;
      const countsAsAttempt = !isGap;
      const recordedCause = isGap ? stampFieldPlanGapCause(params.gapKey as string, params.cause ?? null) : params.cause ?? null;
      const writeCause = hasCause || isGap;

      // A real attempt: count it, stamp it, and schedule the next one unless
      // the state is terminal. `attempts + 1` is computed in SQL from the
      // row's own value, so a concurrent reader never reads a stale count.
      const result = await this.db.execute(sql`
        UPDATE ipo_field_plan
        SET state = ${state}::field_plan_state,
            attempts = attempts + ${countsAsAttempt ? 1 : 0},
            last_attempt_at = ${utc(now)}::timestamptz,
            next_due_at = CASE
              WHEN ${terminal} THEN NULL
              ELSE ${utc(now)}::timestamptz + make_interval(mins =>
                LEAST(
                  ${FIELD_PLAN_BACKOFF_MAX_MINUTES},
                  ${FIELD_PLAN_BACKOFF_BASE_MINUTES} * POWER(2, GREATEST(0, attempts))::int
                )::int
              )
            END,
            policy_origin = CASE WHEN ${hasPolicyOrigin} THEN ${params.policyOrigin ?? null} ELSE policy_origin END,
            reason_code = CASE WHEN ${hasReasonCode} THEN ${params.reasonCode ?? null} ELSE reason_code END,
            cause = CASE WHEN ${writeCause} THEN ${recordedCause} ELSE cause END,
            chosen_source = CASE WHEN ${hasChosen} THEN ${chosen.source ?? null} ELSE chosen_source END,
            chosen_rank = CASE WHEN ${hasChosen} THEN ${chosen.rank ?? null} ELSE chosen_rank END,
            chosen_document_id = CASE WHEN ${hasChosen} THEN ${chosen.documentId ?? null}::uuid ELSE chosen_document_id END,
            chosen_document_type = CASE WHEN ${hasChosen} THEN ${chosen.documentType ?? null} ELSE chosen_document_type END,
            chosen_sha256 = CASE WHEN ${hasChosen} THEN ${chosen.sha256 ?? null} ELSE chosen_sha256 END,
            chosen_page = CASE WHEN ${hasChosen} THEN ${chosen.page ?? null} ELSE chosen_page END,
            claimed_at = NULL,
            claim_token = NULL,
            updated_at = ${utc(now)}::timestamptz
        WHERE id = ${params.planRowId}::uuid
          AND claim_token = ${params.claimToken}
        RETURNING *
      `);

      const rows = (result as unknown as { rows: Record<string, unknown>[] }).rows ?? [];
      if (rows.length === 0) {
        // The token no longer matches: this walker was reclaimed while it
        // worked. Writing here would stamp a stale result over a newer
        // walker's work, so nothing was written and the caller must not treat
        // its own result as recorded.
        return { written: false, reason: 'CLAIM_SUPERSEDED' };
      }
      return { written: true, row: mapRow(rows[0]) };
    } catch (error) {
      throw new DatabaseError(
        `Failed to record field plan outcome for row ${params.planRowId}`,
        undefined,
        error instanceof Error ? error : undefined
      );
    }
  }
}

/** Raw pg row (`listBelowVersion`'s join, snake_case) -> the camelCase row callers read. */
function mapBelowVersionRow(raw: Record<string, unknown>): PlanRowBelowVersion {
  return {
    id: raw.id as string,
    ipoId: raw.ipo_id as string,
    tableName: raw.table_name as string,
    rowKey: raw.row_key as string,
    fieldName: raw.field_name as string,
    rank1Source: (raw.rank1_source as string) ?? null,
    rank2Source: (raw.rank2_source as string) ?? null,
    rank3Source: (raw.rank3_source as string) ?? null,
    state: raw.state as FieldPlanState,
    manifestVersion: raw.manifest_version as number,
    policyOrigin: (raw.policy_origin as string) ?? null,
    ipoSlug: (raw.ipo_slug as string) ?? null,
    ipoName: (raw.ipo_name as string) ?? null,
    ipoSegment: (raw.ipo_segment as 'MAINBOARD' | 'SME') ?? null,
    ipoListingExchanges: (raw.ipo_listing_exchanges as ('NSE' | 'BSE')[]) ?? null,
    ipoStatus: (raw.ipo_status as string) ?? null,
    ipoListingDate: raw.ipo_listing_date == null ? null : new Date(raw.ipo_listing_date as string),
  };
}

/** Raw pg row (snake_case) -> the camelCase row the callers read. */
function mapRow(raw: Record<string, unknown>): IpoFieldPlanRow {
  const date = (v: unknown): Date | null => (v == null ? null : new Date(v as string));
  return {
    id: raw.id as string,
    ipoId: raw.ipo_id as string,
    tableName: raw.table_name as string,
    rowKey: raw.row_key as string,
    fieldName: raw.field_name as string,
    rank1Source: (raw.rank1_source as string) ?? null,
    rank2Source: (raw.rank2_source as string) ?? null,
    rank3Source: (raw.rank3_source as string) ?? null,
    state: raw.state as FieldPlanState,
    chosenSource: (raw.chosen_source as string) ?? null,
    chosenRank: (raw.chosen_rank as number) ?? null,
    chosenDocumentId: (raw.chosen_document_id as string) ?? null,
    chosenDocumentType: (raw.chosen_document_type as string) ?? null,
    chosenSha256: (raw.chosen_sha256 as string) ?? null,
    chosenPage: (raw.chosen_page as number) ?? null,
    attempts: raw.attempts as number,
    lastAttemptAt: date(raw.last_attempt_at),
    nextDueAt: date(raw.next_due_at),
    claimedAt: date(raw.claimed_at),
    claimToken: (raw.claim_token as string) ?? null,
    manifestVersion: raw.manifest_version as number,
    policyOrigin: (raw.policy_origin as string) ?? null,
    reasonCode: (raw.reason_code as string) ?? null,
    cause: (raw.cause as string) ?? null,
    createdAt: date(raw.created_at) as Date,
    updatedAt: date(raw.updated_at) as Date,
  };
}
