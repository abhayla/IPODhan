/**
 * OD-77 (docs/design/data-sourcing-pull-model.md OD-77, §1.11, §2.7, OD-62): the ipos rows that
 * store issue_size = 0. A stored 0 is never a real issue size.
 *
 *  - TENDER / BUYBACK: issue size is NOT_APPLICABLE, DERIVED from offering_type and never stored
 *    (§1.11's BUYBACK/TENDER row, §2.7) -> the 0 is removed (issue_size NULL), nothing else stored.
 *  - OFS / RIGHTS / NCD / IPO: a MISSING value -> the 0 is removed and the field's plan row carries
 *    OD-62's fifth code NOT_SOURCED, through the existing store (ipo_field_plan.reason_code +
 *    cause, the S4 columns the walk already writes). The row is planned by the EXISTING generator
 *    (generateFieldPlan) so its ranks are the manifest's, never typed here; state EXHAUSTED with no
 *    next_due_at, because sourcing the real amount is separate, later work (OD-77).
 */
import * as schema from '@ipodhan/shared/db/schema';
import { eq, sql } from 'drizzle-orm';
import { generateFieldPlan } from '../../src/services/field-plan-generator.js';
import type { IPORepository } from '@ipodhan/shared';

export type ZeroAction = 'REMOVE_NOT_APPLICABLE' | 'NOT_SOURCED';

export function classifyZeroAction(offeringType: string): ZeroAction {
  return offeringType === 'TENDER' || offeringType === 'BUYBACK' ? 'REMOVE_NOT_APPLICABLE' : 'NOT_SOURCED';
}

export const NOT_SOURCED_CAUSE =
  'OD-77: no source we read supplies issue size for this offering; the stored 0 was removed (repair-issue-size-chittorgarh-once-od74 --zeros)';

export interface ZeroRow {
  id: string;
  slug: string;
  offeringType: string;
  segment: 'MAINBOARD' | 'SME' | null;
  listingExchanges: ('NSE' | 'BSE')[] | null;
  issueSize: string;
  updatedAt: string;
}

export interface PlanBeforeImage {
  id: string;
  state: string;
  reasonCode: string | null;
  cause: string | null;
  nextDueAt: string | null;
  updatedAt: string;
}

export interface ZeroOutcome {
  slug: string;
  offeringType: string;
  action: ZeroAction;
  written: boolean;
  note: string;
  before?: { ipoId: string; issueSize: string; updatedAt: string; plan: PlanBeforeImage | null; planInsertedId?: string | null };
}

type Tx = any; // drizzle transaction (same shape repair-tool.ts's SelectInsertLike accepts)

/** Apply one zero row inside the caller's transaction. Returns the before-image for --undo. */
export async function applyZeroRow(tx: Tx, r: ZeroRow, repo: (tx: Tx) => IPORepository): Promise<ZeroOutcome> {
  const action = classifyZeroAction(r.offeringType);
  let plan: PlanBeforeImage | null = null;
  let planInsertedId: string | null = null;
  if (action === 'NOT_SOURCED') {
    const planned = generateFieldPlan({ id: r.id, segment: r.segment, listingExchanges: r.listingExchanges }).find(
      (p) => p.tableName === 'ipos' && p.fieldName === 'issue_size'
    );
    if (!planned) {
      return { slug: r.slug, offeringType: r.offeringType, action, written: false, note: 'the manifest plans no issueSize row for this IPO type — left as is, reported' };
    }
    const existing = await tx.execute(sql`
      SELECT id, state::text AS state, reason_code AS "reasonCode", cause, next_due_at::text AS "nextDueAt", updated_at::text AS "updatedAt"
        FROM ipo_field_plan WHERE ipo_id = ${r.id} AND table_name = 'ipos' AND row_key = '' AND field_name = 'issue_size'`);
    const rows = (existing.rows ?? existing) as PlanBeforeImage[];
    plan = rows[0] ?? null;
    if (plan && plan.state === 'SUPPLIED') {
      return { slug: r.slug, offeringType: r.offeringType, action, written: false, note: 'plan row is SUPPLIED — a value exists elsewhere; left as is' };
    }
    if (plan) {
      // An existing row belongs to the walk: its state and next_due_at stay (a still-due row keeps
      // being asked, OD-73/OD-76); only the reason it holds no value is recorded.
      await tx
        .update(schema.ipoFieldPlan)
        .set({ reasonCode: 'NOT_SOURCED', cause: NOT_SOURCED_CAUSE, updatedAt: new Date() })
        .where(eq(schema.ipoFieldPlan.id, plan.id));
    } else {
      const ins = await tx
        .insert(schema.ipoFieldPlan)
        .values({ ...planned, state: 'EXHAUSTED', reasonCode: 'NOT_SOURCED', cause: NOT_SOURCED_CAUSE, nextDueAt: null })
        .returning({ id: schema.ipoFieldPlan.id });
      planInsertedId = ins[0]?.id ?? null;
    }
  }
  const cur = await tx.execute(sql`SELECT issue_size = 0 AS zero FROM ipos WHERE id = ${r.id} FOR UPDATE`);
  if (!((cur.rows ?? cur)[0]?.zero)) throw new Error(`row changed since selection (issue_size no longer 0) — transaction rolled back`);
  await repo(tx).applyIssueSizeRepair(r.id, null);
  return {
    slug: r.slug,
    offeringType: r.offeringType,
    action,
    written: true,
    note: action === 'NOT_SOURCED' ? 'issue_size 0 -> NULL; plan row NOT_SOURCED' : 'issue_size 0 -> NULL (NOT_APPLICABLE is derived from offering_type)',
    before: { ipoId: r.id, issueSize: r.issueSize, updatedAt: r.updatedAt, plan, planInsertedId },
  };
}

/** Exact reverse of applyZeroRow from its before-image. Refuses a row that changed since. */
export async function undoZeroRow(tx: Tx, o: ZeroOutcome, repo: (tx: Tx) => IPORepository): Promise<boolean> {
  const b = o.before;
  if (!b) return false;
  const cur = await tx.execute(sql`SELECT issue_size IS NULL AS unset FROM ipos WHERE id = ${b.ipoId} FOR UPDATE`);
  if (!((cur.rows ?? cur)[0]?.unset)) return false;
  await repo(tx).applyIssueSizeRepair(b.ipoId, b.issueSize, b.updatedAt);
  if (b.planInsertedId) await tx.delete(schema.ipoFieldPlan).where(eq(schema.ipoFieldPlan.id, b.planInsertedId));
  else if (b.plan)
    await tx
      .update(schema.ipoFieldPlan)
      .set({
        state: b.plan.state as never,
        reasonCode: b.plan.reasonCode,
        cause: b.plan.cause,
        nextDueAt: b.plan.nextDueAt === null ? null : sql`${b.plan.nextDueAt}::timestamp`,
        updatedAt: sql`${b.plan.updatedAt}::timestamp`,
      })
      .where(eq(schema.ipoFieldPlan.id, b.plan.id));
  return true;
}
