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

/**
 * Builds the dropped-row provenance lookup FROM rows already scoped to a
 * single `ipoId` at the query level, defending in depth against a caller
 * that (by mistake) fetched `field_sources` rows for BOTH the keep and drop
 * ids in one query (MAJOR-1, PR #433 review): a keep-side row would silently
 * become the "drop provenance" for a field, so a carried value gets stamped
 * with the SURVIVOR's source instead of the dropped row's real one. Filtering
 * again here — even though the caller is also expected to filter at the
 * query — means a future caller cannot reintroduce the bug by loosening the
 * query's `where`.
 */
export function buildProvenanceMap(
  rows: (ProvenanceRow & { ipoId: string })[],
  ipoId: string
): Map<string, ProvenanceRow> {
  return new Map(rows.filter((r) => r.ipoId === ipoId).map((r) => [r.fieldName, r]));
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

/**
 * MAJOR-2 (PR #433 review): the predecessor script
 * (`git show 9709f987:scripts/merge-duplicate-ipo.mjs`, lines ~319 onward)
 * re-queried after commit — dropped row gone, survivor carries the patched
 * fields, redirect row present, same-day sibling count — and printed the
 * result. `repair-merge-duplicate-ipo.ts` had no equivalent: a bug that
 * committed the wrong thing would report "APPLIED" with nothing to catch it.
 * This is that check, as a pure function over already-fetched query results
 * so it is unit-testable without a database — the CLI runs the queries and
 * hands the rows here.
 */
export interface MergeReadbackInput {
  /** `select count(*)::int from ipos where id = <dropId>` — MUST be 0. */
  dropRowCount: number;
  /** `select * from ipos where id = <keepId>` (one row, or undefined if missing). */
  survivor: Record<string, unknown> | undefined;
  /** The patch this merge was supposed to write onto the survivor. */
  patch: CarryFieldPatch[];
  /** Whether a `ipo_slug_redirects` row (old_slug -> keepId) exists. */
  redirectExists: boolean;
  /** Slugs of other `ipos` rows sharing the survivor's open_date (informational, not a failure). */
  sameDaySiblingSlugs: string[];
  keepId: string;
}

export interface MergeReadbackCheck {
  name: string;
  /** Informational checks (same-day siblings) are always `pass: true` — printed, never gating. */
  pass: boolean;
  detail: string;
}

/** Runs every readback check and returns them in report order. Exit-2 gating is `checks.every(c => c.pass)`. */
export function verifyMergeReadback(input: MergeReadbackInput): MergeReadbackCheck[] {
  const checks: MergeReadbackCheck[] = [];

  checks.push({
    name: 'dropped row deleted',
    pass: input.dropRowCount === 0,
    detail: `ipos rows remaining with the dropped id: ${input.dropRowCount} (expected 0)`,
  });

  checks.push({
    name: 'survivor present',
    pass: input.survivor != null,
    detail: input.survivor != null ? `survivor row found (${input.keepId})` : `survivor row NOT FOUND (${input.keepId})`,
  });

  for (const p of input.patch) {
    const jsKey = columnToCamelCase(p.column);
    const actual = input.survivor ? input.survivor[jsKey] : undefined;
    const pass = input.survivor != null && actual !== null && actual !== undefined && String(actual) === String(p.value);
    checks.push({
      name: `carried field ${p.column}`,
      pass,
      detail: `expected "${String(p.value)}", found "${String(actual)}"`,
    });
  }

  checks.push({
    name: 'slug redirect present',
    pass: input.redirectExists,
    detail: input.redirectExists ? 'ipo_slug_redirects row present' : 'ipo_slug_redirects row MISSING',
  });

  checks.push({
    name: 'same-day siblings (informational)',
    pass: true,
    detail:
      input.sameDaySiblingSlugs.length === 0
        ? 'no other rows share the survivor open_date'
        : `${input.sameDaySiblingSlugs.length} other row(s) share the survivor open_date: ${input.sameDaySiblingSlugs.join(', ')}`,
  });

  return checks;
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
