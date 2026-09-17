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
  // ipos.* date/size/type fields + fresh/OFS split rendered directly in the details table.
  ipoDetailsTable: ['ipos.issue_size', 'ipo_details.fresh_issue', 'ipo_details.ofs_issue', 'ipo_details.issue_type', 'ipos.open_date', 'ipos.close_date', 'ipos.allotment_date', 'ipos.listing_date', 'ipos.price_range_min', 'ipos.price_range_max', 'ipos.lot_size', 'ipos.face_value'],
  // ipo_valuation.* floor/cap figures rendered in the pricing/valuation grid.
  issueStructure: ['ipo_details.fresh_issue', 'ipo_details.ofs_issue', 'ipo_valuation.price_floor', 'ipo_valuation.price_cap', 'ipo_valuation.mcap_at_cap', 'ipo_valuation.pe_at_cap', 'ipo_valuation.mcap_at_floor', 'ipo_valuation.pe_at_floor', 'ipo_valuation.ronw_weighted_3y', 'ipo_valuation.shares_at_floor', 'ipo_valuation.shares_at_cap', 'ipo_valuation.fresh_shares_at_floor', 'ipo_valuation.fresh_shares_at_cap', 'ipo_valuation.ofs_shares', 'ipo_valuation.total_shares_at_floor', 'ipo_valuation.total_shares_at_cap', 'ipo_valuation.pe_not_ascertainable_reason'],
  lotDetails: ['ipos.lot_size', 'ipos.price_range_min', 'ipos.price_range_max', 'ipos.face_value'],
  listingDetails: ['listing_performance.listing_price'],
};

/**
 * Planned fields that no key-facts block renders. Each one still gets a plan
 * row and still gets verified — it simply has no line on this part of the page.
 * Most of these ARE rendered elsewhere on the IPO detail page (financials table,
 * peer comparison, promoter holding, lead-manager/BRLM tables, risk factors,
 * anchor investors, documents, registrar/contact panels) — just not by one of
 * the five key-facts provenance blocks above.
 */
export const NOT_IN_ANY_BLOCK: Readonly<Record<string, string>> = {
  'ipos.symbol':
    'core identity/lookup field (name, symbol, sector, registrar, ISIN, CIN, website, listing exchanges, objectives, offering type, segment, status) rendered in the page header, breadcrumbs, InfoSection or IPOObjectivesSection — not a key-facts provenance block',
  'ipos.company_name':
    'core identity/lookup field (name, symbol, sector, registrar, ISIN, CIN, website, listing exchanges, objectives, offering type, segment, status) rendered in the page header, breadcrumbs, InfoSection or IPOObjectivesSection — not a key-facts provenance block',
  'ipos.status':
    'core identity/lookup field (name, symbol, sector, registrar, ISIN, CIN, website, listing exchanges, objectives, offering type, segment, status) rendered in the page header, breadcrumbs, InfoSection or IPOObjectivesSection — not a key-facts provenance block',
  'ipos.registrar':
    'core identity/lookup field (name, symbol, sector, registrar, ISIN, CIN, website, listing exchanges, objectives, offering type, segment, status) rendered in the page header, breadcrumbs, InfoSection or IPOObjectivesSection — not a key-facts provenance block',
  'ipos.sector':
    'core identity/lookup field (name, symbol, sector, registrar, ISIN, CIN, website, listing exchanges, objectives, offering type, segment, status) rendered in the page header, breadcrumbs, InfoSection or IPOObjectivesSection — not a key-facts provenance block',
  'ipos.listing_exchanges':
    'core identity/lookup field (name, symbol, sector, registrar, ISIN, CIN, website, listing exchanges, objectives, offering type, segment, status) rendered in the page header, breadcrumbs, InfoSection or IPOObjectivesSection — not a key-facts provenance block',
  'ipos.company_description':
    'core identity/lookup field (name, symbol, sector, registrar, ISIN, CIN, website, listing exchanges, objectives, offering type, segment, status) rendered in the page header, breadcrumbs, InfoSection or IPOObjectivesSection — not a key-facts provenance block',
  'ipos.lead_managers':
    'core identity/lookup field (name, symbol, sector, registrar, ISIN, CIN, website, listing exchanges, objectives, offering type, segment, status) rendered in the page header, breadcrumbs, InfoSection or IPOObjectivesSection — not a key-facts provenance block',
  'ipos.isin':
    'core identity/lookup field (name, symbol, sector, registrar, ISIN, CIN, website, listing exchanges, objectives, offering type, segment, status) rendered in the page header, breadcrumbs, InfoSection or IPOObjectivesSection — not a key-facts provenance block',
  'ipos.segment':
    'core identity/lookup field (name, symbol, sector, registrar, ISIN, CIN, website, listing exchanges, objectives, offering type, segment, status) rendered in the page header, breadcrumbs, InfoSection or IPOObjectivesSection — not a key-facts provenance block',
  'ipos.offering_type':
    'core identity/lookup field (name, symbol, sector, registrar, ISIN, CIN, website, listing exchanges, objectives, offering type, segment, status) rendered in the page header, breadcrumbs, InfoSection or IPOObjectivesSection — not a key-facts provenance block',
  'ipos.objectives':
    'core identity/lookup field (name, symbol, sector, registrar, ISIN, CIN, website, listing exchanges, objectives, offering type, segment, status) rendered in the page header, breadcrumbs, InfoSection or IPOObjectivesSection — not a key-facts provenance block',
  'ipos.company_website':
    'core identity/lookup field (name, symbol, sector, registrar, ISIN, CIN, website, listing exchanges, objectives, offering type, segment, status) rendered in the page header, breadcrumbs, InfoSection or IPOObjectivesSection — not a key-facts provenance block',
  'ipos.cin':
    'core identity/lookup field (name, symbol, sector, registrar, ISIN, CIN, website, listing exchanges, objectives, offering type, segment, status) rendered in the page header, breadcrumbs, InfoSection or IPOObjectivesSection — not a key-facts provenance block',
  'ipo_details.company_description':
    'company/registrar/compliance/contact/category detail rendered by CompanyOverview, CompanyContactSection, CategoryReservationSection, LeadManagerSection or ListingPerformance\'s own timeline widgets — not one of the five key-facts blocks',
  'ipo_details.face_value':
    'company/registrar/compliance/contact/category detail rendered by CompanyOverview, CompanyContactSection, CategoryReservationSection, LeadManagerSection or ListingPerformance\'s own timeline widgets — not one of the five key-facts blocks',
  'ipo_details.basis_of_allotment_date':
    'company/registrar/compliance/contact/category detail rendered by CompanyOverview, CompanyContactSection, CategoryReservationSection, LeadManagerSection or ListingPerformance\'s own timeline widgets — not one of the five key-facts blocks',
  'ipo_details.initiation_of_refunds_date':
    'company/registrar/compliance/contact/category detail rendered by CompanyOverview, CompanyContactSection, CategoryReservationSection, LeadManagerSection or ListingPerformance\'s own timeline widgets — not one of the five key-facts blocks',
  'ipo_details.credit_of_shares_date':
    'company/registrar/compliance/contact/category detail rendered by CompanyOverview, CompanyContactSection, CategoryReservationSection, LeadManagerSection or ListingPerformance\'s own timeline widgets — not one of the five key-facts blocks',
  'ipo_details.exchanges':
    'company/registrar/compliance/contact/category detail rendered by CompanyOverview, CompanyContactSection, CategoryReservationSection, LeadManagerSection or ListingPerformance\'s own timeline widgets — not one of the five key-facts blocks',
  'ipo_details.compliance_officer':
    'company/registrar/compliance/contact/category detail rendered by CompanyOverview, CompanyContactSection, CategoryReservationSection, LeadManagerSection or ListingPerformance\'s own timeline widgets — not one of the five key-facts blocks',
  'ipo_details.compliance_officer_phone':
    'company/registrar/compliance/contact/category detail rendered by CompanyOverview, CompanyContactSection, CategoryReservationSection, LeadManagerSection or ListingPerformance\'s own timeline widgets — not one of the five key-facts blocks',
  'ipo_details.compliance_officer_email':
    'company/registrar/compliance/contact/category detail rendered by CompanyOverview, CompanyContactSection, CategoryReservationSection, LeadManagerSection or ListingPerformance\'s own timeline widgets — not one of the five key-facts blocks',
  'ipo_details.upi_cutoff_time':
    'company/registrar/compliance/contact/category detail rendered by CompanyOverview, CompanyContactSection, CategoryReservationSection, LeadManagerSection or ListingPerformance\'s own timeline widgets — not one of the five key-facts blocks',
  'ipo_details.designated_exchange':
    'company/registrar/compliance/contact/category detail rendered by CompanyOverview, CompanyContactSection, CategoryReservationSection, LeadManagerSection or ListingPerformance\'s own timeline widgets — not one of the five key-facts blocks',
  'ipo_details.lot_multiple':
    'company/registrar/compliance/contact/category detail rendered by CompanyOverview, CompanyContactSection, CategoryReservationSection, LeadManagerSection or ListingPerformance\'s own timeline widgets — not one of the five key-facts blocks',
  'ipo_details.allocation_pct':
    'company/registrar/compliance/contact/category detail rendered by CompanyOverview, CompanyContactSection, CategoryReservationSection, LeadManagerSection or ListingPerformance\'s own timeline widgets — not one of the five key-facts blocks',
  'ipo_details.pre_ipo_placement':
    'company/registrar/compliance/contact/category detail rendered by CompanyOverview, CompanyContactSection, CategoryReservationSection, LeadManagerSection or ListingPerformance\'s own timeline widgets — not one of the five key-facts blocks',
  'ipo_details.bid_windows':
    'company/registrar/compliance/contact/category detail rendered by CompanyOverview, CompanyContactSection, CategoryReservationSection, LeadManagerSection or ListingPerformance\'s own timeline widgets — not one of the five key-facts blocks',
  'ipo_details.promoter_shares_held':
    'company/registrar/compliance/contact/category detail rendered by CompanyOverview, CompanyContactSection, CategoryReservationSection, LeadManagerSection or ListingPerformance\'s own timeline widgets — not one of the five key-facts blocks',
  'ipo_details.sebi_regulation_cited':
    'company/registrar/compliance/contact/category detail rendered by CompanyOverview, CompanyContactSection, CategoryReservationSection, LeadManagerSection or ListingPerformance\'s own timeline widgets — not one of the five key-facts blocks',
  'ipo_details.promoter_group_transactions_since_drhp':
    'company/registrar/compliance/contact/category detail rendered by CompanyOverview, CompanyContactSection, CategoryReservationSection, LeadManagerSection or ListingPerformance\'s own timeline widgets — not one of the five key-facts blocks',
  'ipo_details.cut_off_price':
    'company/registrar/compliance/contact/category detail rendered by CompanyOverview, CompanyContactSection, CategoryReservationSection, LeadManagerSection or ListingPerformance\'s own timeline widgets — not one of the five key-facts blocks',
  'ipo_details.min_investment':
    'company/registrar/compliance/contact/category detail rendered by CompanyOverview, CompanyContactSection, CategoryReservationSection, LeadManagerSection or ListingPerformance\'s own timeline widgets — not one of the five key-facts blocks',
  'ipo_details.isin':
    'company/registrar/compliance/contact/category detail rendered by CompanyOverview, CompanyContactSection, CategoryReservationSection, LeadManagerSection or ListingPerformance\'s own timeline widgets — not one of the five key-facts blocks',
  'ipo_details.registrar_link':
    'company/registrar/compliance/contact/category detail rendered by CompanyOverview, CompanyContactSection, CategoryReservationSection, LeadManagerSection or ListingPerformance\'s own timeline widgets — not one of the five key-facts blocks',
  'ipo_details.lead_managers':
    'company/registrar/compliance/contact/category detail rendered by CompanyOverview, CompanyContactSection, CategoryReservationSection, LeadManagerSection or ListingPerformance\'s own timeline widgets — not one of the five key-facts blocks',
  'ipo_details.company_address':
    'company/registrar/compliance/contact/category detail rendered by CompanyOverview, CompanyContactSection, CategoryReservationSection, LeadManagerSection or ListingPerformance\'s own timeline widgets — not one of the five key-facts blocks',
  'ipo_details.company_phone':
    'company/registrar/compliance/contact/category detail rendered by CompanyOverview, CompanyContactSection, CategoryReservationSection, LeadManagerSection or ListingPerformance\'s own timeline widgets — not one of the five key-facts blocks',
  'ipo_details.company_email':
    'company/registrar/compliance/contact/category detail rendered by CompanyOverview, CompanyContactSection, CategoryReservationSection, LeadManagerSection or ListingPerformance\'s own timeline widgets — not one of the five key-facts blocks',
  'ipo_details.company_city':
    'company/registrar/compliance/contact/category detail rendered by CompanyOverview, CompanyContactSection, CategoryReservationSection, LeadManagerSection or ListingPerformance\'s own timeline widgets — not one of the five key-facts blocks',
  'ipo_details.company_state':
    'company/registrar/compliance/contact/category detail rendered by CompanyOverview, CompanyContactSection, CategoryReservationSection, LeadManagerSection or ListingPerformance\'s own timeline widgets — not one of the five key-facts blocks',
  'ipo_details.company_pincode':
    'company/registrar/compliance/contact/category detail rendered by CompanyOverview, CompanyContactSection, CategoryReservationSection, LeadManagerSection or ListingPerformance\'s own timeline widgets — not one of the five key-facts blocks',
  'ipo_details.qib_shares_offered':
    'company/registrar/compliance/contact/category detail rendered by CompanyOverview, CompanyContactSection, CategoryReservationSection, LeadManagerSection or ListingPerformance\'s own timeline widgets — not one of the five key-facts blocks',
  'ipo_details.nii_shares_offered':
    'company/registrar/compliance/contact/category detail rendered by CompanyOverview, CompanyContactSection, CategoryReservationSection, LeadManagerSection or ListingPerformance\'s own timeline widgets — not one of the five key-facts blocks',
  'ipo_details.retail_shares_offered':
    'company/registrar/compliance/contact/category detail rendered by CompanyOverview, CompanyContactSection, CategoryReservationSection, LeadManagerSection or ListingPerformance\'s own timeline widgets — not one of the five key-facts blocks',
  'ipo_details.retail_max_allottees':
    'company/registrar/compliance/contact/category detail rendered by CompanyOverview, CompanyContactSection, CategoryReservationSection, LeadManagerSection or ListingPerformance\'s own timeline widgets — not one of the five key-facts blocks',
  'ipo_details.employee_shares_offered':
    'company/registrar/compliance/contact/category detail rendered by CompanyOverview, CompanyContactSection, CategoryReservationSection, LeadManagerSection or ListingPerformance\'s own timeline widgets — not one of the five key-facts blocks',
  'ipo_details.anchor_shares_offered':
    'company/registrar/compliance/contact/category detail rendered by CompanyOverview, CompanyContactSection, CategoryReservationSection, LeadManagerSection or ListingPerformance\'s own timeline widgets — not one of the five key-facts blocks',
  'ipo_details.max_retail_subscription':
    'company/registrar/compliance/contact/category detail rendered by CompanyOverview, CompanyContactSection, CategoryReservationSection, LeadManagerSection or ListingPerformance\'s own timeline widgets — not one of the five key-facts blocks',
  'ipo_details.max_employee_subscription':
    'company/registrar/compliance/contact/category detail rendered by CompanyOverview, CompanyContactSection, CategoryReservationSection, LeadManagerSection or ListingPerformance\'s own timeline widgets — not one of the five key-facts blocks',
  'ipo_details.employee_discount':
    'company/registrar/compliance/contact/category detail rendered by CompanyOverview, CompanyContactSection, CategoryReservationSection, LeadManagerSection or ListingPerformance\'s own timeline widgets — not one of the five key-facts blocks',
  'ipo_details.sponsor_banks':
    'company/registrar/compliance/contact/category detail rendered by CompanyOverview, CompanyContactSection, CategoryReservationSection, LeadManagerSection or ListingPerformance\'s own timeline widgets — not one of the five key-facts blocks',
  'ipo_details.tick_size':
    'company/registrar/compliance/contact/category detail rendered by CompanyOverview, CompanyContactSection, CategoryReservationSection, LeadManagerSection or ListingPerformance\'s own timeline widgets — not one of the five key-facts blocks',
  'ipo_details.ipo_market_timings':
    'company/registrar/compliance/contact/category detail rendered by CompanyOverview, CompanyContactSection, CategoryReservationSection, LeadManagerSection or ListingPerformance\'s own timeline widgets — not one of the five key-facts blocks',
  'ipo_details.category_details':
    'company/registrar/compliance/contact/category detail rendered by CompanyOverview, CompanyContactSection, CategoryReservationSection, LeadManagerSection or ListingPerformance\'s own timeline widgets — not one of the five key-facts blocks',
  'ipo_details.sub_categories_upi':
    'company/registrar/compliance/contact/category detail rendered by CompanyOverview, CompanyContactSection, CategoryReservationSection, LeadManagerSection or ListingPerformance\'s own timeline widgets — not one of the five key-facts blocks',
  'financial_data.revenue_fy2022':
    'legacy pre-restatement financial summary surfaced by KPIHighlightSection/IPOScoreSection, not the key-facts blocks; superseded per-year by financial_statements',
  'financial_data.revenue_fy2023':
    'legacy pre-restatement financial summary surfaced by KPIHighlightSection/IPOScoreSection, not the key-facts blocks; superseded per-year by financial_statements',
  'financial_data.revenue_fy2024':
    'legacy pre-restatement financial summary surfaced by KPIHighlightSection/IPOScoreSection, not the key-facts blocks; superseded per-year by financial_statements',
  'financial_data.profit_fy2022':
    'legacy pre-restatement financial summary surfaced by KPIHighlightSection/IPOScoreSection, not the key-facts blocks; superseded per-year by financial_statements',
  'financial_data.profit_fy2023':
    'legacy pre-restatement financial summary surfaced by KPIHighlightSection/IPOScoreSection, not the key-facts blocks; superseded per-year by financial_statements',
  'financial_data.profit_fy2024':
    'legacy pre-restatement financial summary surfaced by KPIHighlightSection/IPOScoreSection, not the key-facts blocks; superseded per-year by financial_statements',
  'financial_data.net_worth':
    'legacy pre-restatement financial summary surfaced by KPIHighlightSection/IPOScoreSection, not the key-facts blocks; superseded per-year by financial_statements',
  'financial_data.eps':
    'legacy pre-restatement financial summary surfaced by KPIHighlightSection/IPOScoreSection, not the key-facts blocks; superseded per-year by financial_statements',
  'financial_data.roe':
    'legacy pre-restatement financial summary surfaced by KPIHighlightSection/IPOScoreSection, not the key-facts blocks; superseded per-year by financial_statements',
  'financial_data.debt_to_equity':
    'legacy pre-restatement financial summary surfaced by KPIHighlightSection/IPOScoreSection, not the key-facts blocks; superseded per-year by financial_statements',
  'financial_data.reserves_and_surplus':
    'legacy pre-restatement financial summary surfaced by KPIHighlightSection/IPOScoreSection, not the key-facts blocks; superseded per-year by financial_statements',
  'financial_data.total_assets':
    'legacy pre-restatement financial summary surfaced by KPIHighlightSection/IPOScoreSection, not the key-facts blocks; superseded per-year by financial_statements',
  'financial_data.total_borrowing':
    'legacy pre-restatement financial summary surfaced by KPIHighlightSection/IPOScoreSection, not the key-facts blocks; superseded per-year by financial_statements',
  'financial_data.promoter_holding_pre_issue':
    'legacy pre-restatement financial summary surfaced by KPIHighlightSection/IPOScoreSection, not the key-facts blocks; superseded per-year by financial_statements',
  'financial_data.promoter_holding_post_issue':
    'legacy pre-restatement financial summary surfaced by KPIHighlightSection/IPOScoreSection, not the key-facts blocks; superseded per-year by financial_statements',
  'financial_data.market_cap':
    'legacy pre-restatement financial summary surfaced by KPIHighlightSection/IPOScoreSection, not the key-facts blocks; superseded per-year by financial_statements',
  'financial_data.pre_ipo_eps':
    'legacy pre-restatement financial summary surfaced by KPIHighlightSection/IPOScoreSection, not the key-facts blocks; superseded per-year by financial_statements',
  'financial_data.post_ipo_eps':
    'legacy pre-restatement financial summary surfaced by KPIHighlightSection/IPOScoreSection, not the key-facts blocks; superseded per-year by financial_statements',
  'financial_data.ronw':
    'legacy pre-restatement financial summary surfaced by KPIHighlightSection/IPOScoreSection, not the key-facts blocks; superseded per-year by financial_statements',
  'financial_data.pe_ratio':
    'legacy pre-restatement financial summary surfaced by KPIHighlightSection/IPOScoreSection, not the key-facts blocks; superseded per-year by financial_statements',
  'financial_data.ebitda_fy2022':
    'legacy pre-restatement financial summary surfaced by KPIHighlightSection/IPOScoreSection, not the key-facts blocks; superseded per-year by financial_statements',
  'financial_data.ebitda_fy2023':
    'legacy pre-restatement financial summary surfaced by KPIHighlightSection/IPOScoreSection, not the key-facts blocks; superseded per-year by financial_statements',
  'financial_data.ebitda_fy2024':
    'legacy pre-restatement financial summary surfaced by KPIHighlightSection/IPOScoreSection, not the key-facts blocks; superseded per-year by financial_statements',
  'financial_data.total_income_fy2022':
    'legacy pre-restatement financial summary surfaced by KPIHighlightSection/IPOScoreSection, not the key-facts blocks; superseded per-year by financial_statements',
  'financial_data.total_income_fy2023':
    'legacy pre-restatement financial summary surfaced by KPIHighlightSection/IPOScoreSection, not the key-facts blocks; superseded per-year by financial_statements',
  'financial_data.total_income_fy2024':
    'legacy pre-restatement financial summary surfaced by KPIHighlightSection/IPOScoreSection, not the key-facts blocks; superseded per-year by financial_statements',
  'financial_data.current_ratio':
    'legacy pre-restatement financial summary surfaced by KPIHighlightSection/IPOScoreSection, not the key-facts blocks; superseded per-year by financial_statements',
  'financial_data.quick_ratio':
    'legacy pre-restatement financial summary surfaced by KPIHighlightSection/IPOScoreSection, not the key-facts blocks; superseded per-year by financial_statements',
  'financial_data.inventory_turnover':
    'legacy pre-restatement financial summary surfaced by KPIHighlightSection/IPOScoreSection, not the key-facts blocks; superseded per-year by financial_statements',
  'financial_statements.fiscal_year':
    'rendered by the financials section, which has its own table and its own period columns; a single line under a key-facts block would have to speak for several years at once',
  'financial_statements.revenue':
    'rendered by the financials section, which has its own table and its own period columns; a single line under a key-facts block would have to speak for several years at once',
  'financial_statements.total_income':
    'rendered by the financials section, which has its own table and its own period columns; a single line under a key-facts block would have to speak for several years at once',
  'financial_statements.ebitda':
    'rendered by the financials section, which has its own table and its own period columns; a single line under a key-facts block would have to speak for several years at once',
  'financial_statements.pat':
    'rendered by the financials section, which has its own table and its own period columns; a single line under a key-facts block would have to speak for several years at once',
  'financial_statements.net_worth':
    'rendered by the financials section, which has its own table and its own period columns; a single line under a key-facts block would have to speak for several years at once',
  'financial_statements.basis':
    'rendered by the financials section, which has its own table and its own period columns; a single line under a key-facts block would have to speak for several years at once',
  'financial_statements.unit':
    'rendered by the financials section, which has its own table and its own period columns; a single line under a key-facts block would have to speak for several years at once',
  'financial_statements.eps_basic':
    'rendered by the financials section, which has its own table and its own period columns; a single line under a key-facts block would have to speak for several years at once',
  'financial_statements.eps_diluted':
    'rendered by the financials section, which has its own table and its own period columns; a single line under a key-facts block would have to speak for several years at once',
  'financial_statements.op_cash_flow':
    'rendered by the financials section, which has its own table and its own period columns; a single line under a key-facts block would have to speak for several years at once',
  'financial_statements.dscr':
    'rendered by the financials section, which has its own table and its own period columns; a single line under a key-facts block would have to speak for several years at once',
  'financial_statements.rent_expense':
    'rendered by the financials section, which has its own table and its own period columns; a single line under a key-facts block would have to speak for several years at once',
  'promoters.name':
    'rendered by PromoterHoldingSection\'s own table (name, shareholding, WACA), not a key-facts block',
  'promoters.waca':
    'rendered by PromoterHoldingSection\'s own table (name, shareholding, WACA), not a key-facts block',
  'promoters.is_promoter_group':
    'rendered by PromoterHoldingSection\'s own table (name, shareholding, WACA), not a key-facts block',
  'ipo_intermediaries.role':
    'rendered by LeadManagerSection\'s intermediary table (role, name, SEBI reg, contact), not a key-facts block',
  'ipo_intermediaries.name':
    'rendered by LeadManagerSection\'s intermediary table (role, name, SEBI reg, contact), not a key-facts block',
  'ipo_risk_factors.seq':
    'rendered by CompanyOverview\'s risk-factor list (heading/body/KPIs per item), not a key-facts block',
  'ipo_risk_factors.heading':
    'rendered by CompanyOverview\'s risk-factor list (heading/body/KPIs per item), not a key-facts block',
  'brlm_track_record.brlm_name':
    'rendered by LeadManagerSection\'s BRLM track-record table, not a key-facts block',
  'brlm_track_record.as_of_date':
    'rendered by LeadManagerSection\'s BRLM track-record table, not a key-facts block',
  'brlm_track_record.issues_3y':
    'rendered by LeadManagerSection\'s BRLM track-record table, not a key-facts block',
  'brlm_track_record.closed_below_issue_price':
    'rendered by LeadManagerSection\'s BRLM track-record table, not a key-facts block',
  'promoters.shares_held':
    'rendered by PromoterHoldingSection\'s own table (name, shareholding, WACA), not a key-facts block',
  'promoters.waca_last_year':
    'rendered by PromoterHoldingSection\'s own table (name, shareholding, WACA), not a key-facts block',
  'ipo_intermediaries.sebi_reg_no':
    'rendered by LeadManagerSection\'s intermediary table (role, name, SEBI reg, contact), not a key-facts block',
  'ipo_intermediaries.contact_person':
    'rendered by LeadManagerSection\'s intermediary table (role, name, SEBI reg, contact), not a key-facts block',
  'ipo_intermediaries.phone':
    'rendered by LeadManagerSection\'s intermediary table (role, name, SEBI reg, contact), not a key-facts block',
  'ipo_intermediaries.email':
    'rendered by LeadManagerSection\'s intermediary table (role, name, SEBI reg, contact), not a key-facts block',
  'ipo_intermediaries.grievance_email':
    'rendered by LeadManagerSection\'s intermediary table (role, name, SEBI reg, contact), not a key-facts block',
  'ipo_risk_factors.body':
    'rendered by CompanyOverview\'s risk-factor list (heading/body/KPIs per item), not a key-facts block',
  'ipo_risk_factors.kpis':
    'rendered by CompanyOverview\'s risk-factor list (heading/body/KPIs per item), not a key-facts block',
  'promoter_acquisition_ranges.period':
    'rendered by PromoterHoldingSection\'s acquisition-history sub-table, not a key-facts block',
  'promoter_acquisition_ranges.waca':
    'rendered by PromoterHoldingSection\'s acquisition-history sub-table, not a key-facts block',
  'promoter_acquisition_ranges.cap_multiple':
    'rendered by PromoterHoldingSection\'s acquisition-history sub-table, not a key-facts block',
  'promoter_acquisition_ranges.price_low':
    'rendered by PromoterHoldingSection\'s acquisition-history sub-table, not a key-facts block',
  'promoter_acquisition_ranges.price_high':
    'rendered by PromoterHoldingSection\'s acquisition-history sub-table, not a key-facts block',
  'peer_companies.company_name':
    'rendered by PeerComparisonSection\'s own comparison table, not a key-facts block',
  'peer_companies.is_listed':
    'rendered by PeerComparisonSection\'s own comparison table, not a key-facts block',
  'peer_companies.pe_ratio':
    'rendered by PeerComparisonSection\'s own comparison table, not a key-facts block',
  'peer_companies.eps':
    'rendered by PeerComparisonSection\'s own comparison table, not a key-facts block',
  'peer_companies.diluted_eps':
    'rendered by PeerComparisonSection\'s own comparison table, not a key-facts block',
  'peer_companies.ronw':
    'rendered by PeerComparisonSection\'s own comparison table, not a key-facts block',
  'peer_companies.nav':
    'rendered by PeerComparisonSection\'s own comparison table, not a key-facts block',
  'peer_companies.pbv_ratio':
    'rendered by PeerComparisonSection\'s own comparison table, not a key-facts block',
  'peer_companies.financial_statement_type':
    'rendered by PeerComparisonSection\'s own comparison table, not a key-facts block',
  'anchor_investors.bid_date':
    'rendered by AnchorInvestorsSection\'s own table (bid date, shares, amount, investor list), not a key-facts block',
  'anchor_investors.total_shares_offered':
    'rendered by AnchorInvestorsSection\'s own table (bid date, shares, amount, investor list), not a key-facts block',
  'anchor_investors.total_amount_raised':
    'rendered by AnchorInvestorsSection\'s own table (bid date, shares, amount, investor list), not a key-facts block',
  'anchor_investors.anchor_investors_count':
    'rendered by AnchorInvestorsSection\'s own table (bid date, shares, amount, investor list), not a key-facts block',
  'anchor_investors.investor_list':
    'rendered by AnchorInvestorsSection\'s own table (bid date, shares, amount, investor list), not a key-facts block',
  'documents.filing_date':
    'rendered by DocumentList (filing date per document), not a key-facts block',
  'subscriptions.qib_subscription':
    'the subscription table shows all categories together; the ribbon already carries one line for the total, and further per-category lines would bury the numbers',
  'subscriptions.nii_subscription':
    'the subscription table shows all categories together; the ribbon already carries one line for the total, and further per-category lines would bury the numbers',
  'subscriptions.retail_subscription':
    'the subscription table shows all categories together; the ribbon already carries one line for the total, and further per-category lines would bury the numbers',
  'subscriptions.employee_subscription':
    'the subscription table shows all categories together; the ribbon already carries one line for the total, and further per-category lines would bury the numbers',
  'subscriptions.b_nii_subscription':
    'the subscription table shows all categories together; the ribbon already carries one line for the total, and further per-category lines would bury the numbers',
  'subscriptions.s_nii_subscription':
    'the subscription table shows all categories together; the ribbon already carries one line for the total, and further per-category lines would bury the numbers',
  'subscriptions.total_shares_bid':
    'the subscription table shows all categories together; the ribbon already carries one line for the total, and further per-category lines would bury the numbers',
  'subscriptions.shares_offered':
    'the subscription table shows all categories together; the ribbon already carries one line for the total, and further per-category lines would bury the numbers',
  'gmp_records.gmp':
    'rendered by the GMP widget on the fact ribbon area as a live indicator, not a per-field provenance line — GMP is a separate real-time signal, not a planned/verified field',
  'listing_performance.current_price':
    'rendered by ListingPerformance\'s own price panel (current/BSE/NSE price), not the listingDetails key-facts block which only carries the fixed listing_price',
  'listing_performance.current_price_bse':
    'rendered by ListingPerformance\'s own price panel (current/BSE/NSE price), not the listingDetails key-facts block which only carries the fixed listing_price',
  'listing_performance.current_price_nse':
    'rendered by ListingPerformance\'s own price panel (current/BSE/NSE price), not the listingDetails key-facts block which only carries the fixed listing_price',
  'ipo_demand_graph.price_point':
    'rendered by the demand-graph chart component (price point / cumulative quantity per exchange), not a key-facts block',
  'ipo_demand_graph.is_cut_off':
    'rendered by the demand-graph chart component (price point / cumulative quantity per exchange), not a key-facts block',
  'ipo_demand_graph.cumulative_quantity':
    'rendered by the demand-graph chart component (price point / cumulative quantity per exchange), not a key-facts block',
  'ipo_demand_graph.exchange':
    'rendered by the demand-graph chart component (price point / cumulative quantity per exchange), not a key-facts block',
  'registrars.name':
    'rendered by CompanyContactSection / AllotmentCheckerCard (registrar name, contact, website), not a key-facts block',
  'registrars.short_name':
    'rendered by CompanyContactSection / AllotmentCheckerCard (registrar name, contact, website), not a key-facts block',
  'registrars.email':
    'rendered by CompanyContactSection / AllotmentCheckerCard (registrar name, contact, website), not a key-facts block',
  'registrars.phone':
    'rendered by CompanyContactSection / AllotmentCheckerCard (registrar name, contact, website), not a key-facts block',
  'registrars.website':
    'rendered by CompanyContactSection / AllotmentCheckerCard (registrar name, contact, website), not a key-facts block',
  'registrars.address':
    'rendered by CompanyContactSection / AllotmentCheckerCard (registrar name, contact, website), not a key-facts block',
};
