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
