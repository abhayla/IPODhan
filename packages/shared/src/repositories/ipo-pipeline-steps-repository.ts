/**
 * Per-IPO pipeline step ledger repository (S-01).
 *
 * Spec: docs/specs/per-ipo-due-step-pipeline.md sections 4.1 and 7.
 * The ledger answers "for IPO X, which steps are done / due / failed / not yet
 * available", with evidence and timestamps, in one query.
 */

import { and, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type Redis from 'ioredis';
import { BaseRepository } from './base-repository';
import * as schema from '../db/schema';
import { ipoPipelineSteps, ipos } from '../db/schema';
import { PIPELINE_STEPS, isPipelineStepId } from '../pipeline/step-catalogue';
import {
  CacheTTL,
  getPipelineStepsByIpoKey,
  getPipelineGridKey,
  getPipelineInvalidationKeys,
  PIPELINE_GRID_KEY_PATTERN,
} from '../cache/cache-keys';

export type IpoStepStatus =
  | 'NOT_DUE'
  | 'DUE'
  | 'RUNNING'
  | 'DONE'
  | 'FAILED'
  | 'NOT_AVAILABLE_YET'
  | 'BLOCKED'
  | 'SKIPPED';

/**
 * Statuses that end a run attempt. Reaching one stamps `last_run_at`;
 * NOT_DUE / DUE / RUNNING do not (nothing finished).
 */
const TERMINAL_STATUSES: ReadonlySet<IpoStepStatus> = new Set<IpoStepStatus>([
  'DONE',
  'FAILED',
  'BLOCKED',
  'SKIPPED',
  'NOT_AVAILABLE_YET',
]);

export interface UpsertStepInput {
  ipoId: string;
  stepId: string;
  status: IpoStepStatus;
  source?: string | null;
  inputRef?: string | null;
  evidence?: unknown;
  error?: string | null;
  version?: string | null;
  nextDueAt?: Date | null;
}

export interface PipelineStepRow {
  id: string;
  ipoId: string;
  stepId: string;
  status: IpoStepStatus;
  attempts: number;
  lastRunAt: Date | null;
  nextDueAt: Date | null;
  source: string | null;
  inputRef: string | null;
  evidence: unknown;
  error: string | null;
  version: string | null;
  updatedAt: Date;
}

export interface PipelineGridIpo {
  ipoId: string;
  companyName: string;
  slug: string;
  symbol: string | null;
  status: string;
  listingDate: string | null;
}

export interface PipelineGrid {
  ipos: PipelineGridIpo[];
  /** ipoId -> stepId -> row. Built from ONE steps query, never per-IPO. */
  steps: Record<string, Record<string, PipelineStepRow>>;
}

export class IpoPipelineStepsRepository extends BaseRepository {
  constructor(
    protected db: NodePgDatabase<typeof schema>,
    protected redis: Redis
  ) {
    super(db, redis);
  }

  /**
   * Insert-or-update one (ipo, step) ledger row.
   *
   * Transition rules (spec 4.1):
   * - `attempts` counts finished run attempts: it increments when the step
   *   FAILS, and when a RUNNING step completes (RUNNING -> DONE). Merely
   *   marking a step RUNNING, or a DUE -> DONE bookkeeping write, does not.
   * - `last_run_at` is stamped on any terminal status.
   * - `error` is cleared on DONE, so a stale failure never outlives its fix.
   */
  async upsertStep(input: UpsertStepInput): Promise<void> {
    if (!isPipelineStepId(input.stepId)) {
      throw new Error(
        `Unknown pipeline step id "${input.stepId}" - not in the catalogue (packages/shared/src/pipeline/step-catalogue.ts)`
      );
    }

    const existing = (await this.db
      .select()
      .from(ipoPipelineSteps)
      .where(
        and(eq(ipoPipelineSteps.ipoId, input.ipoId), eq(ipoPipelineSteps.stepId, input.stepId))
      )
      .limit(1)) as Array<{ attempts: number; status: IpoStepStatus }>;

    const previous = existing[0];
    const previousAttempts = previous?.attempts ?? 0;
    const completesARun =
      input.status === 'FAILED' || (input.status === 'DONE' && previous?.status === 'RUNNING');
    const attempts = completesARun ? previousAttempts + 1 : previousAttempts;

    const now = new Date();
    const isTerminal = TERMINAL_STATUSES.has(input.status);
    const error = input.status === 'DONE' ? null : (input.error ?? null);

    const common = {
      status: input.status,
      attempts,
      source: input.source ?? null,
      inputRef: input.inputRef ?? null,
      evidence: (input.evidence ?? null) as never,
      error,
      version: input.version ?? null,
      nextDueAt: input.nextDueAt ?? null,
      updatedAt: now,
    };
    // Only stamp last_run_at when something actually finished; leaving the key
    // out entirely keeps the previous value on an update.
    const timing = isTerminal ? { lastRunAt: now } : {};

    await this.db
      .insert(ipoPipelineSteps)
      .values({
        ipoId: input.ipoId,
        stepId: input.stepId,
        ...common,
        ...timing,
      } as never)
      .onConflictDoUpdate({
        target: [ipoPipelineSteps.ipoId, ipoPipelineSteps.stepId],
        set: { ...common, ...timing } as never,
      });

    await this.invalidateCache(getPipelineInvalidationKeys(input.ipoId), [
      PIPELINE_GRID_KEY_PATTERN,
    ]);
  }

  /** All ledger rows for one IPO, in catalogue order. */
  async findByIpo(ipoId: string): Promise<PipelineStepRow[]> {
    return this.getFromCache(
      getPipelineStepsByIpoKey(ipoId),
      async () => {
        const rows = (await this.db
          .select()
          .from(ipoPipelineSteps)
          .where(eq(ipoPipelineSteps.ipoId, ipoId))) as unknown as PipelineStepRow[];
        return sortByCatalogue(rows);
      },
      CacheTTL.PIPELINE_STEPS
    );
  }

  /**
   * IPOs x steps for the admin grid.
   *
   * Two queries total regardless of row count: one page of IPOs, then one
   * steps query for that whole page (IN (...)) - never one query per IPO.
   */
  async findGrid(options: { stage?: string; limit?: number } = {}): Promise<PipelineGrid> {
    const limit = options.limit ?? 50;
    const stage = options.stage;

    return this.getFromCache(
      getPipelineGridKey(stage, limit),
      async () => {
        const ipoRows = (await this.db
          .select({
            ipoId: ipos.id,
            companyName: ipos.companyName,
            slug: ipos.slug,
            symbol: ipos.symbol,
            status: ipos.status,
            listingDate: ipos.listingDate,
          })
          .from(ipos)
          .where(stage ? eq(ipos.status, stage as never) : activeIpoFilter())
          .orderBy(desc(ipos.openDate))
          .limit(limit)) as unknown as PipelineGridIpo[];

        const ids = ipoRows.map((r) => r.ipoId);
        const steps: Record<string, Record<string, PipelineStepRow>> = {};
        for (const id of ids) steps[id] = {};

        if (ids.length > 0) {
          const stepRows = (await this.db
            .select()
            .from(ipoPipelineSteps)
            .where(inArray(ipoPipelineSteps.ipoId, ids))) as unknown as PipelineStepRow[];

          for (const row of stepRows) {
            if (!steps[row.ipoId]) steps[row.ipoId] = {};
            steps[row.ipoId][row.stepId] = row;
          }
        }

        return { ipos: ipoRows, steps };
      },
      CacheTTL.PIPELINE_STEPS
    );
  }

  /**
   * Create every catalogue row at NOT_DUE for an IPO. Idempotent: existing
   * rows are left exactly as they are (onConflictDoNothing), so calling this
   * on a half-run IPO never resets progress.
   */
  async initForIpo(ipoId: string): Promise<void> {
    const rows = PIPELINE_STEPS.map((step) => ({
      ipoId,
      stepId: step.id,
      status: 'NOT_DUE' as const,
      attempts: 0,
    }));

    await this.db
      .insert(ipoPipelineSteps)
      .values(rows as never)
      .onConflictDoNothing({
        target: [ipoPipelineSteps.ipoId, ipoPipelineSteps.stepId],
      });

    await this.invalidateCache(getPipelineInvalidationKeys(ipoId), [PIPELINE_GRID_KEY_PATTERN]);
  }
}

/**
 * Default grid population: IPOs that are still in flight - anything not
 * LISTED, plus LISTED ones whose listing is within the last 10 days (spec 5:
 * an IPO stops generating work at LISTED + 10 days).
 */
function activeIpoFilter() {
  return or(
    sql`${ipos.status} <> 'LISTED'`,
    isNull(ipos.listingDate),
    sql`${ipos.listingDate} >= (CURRENT_DATE - INTERVAL '10 days')`
  );
}

const CATALOGUE_ORDER = new Map(PIPELINE_STEPS.map((s, i) => [s.id, i]));

function sortByCatalogue(rows: PipelineStepRow[]): PipelineStepRow[] {
  return [...rows].sort(
    (a, b) =>
      (CATALOGUE_ORDER.get(a.stepId) ?? Number.MAX_SAFE_INTEGER) -
      (CATALOGUE_ORDER.get(b.stepId) ?? Number.MAX_SAFE_INTEGER)
  );
}
