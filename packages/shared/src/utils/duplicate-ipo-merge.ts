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

import { foldCompanyIdentity, OPEN_DATE_TOLERANCE_DAYS, isoDay, daysBetween } from './company-identity-fold.js';

export { OPEN_DATE_TOLERANCE_DAYS };

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
 *
 * Item 12 slice A moved the body to `./company-identity-fold` so the fold has
 * ONE TypeScript home. This alias stays because it is the name every existing
 * consumer imports; it is the same function, not a wrapper, so there is no
 * behaviour change and no second place for the logic to drift to.
 */
export const foldCompanyName = foldCompanyIdentity;

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
  // OD-85: a merge MOVES the dropped row's source keys to the survivor and logs their ids, so the
  // records they identify keep binding (to the survivor) instead of being deleted with the row.
  // Its unique index is plain (source, key_type, binding_value) — no ipo_id in it, so a repoint
  // never conflicts; a partial/expression unique index would make the repoint predicate refuse (#900).
  'ipo_source_keys',
  // #996: `ipo_merge_log.keep_ipo_id` is a real FK to `ipos` (ON DELETE SET NULL, migration 0051/
  // 0058) so a chain merge (A into B, then B into C) reaches it as a direct child of `ipos` when
  // dropId = B. Before this entry, the sweep DELETEd that row (B was not in REPOINT_TABLES),
  // erasing the A->B merge history that migration 0051's own comment and OD-92 require to outlive
  // the survivor. Repointing `keep_ipo_id` onto the new survivor (C) keeps the row instead — its
  // only index on the column (`idx_ipo_merge_log_keep`) is non-unique, so the repoint never
  // conflicts with an existing row.
  'ipo_merge_log',
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
 * Builds the `CarryFieldInput[]` for `planCarryFields` from already-fetched
 * keep/drop `ipos` rows (camelCase-keyed, as `db.select().from(ipos)`
 * returns them) and the dropped row's provenance map. Extracted from
 * `IPORepository.mergeDuplicateInto`'s inline `.map(...)` (item 12,
 * `--reverify-from-backup`) so the apply path and a backup-file re-derive
 * path build the identical input shape from the identical column list —
 * one place, not two copies that can drift.
 */
export function buildCarryFieldInputs(
  keep: Record<string, unknown>,
  drop: Record<string, unknown>,
  dropProv: Map<string, ProvenanceRow>
): CarryFieldInput[] {
  return CARRY_IF_ABSENT_COLUMNS.map((column) => {
    const jsKey = columnToCamelCase(column);
    return {
      column,
      keepValue: keep[jsKey],
      dropValue: drop[jsKey],
      dropProvenance: dropProv.get(jsKey),
    };
  });
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

/**
 * #976, OD-59: agreement is judged on the MEANING of a value, never its
 * text — "10", "10.00" and "₹10" are one value. A `numeric(18,2)` column
 * reads back with its scale ("1250000000.00"), which is not a text match
 * against the carried value ("1250000000") even though it is the same
 * number, and a `timestamp`/`date` column can read back as a `Date` object
 * rather than the ISO string the patch carried.
 *
 * `scraper/src/services/data-persister.ts`'s `valuesEqualForWrite` is the
 * existing "equal by meaning" comparator for this exact shape (pg NUMERIC
 * string vs JS number, Date vs ISO string), but it lives in `scraper/` and
 * importing it here would create a circular dependency (`scraper` already
 * depends on `@ipodhan/shared`). This is the same rule, kept local to
 * `packages/shared` so it has no dependency in either direction: parse both
 * sides as finite numbers and compare numerically first (exact, no epsilon
 * — a real 1-rupee difference must still fail); otherwise parse both as
 * dates and compare the underlying instant; otherwise fall back to a
 * trimmed string comparison.
 */
function valuesAgreeByMeaning(a: unknown, b: unknown): boolean {
  if (a === b) return true;

  const aNum = toFiniteNumber(a);
  const bNum = toFiniteNumber(b);
  if (aNum !== null && bNum !== null) return aNum === bNum;

  const aTime = toTimeMs(a);
  const bTime = toTimeMs(b);
  if (aTime !== null && bTime !== null) return aTime === bTime;

  return String(a).trim() === String(b).trim();
}

/** Finite-number parse only — rejects `''`, `null`, `NaN`, and non-numeric strings like dates. */
function toFiniteNumber(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Parses a `Date`, an ISO string, or a bare `YYYY-MM-DD` day into epoch ms; null if not a valid instant. */
function toTimeMs(v: unknown): number | null {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.getTime();
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v.trim())) {
    const s = v.trim();
    const parsed = new Date(s.length === 10 ? `${s}T00:00:00Z` : s);
    return Number.isNaN(parsed.getTime()) ? null : parsed.getTime();
  }
  return null;
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
    // `input.survivor` is built from `db.execute(sql\`select * from ipos ...\`)` — Postgres
    // returns the RAW column name (snake_case), never the camelCase drizzle field name. Reading
    // by `columnToCamelCase(p.column)` here always misses on any multi-word column
    // (allotment_date, verifier_url, ...) and reports a false FAIL after the write already
    // committed (2026-09-16 staging dedupe: gulflloyds, hrhygieneproducts). Read by the column
    // name exactly as `p.column` names it — that is what the row actually has.
    const actual = input.survivor ? input.survivor[p.column] : undefined;
    const pass =
      input.survivor != null && actual !== null && actual !== undefined && valuesAgreeByMeaning(actual, p.value);
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
  /** `ipos.issue_size` on each side; NULL and 0 both read as ABSENT (nothing to disagree about). */
  keepIssueSize?: unknown;
  dropIssueSize?: unknown;
  /**
   * True when the operator passed `--set-issue-size` WITH `--issue-size-note` (the tool's
   * existing source-backed correction path — `repair-merge-duplicate-ipo.ts`, threaded through
   * `IPORepository.mergeDuplicateInto`'s `opts.setIssueSize`/`opts.issueSizeNote`). A disagreeing
   * issue_size is then an ACKNOWLEDGED correction, not a silent guess: the survivor gets the
   * stated size (applied elsewhere, after eligibility), so the refusal below does not apply.
   */
  issueSizeCorrectionAcknowledged?: boolean;
  /**
   * OD-86 (§2.3.3.3): evidence that the pair is ONE offering relaunched by the exchange (OD-83).
   * When `relaunchException(relaunch)` holds, a differing open date and a differing exchange record
   * number (bse_ipo_no, bse_scrip_code; symbol too when the CIN is the same) are NOT refusals.
   * Every other OD-69 refusal stands (names, CIN, ISIN, issue size).
   */
  relaunch?: RelaunchEvidence;
  /**
   * OD-94 (#679): `ipos.offering_type` on each side. Two populated, differing offering types are two
   * offers (OD-70: a later event is its own row of its own type) and are refused, relaunch or not.
   */
  keepOfferingType?: unknown;
  dropOfferingType?: unknown;
  /**
   * OD-94 (#679): `ipos.close_date` / `ipos.listing_date` on each side. Two populated, differing
   * days are refused unless the OD-86 relaunch exception holds (a relaunch moves every date).
   */
  keepCloseDate?: unknown;
  dropCloseDate?: unknown;
  keepListingDate?: unknown;
  dropListingDate?: unknown;
}

/** OD-86's four conditions, measured by the caller from both rows and their source keys. */
export interface RelaunchEvidence {
  /** Both rows' source records carry a share count, and they are equal. */
  sameShares: boolean;
  /** Both rows' source records carry a price band, and they are equal. */
  sameBand: boolean;
  /** ipos.symbol equal (both known) — OR — ipos.cin equal (both known). */
  sameSymbol: boolean;
  sameCin: boolean;
  /** The OLDER row's source record is marked postponed by the exchange (attrs.postponed). */
  olderPostponed: boolean;
}

/** OD-86: all four conditions, or no exception. */
export function relaunchException(e: RelaunchEvidence | undefined): boolean {
  return !!e && e.sameShares && e.sameBand && (e.sameSymbol || e.sameCin) && e.olderPostponed;
}

/** Record-number columns a relaunch legitimately changes (F-127); symbol only when the CIN is shared. */
function relaunchTolerated(column: string, e: RelaunchEvidence): boolean {
  if (column === 'bse_ipo_no' || column === 'bse_scrip_code') return true;
  return column === 'symbol' && e.sameCin;
}

/**
 * How far two non-zero `issue_size` values may differ (as a fraction of the larger) and still be
 * "the same number reported slightly differently" rather than two different offers.
 *
 * WHY A TOLERANCE. `issue_size` is scraped from multiple sources and rounds differently (crores
 * vs rupees, "approx" language, mid-book vs final price). A tolerance narrow enough to still catch
 * a genuinely different IPO's size, wide enough not to refuse ordinary rounding noise.
 *
 * WHY 1%. The gap the invariant's cube-highways-trust pair actually needs caught is total
 * (issue_size 0 vs Rs 5,000cr — the 0 side is ABSENT, not disagreeing, so this constant is not
 * even reached for that pair). 1% is a conservative placeholder for a genuine two-sided
 * disagreement: two sources of the same real number should not diverge by more than rounding: a
 * value with 1% relative tolerance is refused for anything a human would call "a different
 * number" while tolerating INR-vs-crore rounding at the last significant digit. Not re-measured
 * against a real disagreeing pair (none was found in the class this fix addresses) — re-measure
 * if a real false-refusal or false-pass surfaces.
 */
export const ISSUE_SIZE_RELATIVE_TOLERANCE = 0.01;

/** NULL, 0, and non-numeric all read as ABSENT — nothing to disagree about. */
function numericOrAbsent(value: unknown): number | null {
  if (value == null) return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n === 0) return null;
  return n;
}

/** An offering_type value, upper-cased and trimmed; NULL / empty read as ABSENT. */
function offeringTypeOrAbsent(value: unknown): string | null {
  if (value == null) return null;
  const t = String(value).trim().toUpperCase();
  return t === '' ? null : t;
}

/** OD-35: open dates more than this many days apart are two offerings — also the bound on OD-86's relaunch exception. */
export const RELAUNCH_MAX_OPEN_DATE_GAP_DAYS = 180;

export type EligibilityResult = { eligible: true } | { eligible: false; reason: string };

/**
 * The refusal checks run before ANY write. Every compared dimension, in order:
 * offering_type (OD-94, never waived), open_date (OD-69; OD-86 relaunch may differ within 180 days),
 * close_date and listing_date (OD-94; OD-86 relaunch may differ), the name fold (unless
 * force-overridden), the strong identifiers (OD-69), and issue_size (#672). A dimension refuses only
 * when BOTH sides are populated and differ; the reason names the column and both values.
 * Pure so it is unit-testable without a DB —
 * this is what stops a merge tool from combining two different offers.
 */
export function checkMergeEligibility(input: EligibilityInput): EligibilityResult {
  // OD-94 (#679): two offering types are two offers, whatever else agrees — checked first so the
  // reason names the most basic disagreement, and never waived by OD-86 (a relaunch is one offer).
  const keepType = offeringTypeOrAbsent(input.keepOfferingType);
  const dropType = offeringTypeOrAbsent(input.dropOfferingType);
  if (keepType !== null && dropType !== null && keepType !== dropType) {
    return {
      eligible: false,
      reason: `offering_type disagrees (${keepType} vs ${dropType}) — two offering types are two offers (OD-94, OD-70)`,
    };
  }
  const keepDay = isoDay(input.keepOpenDate);
  const dropDay = isoDay(input.dropOpenDate);
  // Both unreadable (null/absent) keeps the original behaviour: not a refusal on date grounds —
  // there is nothing to compare, so the other checks decide. Exactly one unreadable IS a refusal:
  // a merge tool must not guess which side's date to trust.
  if (keepDay === null && dropDay === null) {
    // fall through — same as "no open_date on either side", pre-existing behaviour
  } else if (keepDay === null || dropDay === null) {
    return {
      eligible: false,
      reason:
        `cannot compare open dates — ${keepDay === null ? 'keep' : 'drop'} row's open_date is unreadable ` +
        `(keep=${String(input.keepOpenDate)}, drop=${String(input.dropOpenDate)})`,
    };
  } else {
    // OD-69 (2026-09-23): the merge tool refuses a pair whose open date differs, whatever the
    // names fold to. Before OD-69 a 3-day tolerance applied here — exactly the gap between the
    // real look-alike pair Himalayan Solar Ltd. (2026-09-25) and Himalaya Nutravedics India Ltd.
    // (2026-09-22). OPEN_DATE_TOLERANCE_DAYS still sizes the detection sweep's CLUSTERING (a
    // candidate a human reads), never a merge.
    const spread = daysBetween(keepDay, dropDay);
    // OD-86's exception is bounded by OD-35's same-offering window: a relaunch more than 180 days
    // after the postponed record is a new offering, refused like any other date difference.
    if (spread > RELAUNCH_MAX_OPEN_DATE_GAP_DAYS) {
      return {
        eligible: false,
        reason:
          `the two rows' open date differs (${keepDay} vs ${dropDay}, ${spread} day(s) apart) — beyond ` +
          `OD-35's ${RELAUNCH_MAX_OPEN_DATE_GAP_DAYS}-day window, so not one offering even as an OD-86 relaunch`,
      };
    }
    if (spread > 0 && !relaunchException(input.relaunch)) {
      return {
        eligible: false,
        reason:
          `the two rows' open date differs (${keepDay} vs ${dropDay}, ${spread} day(s) apart) — ` +
          `OD-69: a merge needs the same open date, so they are two offers`,
      };
    }
  }
  // OD-94 (#679): a populated close or listing date that differs is a second offer, except for an
  // OD-86 relaunch, which legitimately moves every date. An absent (or unreadable) side is not a
  // disagreement — there is nothing to compare.
  if (!relaunchException(input.relaunch)) {
    for (const [column, keepValue, dropValue] of [
      ['close_date', input.keepCloseDate, input.dropCloseDate],
      ['listing_date', input.keepListingDate, input.dropListingDate],
    ] as const) {
      const k = isoDay(keepValue);
      const d = isoDay(dropValue);
      if (k !== null && d !== null && k !== d) {
        return {
          eligible: false,
          reason:
            `${column} disagrees (${k} vs ${d}) — a merge needs the same ${column} unless the pair is an ` +
            `OD-86 relaunch, so they are two offers (OD-94)`,
        };
      }
    }
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
    if (relaunchException(input.relaunch) && relaunchTolerated(column, input.relaunch!)) continue;
    if (keepValue && dropValue && String(keepValue).trim().toUpperCase() !== String(dropValue).trim().toUpperCase()) {
      return {
        eligible: false,
        reason: `${column} disagrees (${String(keepValue)} vs ${String(dropValue)}) — two offers, not one row twice`,
      };
    }
  }
  if (!input.issueSizeCorrectionAcknowledged) {
    const keepSize = numericOrAbsent(input.keepIssueSize);
    const dropSize = numericOrAbsent(input.dropIssueSize);
    if (keepSize !== null && dropSize !== null) {
      const larger = Math.max(keepSize, dropSize);
      const relDiff = Math.abs(keepSize - dropSize) / larger;
      if (relDiff > ISSUE_SIZE_RELATIVE_TOLERANCE) {
        return {
          eligible: false,
          reason:
            `issue_size disagrees (${keepSize} vs ${dropSize}, ${(relDiff * 100).toFixed(1)}% apart, ` +
            `more than ${(ISSUE_SIZE_RELATIVE_TOLERANCE * 100).toFixed(0)}% tolerance) — two offers, not one row twice ` +
            `(pass --set-issue-size with --issue-size-note to acknowledge and correct)`,
        };
      }
    }
  }
  return { eligible: true };
}

/**
 * OD-86: build the relaunch evidence from both rows and their `ipo_source_keys` rows. Shares and band
 * come from the keys' `attrs` (what each exchange record said); "postponed" is the exchange's own flag
 * stored in `attrs.postponed` on the OLDER row's key (the older row = the earlier open date).
 */
export function assessRelaunch(
  keep: { openDate?: unknown; symbol?: unknown; cin?: unknown },
  drop: { openDate?: unknown; symbol?: unknown; cin?: unknown },
  keepKeys: { attrs?: unknown }[],
  dropKeys: { attrs?: unknown }[]
): RelaunchEvidence {
  const num = (v: unknown): number | null => {
    const n = Number(v);
    return v != null && v !== '' && Number.isFinite(n) && n > 0 ? n : null;
  };
  const firstAttr = (keys: { attrs?: unknown }[], k: string): number | null => {
    for (const key of keys) {
      const v = num(((key.attrs ?? {}) as Record<string, unknown>)[k]);
      if (v != null) return v;
    }
    return null;
  };
  const eq = (a: number | null, b: number | null) => a != null && b != null && a === b;
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim().toUpperCase() : null);
  const kDay = isoDay(keep.openDate as never);
  const dDay = isoDay(drop.openDate as never);
  const olderKeys = kDay && dDay ? (kDay < dDay ? keepKeys : dDay < kDay ? dropKeys : []) : [];
  return {
    sameShares: eq(firstAttr(keepKeys, 'shares'), firstAttr(dropKeys, 'shares')),
    sameBand:
      eq(firstAttr(keepKeys, 'priceMin'), firstAttr(dropKeys, 'priceMin')) &&
      eq(firstAttr(keepKeys, 'priceMax'), firstAttr(dropKeys, 'priceMax')),
    sameSymbol: str(keep.symbol) != null && str(keep.symbol) === str(drop.symbol),
    sameCin: str(keep.cin) != null && str(keep.cin) === str(drop.cin),
    olderPostponed: olderKeys.some((k) => ((k.attrs ?? {}) as Record<string, unknown>).postponed === true),
  };
}
