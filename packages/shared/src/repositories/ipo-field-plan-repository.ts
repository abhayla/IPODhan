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
    createdAt: date(raw.created_at) as Date,
    updatedAt: date(raw.updated_at) as Date,
  };
}
