/**
 * IPO Comparison Type Definitions
 *
 * Defines TypeScript interfaces for IPO comparison functionality.
 * Used by comparison API endpoint and frontend components.
 */

import { z } from 'zod';

// ==================== COMPARISON INTERFACES ====================

/**
 * Single IPO comparison data with all metrics
 * Story 4.10: Added ipoFinancials for enhanced metrics
 */
export interface IPOComparison {
  slug: string;
  companyName: string;
  priceRange: {
    min: number;
    max: number;
  };
  lotSize: number;
  status: string;
  subscription: {
    qib: number | null;
    nii: number | null;
    retail: number | null;
    total: number | null;
  };
  gmp: number | null;
  financials: {
    peRatio: number | null;
    roe: number | null;
    revenueGrowth: number | null;
    eps: number | null;
  };
  // Story 4.10: Enhanced financial metrics from ipo_financials table
  ipoFinancials?: {
    pbRatio: number | null;
    rocePercentage: number | null;
    industryPe: number | null;
  } | null;
  rating: number | null;
  ratingRationale: string | null;
}

/**
 * API response for comparison endpoint
 */
export interface ComparisonResponse {
  comparisons: IPOComparison[];
  comparedAt: string;
}

// ==================== VALIDATION SCHEMAS ====================

/**
 * Slug format validation (lowercase, hyphen-separated)
 */
const slugSchema = z
  .string()
  .min(1, 'Slug cannot be empty')
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Invalid slug format. Must be lowercase and hyphen-separated');

/**
 * Request validation schema for comparison endpoint
 */
export const ComparisonRequestSchema = z.object({
  ipoSlugs: z
    .array(slugSchema)
    .min(2, 'At least 2 IPOs are required for comparison')
    .max(3, 'Maximum 3 IPOs can be compared'),
});

/**
 * Type inference from validation schema
 */
export type ComparisonRequest = z.infer<typeof ComparisonRequestSchema>;

// ==================== VALIDATION CONSTANTS ====================

/**
 * Valid IPO statuses for comparison
 */
export const VALID_COMPARISON_STATUSES = ['OPEN', 'UPCOMING', 'CLOSED'] as const;

/**
 * Comparison limits
 */
export const COMPARISON_LIMITS = {
  MIN_IPOS: 2,
  MAX_IPOS: 3,
} as const;
