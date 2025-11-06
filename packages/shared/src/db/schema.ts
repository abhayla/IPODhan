import {
  pgTable,
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
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

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

// ==================== TABLE 1: IPOS (Core Entity) ====================

export const ipos = pgTable(
  'ipos',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyName: varchar('company_name', { length: 255 }).notNull(),
    slug: varchar('slug', { length: 255 }).notNull().unique(),
    symbol: varchar('symbol', { length: 20 }), // Stock ticker symbol (nullable - upcoming IPOs may not have symbols yet)
    isin: varchar('isin', { length: 12 }), // International Securities Identification Number (nullable)
    segment: segmentEnum('segment'), // Exchange segment (MAINBOARD | SME) - nullable for RIGHTS/InvITs/REITs
    offeringType: offeringTypeEnum('offering_type').notNull(), // Type of offering (IPO, RIGHTS, TENDER, etc.)
    sector: varchar('sector', { length: 100 }),
    issueSize: numeric('issue_size', { precision: 15, scale: 2 }), // in INR crores (max ₹999,999 crores = ₹9,999.99 billion)
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
    gmp: integer('gmp').notNull(), // grey market premium in INR
    expectedListingPrice: integer('expected_listing_price'),
    subjectRate: integer('subject_rate'), // subject/safalya rate
    kostakRate: integer('kostak_rate'), // kostak rate
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
    uploadedAt: timestamp('uploaded_at').defaultNow().notNull(),
    exchange: varchar('exchange', { length: 10 }), // 'NSE' | 'BSE' - source exchange
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => ({
    exchangeIdx: index('idx_documents_exchange').on(table.exchange),

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

// ==================== TABLE 6: LISTING_PERFORMANCE (One-to-One) ====================

export const listingPerformance = pgTable('listing_performance', {
  id: uuid('id').primaryKey().defaultRandom(),
  ipoId: uuid('ipo_id')
    .unique()
    .references(() => ipos.id, { onDelete: 'cascade' }),
  symbol: varchar('symbol', { length: 20 }),
  companyName: varchar('company_name', { length: 255 }),
  listingDate: date('listing_date'),
  listingPrice: integer('listing_price'),
  issuePrice: integer('issue_price'),
  listingGainPercent: numeric('listing_gain_percent', {
    precision: 5,
    scale: 2,
  }),
  currentPrice: integer('current_price'), // @deprecated Use currentPriceBSE or currentPriceNSE
  currentPriceBSE: integer('current_price_bse'),
  currentPriceNSE: integer('current_price_nse'),
  currentGainPercent: numeric('current_gain_percent', {
    precision: 5,
    scale: 2,
  }),
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

    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => ({
    ipoIdIdx: index('idx_ipo_details_ipo_id').on(table.ipoId),
    dataSourceIdx: index('idx_ipo_details_data_source').on(table.dataSource),
    isinIdx: index('idx_ipo_details_isin').on(table.isin),
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

// ==================== RELATIONS ====================

export const iposRelations = relations(ipos, ({ many, one }) => ({
  subscriptions: many(subscriptions),
  gmpRecords: many(gmpRecords),
  documents: many(documents),
  peerCompanies: many(peerCompanies),
  ipoReviews: many(ipoReviews),
  fieldProtections: many(fieldProtectionMetadata),
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
