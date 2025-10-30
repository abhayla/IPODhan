/**
 * Table Map Generator
 *
 * Dynamically generates table mappings for field protection system.
 * This ensures all tables are automatically included as they're added to the schema.
 */

import * as schema from '@ipodhan/shared/db/schema';

/**
 * Table categories for different handling strategies
 */
export enum TableCategory {
  ONE_TO_ONE = 'one-to-one',      // Direct IPO relationship (financial_data, listing_performance)
  TIME_SERIES = 'time-series',     // Multiple records over time (subscriptions, gmp_records)
  ONE_TO_MANY = 'one-to-many',     // Multiple related records (documents, peer_companies)
  REFERENCE = 'reference',         // Lookup tables (registrars, market_holidays)
  SYSTEM = 'system',               // System tables (audit_logs, field_protection_metadata)
}

/**
 * Table configuration metadata
 */
export interface TableConfig {
  table: any;                      // Drizzle table object
  category: TableCategory;         // How to handle updates
  ipoField?: string;              // Field that links to IPO (default: 'ipoId')
  timestampField?: string;         // For time-series tables
  editable: boolean;               // Whether fields can be edited
  requiresSpecialHandling?: boolean; // Custom update logic needed
}

/**
 * Complete table registry with metadata
 * This is the single source of truth for all tables in the system
 */
export const TABLE_REGISTRY: Record<string, TableConfig> = {
  // Core IPO table
  ipos: {
    table: schema.ipos,
    category: TableCategory.ONE_TO_ONE,
    editable: true,
  },

  // One-to-one relationships
  financial_data: {
    table: schema.financialData,
    category: TableCategory.ONE_TO_ONE,
    ipoField: 'ipoId',
    editable: true,
  },
  listing_performance: {
    table: schema.listingPerformance,
    category: TableCategory.ONE_TO_ONE,
    ipoField: 'ipoId',
    editable: true,
  },
  ipo_financials: {
    table: schema.ipoFinancials,
    category: TableCategory.ONE_TO_ONE,
    ipoField: 'ipoId',
    editable: true,
  },
  ipo_details: {
    table: schema.ipoDetails,
    category: TableCategory.ONE_TO_ONE,
    ipoField: 'ipoId',
    editable: true,
  },
  ipo_scores: {
    table: schema.ipoScores,
    category: TableCategory.ONE_TO_ONE,
    ipoField: 'ipoId',
    editable: true,
  },
  anchor_investors: {
    table: schema.anchorInvestors,
    category: TableCategory.ONE_TO_ONE,
    ipoField: 'ipoId',
    editable: true,
    requiresSpecialHandling: true, // JSONB fields
  },

  // Time-series tables
  subscriptions: {
    table: schema.subscriptions,
    category: TableCategory.TIME_SERIES,
    ipoField: 'ipoId',
    timestampField: 'timestamp',
    editable: true,
  },
  gmp_records: {
    table: schema.gmpRecords,
    category: TableCategory.TIME_SERIES,
    ipoField: 'ipoId',
    timestampField: 'timestamp',
    editable: true,
  },
  ipo_demand_graph: {
    table: schema.ipoDemandGraph,
    category: TableCategory.TIME_SERIES,
    ipoField: 'ipoId',
    timestampField: 'timestamp',
    editable: true,
  },

  // One-to-many relationships
  documents: {
    table: schema.documents,
    category: TableCategory.ONE_TO_MANY,
    ipoField: 'ipoId',
    editable: true,
  },
  peer_companies: {
    table: schema.peerCompanies,
    category: TableCategory.ONE_TO_MANY,
    ipoField: 'ipoId',
    editable: true,
  },
  ipo_reviews: {
    table: schema.ipoReviews,
    category: TableCategory.ONE_TO_MANY,
    ipoField: 'ipoId',
    editable: true,
  },

  // Reference tables (not IPO-specific)
  registrars: {
    table: schema.registrars,
    category: TableCategory.REFERENCE,
    editable: true,
  },
  market_holidays: {
    table: schema.marketHolidays,
    category: TableCategory.REFERENCE,
    editable: true,
  },
  broker_affiliates: {
    table: schema.brokerAffiliates,
    category: TableCategory.REFERENCE,
    editable: true,
  },

  // Tracking tables
  affiliate_clicks: {
    table: schema.affiliateClicks,
    category: TableCategory.REFERENCE,
    ipoField: 'ipoId',
    editable: false, // Read-only tracking
  },
  scraper_logs: {
    table: schema.scraperLogs,
    category: TableCategory.SYSTEM,
    editable: false, // Read-only logs
  },

  // System tables (not editable)
  field_protection_metadata: {
    table: schema.fieldProtectionMetadata,
    category: TableCategory.SYSTEM,
    editable: false,
  },
  admin_settings: {
    table: schema.adminSettings,
    category: TableCategory.SYSTEM,
    editable: false,
  },
  audit_logs: {
    table: schema.auditLogs,
    category: TableCategory.SYSTEM,
    editable: false,
  },
};

/**
 * Get table configuration by name
 */
export function getTableConfig(tableName: string): TableConfig | undefined {
  return TABLE_REGISTRY[tableName];
}

/**
 * Get all editable tables
 */
export function getEditableTables(): Record<string, TableConfig> {
  return Object.entries(TABLE_REGISTRY)
    .filter(([_, config]) => config.editable)
    .reduce((acc, [name, config]) => {
      acc[name] = config;
      return acc;
    }, {} as Record<string, TableConfig>);
}

/**
 * Get tables by category
 */
export function getTablesByCategory(category: TableCategory): Record<string, TableConfig> {
  return Object.entries(TABLE_REGISTRY)
    .filter(([_, config]) => config.category === category)
    .reduce((acc, [name, config]) => {
      acc[name] = config;
      return acc;
    }, {} as Record<string, TableConfig>);
}

/**
 * Get IPO-related tables (have ipoField)
 */
export function getIPORelatedTables(): Record<string, TableConfig> {
  return Object.entries(TABLE_REGISTRY)
    .filter(([_, config]) => config.ipoField || config.table === schema.ipos)
    .reduce((acc, [name, config]) => {
      acc[name] = config;
      return acc;
    }, {} as Record<string, TableConfig>);
}

/**
 * Generate simple table map for backward compatibility
 */
export function generateTableMap(): Record<string, any> {
  return Object.entries(TABLE_REGISTRY)
    .filter(([_, config]) => config.editable)
    .reduce((acc, [name, config]) => {
      // Use the original name from schema or the modified name
      const mappedName = name.replace(/_/g, '');
      if (mappedName !== name && config.table) {
        acc[name] = config.table;
      } else {
        acc[mappedName] = config.table;
      }
      return acc;
    }, {} as Record<string, any>);
}

/**
 * Check if a table supports field protection
 */
export function supportsFieldProtection(tableName: string): boolean {
  const config = getTableConfig(tableName);
  return config?.editable === true && config.category !== TableCategory.SYSTEM;
}

/**
 * Get statistics about table coverage
 */
export function getTableStatistics() {
  const total = Object.keys(TABLE_REGISTRY).length;
  const editable = Object.values(TABLE_REGISTRY).filter(c => c.editable).length;
  const ipoRelated = Object.values(TABLE_REGISTRY).filter(c => c.ipoField || c.table === schema.ipos).length;

  const byCategory = Object.values(TableCategory).reduce((acc, cat) => {
    acc[cat] = Object.values(TABLE_REGISTRY).filter(c => c.category === cat).length;
    return acc;
  }, {} as Record<string, number>);

  return {
    total,
    editable,
    nonEditable: total - editable,
    ipoRelated,
    byCategory,
    coverage: {
      percentage: Math.round((editable / total) * 100),
      protected: editable,
      unprotected: total - editable,
    },
  };
}