// #1196 (OD-88: every column a write sets carries its field_sources row): the ONE definition of
// "which ipos columns a create sources" and the pure decision "which of a row's set columns have no
// provenance". Shared by the nightly check (audit-detection-floor.mjs `u_create_column_without_provenance`)
// and the repair tool (scraper/scripts/repair-create-provenance-1196.ts) so they cannot drift apart.
//
// The list is the scalar ipos columns the field-priority matrix governs plus offeringType (which the
// create door tracks but the matrix does not rank). List-valued columns (leadManagers, listingExchanges,
// registrar) and writer-stamped bookkeeping (id, slug, createdAt, updatedAt, lastScrapedAt) are not
// sourced here.

/** @type {ReadonlyArray<{column: string, field: string, positiveOnly?: boolean}>} */
export const CREATE_PROVENANCE_COLUMNS = Object.freeze([
  { column: 'company_name', field: 'companyName' },
  { column: 'offering_type', field: 'offeringType' },
  { column: 'segment', field: 'segment' },
  { column: 'status', field: 'status' },
  { column: 'sector', field: 'sector' },
  { column: 'company_description', field: 'companyDescription' },
  { column: 'issue_size', field: 'issueSize', positiveOnly: true },
  { column: 'face_value', field: 'faceValue' },
  { column: 'price_range_min', field: 'priceRangeMin' },
  { column: 'price_range_max', field: 'priceRangeMax' },
  { column: 'lot_size', field: 'lotSize' },
  { column: 'open_date', field: 'openDate' },
  { column: 'close_date', field: 'closeDate' },
  { column: 'allotment_date', field: 'allotmentDate' },
  { column: 'listing_date', field: 'listingDate' },
  { column: 'isin', field: 'isin' },
  { column: 'symbol', field: 'symbol' },
  { column: 'cin', field: 'cin' },
]);

/**
 * SQL listing one row per (ipo, column) that holds a value and has no field_sources row
 * (table_name 'ipos', row_key ''). Every status, segment and offering type: the class is "every
 * ipos row", not a subset. Column names come from the constant list above, never from input.
 */
export function buildUnprovenancedColumnsSql() {
  return CREATE_PROVENANCE_COLUMNS.map(
    (c) => `
      SELECT i.id, i.slug, i.status::text AS status, i.offering_type::text AS "offeringType", '${c.field}' AS "fieldName"
        FROM ipos i
       WHERE i.${c.column} IS NOT NULL
         ${c.positiveOnly ? `AND i.${c.column} > 0` : ''}
         AND NOT EXISTS (
           SELECT 1 FROM field_sources fs
            WHERE fs.ipo_id = i.id AND fs.table_name = 'ipos' AND fs.row_key = '' AND fs.field_name = '${c.field}'
         )`
  ).join('\n      UNION ALL\n');
}

/**
 * Pure verdict over the rows buildUnprovenancedColumnsSql returned.
 * @param {Array<{id: string, slug: string, status: string, offeringType: string, fieldName: string}>} rows
 * @param {number} [maxOffenders]
 */
export function evaluateUnprovenancedColumns(rows, maxOffenders = 10) {
  const byIpo = new Map();
  for (const r of rows) {
    const entry = byIpo.get(r.id) ?? { id: r.id, slug: r.slug, status: r.status, offeringType: r.offeringType, fields: [] };
    entry.fields.push(r.fieldName);
    byIpo.set(r.id, entry);
  }
  const offenders = [...byIpo.values()].sort((a, b) => String(a.slug).localeCompare(String(b.slug)));
  const lines = offenders.map((o) => `${o.slug} [${o.status}/${o.offeringType}] no provenance for: ${o.fields.sort().join(',')}`);
  return {
    status: offenders.length === 0 ? 'PASS' : 'FAIL',
    ipoCount: offenders.length,
    columnCount: rows.length,
    detail:
      offenders.length === 0
        ? 'every set sourced column on every ipos row carries a field_sources row'
        : `${offenders.length} ipos row(s), ${rows.length} column(s) with a value and no field_sources row: ` +
          lines.slice(0, maxOffenders).join('; ') +
          (lines.length > maxOffenders ? `; +${lines.length - maxOffenders} more` : ''),
    offenders,
  };
}
