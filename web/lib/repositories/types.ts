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
  documents,
  listingPerformance,
  peerCompanies,
  marketHolidays,
  registrars,
  brokerAffiliates,
} from '../db/schema';

// ==================== ENTITY TYPES ====================

export type IPO = InferSelectModel<typeof ipos>;
export type IPOInsert = InferInsertModel<typeof ipos>;

export type Subscription = InferSelectModel<typeof subscriptions>;
export type SubscriptionInsert = InferInsertModel<typeof subscriptions>;

export type GMPRecord = InferSelectModel<typeof gmpRecords>;
export type GMPRecordInsert = InferInsertModel<typeof gmpRecords>;

export type FinancialData = InferSelectModel<typeof financialData>;
export type FinancialDataInsert = InferInsertModel<typeof financialData>;

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
 */
export type IPOWithRelations = IPO & {
  financialData?: FinancialData | null;
  documents?: Document[];
  subscriptions?: Subscription[];
  gmpRecords?: GMPRecord[];
  listingPerformance?: ListingPerformance | null;
  peerCompanies?: PeerCompany[];
  registrarRelation?: Registrar | null;
};

// ==================== FILTER TYPES ====================

/**
 * Filters for IPO list queries
 */
export interface IPOFilters {
  status?: string | string[];
  category?: string | string[];
  sector?: string;
  search?: string;
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
