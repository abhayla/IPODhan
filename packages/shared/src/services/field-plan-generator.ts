/**
 * THE field-plan generator - pull model, design §2.3 (one definition; spec §2.8, §9.2 item 18).
 *
 * `field_sources` records successful writes only, so a field never attempted and a field attempted
 * and failed are indistinguishable in it (both absent). `ipo_field_plan` is the row that separates
 * them. This module produces those rows for one IPO. It is used by the scraper (the document
 * cycle's plant step and the closed-IPO job, through `scraper/src/services/field-plan-planting.ts`)
 * AND by the admin plan rebuild (`plan-invalidating-rebuild.ts`), so the two can never plan an IPO
 * differently. The scraper's `field-plan-generator.ts` only binds the default manifest.
 *
 * Pure: no database access. Overrides (layer 2) come in through an injected reader.
 */

/**
 * The manifest keys its rank arrays by IPO type, not by the DB `segment` enum. `segment` is only
 * MAINBOARD | SME, so SME_BSE vs SME_NSE is decided by the listing exchanges.
 */
export type IpoTypeKey = 'MAINBOARD' | 'SME_BSE' | 'SME_NSE' | string;

export type FieldPlanState =
  | 'PENDING'
  | 'SUPPLIED'
  | 'NOT_PRINTED'
  | 'NOT_AVAILABLE_YET'
  | 'CHECK_FAILED'
  | 'EXHAUSTED';

/** The slice of an `ipos` row the plan needs. */
export interface PlanIpo {
  id: string;
  segment: 'MAINBOARD' | 'SME' | string | null;
  listingExchanges?: readonly string[] | null;
  /**
   * §1.11 / §2.8 (PR #1327 round 1): the IPO's offering type. A field whose manifest `na` list
   * names it is not applicable, so it is not planned. `undefined` (a caller that never read it)
   * plans every field the type key ranks, as before.
   */
  offeringType?: string | null;
}

/** The slice of `scraper/config/field-manifest.json` the plan needs (the scraper's zod type fits it). */
export interface PlanManifest {
  version: number;
  fields: Record<string, { rank: Partial<Record<string, readonly string[]>>; na?: readonly string[] }>;
}

/** One planned (IPO, table, field) row, shaped like the `ipo_field_plan` columns it inserts into. */
export interface PlannedFieldRow {
  ipoId: string;
  tableName: string;
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
  manifestVersion: number;
  /** 'registry:<version>' | 'override:<id>' — which configuration produced this row's ranks. */
  policyOrigin: string;
}

/** One active `field_source_overrides` row as a reader hands it over (null ranks already dropped). */
export interface ActiveOverride {
  id: string;
  ranks: readonly string[];
  expiresAt: string;
  ipoScoped: boolean;
}

export interface PlanOverridesReader {
  resolve(query: { table: string; column: string; ipoType: string; ipoId?: string }): Promise<ActiveOverride[]>;
}

/** How many rank columns `ipo_field_plan` has. A longer rank list is refused, never truncated. */
export const PLAN_RANK_COLUMNS = 3;

export function resolveIpoTypeKey(ipo: Pick<PlanIpo, 'segment' | 'listingExchanges'> & { id?: string }): IpoTypeKey {
  if (ipo.segment !== 'SME') return 'MAINBOARD';
  // An SME issue listing on NSE Emerge is SME_NSE; everything else SME is SME_BSE. A missing
  // listing_exchanges is NOT evidence of NSE, so it falls to SME_BSE - and it must never fall
  // back to MAINBOARD, which would plan NSE-first ranks for a BSE-only SME issue.
  return (ipo.listingExchanges ?? []).includes('NSE') ? 'SME_NSE' : 'SME_BSE';
}

/**
 * The registry (layer 1) ranks of one manifest entry for one IPO type: `null` when the manifest
 * has no rank entry for the type (N/A - never "source it the MAINBOARD way"), else a copy of the
 * list. The ONE place `rank[typeKey]` is read: the generator here and the scraper's resolver
 * (`field-source-policy.ts`) both call it.
 */
export function registryRanksFor(entry: { rank: Partial<Record<string, readonly string[]>> }, typeKey: IpoTypeKey): string[] | null {
  const ranks = entry.rank[typeKey];
  return Array.isArray(ranks) ? [...ranks] : null;
}

/** The slice of a manifest entry that decides applicability: its per-type ranks and its §1.11 `na` list. */
export interface ApplicabilityEntry {
  rank: Partial<Record<string, readonly string[]>>;
  na?: readonly string[];
}

/**
 * Does this field apply to this IPO at all (§1.11 per-type exceptions, §2.8, §9.2 item 18)? The ONE
 * rule, read from the manifest entry the plan already uses: not applicable when the manifest ranks
 * nothing for the IPO's type key (the plan's own N/A, `registryRanksFor` null) or when the IPO's
 * offering type is in the entry's `na` list (§1.11, e.g. lot size on a BUYBACK). An empty rank list
 * is NOT "not applicable" (#858: no source can serve it, a gap, not a type rule). The page, the API
 * payload and the admin editor all ask this function; there is no second table of rules.
 */
export function isFieldApplicable(
  entry: ApplicabilityEntry,
  ipo: Pick<PlanIpo, 'segment' | 'listingExchanges'> & { offeringType?: string | null }
): boolean {
  if (registryRanksFor(entry, resolveIpoTypeKey(ipo)) === null) return false;
  const type = ipo.offeringType ?? null;
  return !(type !== null && (entry.na ?? []).includes(type));
}

/**
 * One planned row per manifest field that declares a rank for THIS IPO's type. A field with no
 * entry for the type is not planned; a field whose list is empty (no source can serve it for this
 * type, #858) is not planned either - a sourceless row would read as EXHAUSTED vacuously.
 */
export function generateFieldPlan(ipo: PlanIpo, manifest: PlanManifest): PlannedFieldRow[] {
  const typeKey = resolveIpoTypeKey(ipo);
  const rows: PlannedFieldRow[] = [];

  for (const [fieldKey, entry] of Object.entries(manifest.fields)) {
    const dot = fieldKey.indexOf('.');
    if (dot <= 0 || dot === fieldKey.length - 1 || fieldKey.indexOf('.', dot + 1) !== -1) {
      throw new Error(
        `generateFieldPlan: manifest field key "${fieldKey}" is not of the form table.field - ` +
          `the plan row's key is (ipo_id, table_name, field_name) and cannot be derived from it.`
      );
    }
    const tableName = fieldKey.slice(0, dot);
    const fieldName = fieldKey.slice(dot + 1);

    const ranks = registryRanksFor(entry, typeKey);
    if (ranks === null || ranks.length === 0) continue;
    // §1.11: not applicable to this offering type (the same `na` read as isFieldApplicable).
    if (ipo.offeringType != null && (entry.na ?? []).includes(ipo.offeringType)) continue;
    if (ranks.length > PLAN_RANK_COLUMNS) {
      throw new Error(
        `generateFieldPlan: field "${fieldKey}" ranks ${ranks.length} sources for ${typeKey} ` +
          `(${ranks.join(', ')}) but ipo_field_plan has only ${PLAN_RANK_COLUMNS} rank columns - ` +
          `refusing rather than silently dropping rank ${PLAN_RANK_COLUMNS + 1}.`
      );
    }

    rows.push({
      ipoId: ipo.id,
      tableName,
      fieldName,
      rank1Source: ranks[0] ?? null,
      rank2Source: ranks[1] ?? null,
      rank3Source: ranks[2] ?? null,
      state: 'PENDING',
      chosenSource: null,
      chosenRank: null,
      chosenDocumentId: null,
      chosenDocumentType: null,
      chosenSha256: null,
      chosenPage: null,
      attempts: 0,
      lastAttemptAt: null,
      // Stamped so the plan is RECONCILED when the manifest changes, never regenerated per cycle.
      manifestVersion: manifest.version,
      policyOrigin: `registry:${manifest.version}`,
    });
  }

  return rows;
}

/**
 * The override-aware generator (layer 2): the registry plan above, then - only for rows where the
 * reader returns an active override - the override's ranks and origin. An ipo-scoped row beats a
 * global one; among the same scope the reader's order (newest first) decides.
 */
export async function generateFieldPlanAsync(
  ipo: PlanIpo,
  deps: { overrides?: PlanOverridesReader },
  manifest: PlanManifest
): Promise<PlannedFieldRow[]> {
  const rows = generateFieldPlan(ipo, manifest);
  if (rows.length === 0 || !deps.overrides) return rows;
  const typeKey = resolveIpoTypeKey(ipo);
  const reader = deps.overrides;

  return Promise.all(
    rows.map(async (row) => {
      const active = await reader.resolve({ table: row.tableName, column: row.fieldName, ipoType: typeKey, ipoId: ipo.id });
      if (active.length === 0) return row;
      const winner = active.find((r) => r.ipoScoped) ?? active[0];
      const ranks = winner.ranks;
      if (ranks.length > PLAN_RANK_COLUMNS) {
        throw new Error(
          `generateFieldPlanAsync: override "${winner.id}" ranks ${ranks.length} sources for ` +
            `${row.tableName}.${row.fieldName} but ipo_field_plan has only ${PLAN_RANK_COLUMNS} rank columns.`
        );
      }
      return {
        ...row,
        rank1Source: ranks[0] ?? null,
        rank2Source: ranks[1] ?? null,
        rank3Source: ranks[2] ?? null,
        policyOrigin: `override:${winner.id}`,
      };
    })
  );
}
