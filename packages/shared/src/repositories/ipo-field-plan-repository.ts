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
 * manifest changes, never regenerated per cycle." `INSERT ... ON CONFLICT
 * (ipo_id, table_name, row_key, field_name) DO NOTHING` is what makes that
 * true structurally rather than by caller discipline — a second pass over
 * an IPO whose rows already exist inserts zero rows and updates NOTHING,
 * because `DO NOTHING` never touches the conflicting row at all (not even
 * `updated_at`). A row appears only for a (ipo, table, row_key, field)
 * combination that is not already in the table — which is exactly what
 * happens on its own when `manifest_version` changes and the generator
 * plans a field under a NEW key it did not plan before, and is exactly
 * what must NOT happen for a key it already planned.
 */

import { sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type Redis from 'ioredis';
import { randomUUID } from 'crypto';
import { BaseRepository } from './base-repository';
import type * as schema from '../db/schema';
import { DatabaseError } from '../errors/repository-errors';

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
 * row this call inserts is by definition one that did not exist before —
 * `upsertGeneratedRows` never carries an existing row's live state back in.
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
  /** How many NEW rows this call actually inserted (never counts a conflict). */
  inserted: number;
}

export class IpoFieldPlanRepository extends BaseRepository {
  constructor(db: NodePgDatabase<typeof schema>, redis: Redis) {
    super(db, redis);
  }

  /**
   * Insert the generator's rows for one IPO, RECONCILED never REGENERATED.
   *
   * `ON CONFLICT (ipo_id, table_name, row_key, field_name) DO NOTHING` is the
   * whole mechanism: a row already at that key is left completely alone —
   * `state`, `attempts`, `next_due_at`, `claimed_at`, every chosen_* column,
   * and `updated_at` all keep their live values, because `DO NOTHING` means
   * Postgres never executes an UPDATE against the conflicting row. A second
   * pass over the same IPO with an unchanged manifest therefore inserts
   * nothing new (every key already exists) and mutates nothing old. A
   * `manifest_version` bump that adds a field under a key not previously
   * planned inserts exactly that new row — reconciliation, not regeneration,
   * falls out of the conflict target rather than being decided by the
   * caller.
   *
   * Empty input is a no-op (an IPO's type key produced zero rows, or the
   * caller was already given an empty array) — never a wasted round trip.
   */
  async upsertGeneratedRows(rows: GeneratedFieldPlanRow[]): Promise<UpsertGeneratedRowsResult> {
    if (rows.length === 0) return { inserted: 0 };

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
        ON CONFLICT (ipo_id, table_name, row_key, field_name) DO NOTHING
        RETURNING id
      `);

      const inserted = ((result as unknown as { rows: unknown[] }).rows ?? []).length;
      return { inserted };
    } catch (error) {
      throw new DatabaseError(
        `Failed to upsert generated field plan rows${rows[0] ? ` for IPO ${rows[0].ipoId}` : ''}`,
        undefined,
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Claim exactly one due plan row, oldest-due first, in ONE statement.
   *
   * Due = state PENDING, AND its backoff has elapsed (`next_due_at` null or
   * past), AND it is not held by a live claim (`claimed_at` null or older than
   * the staleness window — that second arm is what makes a killed walk's row
   * recoverable rather than stranded forever).
   *
   * The inner select orders by `(next_due_at NULLS FIRST)` over
   * `state = 'PENDING'`, which is the leading-column shape of
   * `idx_ipo_field_plan_state_next_due`, so the query can use that index
   * instead of scanning the plan.
   *
   * `FOR UPDATE SKIP LOCKED` is the whole point: a concurrent claimer's inner
   * select skips the row this transaction has locked and finds nothing, so it
   * returns null rather than claiming the same row a second time.
   */
  async claimNextDueField(params: ClaimNextDueFieldParams = {}): Promise<IpoFieldPlanRow | null> {
    const now = params.now ?? new Date();
    const staleMinutes = params.staleMinutes ?? FIELD_PLAN_CLAIM_STALE_MINUTES;
    const staleBefore = new Date(now.getTime() - staleMinutes * 60_000);
    const token = randomUUID();

    try {
      const result = await this.db.execute(sql`
        UPDATE ipo_field_plan
        SET claimed_at = ${now}::timestamptz, claim_token = ${token}, updated_at = ${now}::timestamptz
        WHERE id = (
          SELECT id FROM ipo_field_plan
          WHERE state = 'PENDING'
            AND (${params.ipoId ?? null}::uuid IS NULL OR ipo_id = ${params.ipoId ?? null}::uuid)
            AND (next_due_at IS NULL OR next_due_at <= ${now}::timestamptz)
            AND (claimed_at IS NULL OR claimed_at <= ${staleBefore}::timestamptz)
          ORDER BY next_due_at ASC NULLS FIRST
          FOR UPDATE SKIP LOCKED
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
        SET claimed_at = NULL, claim_token = NULL, updated_at = ${now}::timestamptz
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
          SET claimed_at = NULL, claim_token = NULL, state = 'PENDING', updated_at = ${now}::timestamptz
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

      // A real attempt: count it, stamp it, and schedule the next one unless
      // the state is terminal. `attempts + 1` is computed in SQL from the
      // row's own value, so a concurrent reader never reads a stale count.
      const result = await this.db.execute(sql`
        UPDATE ipo_field_plan
        SET state = ${state}::field_plan_state,
            attempts = attempts + 1,
            last_attempt_at = ${now}::timestamptz,
            next_due_at = CASE
              WHEN ${terminal} THEN NULL
              ELSE ${now}::timestamptz + make_interval(mins =>
                LEAST(
                  ${FIELD_PLAN_BACKOFF_MAX_MINUTES},
                  ${FIELD_PLAN_BACKOFF_BASE_MINUTES} * POWER(2, GREATEST(0, attempts))::int
                )::int
              )
            END,
            policy_origin = CASE WHEN ${hasPolicyOrigin} THEN ${params.policyOrigin ?? null} ELSE policy_origin END,
            chosen_source = CASE WHEN ${hasChosen} THEN ${chosen.source ?? null} ELSE chosen_source END,
            chosen_rank = CASE WHEN ${hasChosen} THEN ${chosen.rank ?? null} ELSE chosen_rank END,
            chosen_document_id = CASE WHEN ${hasChosen} THEN ${chosen.documentId ?? null}::uuid ELSE chosen_document_id END,
            chosen_document_type = CASE WHEN ${hasChosen} THEN ${chosen.documentType ?? null} ELSE chosen_document_type END,
            chosen_sha256 = CASE WHEN ${hasChosen} THEN ${chosen.sha256 ?? null} ELSE chosen_sha256 END,
            chosen_page = CASE WHEN ${hasChosen} THEN ${chosen.page ?? null} ELSE chosen_page END,
            claimed_at = NULL,
            claim_token = NULL,
            updated_at = ${now}::timestamptz
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
    createdAt: date(raw.created_at) as Date,
    updatedAt: date(raw.updated_at) as Date,
  };
}
