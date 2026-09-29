/**
 * Plan-invalidating fields (spec §2.8, §9.2 item 18): a write to `offering_type`, `segment` or
 * `listing_exchanges` drops and rebuilds that IPO's `ipo_field_plan` rows, keeping the rows whose
 * rank-1 source is unchanged. Called by the ONE admin write (`admin-field-write.ts`) inside its
 * transaction, after the value is written and while the `ipos` row is locked.
 *
 * The planned rows are built from the field manifest by the SAME rules as the scraper's generator
 * (`scraper/src/services/field-plan-generator.ts` generateFieldPlan + generateFieldPlanAsync's
 * override precedence). The generator lives in the scraper workspace, which neither this package
 * nor `web/` can import, so `planRowsFromManifest` is its data-level twin;
 * `scraper/tests/unit/services/plan-rows-from-manifest-parity.test.ts` asserts the two produce the
 * same rows for every IPO type the manifest keys, so they cannot drift silently.
 *
 * What the rebuild does, per (table, field):
 *   - planned, existing row with the SAME rank-1 source: kept (state, chosen value and evidence
 *     untouched); ranks 2/3, manifest version and policy origin follow the new plan, unless the
 *     row is reopened under an override (its ranks are the override's, #968);
 *   - planned, existing row with a DIFFERENT rank-1 source: dropped and re-planted PENDING, so the
 *     walk asks the new rank-1 source;
 *   - existing row the new type no longer plans: dropped;
 *   - planned with no existing row: planted PENDING (row_key '', as the cycle plants).
 * Stored field values are never touched here: the walk replaces a value when its new rank-1 source
 * answers, and an admin hold keeps its value (§2.7).
 */
import { sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type * as schema from '../db/schema';

type Db = NodePgDatabase<typeof schema>;

/** The `ipos` fields whose write rebuilds the plan (§2.8). Drizzle property names. */
export const PLAN_INVALIDATING_IPO_FIELDS: readonly string[] = ['offeringType', 'segment', 'listingExchanges'];

export function isPlanInvalidatingField(tableName: string, fieldName: string): boolean {
  return tableName === 'ipos' && PLAN_INVALIDATING_IPO_FIELDS.includes(fieldName);
}

/**
 * `ipos.listing_exchanges` is a jsonb list the plan's type key reads (`includes('NSE')`). A typed
 * value arrives as text ("BSE", "NSE, BSE") or a list; it is stored as a list of NSE/BSE only, or
 * refused, so a string or an unknown venue never reaches the plan (a string "NSE,BSE" would still
 * answer `includes('NSE')`, by accident).
 */
export function normalizeListingExchanges(value: unknown): { ok: true; value: ('NSE' | 'BSE')[] | null } | { ok: false; reason: string } {
  if (value === null) return { ok: true, value: null };
  const parts = Array.isArray(value) ? value : typeof value === 'string' ? value.split(/[\s,]+/) : null;
  if (!parts) return { ok: false, reason: `expected NSE and/or BSE, got ${JSON.stringify(value)}` };
  const out: ('NSE' | 'BSE')[] = [];
  for (const p of parts) {
    if (typeof p !== 'string') return { ok: false, reason: `expected NSE and/or BSE, got ${JSON.stringify(value)}` };
    const v = p.trim().toUpperCase();
    if (v === '') continue;
    if (v !== 'NSE' && v !== 'BSE') return { ok: false, reason: `unknown listing exchange ${JSON.stringify(p)} (NSE or BSE)` };
    if (!out.includes(v)) out.push(v);
  }
  if (out.length === 0) return { ok: false, reason: 'expected at least one of NSE, BSE' };
  return { ok: true, value: out };
}

/** The slice of `scraper/config/field-manifest.json` the plan needs. */
export interface PlanManifest {
  version: number;
  fields: Record<string, { rank: Record<string, readonly string[] | undefined> }>;
}

export interface PlanTypeIpo {
  id: string;
  segment: string | null;
  listingExchanges?: readonly string[] | null;
}

/** Same rule as `resolveIpoTypeKey` (field-plan-generator.ts). */
export function planTypeKey(ipo: Pick<PlanTypeIpo, 'segment' | 'listingExchanges'>): string {
  if (ipo.segment !== 'SME') return 'MAINBOARD';
  return (ipo.listingExchanges ?? []).includes('NSE') ? 'SME_NSE' : 'SME_BSE';
}

export interface PlannedRow {
  tableName: string;
  fieldName: string;
  rank1Source: string | null;
  rank2Source: string | null;
  rank3Source: string | null;
  manifestVersion: number;
  policyOrigin: string;
}

const RANK_COLUMNS = 3;

/** Registry-only plan rows for one IPO (generateFieldPlan's rules). */
export function planRowsFromManifest(manifest: PlanManifest, ipo: PlanTypeIpo): PlannedRow[] {
  const typeKey = planTypeKey(ipo);
  const out: PlannedRow[] = [];
  for (const [fieldKey, entry] of Object.entries(manifest.fields)) {
    const dot = fieldKey.indexOf('.');
    if (dot <= 0 || dot === fieldKey.length - 1 || fieldKey.indexOf('.', dot + 1) !== -1) {
      throw new Error(`planRowsFromManifest: manifest field key "${fieldKey}" is not of the form table.field`);
    }
    const ranks = entry.rank?.[typeKey];
    // No entry for this type = not planned; an empty list = no source can serve it (#858).
    if (!Array.isArray(ranks) || ranks.length === 0) continue;
    if (ranks.length > RANK_COLUMNS) {
      throw new Error(`planRowsFromManifest: field "${fieldKey}" ranks ${ranks.length} sources for ${typeKey}; ipo_field_plan has ${RANK_COLUMNS} rank columns`);
    }
    out.push({
      tableName: fieldKey.slice(0, dot),
      fieldName: fieldKey.slice(dot + 1),
      rank1Source: ranks[0] ?? null,
      rank2Source: ranks[1] ?? null,
      rank3Source: ranks[2] ?? null,
      manifestVersion: manifest.version,
      policyOrigin: `registry:${manifest.version}`,
    });
  }
  return out;
}

interface OverrideRow {
  id: string;
  table_name: string;
  field_name: string;
  ipo_id: string | null;
  rank1_source: string;
  rank2_source: string | null;
  rank3_source: string | null;
}

/**
 * Active `field_source_overrides` rows for this IPO (its own and global), newest first. Layer 2 of
 * the policy: an ipo-scoped row beats a global one (generateFieldPlanAsync). A database without the
 * table has no layer 2; checked with to_regclass so a missing table never aborts the transaction.
 */
async function activeOverrides(tx: Db, ipoId: string): Promise<OverrideRow[]> {
  const exists = await tx.execute(sql`SELECT to_regclass('public.field_source_overrides') IS NOT NULL AS present`);
  if (!(exists.rows[0] as { present?: boolean } | undefined)?.present) return [];
  const res = await tx.execute(sql`
    SELECT id, table_name, field_name, ipo_id, rank1_source, rank2_source, rank3_source
      FROM field_source_overrides
     WHERE expired_at IS NULL
       AND expires_at > now()
       AND (ipo_id IS NULL OR ipo_id = ${ipoId}::uuid)
     ORDER BY set_at DESC, id DESC`);
  return res.rows as unknown as OverrideRow[];
}

function applyOverrides(rows: PlannedRow[], overrides: OverrideRow[]): PlannedRow[] {
  if (overrides.length === 0) return rows;
  return rows.map((row) => {
    const active = overrides.filter((o) => o.table_name === row.tableName && o.field_name === row.fieldName);
    if (active.length === 0) return row;
    const winner = active.find((o) => o.ipo_id !== null) ?? active[0];
    return {
      ...row,
      rank1Source: winner.rank1_source,
      rank2Source: winner.rank2_source,
      rank3Source: winner.rank3_source,
      policyOrigin: `override:${winner.id}`,
    };
  });
}

export interface PlanRebuildSummary {
  typeKeyBefore: string;
  typeKeyAfter: string;
  planned: number;
  kept: number;
  replanted: number;
  dropped: number;
  added: number;
}

interface ExistingRow {
  id: string;
  table_name: string;
  row_key: string;
  field_name: string;
  rank1_source: string | null;
  reopened_under_policy: string | null;
}

/**
 * Rebuild one IPO's plan inside the caller's transaction (the caller holds the `ipos` row lock).
 * `before` is the IPO's type slice before the write, for the audit summary only.
 */
export async function rebuildIpoPlanInTx(
  tx: Db,
  ipoId: string,
  manifest: PlanManifest,
  before: Pick<PlanTypeIpo, 'segment' | 'listingExchanges'>
): Promise<PlanRebuildSummary> {
  const cur = await tx.execute(sql`SELECT segment, listing_exchanges FROM ipos WHERE id = ${ipoId}::uuid`);
  const ipoRow = cur.rows[0] as { segment: string | null; listing_exchanges: string[] | null } | undefined;
  if (!ipoRow) throw new Error(`rebuildIpoPlanInTx: IPO ${ipoId} not found`);
  const after: PlanTypeIpo = { id: ipoId, segment: ipoRow.segment, listingExchanges: ipoRow.listing_exchanges };

  const planned = applyOverrides(planRowsFromManifest(manifest, after), await activeOverrides(tx, ipoId));
  const plannedByKey = new Map(planned.map((p) => [`${p.tableName}.${p.fieldName}`, p]));

  const existingRes = await tx.execute(sql`
    SELECT id, table_name, row_key, field_name, rank1_source, reopened_under_policy
      FROM ipo_field_plan
     WHERE ipo_id = ${ipoId}::uuid`);
  const existing = existingRes.rows as unknown as ExistingRow[];

  const toDelete: string[] = [];
  const toPlant: Array<PlannedRow & { rowKey: string }> = [];
  const toRerank: Array<{ id: string; plan: PlannedRow }> = [];
  const coveredKeys = new Set<string>();
  let kept = 0;
  let replanted = 0;
  let dropped = 0;

  for (const row of existing) {
    const k = `${row.table_name}.${row.field_name}`;
    const plan = plannedByKey.get(k);
    if (!plan) {
      toDelete.push(row.id);
      dropped++;
      continue;
    }
    coveredKeys.add(k);
    if (plan.rank1Source === row.rank1_source) {
      kept++;
      if (row.reopened_under_policy === null) toRerank.push({ id: row.id, plan });
      continue;
    }
    toDelete.push(row.id);
    toPlant.push({ ...plan, rowKey: row.row_key });
    replanted++;
  }
  let added = 0;
  for (const plan of planned) {
    if (coveredKeys.has(`${plan.tableName}.${plan.fieldName}`)) continue;
    toPlant.push({ ...plan, rowKey: '' });
    added++;
  }

  if (toRerank.length > 0) {
    // One statement, not one round trip per kept row.
    const values = sql.join(
      toRerank.map(
        ({ id, plan }) => sql`(${id}::uuid, ${plan.rank2Source}::varchar, ${plan.rank3Source}::varchar, ${plan.manifestVersion}::int, ${plan.policyOrigin}::varchar)`
      ),
      sql`, `
    );
    await tx.execute(sql`
      UPDATE ipo_field_plan AS p
         SET rank2_source = v.rank2_source, rank3_source = v.rank3_source,
             manifest_version = v.manifest_version, policy_origin = v.policy_origin, updated_at = now()
        FROM (VALUES ${values}) AS v(id, rank2_source, rank3_source, manifest_version, policy_origin)
       WHERE p.id = v.id
         AND (p.rank2_source IS DISTINCT FROM v.rank2_source OR p.rank3_source IS DISTINCT FROM v.rank3_source
              OR p.manifest_version IS DISTINCT FROM v.manifest_version OR p.policy_origin IS DISTINCT FROM v.policy_origin)`);
  }
  if (toDelete.length > 0) {
    await tx.execute(sql`DELETE FROM ipo_field_plan WHERE id IN (${sql.join(toDelete.map((id) => sql`${id}::uuid`), sql`, `)})`);
  }
  if (toPlant.length > 0) {
    const values = sql.join(
      toPlant.map(
        (p) =>
          sql`(${ipoId}::uuid, ${p.tableName}, ${p.rowKey}, ${p.fieldName}, ${p.rank1Source}, ${p.rank2Source}, ${p.rank3Source}, ${p.manifestVersion}, ${p.policyOrigin})`
      ),
      sql`, `
    );
    await tx.execute(sql`
      INSERT INTO ipo_field_plan (
        ipo_id, table_name, row_key, field_name,
        rank1_source, rank2_source, rank3_source, manifest_version, policy_origin
      ) VALUES ${values}`);
  }

  return {
    typeKeyBefore: planTypeKey(before),
    typeKeyAfter: planTypeKey(after),
    planned: planned.length,
    kept,
    replanted,
    dropped,
    added,
  };
}
