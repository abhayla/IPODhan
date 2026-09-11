/**
 * Row keys for the consolidated child-table writer (item 1).
 *
 * `field_sources` / `data_conflicts` are keyed on
 * `(ipo_id, table_name, row_key, field_name)` since #559. `row_key` is the
 * child row's NATURAL key inside its table — it must match that table's own
 * unique constraint exactly, or provenance is filed against a row identity the
 * database does not share.
 *
 * A key function returns `null`, never `''`, when the row cannot be keyed:
 * `''` is the reserved sentinel for tables with exactly one row per IPO, so a
 * keyless row silently written under it would collide with every OTHER keyless
 * row of the same table and destroy their provenance. The caller must skip such
 * a row and count the skip (see `consolidatedUpsertChildRows`).
 */

/**
 * `financial_statements` — matches `unique_financial_statements_ipo_fy_basis`
 * on (ipo_id, fiscal_year, basis), verified against
 * packages/shared/src/db/schema.ts. The unit is deliberately NOT part of the
 * key: the constraint does not include it, and a row's unit can be rewritten by
 * a later filing without the row becoming a different row.
 *
 * A fiscal year and its accounting basis are facts about the reporting period,
 * fixed before any document is filed — a re-extraction of FY2024 RESTATED is
 * always FY2024 RESTATED, so the key is stable across re-extractions.
 */
export function financialStatementsRowKey(
  fiscalYear: number | null | undefined,
  basis: string | null | undefined
): string | null {
  if (fiscalYear === null || fiscalYear === undefined) return null;
  if (!Number.isInteger(fiscalYear)) return null;
  if (basis === null || basis === undefined) return null;
  const trimmed = String(basis).trim();
  if (trimmed === '') return null;
  return `${fiscalYear}:${trimmed}`;
}

/**
 * `ipo_details` — the row key is the reserved singleton sentinel `''`.
 *
 * NOT a shortcut and NOT copied from `financial_statements`: `ipo_details.ipo_id`
 * carries a `.unique()` of its own (packages/shared/src/db/schema.ts:1188-1191),
 * so the table structurally holds exactly ONE row per IPO. There is no second
 * column that could distinguish two rows, which is precisely the condition
 * `SINGLETON_ROW_CHILD_TABLES` describes — `''` here is the row's real identity,
 * not a missing one.
 *
 * A function rather than an inline `''` so the justification has one home and a
 * future column that widens the constraint has one place to break.
 */
export function ipoDetailsRowKey(): string {
  return '';
}

/**
 * `ipo_valuation` — the row key is the PRICING EVENT.
 *
 * This table is NOT one row per IPO, despite reading like one: its unique
 * constraint is `unique_ipo_valuation_ipo_pricing_event` on
 * (ipo_id, pricing_event) (schema.ts:1927-1929), so a single IPO legitimately
 * holds a PRICE_BAND_AD row and a PROSPECTUS row at the same time — the price
 * band as advertised, and the price as finally struck. Keying it `''` like
 * `ipo_details` would file both events' provenance under one identity and let
 * the prospectus's numbers be read as the advertisement's "existing value".
 *
 * The pricing event is fixed by which document produced the row, so it is
 * stable across re-extractions of the same document.
 */
export function ipoValuationRowKey(
  pricingEvent: string | null | undefined
): string | null {
  if (pricingEvent === null || pricingEvent === undefined) return null;
  const trimmed = String(pricingEvent).trim();
  if (trimmed === '') return null;
  return trimmed;
}
