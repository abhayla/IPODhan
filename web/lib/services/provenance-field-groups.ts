/**
 * Which key-facts block on the IPO detail page shows which planned fields —
 * and, for every planned field that no block shows, why not.
 *
 * Nothing in the codebase knows this. `scraper/config/field-manifest.json` says
 * which fields are planned and where they come from; the page says what it
 * renders; no file joins the two. So this map is hand-written, and a
 * hand-written map rots silently: a field renamed in the manifest just stops
 * having a provenance line, which on the page looks exactly like an IPO whose
 * plan has not run yet. Nobody would ever see it.
 *
 * The guard is the same one page-revalidation-targets.ts uses: classify EVERY
 * member of the real population, keep a reason for each exclusion, and let a
 * test fail when a new member is neither. The reason is the point of the
 * exclusion list — "not in the list" tells a later reader nothing.
 *
 * Keys are `table.column`, the manifest's own key and the `(table_name,
 * field_name)` pair in `ipo_field_plan`. Not camelCase: the plan rows carry the
 * database's names, and translating here would be one more place to drift.
 */

/** The block ids match the page's own section order, not the component names. */
export type ProvenanceBlock =
  | 'factRibbon'
  | 'ipoDetailsTable'
  | 'issueStructure'
  | 'lotDetails'
  | 'listingDetails';

export const PROVENANCE_FIELD_GROUPS: Readonly<Record<ProvenanceBlock, readonly string[]>> = {
  // The ribbon repeats the headline numbers from the table below it.
  factRibbon: ['ipos.issue_size', 'subscriptions.total_subscription'],
  ipoDetailsTable: ['ipos.issue_size', 'ipo_details.fresh_issue', 'ipo_details.ofs_issue'],
  issueStructure: ['ipo_details.fresh_issue', 'ipo_details.ofs_issue'],
  lotDetails: ['ipo_details.min_investment'],
  listingDetails: ['listing_performance.listing_price'],
};

/**
 * Planned fields that no key-facts block renders. Each one still gets a plan
 * row and still gets verified — it simply has no line on this part of the page.
 */
export const NOT_IN_ANY_BLOCK: Readonly<Record<string, string>> = {
  'financial_statements.revenue':
    'rendered by the financials section, which has its own table and its own period columns; a single line under it would have to speak for several years at once',
  'subscriptions.qib_subscription':
    'the subscription table shows all four categories together; the ribbon already carries one line for the total, and four more would bury the numbers',
  'subscriptions.nii_subscription':
    'same subscription table as the QIB figure above; covered by the total_subscription line on the ribbon',
  'subscriptions.retail_subscription':
    'same subscription table as the QIB figure above; covered by the total_subscription line on the ribbon',
};
