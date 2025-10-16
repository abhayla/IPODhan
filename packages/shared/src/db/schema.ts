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
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

// ==================== ENUMS ====================

export const ipoCategoryEnum = pgEnum('ipo_category', [
  'MAINBOARD',
  'SME',
  'RIGHTS',
  'NCD',
  'FPO',
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
  'ADDENDUM',
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
    category: ipoCategoryEnum('category').notNull(),
    sector: varchar('sector', { length: 100 }),
    issueSize: numeric('issue_size', { precision: 10, scale: 2 }), // in INR crores
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

    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => ({
    statusIdx: index('idx_ipos_status').on(table.status),
    slugIdx: index('idx_ipos_slug').on(table.slug),
    symbolIdx: index('idx_ipos_symbol').on(table.symbol), // Index for symbol search performance
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
  },
  (table) => ({
    ipoTimestampIdx: index('idx_subscriptions_ipo_timestamp').on(
      table.ipoId,
      table.timestamp
    ),
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
    title: varchar('title', { length: 255 }).notNull(),
    url: text('url').notNull().unique(), // file path or external URL - unique constraint added
    fileSize: bigint('file_size', { mode: 'number' }), // in bytes
    uploadedAt: timestamp('uploaded_at').defaultNow().notNull(),
    exchange: varchar('exchange', { length: 10 }), // 'NSE' | 'BSE' - source exchange
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => ({
    exchangeIdx: index('idx_documents_exchange').on(table.exchange),
  })
);

// ==================== TABLE 6: LISTING_PERFORMANCE (One-to-One) ====================

export const listingPerformance = pgTable('listing_performance', {
  id: uuid('id').primaryKey().defaultRandom(),
  ipoId: uuid('ipo_id')
    .notNull()
    .unique()
    .references(() => ipos.id, { onDelete: 'cascade' }),
  listingPrice: integer('listing_price').notNull(),
  issuePrice: integer('issue_price').notNull(),
  listingGainPercent: numeric('listing_gain_percent', {
    precision: 5,
    scale: 2,
  }).notNull(),
  currentPrice: integer('current_price'), // @deprecated Use currentPriceBSE or currentPriceNSE
  currentPriceBSE: integer('current_price_bse'),
  currentPriceNSE: integer('current_price_nse'),
  currentGainPercent: numeric('current_gain_percent', {
    precision: 5,
    scale: 2,
  }),
  lastUpdated: timestamp('last_updated').defaultNow().notNull(),
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

// ==================== TABLE 13: IPO_REVIEWS (One-to-Many) ====================

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
    category: ipoCategoryEnum('category').notNull(),
    reviewUrl: text('review_url'),
    reviewContent: text('review_content'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => ({
    ipoIdIdx: index('idx_ipo_reviews_ipo_id').on(table.ipoId),
    yearIdx: index('idx_ipo_reviews_year').on(table.year),
    categoryIdx: index('idx_ipo_reviews_category').on(table.category),
    categoryYearPublishedIdx: index('idx_ipo_reviews_category_year_published').on(
      table.category,
      table.year,
      table.publishedDate
    ),
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
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => ({
    ipoIdIdx: index('idx_ipo_details_ipo_id').on(table.ipoId),
    dataSourceIdx: index('idx_ipo_details_data_source').on(table.dataSource),
    isinIdx: index('idx_ipo_details_isin').on(table.isin),
  })
);

// ==================== RELATIONS ====================

export const iposRelations = relations(ipos, ({ many, one }) => ({
  subscriptions: many(subscriptions),
  gmpRecords: many(gmpRecords),
  documents: many(documents),
  peerCompanies: many(peerCompanies),
  ipoReviews: many(ipoReviews),
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
