/**
 * Stage-transition reconciler JOB (Stage F live-wiring). Wraps the pure
 * planStageReconciliation core (stage-reconciler.ts) with the DB read that supplies
 * per-IPO child-table presence, so the scheduler can compute — for every genuine IPO —
 * the data fetches that are DUE-but-MISSING at its lifecycle stage.
 *
 * Default DRY-RUN: it computes + logs the plan and a structured run summary
 * (observability), but does NOT enqueue/trigger fetches. Enqueue + the prod cron
 * schedule are §GATE (ENABLE_STAGE_RECONCILER + scheduler activation = Abhay's call).
 */
import { sql } from 'drizzle-orm';
import { db } from '@ipodhan/shared/db';
import { getRedisClient, IpoPipelineStepsRepository } from '@ipodhan/shared';
import logger from '../../utils/logger.js';
import { planStageReconciliation, type ReconcilerIpoRow, type FetchKind } from '../stage-reconciler.js';
import { initStepLedger } from '../../services/step-ledger.js';
import { planLifecycleSteps, writeSteps } from '../../services/step-ledger-recorders.js';

/**
 * Which catalogue steps a due fetch kind stands for (S-02).
 *
 * The reconciler reasons in FETCH KINDS ("this IPO still has no peers"); the
 * ledger reasons in STEPS ("E6 extract peer comparison"). This table is the one
 * translation between the two vocabularies — without it the two models drift,
 * which spec §G5 exists to prevent.
 */
export const STEPS_BY_FETCH_KIND: Partial<Record<FetchKind, string[]>> = {
  documents: ['C1', 'C2', 'C3', 'C4'],
  docDrhp: ['C1', 'C2', 'C3'],
  docRhp: ['C1', 'C2', 'C3'],
  docPriceBandAd: ['C1', 'C2', 'C4'],
  docCorrigendum: ['C1', 'C2'],
  financials: ['E3'],
  peers: ['E6'],
  objectives: ['E5'],
  anchor: ['H3'],
  subscription: ['H1'],
  demand: ['H4'],
  gmp: ['H2'],
  listing: ['I5'],
};

/** Distinct, catalogue-ordered step ids for a set of due fetch kinds. */
export function dueStepIdsFor(kinds: FetchKind[]): string[] {
  const ids = new Set<string>();
  for (const kind of kinds) for (const id of STEPS_BY_FETCH_KIND[kind] ?? []) ids.add(id);
  return [...ids];
}

export interface StageReconcilerResult {
  totalIpos: number;
  iposWithDueFetches: number;
  dueByKind: Record<string, number>;
  byStage: Record<string, number>;
}

/**
 * Run one reconciliation cycle. dryRun (default true) logs the plan only — no enqueue.
 */
export async function runStageReconcilerJob(opts: { dryRun?: boolean } = {}): Promise<StageReconcilerResult> {
  const dryRun = opts.dryRun !== false;
  logger.info({ dryRun }, '[stage-reconciler-job] cycle start');

  // Per-IPO presence across the child tables the reconciler reasons over.
  const rows = await db.execute(sql`
    SELECT i.id, i.company_name AS "companyName", i.status, i.price_range_min AS "priceRangeMin",
      EXISTS(SELECT 1 FROM documents d WHERE d.ipo_id=i.id)            AS "documents",
      EXISTS(SELECT 1 FROM financial_data f WHERE f.ipo_id=i.id)       AS "financials",
      EXISTS(SELECT 1 FROM peer_companies p WHERE p.ipo_id=i.id)       AS "peers",
      (i.objectives IS NOT NULL AND i.objectives::text NOT IN ('[]','null','{}','')) AS "objectives",
      EXISTS(SELECT 1 FROM anchor_investors a WHERE a.ipo_id=i.id)     AS "anchor",
      (i.subscription_total IS NOT NULL OR EXISTS(SELECT 1 FROM subscriptions s WHERE s.ipo_id=i.id)) AS "subscription",
      EXISTS(SELECT 1 FROM ipo_demand_graph g WHERE g.ipo_id=i.id)     AS "demand",
      (i.gmp IS NOT NULL OR EXISTS(SELECT 1 FROM gmp_records r WHERE r.ipo_id=i.id)) AS "gmp",
      (i.listing_price_historical IS NOT NULL OR EXISTS(SELECT 1 FROM listing_performance lp WHERE lp.ipo_id=i.id)) AS "listing",
      (i.allotment_date IS NOT NULL)                                   AS "allotment"
    FROM ipos i WHERE i.offering_type = 'IPO'
  `);
  const raw = (rows as any).rows ?? rows;

  const PRESENCE_KEYS: FetchKind[] = ['documents', 'financials', 'peers', 'objectives', 'anchor', 'subscription', 'demand', 'gmp', 'listing', 'allotment'];
  const ipoRows: ReconcilerIpoRow[] = raw.map((r: any) => {
    const presence: Partial<Record<FetchKind, boolean>> = {};
    for (const k of PRESENCE_KEYS) presence[k] = r[k] === true;
    return { id: r.id, companyName: r.companyName, status: r.status, priceRangeMin: r.priceRangeMin, presence };
  });

  const plans = planStageReconciliation(ipoRows);
  const dueByKind: Record<string, number> = {};
  const byStage: Record<string, number> = {};
  let iposWithDueFetches = 0;

  // S-02: the ledger repository, built once for the whole cycle.
  const stepsRepository = new IpoPipelineStepsRepository(db as never, getRedisClient() as never);

  for (const p of plans) {
    byStage[p.stage] = (byStage[p.stage] || 0) + 1;
    if (p.dueFetches.length > 0) iposWithDueFetches++;
    for (const k of p.dueFetches) dueByKind[k] = (dueByKind[k] || 0) + 1;

    // S-02 hook — I1 (stage derived) + I2 (due list computed), and a DUE row for
    // each step whose window is open.
    //
    // This is the ONE place the reconciler stops being a pure dry run: it may now
    // write ledger rows. It still enqueues nothing and fetches nothing — the
    // §GATE below is untouched — because writing "this step is outstanding" is
    // bookkeeping, while triggering the fetch is the irreversible act the owner
    // gates. The existing rows are read first so a DUE write can never downgrade
    // a step an earlier cycle already completed.
    try {
      await initStepLedger(p.id);
      const existingRows = await stepsRepository.findByIpo(p.id);
      const existing: Record<string, { status: string; nextDueAt?: Date | null }> = {};
      for (const row of existingRows) existing[row.stepId] = { status: row.status, nextDueAt: row.nextDueAt };

      await writeSteps(
        p.id,
        planLifecycleSteps({
          stage: p.stage,
          dueStepIds: dueStepIdsFor(p.dueFetches),
          dueFetchKinds: p.dueFetches,
          existing,
        })
      );
    } catch (error) {
      // Non-fatal: a ledger write must never fail the reconciler cycle.
      logger.warn(
        { ipoId: p.id, error: error instanceof Error ? error.message : String(error) },
        '[stage-reconciler-job] step-ledger write failed (non-fatal)'
      );
    }

    if (!dryRun) {
      // §GATE: enqueue/trigger the due fetches here once activated. Intentionally a
      // no-op in this build — activation (job triggers + cron) is Abhay's call.
    }
  }

  const result: StageReconcilerResult = { totalIpos: plans.length, iposWithDueFetches, dueByKind, byStage };
  logger.info({ ...result, dryRun }, '[stage-reconciler-job] cycle complete (plan computed; enqueue is §GATE)');
  return result;
}
