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
import logger from '../../utils/logger.js';
import { planStageReconciliation, type ReconcilerIpoRow, type FetchKind } from '../stage-reconciler.js';

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
  for (const p of plans) {
    byStage[p.stage] = (byStage[p.stage] || 0) + 1;
    if (p.dueFetches.length > 0) iposWithDueFetches++;
    for (const k of p.dueFetches) dueByKind[k] = (dueByKind[k] || 0) + 1;
    if (!dryRun) {
      // §GATE: enqueue/trigger the due fetches here once activated. Intentionally a
      // no-op in this build — activation (job triggers + cron) is Abhay's call.
    }
  }

  const result: StageReconcilerResult = { totalIpos: plans.length, iposWithDueFetches, dueByKind, byStage };
  logger.info({ ...result, dryRun }, '[stage-reconciler-job] cycle complete (plan computed; enqueue is §GATE)');
  return result;
}
