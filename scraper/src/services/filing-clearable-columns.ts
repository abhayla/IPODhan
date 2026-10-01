/**
 * #1420 round 3 (B8, OD-153/158/160): the filing persister's ONE map from an extractor field to the
 * scalar column it writes from that field alone, for `ipos`, `ipo_details` and `financial_data`.
 *
 * The persister reads every one-to-one field through `mappedField(table, column)`, so this map IS
 * where the persister gets those field names: an entry is never a second copy of the write path.
 * The re-read answer clear (reread-answer-clear.ts) and the ipos clear door (data-persister.ts) both
 * derive from it, so every column here is clearable by construction.
 *
 * Every OTHER column the persister writes to these three tables is in NOT_ONE_TO_ONE_COLUMNS with
 * the reason it is not cleared (derived, several fields to one column, a per-FY series).
 * tests/unit/services/filing-clearable-columns.test.ts parses filing-persister.ts with the
 * TypeScript compiler API and fails when a written column is in neither list, when an entry here is
 * not written, or when a write site's column cannot be resolved (fail closed).
 *
 * The SQL column name is read from the drizzle schema, never typed.
 */
import { getTableColumns } from 'drizzle-orm';
import * as schema from '@ipodhan/shared/db/schema';

export type ClearableTable = 'ipos' | 'ipo_details' | 'financial_data';

export interface FilingClearableColumn {
  extractorField: string;
  tableName: ClearableTable;
  /** camelCase, as field_sources.field_name and field_protection_metadata.field_name spell it. */
  column: string;
  /** The SQL column, as ipo_field_plan.field_name spells it (from the drizzle schema). */
  sqlColumn: string;
}

const ONE_TO_ONE: ReadonlyArray<readonly [ClearableTable, string, string]> = [
  // [table, column, extractor field]
  ['ipos', 'priceRangeMin', 'price_band_floor'],
  ['ipos', 'priceRangeMax', 'price_band_cap'],
  ['ipos', 'lotSize', 'lot_size'],
  ['ipos', 'faceValue', 'face_value'],
  ['ipos', 'openDate', 'open_date'],
  ['ipos', 'closeDate', 'close_date'],
  ['ipos', 'allotmentDate', 'basis_of_allotment_date'],
  ['ipos', 'listingDate', 'listing_date'],
  ['ipos', 'companyDescription', 'business_description'],
  ['ipos', 'cin', 'cin'],
  ['ipo_details', 'basisOfAllotmentDate', 'basis_of_allotment_date'],
  ['ipo_details', 'initiationOfRefundsDate', 'refund_date'],
  ['ipo_details', 'creditOfSharesDate', 'credit_date'],
  ['ipo_details', 'upiCutoffTime', 'upi_cutoff_time'],
  ['ipo_details', 'designatedExchange', 'designated_stock_exchange'],
  ['ipo_details', 'complianceOfficer', 'compliance_officer'],
  ['ipo_details', 'complianceOfficerPhone', 'compliance_officer_phone'],
  ['ipo_details', 'complianceOfficerEmail', 'compliance_officer_email'],
  ['ipo_details', 'companyDescription', 'business_description'],
  ['ipo_details', 'faceValue', 'face_value'],
  ['ipo_details', 'lotMultiple', 'lot_multiple'],
  ['ipo_details', 'preIpoPlacement', 'pre_ipo_placement'],
  ['ipo_details', 'freshIssue', 'fresh_issue_amount'],
  ['ipo_details', 'promoterSharesHeld', 'promoter_shares_held'],
  ['ipo_details', 'sebiRegulationCited', 'book_building_regulation'],
  ['ipo_details', 'promoterGroupTransactionsSinceDrhp', 'promoter_group_transactions_since_drhp'],
  ['financial_data', 'currentRatio', 'current_ratio'],
  ['financial_data', 'inventoryTurnover', 'inventory_turnover'],
  ['financial_data', 'peRatio', 'pe_at_cap'],
  ['financial_data', 'marketCap', 'market_cap_at_cap'],
  ['financial_data', 'promoterHoldingPreIssue', 'promoter_holding_pre_pct'],
  ['financial_data', 'promoterHoldingPostIssue', 'promoter_holding_post_pct_at_cap'],
];

/**
 * Columns the persister writes to these tables that a single field's answer must NOT clear.
 * Key `<table>.<column>`.
 */
export const NOT_ONE_TO_ONE_COLUMNS: Readonly<Record<string, string>> = {
  'ipos.issueSize': 'derived: fresh + OFS at cap (OD-160, §2.6)',
  'ipos.listingExchanges': 'read from the listing sentence (#1233 answer states), not one extractor field',
  'ipos.segment': 'read from the listing sentence (#1233 answer states), not one extractor field',
  'ipo_details.allocationPct': 'three fields (qib/nii/retail) in one column',
  'ipo_details.ofsIssue': 'one of several fields (ofs_amount_at_cap / ofs_amount / ofs_shares), withheld with freshIssue (F-51)',
  'ipo_details.issueType': 'decided from two fields (regulation + cover price type), or from the band (min === max)',
  'ipo_details.bidWindows': 'built from several fields',
  'financial_data.ipoId': 'the row key set when the financial_data object is created, never a printed value',
  'financial_data.quickRatio': 'derived, never printed (OD-160)',
  'financial_data.netWorth': 'latest FY of a per-FY series; the series also feeds financial_statements child rows',
  'financial_data.eps': 'latest FY of a per-FY series; the series also feeds financial_statements child rows',
  'financial_data.ronw': 'latest FY of a per-FY series',
  ...Object.fromEntries(
    [2022, 2023, 2024].flatMap((fy) =>
      ['revenueFy', 'profitFy', 'ebitdaFy', 'totalIncomeFy'].map((p) => [
        `financial_data.${p}${fy}`,
        'one year of a per-FY series; the series also feeds financial_statements child rows',
      ])
    )
  ),
};

// Read lazily: a module that imports the persister under a mocked schema never touches it.
function drizzleTable(table: ClearableTable) {
  return table === 'ipos' ? schema.ipos : table === 'ipo_details' ? schema.ipoDetails : schema.financialData;
}

function sqlColumnOf(table: ClearableTable, column: string): string {
  const col = (getTableColumns(drizzleTable(table)) as Record<string, { name: string }>)[column];
  if (!col) throw new Error(`filing-clearable-columns: ${table}.${column} is not a drizzle column`);
  return col.name;
}

export const FILING_CLEARABLE_COLUMNS: readonly FilingClearableColumn[] = ONE_TO_ONE.map(([tableName, column, extractorField]) => ({
  extractorField,
  tableName,
  column,
  get sqlColumn() {
    return sqlColumnOf(tableName, column);
  },
}));

/** The extractor field the persister reads for `table.column`. Throws for a column not in the map. */
export function mappedField(table: ClearableTable, column: string): string {
  const e = FILING_CLEARABLE_COLUMNS.find((c) => c.tableName === table && c.column === column);
  if (!e) throw new Error(`filing-clearable-columns: ${table}.${column} is not a one-to-one filing column`);
  return e.extractorField;
}

/** The SQL column of a clearable `ipos` entry (the ipos clear door's allow-list), or null when off the map. */
export function clearableIposSqlColumn(column: string): string | null {
  const e = FILING_CLEARABLE_COLUMNS.find((c) => c.tableName === 'ipos' && c.column === column);
  return e ? e.sqlColumn : null;
}
