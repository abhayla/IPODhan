/**
 * Historical IPO Types
 *
 * TypeScript interfaces for the Historical IPOs API (Story 6.1)
 * Used for filtering, sorting, and displaying historical IPO performance data
 */

import { z } from 'zod';

// ==================== QUERY PARAMETERS ====================

/**
 * Query parameters for Historical IPOs API endpoint
 * Supports filtering by year, sector, performance and sorting
 */
export interface HistoricalIPOQueryParams {
  /** Filter by listing year (default: 'All') */
  year?: '2020' | '2021' | '2022' | '2023' | '2024' | '2025' | 'All';

  /** Filter by sector (default: 'All') */
  sector?: string;

  /** Filter by listing performance (default: 'All') */
  performance?: 'All' | 'Positive' | 'Negative';

  /** Sort field (default: 'listing_date') */
  sort?: 'listing_date' | 'listing_gain' | 'subscription';

  /** Sort order (default: 'DESC') */
  sortOrder?: 'ASC' | 'DESC';

  /** Page number for pagination (default: 1) */
  page?: number;

  /** Results per page (default: 20, max: 100) */
  limit?: number;
}

// ==================== VALIDATION SCHEMA ====================

/**
 * Zod schema for validating Historical IPO query parameters
 * Used in API route to ensure type-safe and validated inputs
 */
export const historicalIPOQuerySchema = z.object({
  year: z
    .enum(['2020', '2021', '2022', '2023', '2024', '2025', 'All'])
    .default('All'),
  sector: z.string().default('All'),
  performance: z.enum(['All', 'Positive', 'Negative']).default('All'),
  sort: z
    .enum(['listing_date', 'listing_gain', 'subscription'])
    .default('listing_date'),
  sortOrder: z.enum(['ASC', 'DESC']).default('DESC'),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

/**
 * Validated query parameters type (inferred from schema)
 */
export type ValidatedHistoricalIPOQueryParams = z.infer<
  typeof historicalIPOQuerySchema
>;

// ==================== RESPONSE TYPES ====================

/**
 * Historical IPO data with listing performance
 * Includes computed fields: listingGainPercent and year
 */
export interface HistoricalIPO {
  id: string;
  companyName: string;
  slug: string;
  status: 'LISTED';
  issuePrice: number;
  listingDate: Date;
  listingOpen: number;
  listingHigh: number;
  listingClose: number;

  /** Computed: ((listingClose - issuePrice) / issuePrice) * 100 */
  listingGainPercent: number;

  subscriptionOverall: number;
  sector: string;

  /** Computed: YEAR(listingDate) */
  year: number;
}

/**
 * Pagination metadata
 */
export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

/**
 * Historical IPOs API response format
 */
export interface HistoricalIPOResponse {
  data: {
    ipos: HistoricalIPO[];
    pagination: PaginationMeta;
  };
}

// ==================== REPOSITORY TYPES ====================

/**
 * Repository return type for findHistorical method
 */
export interface HistoricalIPORepositoryResult {
  ipos: HistoricalIPO[];
  total: number;
}
