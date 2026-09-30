/**
 * Plan-invalidating fields (spec §2.8, §9.2 item 18): a write to `offering_type`, `segment` or
 * `listing_exchanges` drops and rebuilds that IPO's `ipo_field_plan` rows, keeping the rows whose
 * rank-1 source is unchanged. Called by the ONE admin write (`admin-field-write.ts`) inside its
 * transaction, after the value is written and while the `ipos` row is locked.
 *
 * The planned rows come from THE generator (`field-plan-generator.ts` in this package, the same
 * function the scraper's plant step calls), with active `field_source_overrides` read inside the
 * transaction and applied by the generator's own precedence. There is no second copy of the rules.
 *
 * No plan change = no rebuild: the plan depends only on the IPO's type key (segment + listing
 * exchanges) and its offering type (the manifest's §1.11 `na` lists). A save that leaves both as
 * they were touches no plan row; an `offering_type` correction alone rebuilds only when it changes
 * the not-applicable set (`planInputsChanged`), so a field the new type makes not applicable stops
 * being planned and walked (PR #1327 round 1), while FPO -> IPO touches nothing.
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
 *
 * OD-142: a re-planted row whose field still holds a (non-admin) value is listed in the admin queue
 * as "source no longer first" until the new rank-1 source answers (`source-no-longer-first.ts`); a
 * dropped row's open item leaves the queue (the field no longer applies, item 18).
 */
import { sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type * as schema from '../db/schema';
import { parseNaiveTimestampAsUtc } from '../db/timezone-config';
import { FIELD_PLAN_HELD_READ_PREFIX } from '../repositories/ipo-field-plan-repository';
import {
  generateFieldPlanAsync,
  resolveIpoTypeKey,
  type ActiveOverride,
  type PlanIpo,
  type PlanManifest,
  type PlannedFieldRow,
  type PlanOverridesReader,
} from './field-plan-generator';
import { clearSourceNoLongerFirstForDropped, queueSourceNoLongerFirstInTx, type RankOneChange } from './source-no-longer-first';

export type { PlanManifest };

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

interface OverrideRow {
  id: string;
  table_name: string;
  field_name: string;
  ipo_id: string | null;
  rank1_source: string;
  rank2_source: string | null;
  rank3_source: string | null;
  expires_at: string | Date;
}

/**
 * Layer 2 read inside the admin transaction, as the generator's reader: active rows for this IPO
 * (its own and global), newest first, null ranks dropped (the scraper's reader does the same,
 * `field-source-overrides-reader.ts`). A database without the table has no layer 2; checked with
 * to_regclass so a missing table never aborts the transaction.
 */
async function txOverridesReader(tx: Db, ipoId: string): Promise<PlanOverridesReader> {
  const exists = await tx.execute(sql`SELECT to_regclass('public.field_source_overrides') IS NOT NULL AS present`);
  let rows: OverrideRow[] = [];
  if ((exists.rows[0] as { present?: boolean } | undefined)?.present) {
    const res = await tx.execute(sql`
      SELECT id, table_name, field_name, ipo_id, rank1_source, rank2_source, rank3_source, expires_at
        FROM field_source_overrides
       WHERE expired_at IS NULL
         AND expires_at > now()
         AND (ipo_id IS NULL OR ipo_id = ${ipoId}::uuid)
       ORDER BY set_at DESC, id DESC`);
    rows = res.rows as unknown as OverrideRow[];
  }
  return {
    async resolve(q): Promise<ActiveOverride[]> {
      return rows
        .filter((o) => o.table_name === q.table && o.field_name === q.column)
        .map((o) => ({
          id: o.id,
          ranks: [o.rank1_source, o.rank2_source, o.rank3_source].filter((x): x is string => x !== null),
          expiresAt: expiresAtToIso(o.expires_at),
          ipoScoped: o.ipo_id !== null,
        }));
    },
  };
}

/**
 * `expires_at` comes back from a raw `tx.execute(sql\`...\`)` read, so it is whatever the pg
 * driver's type parser for this column's OID produced — a `Date` when node-postgres's own
 * `timestamptz` parser (or `configureUtcTimestampParsing`) already ran, or naive wall-clock TEXT
 * otherwise. A `Date` is re-serialised directly (it already carries the correct instant); text is
 * parsed as UTC via `parseNaiveTimestampAsUtc`, never via a bare `new Date(<string>)`, which would
 * read a naive value at the PROCESS's local offset (`.claude/rules/ist-timezone.md`).
 */
export function expiresAtToIso(value: string | Date): string {
  if (value instanceof Date) {
    return value.toISOString();
  }
  const parsed = parseNaiveTimestampAsUtc(value);
  if (parsed === null) {
    throw new Error(`field_source_overrides.expires_at: could not parse ${JSON.stringify(value)}`);
  }
  return parsed.toISOString();
}

export interface PlanRebuildSummary {
  typeKeyBefore: string;
  typeKeyAfter: string;
  planned: number;
  kept: number;
  replanted: number;
  dropped: number;
  added: number;
  /** OD-142: "source no longer first" queue items opened (re-planted fields that keep a value). */
  queued: number;
  /** false when the type key did not change: no plan row was touched. */
  rebuilt: boolean;
}

interface ExistingRow {
  id: string;
  table_name: string;
  row_key: string;
  field_name: string;
  rank1_source: string | null;
  reopened_under_policy: string | null;
  cause: string | null;
  /** Naive timestamp as its own text, never through a JS Date (ist-timezone rule). */
  last_attempt_at: string | null;
}

/**
 * The manifest fields an offering type makes not applicable (§1.11 `na` lists), as a sorted key.
 * `null` (type unknown) excludes nothing, the same as the generator.
 */
function notApplicableKey(manifest: PlanManifest, offeringType: string | null | undefined): string {
  if (offeringType == null) return '';
  return Object.entries(manifest.fields)
    .filter(([, entry]) => (entry.na ?? []).includes(offeringType))
    .map(([k]) => k)
    .sort()
    .join('|');
}

/**
 * Would the generator plan this IPO differently after the write? The plan's inputs are the ranks
 * (a function of the type key) and the not-applicable set (a function of the offering type through
 * the manifest's `na` lists). An offering-type change that moves neither (FPO -> IPO) changes
 * nothing in the plan, so it must not re-version or re-plant a single row.
 */
export function planInputsChanged(
  manifest: PlanManifest,
  before: Pick<PlanIpo, 'segment' | 'listingExchanges' | 'offeringType'>,
  after: Pick<PlanIpo, 'segment' | 'listingExchanges' | 'offeringType'>
): boolean {
  if (resolveIpoTypeKey(before) !== resolveIpoTypeKey(after)) return true;
  return notApplicableKey(manifest, before.offeringType) !== notApplicableKey(manifest, after.offeringType);
}

/**
 * Rebuild one IPO's plan inside the caller's transaction (the caller holds the `ipos` row lock).
 * `before` is the IPO's type slice before the write, for the audit summary only.
 */
export async function rebuildIpoPlanInTx(
  tx: Db,
  ipoId: string,
  manifest: PlanManifest,
  before: Pick<PlanIpo, 'segment' | 'listingExchanges' | 'offeringType'>
): Promise<PlanRebuildSummary> {
  const cur = await tx.execute(sql`SELECT segment, listing_exchanges, offering_type::text AS offering_type FROM ipos WHERE id = ${ipoId}::uuid`);
  const ipoRow = cur.rows[0] as { segment: string | null; listing_exchanges: string[] | null; offering_type: string | null } | undefined;
  if (!ipoRow) throw new Error(`rebuildIpoPlanInTx: IPO ${ipoId} not found`);
  const after: PlanIpo = { id: ipoId, segment: ipoRow.segment, listingExchanges: ipoRow.listing_exchanges, offeringType: ipoRow.offering_type };
  const typeKeyBefore = resolveIpoTypeKey(before);
  const typeKeyAfter = resolveIpoTypeKey(after);
  if (!planInputsChanged(manifest, before, after)) {
    // Same ranks and same not-applicable set: the plan would come out identical, so nothing is
    // rebuilt and nothing re-versioned (e.g. FPO -> IPO, which no manifest `na` list separates).
    return { typeKeyBefore, typeKeyAfter, planned: 0, kept: 0, replanted: 0, dropped: 0, added: 0, queued: 0, rebuilt: false };
  }

  const planned = await generateFieldPlanAsync(after, { overrides: await txOverridesReader(tx, ipoId) }, manifest);
  const plannedByKey = new Map(planned.map((p) => [`${p.tableName}.${p.fieldName}`, p]));

  const existingRes = await tx.execute(sql`
    SELECT id, table_name, row_key, field_name, rank1_source, reopened_under_policy, cause, last_attempt_at::text AS last_attempt_at
      FROM ipo_field_plan
     WHERE ipo_id = ${ipoId}::uuid`);
  const existing = existingRes.rows as unknown as ExistingRow[];

  const toDelete: string[] = [];
  const toPlant: Array<PlannedFieldRow & { rowKey: string; heldReadCause: string | null; heldReadAt: string | null }> = [];
  const toRerank: Array<{ id: string; plan: PlannedFieldRow }> = [];
  const coveredKeys = new Set<string>();
  const rankOneChanges: RankOneChange[] = [];
  const droppedKeys: Array<{ tableName: string; rowKey: string; fieldName: string }> = [];
  let kept = 0;
  let replanted = 0;
  let dropped = 0;

  for (const row of existing) {
    const k = `${row.table_name}.${row.field_name}`;
    const plan = plannedByKey.get(k);
    if (!plan) {
      toDelete.push(row.id);
      droppedKeys.push({ tableName: row.table_name, rowKey: row.row_key, fieldName: row.field_name });
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
    if (plan.rank1Source !== null) {
      rankOneChanges.push({
        tableName: row.table_name,
        fieldName: row.field_name,
        rowKey: row.row_key,
        oldRank1: row.rank1_source,
        newRank1: plan.rank1Source,
      });
    }
    // A held field's walk-read stamp (`[held-read:<key>]`, OD-65: no extra read of a held field)
    // moves to the re-planted row, so the new rank-1 source does not read it again until the key
    // (stage, completed documents) changes.
    const cause = row.cause;
    const held = cause !== null && cause.startsWith(FIELD_PLAN_HELD_READ_PREFIX);
    toPlant.push({
      ...plan,
      rowKey: row.row_key,
      heldReadCause: held ? cause.slice(0, cause.indexOf(']') + 1) : null,
      heldReadAt: held ? row.last_attempt_at : null,
    });
    replanted++;
  }
  let added = 0;
  for (const plan of planned) {
    if (coveredKeys.has(`${plan.tableName}.${plan.fieldName}`)) continue;
    toPlant.push({ ...plan, rowKey: '', heldReadCause: null, heldReadAt: null });
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
          sql`(${ipoId}::uuid, ${p.tableName}, ${p.rowKey}, ${p.fieldName}, ${p.rank1Source}, ${p.rank2Source}, ${p.rank3Source}, ${p.manifestVersion}, ${p.policyOrigin}, ${p.heldReadCause}::text, ${p.heldReadAt}::timestamp)`
      ),
      sql`, `
    );
    await tx.execute(sql`
      INSERT INTO ipo_field_plan (
        ipo_id, table_name, row_key, field_name,
        rank1_source, rank2_source, rank3_source, manifest_version, policy_origin,
        cause, last_attempt_at
      ) VALUES ${values}`);
    // A carried held-read stamp means "read at this key": not due by the slot cadence (as
    // recordHeldFieldRead leaves a PENDING row).
    await tx.execute(sql`
      UPDATE ipo_field_plan SET next_due_at = NULL
       WHERE ipo_id = ${ipoId}::uuid AND state = 'PENDING'
         AND left(coalesce(cause, ''), ${FIELD_PLAN_HELD_READ_PREFIX.length}) = ${FIELD_PLAN_HELD_READ_PREFIX}`);
  }

  await clearSourceNoLongerFirstForDropped(tx, ipoId, droppedKeys);
  const queue = await queueSourceNoLongerFirstInTx(tx, ipoId, rankOneChanges);

  return {
    typeKeyBefore,
    typeKeyAfter,
    planned: planned.length,
    kept,
    replanted,
    dropped,
    added,
    queued: queue.queued,
    rebuilt: true,
  };
}
