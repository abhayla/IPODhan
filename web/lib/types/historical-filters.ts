/**
 * Historical IPO Filter State Types
 *
 * TypeScript interfaces for managing filter state in Historical IPOs page (Story 6.2)
 */

/**
 * Filter state interface for Historical IPOs page
 * Tracks all filter options, sort preferences, and pagination state
 */
export interface HistoricalFiltersState {
  /** Selected year filter ('All' or specific year) */
  year: string;

  /** Selected sector filter ('All' or specific sector) */
  sector: string;

  /** Listing performance filter */
  performance: 'All' | 'Positive' | 'Negative';

  /** Sort column */
  sort: 'listing_date' | 'listing_gain' | 'subscription';

  /** Sort order */
  sortOrder: 'ASC' | 'DESC';

  /** Search query for company name */
  searchQuery: string;

  /** Search query alias for compatibility */
  search?: string;

  /** Current page number */
  page: number;

  /** Items per page */
  limit: number;
}

/**
 * Default filter state
 */
export const defaultFiltersState: HistoricalFiltersState = {
  year: 'All',
  sector: 'All',
  performance: 'All',
  sort: 'listing_date',
  sortOrder: 'DESC',
  searchQuery: '',
  search: '',
  page: 1,
  limit: 20,
};

/**
 * Available year options for filtering
 */
export const YEAR_OPTIONS = ['All', '2020', '2021', '2022', '2023', '2024', '2025'] as const;

/**
 * Available sector options (common IPO sectors in India)
 */
export const SECTOR_OPTIONS = [
  'All',
  'Technology',
  'Finance',
  'Healthcare',
  'Consumer',
  'Industrial',
  'Pharma',
  'Retail',
  'Energy',
  'Real Estate',
  'Telecommunications',
] as const;

/**
 * Available performance filter options
 */
export const PERFORMANCE_OPTIONS = [
  { value: 'All', label: 'All Performance' },
  { value: 'Positive', label: 'Positive Gains' },
  { value: 'Negative', label: 'Negative Losses' },
] as const;

/**
 * Available sort options
 */
export const SORT_OPTIONS = [
  { value: 'listing_date', label: 'Listing Date' },
  { value: 'listing_gain', label: 'Listing Gain %' },
  { value: 'subscription', label: 'Subscription' },
] as const;
