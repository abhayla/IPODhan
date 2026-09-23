/**
 * "Is this IPO's plan settled?" -- read from the DB, in ONE place (review round 4, M-2).
 *
 * The closed-IPO job's DONE rule (OD-79, §6.2) needs two facts about the STORED
 * `ipo_field_plan` rows of an IPO, read after the walk:
 *   - how many rows are stored (M-1: a generator that REPORTS rows proves nothing;
 *     a plan that was never written must not be sealed DONE), and
 *   - how many are not settled.
 *
 * Settled = a terminal state, taken from the ONE exported list
 * (`FIELD_PLAN_TERMINAL_STATES`, ipo-field-plan-repository.ts). The predicate is
 * `state NOT IN (<terminal states>)`, never an IN-list of the open states: a new
 * `field_plan_state` value then counts as UNSETTLED and blocks DONE, instead of
 * silently counting as settled.
 *
 * Imported by the job wiring (scraper/src/index.ts), the integration test and the
 * repair tool (scraper/scripts/repair-closed-ipo-false-done.ts). The detection
 * floor (scripts/audit-detection-floor.mjs) is plain Node and cannot import this
 * TypeScript; a unit test pins its literal list to the same constant.
 */
import { sql, type SQL } from 'drizzle-orm';
import { FIELD_PLAN_TERMINAL_STATES } from '@ipodhan/shared/repositories';

export { FIELD_PLAN_TERMINAL_STATES };

export interface PlanSettlement {
  /** `ipo_field_plan` rows stored for the IPO. */
  stored: number;
  /** Of those, rows whose state is NOT terminal. */
  unsettled: number;
  /** The unsettled rows per state (only non-terminal states appear). */
  unsettledByState: Record<string, number>;
}

/** `<stateColumn>::text NOT IN ('SUPPLIED', 'NOT_PRINTED', 'EXHAUSTED')` as bound parameters. */
export function unsettledPlanStatePredicate(stateColumn: SQL): SQL {
  const terminal = sql.join(
    FIELD_PLAN_TERMINAL_STATES.map((s) => sql`${s}`),
    sql`, `
  );
  return sql`${stateColumn}::text NOT IN (${terminal})`;
}

type ExecDb = { execute: (q: SQL) => Promise<unknown> };

interface SettlementRow {
  state: string;
  unsettled: boolean;
  n: number | string;
}

export function summarisePlanSettlement(rows: SettlementRow[]): PlanSettlement {
  const out: PlanSettlement = { stored: 0, unsettled: 0, unsettledByState: {} };
  for (const r of rows) {
    const n = Number(r.n);
    out.stored += n;
    if (r.unsettled) {
      out.unsettled += n;
      out.unsettledByState[r.state] = (out.unsettledByState[r.state] ?? 0) + n;
    }
  }
  return out;
}

/** Stored + unsettled plan rows of one IPO, per state, in one query. */
export async function readPlanSettlement(db: ExecDb, ipoId: string): Promise<PlanSettlement> {
  const result = await db.execute(sql`
    SELECT p.state::text AS state,
           ${unsettledPlanStatePredicate(sql.raw('p.state'))} AS unsettled,
           count(*)::int AS n
      FROM ipo_field_plan p
     WHERE p.ipo_id = ${ipoId}::uuid
     GROUP BY p.state`);
  const rows = ((result as { rows?: SettlementRow[] }).rows ?? (result as SettlementRow[])) as SettlementRow[];
  return summarisePlanSettlement(rows);
}
