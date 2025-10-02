/**
 * Core IPO Types for Web Application
 * These types mirror ipodhan-shared but are local to avoid workspace dependency issues during build
 */

// Core IPO Model
export interface IPO {
  id: string;
  symbol: string;
  companyName: string;
  issueSize: number;
  priceBand: {
    low: number;
    high: number;
  };
  lotSize: number;
  dates: {
    open: Date;
    close: Date;
    listing?: Date;
  };
  status: 'UPCOMING' | 'LIVE' | 'CLOSED' | 'LISTED';
  category: 'MAINBOARD' | 'SME';
  registrar?: string;
  exchange?: string;
  createdAt: Date;
  updatedAt: Date;
}

// IPO Score Model
export interface IPOScore {
  id: string;
  ipoId: string;
  totalScore: number;
  components: {
    fundamental: number;
    sentiment: number;
    subscription: number;
    sector: number;
  };
  verdict: 'APPLY' | 'CONSIDER' | 'SKIP';
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  reasoning: string;
  algorithmVersion: string;
  calculatedAt: Date;
}

// GMP History Model
export interface GMPHistory {
  id: string;
  ipoId: string;
  gmp: {
    absolute: number;
    percentage: number;
  };
  kostakRate?: number;
  source: 'IPOWATCH' | 'INVESTORGAIN' | 'CHITTORGARH';
  recordedAt: Date;
}

// Subscription Data Model
export interface SubscriptionData {
  id: string;
  ipoId: string;
  category: 'QIB' | 'NII' | 'RETAIL' | 'EMPLOYEE';
  subscription: {
    times: number;
    sharesOffered: bigint;
    sharesBid: bigint;
  };
  recordedAt: Date;
}

// Search Filters
export interface SearchFilters {
  status?: 'LIVE' | 'UPCOMING' | 'CLOSED' | null;
  category?: 'MAINBOARD' | 'SME' | null;
  scoreRange?: {
    min: number;
    max: number;
  };
  sector?: string;
  issueSize?: {
    min?: number;
    max?: number;
  };
  dateRange?: {
    start?: Date;
    end?: Date;
  };
}

// Search Result
export interface SearchResult {
  id: string;
  companyName: string;
  symbol: string;
  score: number;
  status: string;
  relevance?: number;
}

// Sort Options
export type SortOption = 'score' | 'closingDate' | 'gmp' | 'size' | 'relevance';

// IPO Filter Options
export interface IPOFilterOptions {
  scoreRanges: Array<{ label: string; min: number; max: number }>;
  categories: Array<{ label: string; value: 'MAINBOARD' | 'SME' | 'BOTH' }>;
  issueSizes: Array<{ label: string; min?: number; max?: number }>;
}

// Pagination
export interface PaginationParams {
  page: number;
  limit: number;
  total?: number;
}

// Verdict Display
export type VerdictDisplay = {
  label: 'Strong Buy' | 'Consider' | 'Risky' | 'Avoid';
  color: string;
  bgColor: string;
  borderColor: string;
};

// Score Range
export type ScoreRange = '70+' | '50-70' | '30-50' | '<30';

// Tab Type for homepage
export type TabType = {
  id: string;
  label: string;
  status?: 'LIVE' | 'UPCOMING' | 'CLOSED';
  count?: number;
};

// Frontend-specific Component Props
export interface IPOCardProps {
  ipo: IPO;
  score?: IPOScore;
  showSubscription?: boolean;
  onClick?: () => void;
}

export interface IPOListProps {
  ipos: IPO[];
  scores: Record<string, IPOScore>;
  loading: boolean;
  error: string | null;
}

export interface IPOFilterProps {
  filters: SearchFilters;
  onFilterChange: (filters: Partial<SearchFilters>) => void;
  onClearFilters: () => void;
}

export interface PaginationProps {
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}

// API Response Types
export interface GetIPOsResponse {
  data: IPO[];
  total: number;
  page: number;
  limit: number;
}

export interface GetIPOsParams {
  status?: 'LIVE' | 'UPCOMING' | 'CLOSED';
  category?: 'MAINBOARD' | 'SME';
  page?: number;
  limit?: number;
}

export interface GetGMPHistoryParams {
  days?: number;
}
