/**
 * Pure helpers for merging two `ipos` rows that are one IPO (F-55 class).
 *
 * Extracted from the original `scripts/merge-duplicate-ipo.mjs` prototype so
 * the child-table discovery / ordering / name-fold logic is unit-testable
 * without a database connection. The DB-touching parts (querying
 * information_schema for the live FK graph, the actual read/write of rows)
 * live in `IPORepository.mergeDuplicateInto` — this module only computes,
 * from data already fetched, what the merge plan should be.
 */

/** One row of `information_schema` foreign-key metadata: child references parent via col. */
export interface FkEdge {
  child: string;
  col: string;
  parent: string;
}

/**
 * The normaliser this repair class exists because of, with the corporate-form
 * words the shipped normaliser (`normalizeCompanyNameForMatching`) was
 * missing at the time (F-55: "Company" vs "Co." never collided). Kept
 * independent of that normaliser so a future change to it does not silently
 * change what this repair tool considers "the same company".
 */
export function foldCompanyName(name: string | null | undefined): string {
  return String(name ?? '')
    .toLowerCase()
    .replace(/[.,()&'"-]/g, ' ')
    .replace(
      /\b(private|pvt|limited|ltd|company|co|corporation|corp|incorporated|inc|and|the|of|india|indian)\b/g,
      ' '
    )
    .replace(/\s+/g, '');
}

/** `field_sources.field_name` is camelCase (listingDate, bseIpoNo), not the snake_case column name. */
export function columnToCamelCase(column: string): string {
  return column.replace(/_([a-z])/g, (_match, ch: string) => ch.toUpperCase());
}

/**
 * Data a PERSON created. Deleting it loses something no scraper can rebuild,
 * so it is REPOINTED to the survivor instead of deleted with the dropped row.
 * Everything else discovered as a descendant of `ipos` is scraper output and
 * is deleted along with the dropped row.
 */
export const REPOINT_TABLES: ReadonlySet<string> = new Set([
  'user_watchlist',
  'affiliate_clicks',
  'ipo_reviews',
  'audit_logs',
  'brlm_track_record',
  'ipo_slug_redirects',
]);

/**
 * Columns carried from the dropped row onto the survivor ONLY where the
 * survivor's value is absent. Short and reviewed on purpose — a merge that
 * copies every column is how a wrong value wins.
 */
export const CARRY_IF_ABSENT_COLUMNS: readonly string[] = [
  'listing_date',
  'verifier_url',
  'company_website',
  'cin',
  'symbol',
  'isin',
  'lot_size',
  'registrar',
  'registrar_id',
  'company_description',
  'lead_managers',
  'bse_ipo_no',
  'bse_scrip_code',
  'allotment_date',
  'sector',
  'face_value',
  'objectives',
];

/** Identifier columns that, if they DISAGREE between the two rows, prove two different offers. */
export const DISAGREEING_IDENTIFIER_COLUMNS: readonly string[] = [
  'cin',
  'isin',
  'symbol',
  'bse_ipo_no',
  'bse_scrip_code',
];

/**
 * Breadth-first walk of the live FK graph starting at `root`, discovering
 * every table reachable by following child->parent FK edges (a table is
 * reached once, via the first edge found reaching it — mirrors the original
 * script's `frontier` walk). Self-referencing edges (`child === parent`) are
 * ignored so a self-FK never becomes its own "child".
 *
 * @returns table name -> { col: the FK column on that table, parent: the table it points at }
 */
export function discoverDescendants(fks: FkEdge[], root = 'ipos'): Map<string, { col: string; parent: string }> {
  const reach = new Map<string, { col: string; parent: string }>();
  let frontier = [root];
  while (frontier.length) {
    const next: string[] = [];
    for (const parent of frontier) {
      for (const fk of fks.filter((f) => f.parent === parent && f.child !== f.parent)) {
        if (reach.has(fk.child)) continue;
        reach.set(fk.child, { col: fk.col, parent: fk.parent });
        next.push(fk.child);
      }
    }
    frontier = next;
  }
  return reach;
}

/**
 * Orders the discovered descendant tables so that a table is safe to
 * write/delete once nothing still-pending references it (reverse-dependency
 * order) — a grandchild table is always ordered before its parent so it
 * never blocks the parent's delete. A cycle among the remaining tables (which
 * should not occur in this schema) falls back to an arbitrary but stable
 * order rather than looping forever.
 */
export function reverseDependencyOrder(reach: Map<string, { col: string; parent: string }>, fks: FkEdge[]): string[] {
  const order: string[] = [];
  const pending = new Set(reach.keys());
  while (pending.size) {
    const free = [...pending].filter(
      (t) => ![...pending].some((o) => o !== t && fks.some((f) => f.child === o && f.parent === t))
    );
    if (!free.length) {
      order.push(...pending);
      break;
    }
    free.sort().forEach((t) => {
      order.push(t);
      pending.delete(t);
    });
  }
  return order;
}

/** Convenience: discover + order in one call, and split into (direct children of `ipos`, all descendants). */
export function planDescendantTables(
  fks: FkEdge[],
  root = 'ipos'
): { reach: Map<string, { col: string; parent: string }>; order: string[]; direct: string[] } {
  const reach = discoverDescendants(fks, root);
  const order = reverseDependencyOrder(reach, fks);
  const direct = order.filter((t) => reach.get(t)?.parent === root);
  return { reach, order, direct };
}

export interface ProvenanceRow {
  fieldName: string;
  source: string;
  confidence: number;
}

export interface CarryFieldInput {
  column: string;
  keepValue: unknown;
  dropValue: unknown;
  dropProvenance: ProvenanceRow | undefined;
}

export interface CarryFieldPatch {
  column: string;
  value: unknown;
  source: string;
  confidence: number;
  note: string;
}

/**
 * Decides which of `CARRY_IF_ABSENT_COLUMNS` actually get carried onto the
 * survivor: only columns the survivor has NOTHING in, and the dropped row
 * has a value for. Pure — takes already-fetched values/provenance, decides
 * nothing about the database.
 */
export function planCarryFields(inputs: CarryFieldInput[], droppedId: string): CarryFieldPatch[] {
  const patch: CarryFieldPatch[] = [];
  for (const { column, keepValue, dropValue, dropProvenance } of inputs) {
    if (keepValue !== null && keepValue !== undefined) continue;
    if (dropValue === null || dropValue === undefined) continue;
    patch.push({
      column,
      value: dropValue,
      source: dropProvenance ? dropProvenance.source : 'ADMIN',
      confidence: dropProvenance ? dropProvenance.confidence : 100,
      note: `carried from the merged duplicate row ${droppedId}`,
    });
  }
  return patch;
}

export interface EligibilityInput {
  keepOpenDate: unknown;
  dropOpenDate: unknown;
  keepCompanyName: string | null | undefined;
  dropCompanyName: string | null | undefined;
  forceDifferentName: boolean;
  identifiers: { column: string; keepValue: unknown; dropValue: unknown }[];
}

export type EligibilityResult = { eligible: true } | { eligible: false; reason: string };

/**
 * The refusal checks the original script ran before ANY write: same
 * open_date, names fold to the same string (unless force-overridden), and no
 * disagreeing strong identifier. Pure so it is unit-testable without a DB —
 * this is what stops a merge tool from combining two different offers.
 */
export function checkMergeEligibility(input: EligibilityInput): EligibilityResult {
  if (String(input.keepOpenDate) !== String(input.dropOpenDate)) {
    return {
      eligible: false,
      reason: `the two rows open on different dates (${input.keepOpenDate} vs ${input.dropOpenDate}), so they are two offers`,
    };
  }
  if (!input.forceDifferentName && foldCompanyName(input.keepCompanyName) !== foldCompanyName(input.dropCompanyName)) {
    return {
      eligible: false,
      reason:
        `the two company names do not fold to the same string ("${input.keepCompanyName}" -> ` +
        `${foldCompanyName(input.keepCompanyName)}, "${input.dropCompanyName}" -> ${foldCompanyName(input.dropCompanyName)})`,
    };
  }
  for (const { column, keepValue, dropValue } of input.identifiers) {
    if (keepValue && dropValue && String(keepValue) !== String(dropValue)) {
      return {
        eligible: false,
        reason: `${column} disagrees (${String(keepValue)} vs ${String(dropValue)}) — two offers, not one row twice`,
      };
    }
  }
  return { eligible: true };
}
