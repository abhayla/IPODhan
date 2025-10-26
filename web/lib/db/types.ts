import { InferSelectModel, InferInsertModel } from 'drizzle-orm';
import * as schema from '../../../packages/shared/src/db/schema';

// ==================== IPO TYPES ====================

export type IPO = InferSelectModel<typeof schema.ipos>;
export type NewIPO = InferInsertModel<typeof schema.ipos>;

// Default historical field values (Story 7.10, 4.7, 4.9) for test fixtures
export const DEFAULT_HISTORICAL_FIELDS = {
  symbol: null,
  isin: null,
  subscriptionRetail: null,
  subscriptionHni: null,
  subscriptionQib: null,
  subscriptionTotal: null,
  gmpPrice: null,
  gmpPercentageHistorical: null,
  gmpUpdatedAtHistorical: null,
  listingPriceHistorical: null,
  listingGainPercentage: null,
  listingGainAmount: null,
  listingDateHistorical: null,
  currentPrice: null,
  currentGainPercentage: null,
  currentGainAmount: null,
  currentPriceUpdatedAt: null,
  historicalDataSource: null,
  historicalDataScrapedAt: null,
} as const;

/**
 * Helper function to create test fixtures with historical fields
 * Story 7.10: Adds historical IPO performance fields as null by default
 */
export function mockIPO(data: Partial<IPO>): IPO {
  return {
    ...DEFAULT_HISTORICAL_FIELDS,
    ...data,
  } as IPO;
}

// ==================== SUBSCRIPTION TYPES ====================

export type Subscription = InferSelectModel<typeof schema.subscriptions>;
export type NewSubscription = InferInsertModel<typeof schema.subscriptions>;

// ==================== GMP RECORD TYPES ====================

export type GMPRecord = InferSelectModel<typeof schema.gmpRecords>;
export type NewGMPRecord = InferInsertModel<typeof schema.gmpRecords>;

// ==================== FINANCIAL DATA TYPES ====================

export type FinancialData = InferSelectModel<typeof schema.financialData>;
export type NewFinancialData = InferInsertModel<typeof schema.financialData>;

// ==================== IPO FINANCIALS TYPES (Story 4.10 - Enhanced) ====================

export type IpoFinancials = InferSelectModel<typeof schema.ipoFinancials>;
export type NewIpoFinancials = InferInsertModel<typeof schema.ipoFinancials>;

// ==================== IPO DETAILS TYPES (Story 4.11 - Issue Structure) ====================

export type IpoDetails = InferSelectModel<typeof schema.ipoDetails>;
export type NewIpoDetails = InferInsertModel<typeof schema.ipoDetails>;

// ==================== DOCUMENT TYPES ====================

export type Document = InferSelectModel<typeof schema.documents>;
export type NewDocument = InferInsertModel<typeof schema.documents>;

// ==================== LISTING PERFORMANCE TYPES ====================

export type ListingPerformance = InferSelectModel<typeof schema.listingPerformance>;
export type NewListingPerformance = InferInsertModel<typeof schema.listingPerformance>;

// ==================== MARKET HOLIDAY TYPES ====================

export type MarketHoliday = InferSelectModel<typeof schema.marketHolidays>;
export type NewMarketHoliday = InferInsertModel<typeof schema.marketHolidays>;

// ==================== REGISTRAR TYPES ====================

export type Registrar = InferSelectModel<typeof schema.registrars>;
export type NewRegistrar = InferInsertModel<typeof schema.registrars>;

// ==================== PEER COMPANY TYPES ====================

export type PeerCompany = InferSelectModel<typeof schema.peerCompanies>;
export type NewPeerCompany = InferInsertModel<typeof schema.peerCompanies>;

// ==================== BROKER AFFILIATE TYPES ====================

export type BrokerAffiliate = InferSelectModel<typeof schema.brokerAffiliates>;
export type NewBrokerAffiliate = InferInsertModel<typeof schema.brokerAffiliates>;

// ==================== SCRAPER LOG TYPES ====================

export type ScraperLog = InferSelectModel<typeof schema.scraperLogs>;
export type NewScraperLog = InferInsertModel<typeof schema.scraperLogs>;

// ==================== IPO SCORE TYPES (Story 4.7) ====================

export type IPOScore = InferSelectModel<typeof schema.ipoScores>;
export type NewIPOScore = InferInsertModel<typeof schema.ipoScores>;

// ==================== ANCHOR INVESTOR TYPES (Story 11.10) ====================

export type AnchorInvestor = InferSelectModel<typeof schema.anchorInvestors>;
export type NewAnchorInvestor = InferInsertModel<typeof schema.anchorInvestors>;

// ==================== ENUM TYPES ====================

export type IPOSegment = IPO['segment'];
export type IPOOfferingType = IPO['offeringType'];
export type IPOStatus = IPO['status'];
export type DocumentType = Document['type'];
export type Exchange = MarketHoliday['exchange'];
export type HolidayType = MarketHoliday['type'];
export type FinancialStatementType = NonNullable<PeerCompany['financialStatementType']>;
export type ScraperSource = 'NSE' | 'BSE' | 'API_FALLBACK';
export type ScraperStatus = 'SUCCESS' | 'FAILURE' | 'PARTIAL';
export type IPOVerdict = IPOScore['verdict'];
export type ConfidenceLevel = IPOScore['confidence'];

// ==================== API RESPONSE TYPES ====================

/**
 * IPO with peer financial data (for peer comparison)
 */
export type IPOPeer = IPO & {
  financialData: FinancialData | null;
};

/**
 * IPO Detail Response
 * Complete IPO data with all relations for detail page (Story 4.1, 4.7, 4.10, 4.11, 11.10)
 */
export interface IPODetailResponse {
  ipo: IPO & {
    registrarRelation?: Registrar | null;
  };
  financialData: FinancialData | null;
  ipoFinancials: IpoFinancials | null; // Story 4.10: Enhanced financial metrics
  ipoDetails: IpoDetails | null; // Story 4.11: Issue structure details
  documents: Document[];
  subscriptions: Subscription[];
  gmpRecords: GMPRecord[];
  listingPerformance: ListingPerformance | null;
  peerCompanies: PeerCompany[];
  peers: IPOPeer[];
  ipoScore: IPOScore | null; // Story 4.7
  anchorInvestor: AnchorInvestor | null; // Story 11.10: Anchor investor details
  metadata: {
    lastUpdated: string;
  };
}
