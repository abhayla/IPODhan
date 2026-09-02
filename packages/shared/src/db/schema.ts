import {
  pgTable,
  char,
  uuid,
  varchar,
  text,
  integer,
  numeric,
  date,
  timestamp,
  boolean,
  jsonb,
  bigint,
  index,
  pgEnum,
  unique,
  check,
} from 'drizzle-orm/pg-core';
import { relations, isNull, sql } from 'drizzle-orm';

// ==================== ENUMS ====================

// Exchange segment where IPO is listed
export const segmentEnum = pgEnum('segment', ['MAINBOARD', 'SME']);

// Type of offering (what it is)
export const offeringTypeEnum = pgEnum('offering_type', [
  'IPO',          // Initial Public Offering
  'FPO',          // Follow-on Public Offering
  'RIGHTS',       // Rights Issue
  'OFS',          // Offer for Sale
  'IPP',          // Institutional Placement Program
  'QIP',          // Qualified Institutional Placement
  'PREFERENTIAL', // Preferential Allotment
  'NCD',          // Non-Convertible Debentures
  'BONDS',        // Corporate Bonds
  'INVITS',       // Infrastructure Investment Trusts
  'REITS',        // Real Estate Investment Trusts
  'BUYBACK',      // Share Buyback
  'DELISTING',    // Delisting from Exchange
  'TENDER',       // Tender Offer
]);

export const ipoStatusEnum = pgEnum('ipo_status', [
  'UPCOMING',
  'OPEN',
  'CLOSED',
  'LISTED',
]);

export const documentTypeEnum = pgEnum('document_type', [
  'DRHP',
  'RHP',
  'PROSPECTUS',
  'BASIS_OF_ALLOTMENT',
  'ADDENDUM',
  // New NSE document types
  'RATIOS_BASIS_ISSUE_PRICE',
  'BIDDING_CENTERS',
  'SAMPLE_APPLICATION_FORMS',
  'SECURITY_PARAMS_PRE_ANCHOR',
  'SECURITY_PARAMS_POST_ANCHOR',
  'ANCHOR_ALLOCATION_REPORT',
  'ASBA_PROCESSING_CIRCULAR',
  // T-403 (lifecycle-plan E14): three filings that previously had nowhere to go.
  // The price-band advertisement and the corrigendum were both being stored as
  // ADDENDUM, which loses the corrigendum's date precedence over the RHP and
  // loses the price-band ad entirely; the basis-of-allotment ADVERTISEMENT is a
  // distinct document from the existing BASIS_OF_ALLOTMENT.
  'PRICE_BAND_AD',
  'CORRIGENDUM',
  'BASIS_OF_ALLOTMENT_AD',
]);

/**
 * Per-(IPO, document type) fetch state — T-403 WP B, matrix §7.1 verbatim.
 *
 * WANTED         due at this stage, not yet looked for (or looked for and still open)
 * NOT_YET_FILED  the exchange ANSWERED and the field/title was empty. NOT a failure —
 *                the filing simply does not exist yet. Retried next cycle.
 * FOUND          link found AND the download passed verification (matrix §3).
 * EXTRACTED      WP C read it. Terminal for the live cycle.
 * EXTRACT_FAILED WP C failed 3x. No automatic retry until extractor_version bumps.
 * BLOCKED_ALL    every source failed. P2 alert; retried every cycle for 24h then 6-hourly.
 * SUPERSEDED     a newer filing of a superseding type replaced this one (by filing_date).
 * NOT_APPLICABLE this type cannot exist for this issue (e.g. a price band ad on a
 *                fixed-price issue) — never retried (R9).
 */
export const documentFetchStatusEnum = pgEnum('document_fetch_status', [
  'WANTED',
  'NOT_YET_FILED',
  'FOUND',
  'EXTRACTED',
  'EXTRACT_FAILED',
  'BLOCKED_ALL',
  'SUPERSEDED',
  'NOT_APPLICABLE',
]);

export const exchangeEnum = pgEnum('exchange', ['NSE', 'BSE', 'BOTH']);

export const holidayTypeEnum = pgEnum('holiday_type', [
  'TRADING',
  'SETTLEMENT',
  'BOTH',
]);

export const financialStatementTypeEnum = pgEnum('financial_statement_type', [
  'CONSOLIDATED',
  'STANDALONE',
]);

export const scraperSourceEnum = pgEnum('scraper_source', [
  'ADMIN',           // Manual admin edits (highest priority)
  'DRHP',            // DRHP PDF extraction (authoritative for financials)
  'NSE',
  'BSE',
  'API_FALLBACK',
  'MONEYCONTROL',
  'CHITTORGARH',
]);

export const dataSourceEnum = pgEnum('data_source', [
  'MANUAL',
  'SCRAPER',
  'NSE_PAST_API',
]);

export const scraperStatusEnum = pgEnum('scraper_status', [
  'SUCCESS',
  'FAILURE',
  'PARTIAL',
]);

export const reviewRecommendationEnum = pgEnum('review_recommendation', [
  'May apply',
  'Subscribe',
  'Avoid',
  'Not Recommended',
]);

export const ipoVerdictEnum = pgEnum('ipo_verdict', [
  'APPLY',
  'CONSIDER',
  'SKIP',
]);

export const confidenceLevelEnum = pgEnum('confidence_level', [
  'HIGH',
  'MEDIUM',
  'LOW',
]);

export const extractionStatusEnum = pgEnum('extraction_status', [
  'PENDING',
  'IN_PROGRESS',
  'SUCCESS',
  'PARTIAL',
  'FAILED',
]);

export const issueTypeEnum = pgEnum('issue_type', [
  'BOOK_BUILDING',
  'FIXED_PRICE',
  'HYBRID',
]);

// ==================== T-428 WP C-1: filing-field enums ====================
//
// `financial_statement_basis` is deliberately NOT named/reused from the existing
// `financial_statement_type` enum (CONSOLIDATED|STANDALONE, backs `ipo_financials`):
// the price-band-ad filing fields use a different axis (RESTATED|STANDALONE per
// docs/reviews/price-band-ad-field-inventory.md), and the T-403 round-2 lesson was
// exactly this — an enum named like an existing table/enum silently collides.

export const pricingEventEnum = pgEnum('pricing_event', [
  'PRICE_BAND_AD',
  'PROSPECTUS',
]);

export const financialStatementBasisEnum = pgEnum('financial_statement_basis', [
  'RESTATED',
  'STANDALONE',
]);

export const financialUnitEnum = pgEnum('financial_unit', [
  'MILLION',
  'LAKH',
  'CRORE',
]);

export const acquisitionPeriodEnum = pgEnum('acquisition_period', [
  '1Y',
  '18M',
  '3Y',
]);

export const intermediaryRoleEnum = pgEnum('intermediary_role', [
  'BRLM',
  'REGISTRAR',
  'SYNDICATE',
  'SPONSOR_BANK',
  'ESCROW_BANK',
  'PUBLIC_ISSUE_BANK',
]);

// ==================== TABLE 1: IPOS (Core Entity) ====================

export const ipos = pgTable(
  'ipos',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyName: varchar('company_name', { length: 255 }).notNull(),
    slug: varchar('slug', { length: 255 }).notNull().unique(),
    symbol: varchar('symbol', { length: 20 }), // Stock ticker symbol (nullable - upcoming IPOs may not have symbols yet)
    isin: varchar('isin', { length: 12 }), // International Securities Identification Number (nullable)
    bseScripCode: varchar('bse_scrip_code', { length: 20 }), // BSE numeric scrip code (e.g. "543320"); used by listing-performance-updater to fetch BSE prices (nullable)
    // T-403: BSE's IPO_NO — the key its core document API (GetMkt_ISSUE_BBS_IPO)
    // is addressed by. It is NOT the scrip code and there is no way to derive one
    // from the other outside the board payload. It must be REMEMBERED, because
    // IPO_HomePageDetail only lists live and forthcoming issues: verified
    // 2026-08-28, Skyways (IPO_NO 7903) had already dropped off the board the day
    // after it closed — which is exactly when its final Prospectus becomes due.
    // Captured while the IPO is still on the board, then used for the rest of its life.
    bseIpoNo: integer('bse_ipo_no'),
    // T-403 detection upgrade for the F17 class. How many lead managers the BSE
    // payload ACTUALLY listed at write time. The co-BRLM bug (Skyways: 3 in the
    // payload, 2 stored) survived because nothing ever compared the two numbers;
    // the nightly audit now FAILs when lead_managers is shorter than this.
    bsePayloadLeadManagerCount: integer('bse_payload_lead_manager_count'),

    /**
     * The issuer's own website, read off the RHP/DRHP cover (T-403 M-6).
     *
     * Load-bearing: the document chain's fourth rung is the issuer's investor
     * page, and before this column NOTHING supplied a URL for it — the rung was
     * unreachable in production and could only record
     * `COMPANY:skipped:no_company_url`.
     *
     * ON `ipos`, NOT `ipo_details`, deliberately: no journaled migration creates
     * `ipo_details` at all (verified by replaying the journal into an empty
     * database), so a column added there would not exist on any journal-built
     * environment and the rung would stay unreachable — the same "a repair
     * nobody applies" trap as the enum values in 0036. These sit beside
     * `bse_ipo_no`, which is the same kind of discovery bookkeeping.
     */
    companyWebsite: varchar('company_website', { length: 255 }),

    /**
     * The third-party IPO page (Chittorgarh) used ONLY to verify which exchange
     * URL is correct — never a document source (owner rule, 2026-08-28).
     * Recorded by the scraper orchestrator, which already fetches that page.
     */
    verifierUrl: varchar('verifier_url', { length: 512 }),

    // T-428 WP C-1: Corporate Identification Number, printed on every price-band
    // ad / prospectus cover. 21 chars is the fixed CIN length (India, MCA format).
    cin: varchar('cin', { length: 21 }),

    segment: segmentEnum('segment'), // Exchange segment (MAINBOARD | SME) - nullable for RIGHTS/InvITs/REITs
    offeringType: offeringTypeEnum('offering_type').notNull(), // Type of offering (IPO, RIGHTS, TENDER, etc.)
    sector: varchar('sector', { length: 100 }),
    issueSize: numeric('issue_size', { precision: 15, scale: 2 }), // in INR RUPEES (normalizeCurrency stores rupees; render via formatIssueSizeCrores) - GitHub #9
    priceRangeMin: integer('price_range_min'), // min price per share
    priceRangeMax: integer('price_range_max'), // max price per share
    lotSize: integer('lot_size'),
    status: ipoStatusEnum('status').notNull(),
    openDate: date('open_date'),
    closeDate: date('close_date'),
    allotmentDate: date('allotment_date'),
    listingDate: date('listing_date'),
    companyDescription: text('company_description'),
    faceValue: integer('face_value'),
    listingExchanges: jsonb('listing_exchanges').$type<('NSE' | 'BSE')[]>(),
    registrar: varchar('registrar', { length: 255 }),
    registrarId: uuid('registrar_id').references(() => registrars.id),
    leadManagers: jsonb('lead_managers').$type<string[]>(),
    rating: integer('rating'), // 1-5 stars
    ratingRationale: text('rating_rationale'),
    ratingOverride: boolean('rating_override').default(false), // Manual override flag for admin
    lastScrapedAt: timestamp('last_scraped_at'), // Timestamp of last successful scrape

    // Manual Data Management (Phase 6)
    scraperLocked: boolean('scraper_locked').default(false), // IPO-level protection flag (master lock)
    scraperLockNote: text('scraper_lock_note'), // Admin note explaining why IPO is locked
    lastManualEditAt: timestamp('last_manual_edit_at'), // Last time admin manually edited any field

    // Historical IPO Performance Data (Story 7.10)
    // Subscription data
    subscriptionRetail: numeric('subscription_retail', { precision: 10, scale: 2 }), // Retail investor subscription multiple
    subscriptionHni: numeric('subscription_hni', { precision: 10, scale: 2 }), // HNI subscription multiple
    subscriptionQib: numeric('subscription_qib', { precision: 10, scale: 2 }), // QIB subscription multiple
    subscriptionTotal: numeric('subscription_total', { precision: 10, scale: 2 }), // Total subscription multiple

    // GMP (Grey Market Premium) data
    gmpPrice: numeric('gmp_price', { precision: 10, scale: 2 }), // GMP absolute value in rupees
    gmpPercentageHistorical: numeric('gmp_percentage_historical', { precision: 5, scale: 2 }), // GMP as percentage
    gmpUpdatedAtHistorical: timestamp('gmp_updated_at_historical'), // Last GMP update timestamp

    // Listing performance
    listingPriceHistorical: numeric('listing_price_historical', { precision: 10, scale: 2 }), // Listing price
    listingGainPercentage: numeric('listing_gain_percentage', { precision: 5, scale: 2 }), // Listing gain %
    listingGainAmount: numeric('listing_gain_amount', { precision: 10, scale: 2 }), // Listing gain amount
    listingDateHistorical: date('listing_date_historical'), // Date when IPO listed

    // Current price tracking
    currentPrice: numeric('current_price', { precision: 10, scale: 2 }), // Current market price
    currentGainPercentage: numeric('current_gain_percentage', { precision: 5, scale: 2 }), // Current gain %
    currentGainAmount: numeric('current_gain_amount', { precision: 10, scale: 2 }), // Current gain amount
    currentPriceUpdatedAt: timestamp('current_price_updated_at'), // Last current price update

    // Metadata
    historicalDataSource: varchar('historical_data_source', { length: 100 }), // e.g., 'Chittorgarh'
    historicalDataScrapedAt: timestamp('historical_data_scraped_at'), // Last historical scrape timestamp

    // IPO Objectives (Story 11.13)
    objectives: jsonb('objectives').$type<IPOObjective[]>(), // Array of {serial, description, amount}

    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => ({
    statusIdx: index('idx_ipos_status').on(table.status),
    slugIdx: index('idx_ipos_slug').on(table.slug),
    symbolIdx: index('idx_ipos_symbol').on(table.symbol), // Index for symbol search performance
    segmentIdx: index('idx_ipos_segment').on(table.segment),
    offeringTypeIdx: index('idx_ipos_offering_type').on(table.offeringType),
    segmentOfferingTypeIdx: index('idx_ipos_segment_offering_type').on(table.segment, table.offeringType),
    // Note: Trigram index for fuzzy company name search created in migration 0000_initial_schema.sql
    // CREATE INDEX idx_ipos_company_name_trgm ON ipos USING gin(company_name gin_trgm_ops);
  })
);

// ==================== TABLE 2: SUBSCRIPTIONS (Time-series) ====================

export const subscriptions = pgTable(
  'subscriptions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ipoId: uuid('ipo_id')
      .notNull()
      .references(() => ipos.id, { onDelete: 'cascade' }),
    timestamp: timestamp('timestamp').notNull(),

    // High-level categories
    qibSubscription: numeric('qib_subscription', { precision: 10, scale: 2 }),
    niiSubscription: numeric('nii_subscription', { precision: 10, scale: 2 }),
    retailSubscription: numeric('retail_subscription', {
      precision: 10,
      scale: 2,
    }),
    totalSubscription: numeric('total_subscription', {
      precision: 10,
      scale: 2,
    }),
    employeeSubscription: numeric('employee_subscription', {
      precision: 10,
      scale: 2,
    }),
    othersSubscription: numeric('others_subscription', {
      precision: 10,
      scale: 2,
    }),

    // Granular breakdown
    anchorInvestorSubscription: numeric('anchor_investor_subscription', {
      precision: 10,
      scale: 2,
    }),
    retailHNISubscription: numeric('retail_hni_subscription', {
      precision: 10,
      scale: 2,
    }),
    retailOthersSubscription: numeric('retail_others_subscription', {
      precision: 10,
      scale: 2,
    }),
    bNIISubscription: numeric('b_nii_subscription', {
      precision: 10,
      scale: 2,
    }),
    sNIISubscription: numeric('s_nii_subscription', {
      precision: 10,
      scale: 2,
    }),

    // Additional metrics
    totalApplications: integer('total_applications'),
    totalSharesBid: bigint('total_shares_bid', { mode: 'number' }),
    sharesOffered: bigint('shares_offered', { mode: 'number' }),

    // NEW NSE FIELDS - Sub-category breakdowns
    qibFiiSubscription: numeric('qib_fii_subscription', { precision: 10, scale: 2 }),
    qibDomesticFiSubscription: numeric('qib_domestic_fi_subscription', { precision: 10, scale: 2 }),
    qibMutualFundSubscription: numeric('qib_mutual_fund_subscription', { precision: 10, scale: 2 }),
    qibOthersSubscription: numeric('qib_others_subscription', { precision: 10, scale: 2 }),

    niiCorporatesSubscription: numeric('nii_corporates_subscription', { precision: 10, scale: 2 }),
    niiIndividualsSubscription: numeric('nii_individuals_subscription', { precision: 10, scale: 2 }),
    niiOthersSubscription: numeric('nii_others_subscription', { precision: 10, scale: 2 }),

    retailCutOffShares: bigint('retail_cut_off_shares', { mode: 'number' }),
    retailPriceBidShares: bigint('retail_price_bid_shares', { mode: 'number' }),

    employeeCutOffShares: bigint('employee_cut_off_shares', { mode: 'number' }),
    employeePriceBidShares: bigint('employee_price_bid_shares', { mode: 'number' }),

    cutOffBidsTotal: bigint('cut_off_bids_total', { mode: 'number' }), // Total cut-off bids

    // Exchange breakdown
    totalBidsNSE: bigint('total_bids_nse', { mode: 'number' }),
    totalBidsBSE: bigint('total_bids_bse', { mode: 'number' }),
    totalBidsCombined: bigint('total_bids_combined', { mode: 'number' }),
  },
  (table) => ({
    ipoTimestampIdx: index('idx_subscriptions_ipo_timestamp').on(
      table.ipoId,
      table.timestamp
    ),
  })
);

// ==================== NEW TABLE: IPO_DEMAND_GRAPH (Price-wise demand) ====================

export const ipoDemandGraph = pgTable(
  'ipo_demand_graph',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ipoId: uuid('ipo_id')
      .notNull()
      .references(() => ipos.id, { onDelete: 'cascade' }),
    timestamp: timestamp('timestamp').notNull(), // When data was captured

    // Price point details
    pricePoint: numeric('price_point', { precision: 10, scale: 2 }), // 695.00, 696.00, ..., 730.00, or null for "Cut-Off"
    isCutOff: boolean('is_cut_off').default(false).notNull(), // true for cut-off price

    // Demand data
    cumulativeQuantity: bigint('cumulative_quantity', { mode: 'number' }).notNull(), // Total shares bid at this price and above

    // Exchange breakdown
    exchange: exchangeEnum('exchange').notNull(), // NSE, BSE, or BOTH (for combined)

    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    ipoExchangePriceIdx: index('idx_demand_ipo_exchange_price').on(
      table.ipoId,
      table.exchange,
      table.pricePoint
    ),
    timestampIdx: index('idx_demand_timestamp').on(table.timestamp),
  })
);

// ==================== TABLE 3: GMP_RECORDS (Time-series) ====================

export const gmpRecords = pgTable(
  'gmp_records',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ipoId: uuid('ipo_id')
      .notNull()
      .references(() => ipos.id, { onDelete: 'cascade' }),
    timestamp: timestamp('timestamp').notNull(),
    // B2/G14: numeric(10,2) so fractional GMP/rates aren't truncated. mode:'number'
    // keeps the TS type as `number` (no consumer ripple) and reads correctly whether
    // the prod column is still integer (pre-ALTER) or numeric (post-ALTER, gated).
    gmp: numeric('gmp', { precision: 10, scale: 2, mode: 'number' }).notNull(), // grey market premium in INR
    gmpPercentage: numeric('gmp_percentage', { precision: 10, scale: 2, mode: 'number' }), // GMP as % of issue price (B1/G11)
    expectedListingPrice: numeric('expected_listing_price', { precision: 10, scale: 2, mode: 'number' }),
    subjectRate: numeric('subject_rate', { precision: 10, scale: 2, mode: 'number' }), // subject/safalya rate
    kostakRate: numeric('kostak_rate', { precision: 10, scale: 2, mode: 'number' }), // kostak rate
    saudaDetails: text('sauda_details'), // trading info
    source: varchar('source', { length: 100 }).notNull(),
  },
  (table) => ({
    ipoTimestampIdx: index('idx_gmp_records_ipo_timestamp').on(
      table.ipoId,
      table.timestamp
    ),
  })
);

// ==================== TABLE 4: FINANCIAL_DATA (One-to-One) ====================

export const financialData = pgTable('financial_data', {
  id: uuid('id').primaryKey().defaultRandom(),
  ipoId: uuid('ipo_id')
    .notNull()
    .unique()
    .references(() => ipos.id, { onDelete: 'cascade' }),

  // Revenue by fiscal year (in INR crores)
  revenueFy2022: numeric('revenue_fy2022', { precision: 12, scale: 2 }),
  revenueFy2023: numeric('revenue_fy2023', { precision: 12, scale: 2 }),
  revenueFy2024: numeric('revenue_fy2024', { precision: 12, scale: 2 }),

  // Profit by fiscal year (in INR crores)
  profitFy2022: numeric('profit_fy2022', { precision: 12, scale: 2 }),
  profitFy2023: numeric('profit_fy2023', { precision: 12, scale: 2 }),
  profitFy2024: numeric('profit_fy2024', { precision: 12, scale: 2 }),

  // Other financial metrics
  netWorth: numeric('net_worth', { precision: 12, scale: 2 }),
  peRatio: numeric('pe_ratio', { precision: 10, scale: 2 }),
  eps: numeric('eps', { precision: 10, scale: 2 }),
  roe: numeric('roe', { precision: 5, scale: 2 }), // percentage
  debtToEquity: numeric('debt_to_equity', { precision: 10, scale: 2 }),
  reservesAndSurplus: numeric('reserves_and_surplus', {
    precision: 12,
    scale: 2,
  }),
  totalAssets: numeric('total_assets', { precision: 12, scale: 2 }),
  totalBorrowing: numeric('total_borrowing', { precision: 12, scale: 2 }),

  // Promoter Holding Fields (Story 11.9)
  promoterHoldingPreIssue: numeric('promoter_holding_pre_issue', {
    precision: 5,
    scale: 2,
  }), // percentage (e.g., 77.00)
  promoterHoldingPostIssue: numeric('promoter_holding_post_issue', {
    precision: 5,
    scale: 2,
  }), // percentage (e.g., 62.00)

  // KPI Highlight Fields (Story 11.11)
  marketCap: numeric('market_cap', { precision: 15, scale: 2 }), // Market capitalization in ₹ crores
  preIpoEps: numeric('pre_ipo_eps', { precision: 10, scale: 2 }), // Pre-IPO Earnings Per Share
  postIpoEps: numeric('post_ipo_eps', { precision: 10, scale: 2 }), // Post-IPO Earnings Per Share
  ronw: numeric('ronw', { precision: 5, scale: 2 }), // Return on Net Worth %

  // Enhanced Financial Metrics (Story 11.12)
  ebitdaFy2022: numeric('ebitda_fy2022', { precision: 12, scale: 2 }), // EBITDA for FY2022 in ₹ crores
  ebitdaFy2023: numeric('ebitda_fy2023', { precision: 12, scale: 2 }), // EBITDA for FY2023 in ₹ crores
  ebitdaFy2024: numeric('ebitda_fy2024', { precision: 12, scale: 2 }), // EBITDA for FY2024 in ₹ crores
  totalIncomeFy2022: numeric('total_income_fy2022', { precision: 12, scale: 2 }), // Total Income for FY2022 in ₹ crores
  totalIncomeFy2023: numeric('total_income_fy2023', { precision: 12, scale: 2 }), // Total Income for FY2023 in ₹ crores
  totalIncomeFy2024: numeric('total_income_fy2024', { precision: 12, scale: 2 }), // Total Income for FY2024 in ₹ crores
  totalBorrowings: numeric('total_borrowings', { precision: 12, scale: 2 }), // Total borrowings in ₹ crores
  currentRatio: numeric('current_ratio', { precision: 5, scale: 2 }), // Current Ratio (current assets / current liabilities)
  quickRatio: numeric('quick_ratio', { precision: 5, scale: 2 }), // Quick Ratio (quick assets / current liabilities)
  inventoryTurnover: numeric('inventory_turnover', { precision: 5, scale: 2 }), // Inventory Turnover Ratio
});

// ==================== TABLE 15: IPO_FINANCIALS (One-to-One - Enhanced) ====================

export const ipoFinancials = pgTable(
  'ipo_financials',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ipoId: uuid('ipo_id')
      .notNull()
      .unique()
      .references(() => ipos.id, { onDelete: 'cascade' }),

    // Revenue by fiscal year (in INR crores)
    revenueFy1: numeric('revenue_fy1', { precision: 12, scale: 2 }),
    revenueFy2: numeric('revenue_fy2', { precision: 12, scale: 2 }),
    revenueFy3: numeric('revenue_fy3', { precision: 12, scale: 2 }),

    // Profit by fiscal year
    profitFy1: numeric('profit_fy1', { precision: 12, scale: 2 }),
    profitFy2: numeric('profit_fy2', { precision: 12, scale: 2 }),
    profitFy3: numeric('profit_fy3', { precision: 12, scale: 2 }),

    // Existing metrics
    peRatio: numeric('pe_ratio', { precision: 8, scale: 2 }),
    roePercentage: numeric('roe_percentage', { precision: 5, scale: 2 }),
    debtToEquity: numeric('debt_to_equity', { precision: 8, scale: 2 }),

    // NEW METRICS (Story 4.10)
    pbRatio: numeric('pb_ratio', { precision: 8, scale: 2 }), // Price-to-Book ratio
    rocePercentage: numeric('roce_percentage', { precision: 5, scale: 2 }), // Return on Capital Employed %
    industryPe: numeric('industry_pe', { precision: 8, scale: 2 }), // Industry average P/E
    peerCompanies: text('peer_companies').array(), // Peer company names
    financialYearEnd: varchar('financial_year_end', { length: 10 }), // FY end date

    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => ({
    ipoIdIdx: index('idx_ipo_financials_ipo_id').on(table.ipoId),
  })
);

// ==================== TABLE 5: DOCUMENTS (One-to-Many) ====================

export const documents = pgTable(
  'documents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ipoId: uuid('ipo_id')
      .notNull()
      .references(() => ipos.id, { onDelete: 'cascade' }),
    type: documentTypeEnum('type').notNull(),

    // Media type and sequencing fields for handling multiple documents
    mediaType: varchar('media_type', { length: 20 }).default('PDF').notNull(), // 'PDF' or 'VIDEO'
    sequenceNumber: integer('sequence_number').default(1).notNull(), // For multiple documents of same type (addendums, etc.)
    isActive: boolean('is_active').default(true).notNull(), // Track superseded documents

    title: varchar('title', { length: 255 }).notNull(),
    url: text('url').notNull(), // file path or external URL
    fileSize: bigint('file_size', { mode: 'number' }), // in bytes
    /**
     * sha256 of the stored bytes (T-403 W-1).
     *
     * The dedup rule the discovery runner implements — matrix E7/R2, "the same
     * bytes served by BSE and by NSE are ONE document, not two" — was computed
     * per run and then thrown away: nothing persisted the hash, so the rule
     * could not survive a restart and no query could prove two rows were the
     * same filing. char(64) because a sha256 hex digest is exactly 64
     * characters, always.
     */
    sha256: char('sha256', { length: 64 }),
    // T-428 WP C-1: the date the filing was made with the exchange/registrar
    // (distinct from uploadedAt, which is when WE fetched it).
    filingDate: date('filing_date'),
    uploadedAt: timestamp('uploaded_at').defaultNow().notNull(),
    exchange: varchar('exchange', { length: 10 }), // 'NSE' | 'BSE' - source exchange

    // DRHP extraction tracking (Phase 0: Data Flow Architecture)
    extractionStatus: varchar('extraction_status', { length: 50 }).default('PENDING'), // PENDING|IN_PROGRESS|COMPLETED|FAILED|MANUAL_REVIEW
    extractionConfidence: numeric('extraction_confidence', { precision: 5, scale: 2 }), // 0-100%
    extractedAt: timestamp('extracted_at'),
    extractionError: text('extraction_error'), // Error message if extraction failed
    retryCount: integer('retry_count').default(0).notNull(), // Number of extraction attempts

    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => ({
    exchangeIdx: index('idx_documents_exchange').on(table.exchange),
    extractionStatusIdx: index('idx_documents_extraction_status').on(table.extractionStatus),

    // Composite unique constraint: one document per (IPO + type + mediaType + exchange + sequence)
    // Allows multiple documents of same type (e.g., Addendum 1, 2, 3)
    // Distinguishes PDF vs VIDEO versions
    // Supports documents from both NSE and BSE
    uniqueDocPerIpo: unique('unique_doc_per_ipo').on(
      table.ipoId,
      table.type,
      table.mediaType,
      table.exchange,
      table.sequenceNumber
    ),

    // Keep URL unique globally to prevent exact duplicates
    uniqueUrl: unique('unique_url').on(table.url),
  })
);

// ==================== TABLE 5b: DOCUMENT_FETCH_STATE (T-403 WP B) ====================

/**
 * One row per (ipo_id, doc_type): what we WANT, what we have, and what happened.
 *
 * Why a new table rather than a column on `documents`: `documents` only has rows
 * for things already FOUND, so "wanted but not filed yet", "blocked on every
 * source" and "not applicable to this issue" have nowhere to live — which is why
 * the old discovery job had no memory and re-fetched the same NSE payload every
 * day (matrix §7.1).
 *
 * `last_attempt` is the per-run attempt log the admin page and the nightly audit
 * read, e.g.
 *   [{"source":"BSE","http":200,"ms":812,"outcome":"no_link"},
 *    {"source":"NSE","http":0,"ms":15000,"outcome":"timeout"}]
 */
export const documentFetchState = pgTable(
  'document_fetch_state',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ipoId: uuid('ipo_id')
      .notNull()
      .references(() => ipos.id, { onDelete: 'cascade' }),
    docType: documentTypeEnum('doc_type').notNull(),
    state: documentFetchStatusEnum('state').notNull().default('WANTED'),

    // Set once the document is FOUND. ON DELETE SET NULL, not CASCADE: purging a
    // documents row must not erase the memory that we already looked for it.
    documentId: uuid('document_id').references(() => documents.id, {
      onDelete: 'set null',
    }),

    attempts: integer('attempts').default(0).notNull(),
    lastAttemptAt: timestamp('last_attempt_at'),
    nextRetryAt: timestamp('next_retry_at'),
    /** Every source tried in the last run, in order (see the example above). */
    lastAttempt: jsonb('last_attempt'),

    firstSeenAt: timestamp('first_seen_at').defaultNow().notNull(),
    /** When BLOCKED_ALL was first entered — drives the 24h -> 6h retry ladder (§7.3). */
    blockedSinceAt: timestamp('blocked_since_at'),
    extractedAt: timestamp('extracted_at'),
    extractorVersion: varchar('extractor_version', { length: 50 }),

    /**
     * The date printed ON the document. Supersession is decided by this, never by
     * fetch order — a late-discovered IPO fetches its filings newest-first and an
     * older filing must not overwrite a newer one (lifecycle-plan E1/E8).
     */
    filingDate: date('filing_date'),

    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => ({
    // One state row per (IPO, doc type) — the identity the whole machine is keyed on.
    uniqueStatePerIpoType: unique('unique_doc_fetch_state_per_ipo_type').on(
      table.ipoId,
      table.docType
    ),
    stateIdx: index('idx_document_fetch_state_state').on(table.state),
    // The cycle's hot query: "which rows are due to be retried now?"
    nextRetryIdx: index('idx_document_fetch_state_next_retry').on(
      table.state,
      table.nextRetryAt
    ),
    ipoIdx: index('idx_document_fetch_state_ipo').on(table.ipoId),
  })
);

// ==================== TABLE 6: LISTING_PERFORMANCE (One-to-One) ====================

export const listingPerformance = pgTable('listing_performance', {
  id: uuid('id').primaryKey().defaultRandom(),
  ipoId: uuid('ipo_id')
    .unique()
    .references(() => ipos.id, { onDelete: 'cascade' }),
  symbol: varchar('symbol', { length: 20 }),
  companyName: varchar('company_name', { length: 255 }),
  listingDate: date('listing_date'),
  // Prices are numeric(10,2), not integer (#79): Chittorgarh sends decimal rupee
  // prices (e.g. ₹145.78) which an integer column rejects. mode:'number' keeps the
  // Drizzle return type a JS number (financial-column-precision.md pattern), so
  // consumers are unaffected by the numeric→string ripple.
  listingPrice: numeric('listing_price', { precision: 10, scale: 2, mode: 'number' }),
  issuePrice: numeric('issue_price', { precision: 10, scale: 2, mode: 'number' }),
  // Gain % widened numeric(5,2)→numeric(7,2) (#79): current_gain (price vs issue,
  // years after listing) is unbounded and older IPOs up >1000% overflow the ±999.99
  // cap. numeric(7,2) admits up to ±99999.99%.
  listingGainPercent: numeric('listing_gain_percent', {
    precision: 7,
    scale: 2,
  }),
  currentPrice: numeric('current_price', { precision: 10, scale: 2, mode: 'number' }), // @deprecated Use currentPriceBSE or currentPriceNSE
  currentPriceBSE: numeric('current_price_bse', { precision: 10, scale: 2, mode: 'number' }),
  currentPriceNSE: numeric('current_price_nse', { precision: 10, scale: 2, mode: 'number' }),
  currentGainPercent: numeric('current_gain_percent', {
    precision: 7,
    scale: 2,
  }),
  // Listing-day OHLC trading information — captured from the exchange on listing day.
  // numeric (not integer) so paise are preserved (₹/financial-column-precision rule);
  // the legacy listingPrice/issuePrice/currentPrice integer columns above are pre-existing.
  listingOpenPrice: numeric('listing_open_price', { precision: 10, scale: 2 }),
  listingHighPrice: numeric('listing_high_price', { precision: 10, scale: 2 }),
  listingLowPrice: numeric('listing_low_price', { precision: 10, scale: 2 }),
  listingClosePrice: numeric('listing_close_price', { precision: 10, scale: 2 }),
  lastTradedPrice: numeric('last_traded_price', { precision: 10, scale: 2 }),
  dataSource: dataSourceEnum('data_source').default('MANUAL'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  lastUpdated: timestamp('last_updated').defaultNow().notNull(), // @deprecated Use updatedAt
});

// ==================== TABLE 7: MARKET_HOLIDAYS (Utility) ====================

export const marketHolidays = pgTable(
  'market_holidays',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    date: date('date').notNull(),
    description: varchar('description', { length: 255 }).notNull(),
    exchange: exchangeEnum('exchange').notNull(),
    type: holidayTypeEnum('type').notNull(),
    year: integer('year').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => ({
    dateIdx: index('idx_market_holidays_date').on(table.date),
    yearIdx: index('idx_market_holidays_year').on(table.year),
  })
);

// ==================== TABLE 8: REGISTRARS (Utility) ====================

export const registrars = pgTable('registrars', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 255 }).notNull(),
  shortName: varchar('short_name', { length: 100 }),
  email: varchar('email', { length: 255 }),
  phone: varchar('phone', { length: 20 }),
  website: text('website'),
  allotmentCheckUrl: text('allotment_check_url'),
  address: text('address'),
  logoUrl: text('logo_url'),
  active: boolean('active').default(true).notNull(),
  // T-300: standing daily URL health check writes these so the serving layer
  // can degrade gracefully (hide a dead CTA) without a live fetch per request.
  // allotmentUrlHealthy defaults true (unknown == assume OK) until the first
  // health-check cycle observes it; NULL allotmentUrlCheckedAt means "never
  // checked yet", not "checked and healthy".
  allotmentUrlHealthy: boolean('allotment_url_healthy').default(true).notNull(),
  allotmentUrlCheckedAt: timestamp('allotment_url_checked_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// ==================== TABLE 9: PEER_COMPANIES (One-to-Many) ====================

export const peerCompanies = pgTable('peer_companies', {
  id: uuid('id').primaryKey().defaultRandom(),
  ipoId: uuid('ipo_id')
    .notNull()
    .references(() => ipos.id, { onDelete: 'cascade' }),
  companyName: varchar('company_name', { length: 255 }).notNull(),
  sector: varchar('sector', { length: 100 }),
  isListed: boolean('is_listed').notNull(),

  // Financial metrics
  peRatio: numeric('pe_ratio', { precision: 10, scale: 2 }),
  eps: numeric('eps', { precision: 10, scale: 2 }),
  dilutedEps: numeric('diluted_eps', { precision: 10, scale: 2 }),
  ronw: numeric('ronw', { precision: 5, scale: 2 }), // return on net worth %
  nav: numeric('nav', { precision: 10, scale: 2 }), // net asset value
  pbvRatio: numeric('pbv_ratio', { precision: 10, scale: 2 }), // price-to-book value
  financialStatementType: financialStatementTypeEnum('financial_statement_type'),

  // Metadata
  dataSource: varchar('data_source', { length: 100 }),
  lastUpdated: timestamp('last_updated'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// ==================== TABLE 10: BROKER_AFFILIATES (One-to-Many) ====================

export const brokerAffiliates = pgTable(
  'broker_affiliates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    brokerName: varchar('broker_name', { length: 255 }).notNull(),
    brokerLogo: text('broker_logo'),
    affiliateUrl: text('affiliate_url').notNull(),
    displayText: varchar('display_text', { length: 100 }),
    active: boolean('active').default(true).notNull(),
    displayOrder: integer('display_order').default(0).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => ({
    activeOrderIdx: index('idx_broker_affiliates_active_order').on(
      table.active,
      table.displayOrder
    ),
  })
);

// ==================== TABLE 11: AFFILIATE_CLICKS (Time-series) ====================

export const affiliateClicks = pgTable(
  'affiliate_clicks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ipoId: uuid('ipo_id').references(() => ipos.id, { onDelete: 'set null' }),
    broker: varchar('broker', { length: 50 }).notNull(), // 'zerodha' or 'angelone'
    source: varchar('source', { length: 50 }).notNull(), // 'ipo_detail' or 'homepage'
    userSession: varchar('user_session', { length: 255 }), // Session identifier for analytics
    clickedAt: timestamp('clicked_at').defaultNow().notNull(),
  },
  (table) => ({
    brokerIdx: index('idx_affiliate_clicks_broker').on(table.broker),
    clickedAtIdx: index('idx_affiliate_clicks_clicked_at').on(table.clickedAt),
    ipoIdIdx: index('idx_affiliate_clicks_ipo_id').on(table.ipoId),
  })
);

// ==================== TABLE 12: SCRAPER_LOGS (Monitoring) ====================

export const scraperLogs = pgTable(
  'scraper_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    source: text('source').notNull(), // 'NSE' | 'BSE' | 'API_FALLBACK'
    status: text('status').notNull(), // 'SUCCESS' | 'FAILURE' | 'PARTIAL'
    recordsProcessed: integer('records_processed').default(0),
    recordsFailed: integer('records_failed').default(0),
    durationMs: integer('duration_ms').notNull(),
    errorMessage: text('error_message'),
    errorStack: text('error_stack'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    createdAtIdx: index('idx_scraper_logs_created_at').on(table.createdAt),
    sourceCreatedAtIdx: index('idx_scraper_logs_source_created_at').on(
      table.source,
      table.createdAt
    ),
    statusIdx: index('idx_scraper_logs_status').on(table.status),
  })
);

// ==================== TABLE 12b: SCRAPER_STEPS (T-340 post-scrape step ledger) ====================
// A NEW table, deliberately NOT reusing scraper_logs above: scraper_logs'
// `source` column is a SOURCE name (NSE/BSE/API_FALLBACK/...) and its
// `status` enum (SUCCESS/FAILURE/PARTIAL) has no 'skipped' state, so a
// post-scrape step (statusUpdate, registrarReresolve, ...) skipped for a
// documented reason (e.g. ADMIN_API_TOKEN unset, outside a cadence window)
// cannot be represented without either overloading `source` with non-source
// values or losing the reason entirely. See the T-340 PR body for the full
// "why a new table" rationale.
export const scraperSteps = pgTable(
  'scraper_steps',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    cycleId: uuid('cycle_id').notNull(), // one value per `--source=all` run, links every step of that cycle
    step: text('step').notNull(), // one of scraper/src/index.ts's exported STEP_NAMES
    status: text('status').notNull(), // 'ok' | 'skipped' | 'failed'
    reason: text('reason'), // required when status='skipped'; the failure message when status='failed'
    durationMs: integer('duration_ms').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    createdAtIdx: index('idx_scraper_steps_created_at').on(table.createdAt),
    stepCreatedAtIdx: index('idx_scraper_steps_step_created_at').on(
      table.step,
      table.createdAt
    ),
    cycleIdIdx: index('idx_scraper_steps_cycle_id').on(table.cycleId),
  })
);

// ==================== TABLE 13: EXTRACTION_LOGS (DRHP PDF Extraction Tracking) ====================

export const extractionLogs = pgTable(
  'extraction_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ipoId: uuid('ipo_id').references(() => ipos.id, { onDelete: 'cascade' }),
    companyName: varchar('company_name', { length: 255 }).notNull(),

    // File Information
    fileName: varchar('file_name', { length: 255 }).notNull(),
    filePath: varchar('file_path', { length: 500 }),
    fileSize: integer('file_size'), // in bytes
    totalPages: integer('total_pages'),

    // Extraction Status
    status: extractionStatusEnum('status').notNull().default('PENDING'),
    extractorVersion: varchar('extractor_version', { length: 20 }),
    extractionMethod: varchar('extraction_method', { length: 50 }), // 'pdfplumber', 'pymupdf4llm', 'manual'

    // Extracted Data Summary
    fieldsExtracted: integer('fields_extracted').default(0),
    totalFields: integer('total_fields').default(16),
    extractedData: jsonb('extracted_data'), // JSON of extracted financial data

    // Quality Metrics
    confidenceScore: integer('confidence_score'), // 0-100
    confidenceLevel: confidenceLevelEnum('confidence_level'),
    dataIssues: jsonb('data_issues').$type<string[]>(), // Array of detected issues

    // Processing Metrics
    durationMs: integer('duration_ms'),
    plPageNumber: integer('pl_page_number'), // Page where P&L was found
    tablesProcessed: integer('tables_processed'),
    unitDetected: varchar('unit_detected', { length: 20 }), // 'lakhs', 'crores', 'millions'

    // Error Tracking
    errorMessage: text('error_message'),
    errorStack: text('error_stack'),
    failureReason: text('failure_reason'),

    // Admin Metadata
    uploadedBy: varchar('uploaded_by', { length: 255 }), // Admin username
    reviewedBy: varchar('reviewed_by', { length: 255 }),
    reviewNotes: text('review_notes'),
    isVerified: boolean('is_verified').default(false),

    // Timestamps
    createdAt: timestamp('created_at').defaultNow().notNull(),
    processedAt: timestamp('processed_at'),
    reviewedAt: timestamp('reviewed_at'),
  },
  (table) => ({
    ipoIdIdx: index('idx_extraction_logs_ipo_id').on(table.ipoId),
    statusIdx: index('idx_extraction_logs_status').on(table.status),
    createdAtIdx: index('idx_extraction_logs_created_at').on(table.createdAt),
    confidenceLevelIdx: index('idx_extraction_logs_confidence').on(table.confidenceLevel),
    companyNameIdx: index('idx_extraction_logs_company').on(table.companyName),
  })
);

// ==================== TABLE 14: IPO_REVIEWS (One-to-Many) ====================

export const ipoReviews = pgTable(
  'ipo_reviews',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    reviewTitle: varchar('review_title', { length: 500 }).notNull(),
    author: varchar('author', { length: 255 }).notNull(),
    recommendation: reviewRecommendationEnum('recommendation').notNull(),
    ipoId: uuid('ipo_id')
      .notNull()
      .references(() => ipos.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    publishedDate: timestamp('published_date').notNull(),
    year: integer('year').notNull(),
    segment: segmentEnum('segment').notNull(), // Changed from category to segment
    reviewUrl: text('review_url'),
    reviewContent: text('review_content'),
    // Moderation fields (Story 11.16)
    isApproved: boolean('is_approved').default(false).notNull(),
    moderatedBy: varchar('moderated_by', { length: 255 }),
    moderatedAt: timestamp('moderated_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => ({
    ipoIdIdx: index('idx_ipo_reviews_ipo_id').on(table.ipoId),
    yearIdx: index('idx_ipo_reviews_year').on(table.year),
    segmentIdx: index('idx_ipo_reviews_segment').on(table.segment),
    segmentYearPublishedIdx: index('idx_ipo_reviews_segment_year_published').on(
      table.segment,
      table.year,
      table.publishedDate
    ),
    approvedIdx: index('idx_ipo_reviews_approved').on(table.isApproved, table.ipoId),
  })
);

// ==================== TABLE 14: IPO_SCORES (One-to-One) ====================

export const ipoScores = pgTable('ipo_scores', {
  id: uuid('id').primaryKey().defaultRandom(),
  ipoId: uuid('ipo_id')
    .notNull()
    .unique()
    .references(() => ipos.id, { onDelete: 'cascade' }),

  // Score components (each 0-25, total 0-100)
  totalScore: integer('total_score').notNull(), // 0-100
  fundamentalScore: integer('fundamental_score').notNull(), // 0-25
  sentimentScore: integer('sentiment_score').notNull(), // 0-25
  subscriptionScore: integer('subscription_score').notNull(), // 0-25
  sectorScore: integer('sector_score').notNull(), // 0-25

  // Verdict and confidence
  verdict: ipoVerdictEnum('verdict').notNull(),
  confidence: confidenceLevelEnum('confidence').notNull(),
  reasoning: text('reasoning'),

  // Metadata
  calculatedAt: timestamp('calculated_at').defaultNow().notNull(),
  algorithmVersion: varchar('algorithm_version', { length: 50 }).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// ==================== TABLE 16: IPO_DETAILS (One-to-One) ====================

export const ipoDetails = pgTable(
  'ipo_details',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ipoId: uuid('ipo_id')
      .notNull()
      .unique()
      .references(() => ipos.id, { onDelete: 'cascade' }),

    // Issue structure fields (Story 4.11)
    issueType: issueTypeEnum('issue_type'),
    // in INR RUPEES (same convention as ipos.issue_size, which fresh+ofs sum to;
    // render via formatIssueSizeCrores). GitHub #8 — unit consistency.
    freshIssue: numeric('fresh_issue', { precision: 12, scale: 2 }),
    ofsIssue: numeric('ofs_issue', { precision: 12, scale: 2 }),
    cutOffPrice: numeric('cut_off_price', { precision: 10, scale: 2 }),
    minInvestment: numeric('min_investment', { precision: 12, scale: 2 }),
    registrarLink: varchar('registrar_link', { length: 500 }),

    // Other fields
    isin: varchar('isin', { length: 12 }),
    faceValue: numeric('face_value', { precision: 10, scale: 2 }),
    basisOfAllotmentDate: date('basis_of_allotment_date'),
    initiationOfRefundsDate: date('initiation_of_refunds_date'),
    creditOfSharesDate: date('credit_of_shares_date'),
    leadManagers: text('lead_managers').array(),
    exchanges: text('exchanges').array(),
    companyDescription: text('company_description'),
    dataSource: varchar('data_source', { length: 50 }).notNull(),
    lastVerifiedAt: timestamp('last_verified_at'),

    // Company Contact Information (Story 11.14)
    companyAddress: text('company_address'),
    companyPhone: varchar('company_phone', { length: 50 }),
    companyEmail: varchar('company_email', { length: 255 }),
    companyCity: varchar('company_city', { length: 100 }),
    companyState: varchar('company_state', { length: 100 }),
    companyPincode: varchar('company_pincode', { length: 10 }),
    complianceOfficer: varchar('compliance_officer', { length: 255 }),
    complianceOfficerPhone: varchar('compliance_officer_phone', { length: 50 }),
    complianceOfficerEmail: varchar('compliance_officer_email', { length: 255 }),

    // Category Reservation (Story 11.15)
    qibSharesOffered: bigint('qib_shares_offered', { mode: 'number' }),
    niiSharesOffered: bigint('nii_shares_offered', { mode: 'number' }),
    retailSharesOffered: bigint('retail_shares_offered', { mode: 'number' }),
    retailMaxAllottees: integer('retail_max_allottees'),
    employeeSharesOffered: bigint('employee_shares_offered', { mode: 'number' }),
    anchorSharesOffered: bigint('anchor_shares_offered', { mode: 'number' }),

    // NEW NSE FIELDS - Phase 1 (High Priority)
    upiCutoffTime: varchar('upi_cutoff_time', { length: 50 }), // "5:00 PM on last day"
    maxRetailSubscription: numeric('max_retail_subscription', { precision: 12, scale: 2 }), // 200000.00
    maxEmployeeSubscription: numeric('max_employee_subscription', { precision: 12, scale: 2 }), // 500000.00
    employeeDiscount: numeric('employee_discount', { precision: 10, scale: 2 }), // 69.00
    sponsorBanks: text('sponsor_banks').array(), // ["ICICI Bank", "Kotak Mahindra Bank"]

    // NEW NSE FIELDS - Phase 2 (Medium Priority)
    tickSize: numeric('tick_size', { precision: 10, scale: 2 }), // 1.00
    ipoMarketTimings: varchar('ipo_market_timings', { length: 50 }), // "10:00 AM - 5:00 PM"
    categoryDetails: jsonb('category_details'), // Category codes object
    subCategoriesUPI: text('sub_categories_upi').array(), // ["IND", "EMP"]

    // NEW NSE FIELDS - Phase 3 (Low Priority)
    remarks: text('remarks'), // IPO-specific notices
    eFormLink: varchar('e_form_link', { length: 500 }),
    scsbBranchesLink: varchar('scsb_branches_link', { length: 500 }),
    graphLogicPdfLink: varchar('graph_logic_pdf_link', { length: 500 }),

    // Educational resources
    videoLinkUPI: varchar('video_link_upi', { length: 500 }),
    videoLinkBHIM: varchar('video_link_bhim', { length: 500 }),
    mobileAppsUPILink: varchar('mobile_apps_upi_link', { length: 500 }),

    // T-428 WP C-1: price-band-ad fields (docs/reviews/price-band-ad-field-inventory.md).
    // designatedExchange stays a plain varchar (not an enum) — the DoD did not specify
    // an enum for it and the ad copy is free text (e.g. "BSE" vs "BSE Limited").
    designatedExchange: varchar('designated_exchange', { length: 10 }),
    lotMultiple: integer('lot_multiple'),
    allocationPct: jsonb('allocation_pct'),
    preIpoPlacement: boolean('pre_ipo_placement'),

    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => ({
    ipoIdIdx: index('idx_ipo_details_ipo_id').on(table.ipoId),
    dataSourceIdx: index('idx_ipo_details_data_source').on(table.dataSource),
    isinIdx: index('idx_ipo_details_isin').on(table.isin),

    // NOTE: Timeline date validation is enforced at the application level
    // (in seed script, repositories, and scrapers) rather than database constraints.
    // PostgreSQL doesn't support CHECK constraints with subqueries referencing other tables.
    //
    // Business Rules:
    //   - Timeline dates must be >= close_date
    //   - Timeline dates must be <= close_date + 30 days
    //   - Standard: basis (+2d), refunds (+4d), credit (+6d) after close_date
    //
    // Implementation:
    //   - Utility: web/lib/validation/timeline-dates.ts
    //   - Documentation: docs/16-database/TIMELINE_DATE_BUSINESS_RULES.md
    //   - Seed Script: web/scripts/seed-database.ts (lines 840-848)
  })
);

// ==================== TABLE 17: FIELD_PROTECTION_METADATA (Manual Data Management) ====================

export const fieldProtectionMetadata = pgTable(
  'field_protection_metadata',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tableName: varchar('table_name', { length: 100 }).notNull(),
    fieldName: varchar('field_name', { length: 100 }).notNull(),
    ipoId: uuid('ipo_id')
      .notNull()
      .references(() => ipos.id, { onDelete: 'cascade' }),

    // Protection flags
    isProtected: boolean('is_protected').default(false).notNull(),
    autoProtected: boolean('auto_protected').default(false).notNull(), // Auto-locked after manual edit
    isPermanent: boolean('is_permanent').default(false).notNull(), // Permanent protection (never auto-remove)

    // Manual edit tracking
    manuallyEditedAt: timestamp('manually_edited_at'),
    manuallyEditedBy: varchar('manually_edited_by', { length: 255 }),
    editNote: text('edit_note'), // Admin note explaining the edit

    // Metadata
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => ({
    ipoIdIdx: index('idx_field_protection_ipo_id').on(table.ipoId),
    tableNameIdx: index('idx_field_protection_table_name').on(table.tableName),
    isProtectedIdx: index('idx_field_protection_is_protected').on(table.isProtected),

    // Composite unique constraint: one protection record per (table + field + IPO)
    uniqueFieldPerIpo: unique('unique_field_per_ipo').on(
      table.tableName,
      table.fieldName,
      table.ipoId
    ),
  })
);

// ==================== TABLE 18: ADMIN_SETTINGS (Configuration) ====================

export const adminSettings = pgTable(
  'admin_settings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    settingKey: varchar('setting_key', { length: 100 }).notNull().unique(),
    settingValue: text('setting_value'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => ({
    settingKeyIdx: index('idx_admin_settings_key').on(table.settingKey),
  })
);

// ==================== TABLE 19: ANCHOR_INVESTORS (One-to-One) ====================

export const anchorInvestors = pgTable(
  'anchor_investors',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ipoId: uuid('ipo_id')
      .notNull()
      .references(() => ipos.id, { onDelete: 'cascade' }),
    bidDate: date('bid_date').notNull(),
    totalSharesOffered: bigint('total_shares_offered', { mode: 'number' }).notNull(),
    totalAmountRaised: numeric('total_amount_raised', { precision: 12, scale: 2 }).notNull(),
    anchorInvestorsCount: integer('anchor_investors_count').notNull(),
    lockIn50PercentDate: date('lock_in_50_percent_date').notNull(),
    lockInRemainingDate: date('lock_in_remaining_date').notNull(),
    investorList: jsonb('investor_list').$type<IndividualInvestor[]>(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => ({
    ipoIdIdx: index('idx_anchor_investors_ipo_id').on(table.ipoId),
    bidDateIdx: index('idx_anchor_investors_bid_date').on(table.bidDate),
  })
);

export interface IndividualInvestor {
  name: string;
  type: string; // e.g., "Mutual Fund", "FII", "Insurance"
  shares: number;
  amount: number; // in ₹ Crores
  percentOfIssue: number;
}

export interface IPOObjective {
  sno: number;                  // Serial number (1, 2, 3...)
  description: string;          // Objective description
  amount: number | null;        // Amount in crores (null for unallocated)
}

// ==================== TABLE 20: AUDIT_LOGS ====================
// Activity audit log for admin actions (immutable)

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    // Timestamp
    timestamp: timestamp('timestamp').defaultNow().notNull(),

    // Admin identity
    adminUser: varchar('admin_user', { length: 255 }).notNull(),

    // Action information
    actionType: varchar('action_type', { length: 100 }).notNull(), // Field Updated, IPO Locked, Protection Enabled, etc.

    // Related IPO (nullable - some actions may not be IPO-specific)
    ipoId: uuid('ipo_id').references(() => ipos.id, { onDelete: 'set null' }),

    // Field-level information
    tableName: varchar('table_name', { length: 100 }),
    fieldName: varchar('field_name', { length: 100 }),
    oldValue: text('old_value'),
    newValue: text('new_value'),

    // Additional context
    details: jsonb('details'), // Structured data about the action

    // Request metadata
    ipAddress: varchar('ip_address', { length: 45 }), // IPv4 max 15, IPv6 max 45
    userAgent: text('user_agent'),

    // Execution status
    success: boolean('success').default(true).notNull(),
    errorMessage: text('error_message'),

    // Created timestamp (immutable)
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    // Performance indexes for filtering
    timestampIdx: index('idx_audit_logs_timestamp').on(table.timestamp.desc()),
    adminUserIdx: index('idx_audit_logs_admin_user').on(table.adminUser),
    ipoIdIdx: index('idx_audit_logs_ipo_id').on(table.ipoId),
    actionTypeIdx: index('idx_audit_logs_action_type').on(table.actionType),

    // Composite index for common query patterns
    timestampAdminIdx: index('idx_audit_logs_timestamp_admin').on(
      table.timestamp.desc(),
      table.adminUser
    ),
  })
);

// ==================== TABLE 21: FIELD_SOURCES (Phase 0: Data Flow Architecture) ====================
// Tracks which scraper source provided each field value for audit trail

export const fieldSources = pgTable(
  'field_sources',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ipoId: uuid('ipo_id')
      .notNull()
      .references(() => ipos.id, { onDelete: 'cascade' }),
    tableName: varchar('table_name', { length: 100 }).notNull(), // e.g., 'ipos', 'financial_data'
    fieldName: varchar('field_name', { length: 100 }).notNull(), // e.g., 'issueSize', 'revenue_fy2024'

    // Source tracking
    source: scraperSourceEnum('source').notNull(), // ADMIN|DRHP|NSE|BSE|etc.
    confidence: integer('confidence').default(100).notNull(), // 0-100 (data quality score)

    // Change history
    previousValue: text('previous_value'), // Previous value (JSON stringified if needed)
    previousSource: scraperSourceEnum('previous_source'), // What source provided previous value

    // Data lineage (structured metadata)
    dataLineage: jsonb('data_lineage'), // {method: 'API'|'SCRAPE', endpoint: '/xyz', confidence: 95}

    // Timestamps
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
    updatedBy: varchar('updated_by', { length: 255 }), // Admin username or 'SYSTEM'
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    // Performance indexes
    ipoIdIdx: index('idx_field_sources_ipo_id').on(table.ipoId),
    tableNameIdx: index('idx_field_sources_table_name').on(table.tableName),
    fieldNameIdx: index('idx_field_sources_field_name').on(table.fieldName),
    sourceIdx: index('idx_field_sources_source').on(table.source),

    // Composite index for common queries
    ipoTableFieldIdx: index('idx_field_sources_ipo_table_field').on(
      table.ipoId,
      table.tableName,
      table.fieldName
    ),

    // Unique constraint: one source record per field per IPO
    uniqueFieldPerIpo: unique('unique_field_source_per_ipo').on(
      table.ipoId,
      table.tableName,
      table.fieldName
    ),
  })
);

// ==================== TABLE 22: DATA_CONFLICTS (Phase 0: Data Flow Architecture) ====================
// Logs detected conflicts between scraper sources for admin review

export const dataConflicts = pgTable(
  'data_conflicts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ipoId: uuid('ipo_id')
      .notNull()
      .references(() => ipos.id, { onDelete: 'cascade' }),
    tableName: varchar('table_name', { length: 100 }).notNull(),
    fieldName: varchar('field_name', { length: 100 }).notNull(),

    // Conflicting sources
    source1: scraperSourceEnum('source1').notNull(), // e.g., NSE
    value1: text('value1'), // Value from source1 (JSON stringified if needed)
    source2: scraperSourceEnum('source2').notNull(), // e.g., BSE
    value2: text('value2'), // Value from source2

    // Resolution
    resolvedSource: scraperSourceEnum('resolved_source'), // Which source won
    resolutionReason: varchar('resolution_reason', { length: 100 }), // SOURCE_PRIORITY|ADMIN_CHOICE|CONFIDENCE_SCORE
    severity: varchar('severity', { length: 20 }).default('INFO').notNull(), // INFO|WARNING|CRITICAL

    // Admin resolution
    adminNote: text('admin_note'), // Admin explanation for manual resolution
    resolvedAt: timestamp('resolved_at'),
    resolvedBy: varchar('resolved_by', { length: 255 }), // 'SYSTEM' or admin username

    // Timestamps
    detectedAt: timestamp('detected_at').defaultNow().notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    // Performance indexes
    ipoIdIdx: index('idx_data_conflicts_ipo_id').on(table.ipoId),
    fieldNameIdx: index('idx_data_conflicts_field_name').on(table.fieldName),
    severityIdx: index('idx_data_conflicts_severity').on(table.severity),
    detectedAtIdx: index('idx_data_conflicts_detected_at').on(table.detectedAt.desc()),

    // Unresolved conflicts index (most important query)
    unresolvedIdx: index('idx_data_conflicts_unresolved').on(table.resolvedAt)
      .where(isNull(table.resolvedAt)),

    // Composite index for conflict dashboard
    ipoUnresolvedIdx: index('idx_data_conflicts_ipo_unresolved').on(
      table.ipoId,
      table.resolvedAt
    ),
  })
);

// ==================== TABLE 23: IPO_SLUG_REDIRECTS (P3-1, T-278) ====================
// A permanent redirect from a retired IPO slug (name pollution cleanup, dedup merge,
// admin correction) to the IPO's current slug, so an old bookmarked/indexed URL 301s
// instead of 404ing. Looked up by the detail page BEFORE fuzzy fallback (SEO — no
// dead links). One old slug always maps to exactly one IPO; the IPO's live slug is
// read fresh from `ipos.slug` at request time so a redirect chain never goes stale
// if the target is renamed again later.
export const ipoSlugRedirects = pgTable(
  'ipo_slug_redirects',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    oldSlug: varchar('old_slug', { length: 255 }).notNull().unique(),
    ipoId: uuid('ipo_id')
      .notNull()
      .references(() => ipos.id, { onDelete: 'cascade' }),
    reason: varchar('reason', { length: 100 }), // e.g. 'NAME_POLLUTION_CLEANUP', 'DUPLICATE_MERGE'
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    oldSlugIdx: index('idx_ipo_slug_redirects_old_slug').on(table.oldSlug),
    ipoIdIdx: index('idx_ipo_slug_redirects_ipo_id').on(table.ipoId),
  })
);

// ==================== RELATIONS ====================

export const iposRelations = relations(ipos, ({ many, one }) => ({
  subscriptions: many(subscriptions),
  gmpRecords: many(gmpRecords),
  documents: many(documents),
  peerCompanies: many(peerCompanies),
  ipoReviews: many(ipoReviews),
  fieldProtections: many(fieldProtectionMetadata),
  fieldSources: many(fieldSources),
  dataConflicts: many(dataConflicts),
  ipoDemandGraph: many(ipoDemandGraph),
  financialData: one(financialData, {
    fields: [ipos.id],
    references: [financialData.ipoId],
  }),
  ipoFinancials: one(ipoFinancials, {
    fields: [ipos.id],
    references: [ipoFinancials.ipoId],
  }),
  listingPerformance: one(listingPerformance, {
    fields: [ipos.id],
    references: [listingPerformance.ipoId],
  }),
  ipoScore: one(ipoScores, {
    fields: [ipos.id],
    references: [ipoScores.ipoId],
  }),
  ipoDetails: one(ipoDetails, {
    fields: [ipos.id],
    references: [ipoDetails.ipoId],
  }),
  anchorInvestor: one(anchorInvestors, {
    fields: [ipos.id],
    references: [anchorInvestors.ipoId],
  }),
  registrarRelation: one(registrars, {
    fields: [ipos.registrarId],
    references: [registrars.id],
  }),
}));

export const subscriptionsRelations = relations(subscriptions, ({ one }) => ({
  ipo: one(ipos, {
    fields: [subscriptions.ipoId],
    references: [ipos.id],
  }),
}));

export const ipoDemandGraphRelations = relations(ipoDemandGraph, ({ one }) => ({
  ipo: one(ipos, {
    fields: [ipoDemandGraph.ipoId],
    references: [ipos.id],
  }),
}));

export const gmpRecordsRelations = relations(gmpRecords, ({ one }) => ({
  ipo: one(ipos, {
    fields: [gmpRecords.ipoId],
    references: [ipos.id],
  }),
}));

export const financialDataRelations = relations(financialData, ({ one }) => ({
  ipo: one(ipos, {
    fields: [financialData.ipoId],
    references: [ipos.id],
  }),
}));

export const documentsRelations = relations(documents, ({ one }) => ({
  ipo: one(ipos, {
    fields: [documents.ipoId],
    references: [ipos.id],
  }),
}));

export const listingPerformanceRelations = relations(
  listingPerformance,
  ({ one }) => ({
    ipo: one(ipos, {
      fields: [listingPerformance.ipoId],
      references: [ipos.id],
    }),
  })
);

export const peerCompaniesRelations = relations(peerCompanies, ({ one }) => ({
  ipo: one(ipos, {
    fields: [peerCompanies.ipoId],
    references: [ipos.id],
  }),
}));

export const affiliateClicksRelations = relations(affiliateClicks, ({ one }) => ({
  ipo: one(ipos, {
    fields: [affiliateClicks.ipoId],
    references: [ipos.id],
  }),
}));

export const ipoReviewsRelations = relations(ipoReviews, ({ one }) => ({
  ipo: one(ipos, {
    fields: [ipoReviews.ipoId],
    references: [ipos.id],
  }),
}));

export const ipoScoresRelations = relations(ipoScores, ({ one }) => ({
  ipo: one(ipos, {
    fields: [ipoScores.ipoId],
    references: [ipos.id],
  }),
}));

export const ipoFinancialsRelations = relations(ipoFinancials, ({ one }) => ({
  ipo: one(ipos, {
    fields: [ipoFinancials.ipoId],
    references: [ipos.id],
  }),
}));

export const ipoDetailsRelations = relations(ipoDetails, ({ one }) => ({
  ipo: one(ipos, {
    fields: [ipoDetails.ipoId],
    references: [ipos.id],
  }),
}));

export const fieldProtectionMetadataRelations = relations(
  fieldProtectionMetadata,
  ({ one }) => ({
    ipo: one(ipos, {
      fields: [fieldProtectionMetadata.ipoId],
      references: [ipos.id],
    }),
  })
);

export const anchorInvestorsRelations = relations(anchorInvestors, ({ one }) => ({
  ipo: one(ipos, {
    fields: [anchorInvestors.ipoId],
    references: [ipos.id],
  }),
}));

export const auditLogsRelations = relations(auditLogs, ({ one }) => ({
  ipo: one(ipos, {
    fields: [auditLogs.ipoId],
    references: [ipos.id],
  }),
}));

export const fieldSourcesRelations = relations(fieldSources, ({ one }) => ({
  ipo: one(ipos, {
    fields: [fieldSources.ipoId],
    references: [ipos.id],
  }),
}));

export const ipoSlugRedirectsRelations = relations(ipoSlugRedirects, ({ one }) => ({
  ipo: one(ipos, {
    fields: [ipoSlugRedirects.ipoId],
    references: [ipos.id],
  }),
}));

export const dataConflictsRelations = relations(dataConflicts, ({ one }) => ({
  ipo: one(ipos, {
    fields: [dataConflicts.ipoId],
    references: [ipos.id],
  }),
}));

// ==================== T-428 WP C-1: filing-field tables ====================
// Source: docs/reviews/wp-c-extraction-contract.md section 4,
// docs/reviews/price-band-ad-field-inventory.md "Schema changes this implies".
// Write target for WP C (extraction happens in WP C-2, persistence wiring in WP
// C-3 behind ENABLE_FILING_EXTRACTION, default OFF) -- nothing writes here yet.
// Existing financial_data FY2022-2024 columns stay untouched (gated drop later).

export const financialStatements = pgTable(
  'financial_statements',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ipoId: uuid('ipo_id')
      .notNull()
      .references(() => ipos.id, { onDelete: 'cascade' }),
    fiscalYear: integer('fiscal_year').notNull(),
    basis: financialStatementBasisEnum('basis').notNull(),
    unit: financialUnitEnum('unit').notNull(),
    revenue: numeric('revenue', { precision: 18, scale: 2 }),
    totalIncome: numeric('total_income', { precision: 18, scale: 2 }),
    ebitda: numeric('ebitda', { precision: 18, scale: 2 }),
    pat: numeric('pat', { precision: 18, scale: 2 }),
    netWorth: numeric('net_worth', { precision: 18, scale: 2 }),
    epsBasic: numeric('eps_basic', { precision: 18, scale: 2 }),
    epsDiluted: numeric('eps_diluted', { precision: 18, scale: 2 }),
    opCashFlow: numeric('op_cash_flow', { precision: 18, scale: 2 }),
    dscr: numeric('dscr', { precision: 18, scale: 2 }),
    rentExpense: numeric('rent_expense', { precision: 18, scale: 2 }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => ({
    ipoIdIdx: index('idx_financial_statements_ipo_id').on(table.ipoId),
    uniqueIpoFyBasis: unique('unique_financial_statements_ipo_fy_basis').on(
      table.ipoId,
      table.fiscalYear,
      table.basis
    ),
  })
);

export const financialStatementsRelations = relations(financialStatements, ({ one }) => ({
  ipo: one(ipos, {
    fields: [financialStatements.ipoId],
    references: [ipos.id],
  }),
}));

export const ipoValuation = pgTable(
  'ipo_valuation',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ipoId: uuid('ipo_id')
      .notNull()
      .references(() => ipos.id, { onDelete: 'cascade' }),
    pricingEvent: pricingEventEnum('pricing_event').notNull(),
    priceFloor: numeric('price_floor', { precision: 18, scale: 2 }),
    priceCap: numeric('price_cap', { precision: 18, scale: 2 }),
    sharesAtFloor: bigint('shares_at_floor', { mode: 'number' }), // share count -- never numeric; round-7 class
    sharesAtCap: bigint('shares_at_cap', { mode: 'number' }), // share count -- never numeric; round-7 class
    mcapAtFloor: numeric('mcap_at_floor', { precision: 18, scale: 2 }),
    mcapAtCap: numeric('mcap_at_cap', { precision: 18, scale: 2 }),
    peAtFloor: numeric('pe_at_floor', { precision: 18, scale: 2 }),
    peAtCap: numeric('pe_at_cap', { precision: 18, scale: 2 }),
    peNotAscertainableReason: text('pe_not_ascertainable_reason'),
    ronwWeighted3y: numeric('ronw_weighted_3y', { precision: 18, scale: 2 }),
    faceValueMultipleFloor: numeric('face_value_multiple_floor', { precision: 18, scale: 2 }),
    faceValueMultipleCap: numeric('face_value_multiple_cap', { precision: 18, scale: 2 }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => ({
    ipoIdIdx: index('idx_ipo_valuation_ipo_id').on(table.ipoId),
    uniqueIpoPricingEvent: unique('unique_ipo_valuation_ipo_pricing_event').on(
      table.ipoId,
      table.pricingEvent
    ),
  })
);

export const ipoValuationRelations = relations(ipoValuation, ({ one }) => ({
  ipo: one(ipos, {
    fields: [ipoValuation.ipoId],
    references: [ipos.id],
  }),
}));

export const promoters = pgTable(
  'promoters',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ipoId: uuid('ipo_id')
      .notNull()
      .references(() => ipos.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 255 }).notNull(),
    sharesHeld: bigint('shares_held', { mode: 'number' }),
    waca: numeric('waca', { precision: 18, scale: 2 }),
    wacaLastYear: numeric('waca_last_year', { precision: 18, scale: 2 }),
    isPromoterGroup: boolean('is_promoter_group').default(false).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => ({
    ipoIdIdx: index('idx_promoters_ipo_id').on(table.ipoId),
  })
);

export const promotersRelations = relations(promoters, ({ one }) => ({
  ipo: one(ipos, {
    fields: [promoters.ipoId],
    references: [ipos.id],
  }),
}));

export const promoterAcquisitionRanges = pgTable(
  'promoter_acquisition_ranges',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ipoId: uuid('ipo_id')
      .notNull()
      .references(() => ipos.id, { onDelete: 'cascade' }),
    period: acquisitionPeriodEnum('period').notNull(),
    waca: numeric('waca', { precision: 18, scale: 2 }),
    capMultiple: numeric('cap_multiple', { precision: 18, scale: 2 }),
    priceLow: numeric('price_low', { precision: 18, scale: 2 }),
    priceHigh: numeric('price_high', { precision: 18, scale: 2 }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => ({
    ipoIdIdx: index('idx_promoter_acquisition_ranges_ipo_id').on(table.ipoId),
  })
);

export const promoterAcquisitionRangesRelations = relations(
  promoterAcquisitionRanges,
  ({ one }) => ({
    ipo: one(ipos, {
      fields: [promoterAcquisitionRanges.ipoId],
      references: [ipos.id],
    }),
  })
);

export const ipoIntermediaries = pgTable(
  'ipo_intermediaries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ipoId: uuid('ipo_id')
      .notNull()
      .references(() => ipos.id, { onDelete: 'cascade' }),
    role: intermediaryRoleEnum('role').notNull(),
    name: varchar('name', { length: 255 }).notNull(),
    sebiRegNo: varchar('sebi_reg_no', { length: 50 }),
    contactPerson: varchar('contact_person', { length: 255 }),
    phone: varchar('phone', { length: 50 }),
    email: varchar('email', { length: 255 }),
    grievanceEmail: varchar('grievance_email', { length: 255 }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => ({
    ipoIdIdx: index('idx_ipo_intermediaries_ipo_id').on(table.ipoId),
    ipoIdRoleIdx: index('idx_ipo_intermediaries_ipo_id_role').on(table.ipoId, table.role),
  })
);

export const ipoIntermediariesRelations = relations(ipoIntermediaries, ({ one }) => ({
  ipo: one(ipos, {
    fields: [ipoIntermediaries.ipoId],
    references: [ipos.id],
  }),
}));

export const brlmTrackRecord = pgTable(
  'brlm_track_record',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    brlmName: varchar('brlm_name', { length: 255 }).notNull(),
    asOfDate: date('as_of_date').notNull(),
    issues3y: integer('issues_3y'),
    closedBelowIssuePrice: integer('closed_below_issue_price'),
    // Provenance FK: which IPO's filing this track-record row was read off of.
    // The same BRLM track record repeats across every ad it appears in -- this
    // is the ipo_id FK + index every new row-table gets, per the DoD.
    sourceIpoId: uuid('source_ipo_id')
      .notNull()
      .references(() => ipos.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => ({
    sourceIpoIdIdx: index('idx_brlm_track_record_source_ipo_id').on(table.sourceIpoId),
    brlmNameIdx: index('idx_brlm_track_record_brlm_name').on(table.brlmName),
    // T-431 (T-428 review carry-over): the repository's upsert was check-then-write,
    // so two concurrent filing extractions reading the same BRLM's table both saw
    // "absent" and both inserted. This unique makes the upsert atomic via
    // onConflictDoUpdate. The key includes sourceIpoId on purpose: the same BRLM's
    // track record legitimately appears in many ads on the same as-of date, and each
    // filing keeps its own provenance row rather than overwriting another filing's.
    uniqueNameDateSource: unique('unique_brlm_track_record_name_date_source').on(
      table.brlmName,
      table.asOfDate,
      table.sourceIpoId
    ),
  })
);

export const brlmTrackRecordRelations = relations(brlmTrackRecord, ({ one }) => ({
  sourceIpo: one(ipos, {
    fields: [brlmTrackRecord.sourceIpoId],
    references: [ipos.id],
  }),
}));

export const ipoRiskFactors = pgTable(
  'ipo_risk_factors',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ipoId: uuid('ipo_id')
      .notNull()
      .references(() => ipos.id, { onDelete: 'cascade' }),
    seq: integer('seq').notNull(),
    heading: varchar('heading', { length: 500 }).notNull(),
    body: text('body'),
    kpis: jsonb('kpis'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => ({
    ipoIdIdx: index('idx_ipo_risk_factors_ipo_id').on(table.ipoId),
    uniqueIpoSeq: unique('unique_ipo_risk_factors_ipo_seq').on(table.ipoId, table.seq),
  })
);

export const ipoRiskFactorsRelations = relations(ipoRiskFactors, ({ one }) => ({
  ipo: one(ipos, {
    fields: [ipoRiskFactors.ipoId],
    references: [ipos.id],
  }),
}));
