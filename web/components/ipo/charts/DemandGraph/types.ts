/**
 * Type definitions for IPO Demand Graph component
 *
 * Displays price-wise demand distribution showing bid intensity across price buckets
 * Data sourced from ipo_demand_graph table
 */

import { exchangeEnum } from '@ipodhan/shared/db/schema';

/**
 * Raw demand data from database
 */
export interface IPODemandRecord {
  id: string;
  ipoId: string;
  timestamp: Date;
  pricePoint: number | null; // null for "Cut-Off" price
  isCutOff: boolean;
  cumulativeQuantity: number; // Total shares bid at this price and above
  exchange: typeof exchangeEnum.enumValues[number]; // 'NSE' | 'BSE' | 'BOTH'
  createdAt: Date;
}

/**
 * Processed demand data for chart visualization
 */
export interface DemandChartData {
  priceLabel: string; // "₹695" or "Cut-Off"
  pricePoint: number | null;
  cumulativeQuantity: number;
  demandIntensity: number; // Normalized 0-100 for visual scaling
  isCutOff: boolean;
  exchange: 'NSE' | 'BSE' | 'BOTH';
}

/**
 * Component props
 */
export interface DemandGraphProps {
  /**
   * Demand records from database
   */
  demandRecords: IPODemandRecord[];

  /**
   * Company name for chart title
   */
  companyName: string;

  /**
   * Price range max for context
   */
  priceRangeMax: number | null;

  /**
   * Default exchange filter
   * @default 'BOTH'
   */
  defaultExchange?: 'NSE' | 'BSE' | 'BOTH';

  /**
   * Whether to expand chart by default
   * @default false
   */
  defaultExpanded?: boolean;

  /**
   * Show advanced features (exchange filter, top N buckets filter)
   * @default true
   */
  showAdvanced?: boolean;
}

/**
 * Summary statistics for demand graph
 */
export interface DemandSummary {
  totalBuckets: number;
  maxDemand: number;
  cutOffDemand: number | null;
  mostDemandedPrice: number | null;
  avgDemandPerBucket: number;
}
