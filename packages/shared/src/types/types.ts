import { InferSelectModel, InferInsertModel } from 'drizzle-orm';
import * as schema from '../db/schema.js';

// ==================== IPO TYPES ====================

export type IPO = InferSelectModel<typeof schema.ipos>;
export type NewIPO = InferInsertModel<typeof schema.ipos>;

// ==================== SUBSCRIPTION TYPES ====================

export type Subscription = InferSelectModel<typeof schema.subscriptions>;
export type NewSubscription = InferInsertModel<typeof schema.subscriptions>;

// ==================== GMP RECORD TYPES ====================

export type GMPRecord = InferSelectModel<typeof schema.gmpRecords>;
export type NewGMPRecord = InferInsertModel<typeof schema.gmpRecords>;

// ==================== FINANCIAL DATA TYPES ====================

export type FinancialData = InferSelectModel<typeof schema.financialData>;
export type NewFinancialData = InferInsertModel<typeof schema.financialData>;

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

// ==================== ENUM TYPES ====================

export type IPOCategory = IPO['category'];
export type IPOStatus = IPO['status'];
export type DocumentType = Document['type'];
export type Exchange = MarketHoliday['exchange'];
export type HolidayType = MarketHoliday['type'];
export type FinancialStatementType = NonNullable<PeerCompany['financialStatementType']>;
export type ScraperSource = 'NSE' | 'BSE' | 'MONEYCONTROL' | 'CHITTORGARH' | 'API_FALLBACK';
export type ScraperStatus = 'SUCCESS' | 'FAILURE' | 'PARTIAL';

// ==================== API RESPONSE TYPES ====================

/**
 * IPO with peer financial data (for peer comparison)
 */
export type IPOPeer = IPO & {
  financialData: FinancialData | null;
};

/**
 * IPO Detail Response
 * Complete IPO data with all relations for detail page (Story 4.1)
 */
export interface IPODetailResponse {
  ipo: IPO & {
    registrarRelation?: Registrar | null;
  };
  financialData: FinancialData | null;
  documents: Document[];
  subscriptions: Subscription[];
  gmpRecords: GMPRecord[];
  listingPerformance: ListingPerformance | null;
  peerCompanies: PeerCompany[];
  peers: IPOPeer[];
  metadata: {
    lastUpdated: string;
  };
}
