/**
 * Repository Type Definitions
 *
 * Defines TypeScript interfaces and types for all repository operations.
 * Uses Drizzle ORM's InferSelectModel for type safety.
 */

import type { InferSelectModel, InferInsertModel } from 'drizzle-orm';
import type {
  ipos,
  subscriptions,
  gmpRecords,
  financialData,
  ipoFinancials,
  ipoDetails,
  documents,
  listingPerformance,
  peerCompanies,
  marketHolidays,
  registrars,
  brokerAffiliates,
  ipoScores,
} from '../db';
// Import IPO type and helper from db/types (Story 7.10, 4.7)
import type { IPO, NewIPO, IPOScore } from '../db/types';
import { DEFAULT_HISTORICAL_FIELDS, mockIPO } from '../db/types';

// ====================ENTITY TYPES ====================

export type { IPO };
export type IPOInsert = NewIPO;
export { DEFAULT_HISTORICAL_FIELDS, mockIPO };

export type Subscription = InferSelectModel<typeof subscriptions>;
export type SubscriptionInsert = InferInsertModel<typeof subscriptions>;

export type GMPRecord = InferSelectModel<typeof gmpRecords>;
export type GMPRecordInsert = InferInsertModel<typeof gmpRecords>;

export type FinancialData = InferSelectModel<typeof financialData>;
export type FinancialDataInsert = InferInsertModel<typeof financialData>;

export type IpoFinancials = InferSelectModel<typeof ipoFinancials>;
export type IpoFinancialsInsert = InferInsertModel<typeof ipoFinancials>;

export type IpoDetails = InferSelectModel<typeof ipoDetails>;
export type IpoDetailsInsert = InferInsertModel<typeof ipoDetails>;

export type Document = InferSelectModel<typeof documents>;
export type DocumentInsert = InferInsertModel<typeof documents>;

export type ListingPerformance = InferSelectModel<typeof listingPerformance>;
export type ListingPerformanceInsert = InferInsertModel<
  typeof listingPerformance
>;

export type PeerCompany = InferSelectModel<typeof peerCompanies>;
export type PeerCompanyInsert = InferInsertModel<typeof peerCompanies>;

export type MarketHoliday = InferSelectModel<typeof marketHolidays>;
export type MarketHolidayInsert = InferInsertModel<typeof marketHolidays>;

export type Registrar = InferSelectModel<typeof registrars>;
export type RegistrarInsert = InferInsertModel<typeof registrars>;

export type BrokerAffiliate = InferSelectModel<typeof brokerAffiliates>;
export type BrokerAffiliateInsert = InferInsertModel<typeof brokerAffiliates>;

// ==================== COMPOSITE TYPES ====================

/**
 * IPO with all related data (financials, documents, etc.)
 * Story 4.7: Added ipoScore
 * Story 4.10: Added ipoFinancials
 * Story 4.11: Added ipoDetails
 */
export type IPOWithRelations = IPO & {
  financialData?: FinancialData | null;
  ipoFinancials?: IpoFinancials | null;
  ipoDetails?: IpoDetails | null;
  documents?: Document[];
  subscriptions?: Subscription[];
  gmpRecords?: GMPRecord[];
  listingPerformance?: ListingPerformance | null;
  peerCompanies?: PeerCompany[];
  registrarRelation?: Registrar | null;
  ipoScore?: IPOScore | null;
};

// ==================== FILTER TYPES ====================

/**
 * Filters for IPO list queries
 * Story 4.7: Added scoreRange filter
 * Story 11.8: Replaced category with segment + offeringType
 */
export interface IPOFilters {
  status?: string | string[];
  segment?: string | string[];
  offeringType?: string | string[];
  sector?: string;
  search?: string;
  scoreRange?: string; // "0-25" | "26-50" | "51-75" | "76-100" | "all"
  minIssueSize?: number;
  maxIssueSize?: number;
  openDateFrom?: Date;
  openDateTo?: Date;
  closeDateFrom?: Date;
  closeDateTo?: Date;
  listingDateFrom?: Date;
  listingDateTo?: Date;
  page?: number;
  limit?: number;
  sortBy?: 'openDate' | 'closeDate' | 'listingDate' | 'issueSize' | 'createdAt';
  sortOrder?: 'asc' | 'desc';
}

/**
 * Filters for subscription history queries
 */
export interface SubscriptionFilters {
  ipoId: string;
  fromDate?: Date;
  toDate?: Date;
  limit?: number;
}

/**
 * Filters for GMP history queries
 */
export interface GMPFilters {
  ipoId: string;
  days?: number;
  fromDate?: Date;
  toDate?: Date;
  limit?: number;
}

// ==================== PAGINATION TYPES ====================

/**
 * Pagination parameters for queries
 */
export interface PaginationParams {
  page: number;
  limit: number;
}

/**
 * Pagination metadata
 */
export interface PaginationMeta {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
}

/**
 * Paginated response
 */
export interface PaginatedResponse<T> {
  data: T[];
  meta: PaginationMeta;
}

// ==================== REPOSITORY INTERFACES ====================

/**
 * IPO with peer financial data
 */
export type IPOPeer = IPO & {
  financialData?: FinancialData | null;
};

/**
 * IPO Repository Interface
 */
export interface IIPORepository {
  findAll(filters?: IPOFilters): Promise<PaginatedResponse<IPO>>;
  findBySlug(slug: string): Promise<IPOWithRelations | null>;
  findById(id: string): Promise<IPO | null>;
  search(query: string, limit?: number): Promise<IPO[]>;
  create(ipo: IPOInsert): Promise<IPO>;
  update(id: string, data: Partial<IPOInsert>): Promise<IPO>;
  delete(id: string): Promise<void>;
  findPeers(
    ipoId: string,
    sector: string | null,
    limit?: number
  ): Promise<IPOPeer[]>;
  findHistorical(
    filters: HistoricalIPOQueryParams
  ): Promise<PaginatedResponse<HistoricalIPO>>;
}

/**
 * Subscription Repository Interface
 */
export interface ISubscriptionRepository {
  findByIPO(filters: SubscriptionFilters): Promise<Subscription[]>;
  findLatest(ipoId: string): Promise<Subscription | null>;
  createSnapshot(data: SubscriptionInsert): Promise<Subscription>;
  deleteByIPO(ipoId: string): Promise<void>;
}

/**
 * GMP Repository Interface
 */
export interface IGMPRepository {
  findByIPO(filters: GMPFilters): Promise<GMPRecord[]>;
  findLatest(ipoId: string): Promise<GMPRecord | null>;
  create(data: GMPRecordInsert): Promise<GMPRecord>;
  deleteByIPO(ipoId: string): Promise<void>;
}

/**
 * Financial Data Repository Interface
 */
export interface IFinancialDataRepository {
  findByIPO(ipoId: string): Promise<FinancialData | null>;
  upsert(data: FinancialDataInsert): Promise<FinancialData>;
  delete(ipoId: string): Promise<void>;
}

/**
 * IPO Financials Repository Interface (Enhanced - Story 4.10)
 */
export interface IIpoFinancialsRepository {
  findByIPO(ipoId: string): Promise<IpoFinancials | null>;
  upsert(data: IpoFinancialsInsert): Promise<IpoFinancials>;
  delete(ipoId: string): Promise<void>;
}

/**
 * IPO Details Repository Interface (Story 4.11)
 */
export interface IIpoDetailsRepository {
  findByIPO(ipoId: string): Promise<IpoDetails | null>;
  upsert(data: IpoDetailsInsert): Promise<IpoDetails>;
  delete(ipoId: string): Promise<void>;
}

/**
 * Document Repository Interface
 */
export interface IDocumentRepository {
  findByIPO(ipoId: string): Promise<Document[]>;
  create(data: DocumentInsert): Promise<Document>;
  delete(id: string): Promise<void>;
  deleteByIPO(ipoId: string): Promise<void>;
}

/**
 * Listing Performance Repository Interface
 */
export interface IListingPerformanceRepository {
  findByIPO(ipoId: string): Promise<ListingPerformance | null>;
  upsert(data: ListingPerformanceInsert): Promise<ListingPerformance>;
  delete(ipoId: string): Promise<void>;
}

// ==================== HISTORICAL IPO TYPES ====================

/**
 * Historical IPO with computed fields
 * Extends IPO with listing performance and computed metrics
 */
export type HistoricalIPO = IPO & {
  listingOpen?: number | null;
  listingHigh?: number | null;
  listingClose?: number | null;
  issuePrice?: number | null;
  listingGainPercent?: number | null;
  subscriptionOverall?: number | null;
  year: number;
};

/**
 * Filters for historical IPO queries
 */
export interface HistoricalIPOQueryParams {
  year?: string;
  sector?: string;
  performance?: 'Positive' | 'Negative' | 'All';
  sort?: 'listing_date' | 'listing_gain' | 'subscription';
  sortOrder?: 'asc' | 'desc';
  search?: string; // Search by company name
  page?: number;
  limit?: number;
}

/**
 * Historical IPO API Response
 */
export interface HistoricalIPOResponse {
  data: HistoricalIPO[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    hasMore: boolean;
  };
}
