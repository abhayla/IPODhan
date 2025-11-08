/**
 * Feature Flags Configuration
 * Controls gradual rollout of Data Flow Architecture Fix features
 *
 * Usage:
 * - Set environment variables to enable features
 * - Use percentage rollout for gradual deployment
 */

// Load environment variables if not already loaded
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: join(__dirname, '..', '..', '.env') });

/**
 * Feature flag configuration
 * All flags default to false/0 for safety
 */
export const FEATURE_FLAGS = {
  // ==================== CORE FEATURES ====================

  /**
   * Enable field source tracking
   * When enabled, records which scraper provided each field value
   * Default: false (Phase 0 foundation)
   */
  ENABLE_SOURCE_TRACKING: process.env.ENABLE_SOURCE_TRACKING === 'true',

  /**
   * Enable conflict detection and logging
   * When enabled, logs conflicts between scrapers to database
   * Default: false (Phase 0 foundation)
   */
  ENABLE_CONFLICT_DETECTION: process.env.ENABLE_CONFLICT_DETECTION === 'true',

  /**
   * Enable data consolidation service
   * When enabled, uses smart merging with priority matrix
   * Default: false (Phase 1)
   */
  ENABLE_DATA_CONSOLIDATION: process.env.ENABLE_DATA_CONSOLIDATION === 'true',

  /**
   * Enable DRHP extraction pipeline
   * When enabled, automatically extracts financial data from DRHP PDFs
   * Default: false (Phase 2)
   */
  ENABLE_DRHP_EXTRACTION: process.env.ENABLE_DRHP_EXTRACTION === 'true',

  /**
   * Enable early IPO detection (SEBI monitoring)
   * When enabled, detects IPOs 30-60 days before opening
   * Default: false (Phase 3)
   */
  ENABLE_EARLY_DETECTION: process.env.ENABLE_EARLY_DETECTION === 'true',

  // ==================== ROLLOUT CONTROLS ====================

  /**
   * Percentage of IPOs to use source tracking (0-100)
   * Enables gradual rollout with hash-based distribution
   * Default: 0 (disabled)
   */
  SOURCE_TRACKING_PERCENTAGE: parseInt(process.env.SOURCE_TRACKING_PERCENTAGE || '0'),

  /**
   * Percentage of IPOs to use conflict detection (0-100)
   * Default: 0 (disabled)
   */
  CONFLICT_DETECTION_PERCENTAGE: parseInt(process.env.CONFLICT_DETECTION_PERCENTAGE || '0'),

  /**
   * Percentage of IPOs to use data consolidation (0-100)
   * Default: 0 (disabled)
   */
  CONSOLIDATION_PERCENTAGE: parseInt(process.env.CONSOLIDATION_PERCENTAGE || '0'),

  // ==================== TESTING & DEBUG ====================

  /**
   * Verbose logging for data flow operations
   * Default: false
   */
  DEBUG_DATA_FLOW: process.env.DEBUG_DATA_FLOW === 'true',

  /**
   * Specific scrapers to enable features for (comma-separated)
   * Example: 'NSE,BSE' - only enable for NSE and BSE scrapers
   * Default: empty (all scrapers)
   */
  ENABLED_SCRAPERS: (process.env.ENABLED_SCRAPERS || '').split(',').filter(Boolean),

  /**
   * Specific IPO IDs to enable features for (comma-separated)
   * Useful for targeted testing
   * Default: empty (all IPOs)
   */
  ENABLED_IPO_IDS: (process.env.ENABLED_IPO_IDS || '').split(',').filter(Boolean),

  // ==================== PERFORMANCE TUNING ====================

  /**
   * Maximum conflict logs per IPO per run
   * Prevents excessive logging for problematic IPOs
   * Default: 50
   */
  MAX_CONFLICTS_PER_IPO: parseInt(process.env.MAX_CONFLICTS_PER_IPO || '50'),

  /**
   * Batch size for bulk source tracking
   * Default: 100 fields per batch
   */
  SOURCE_TRACKING_BATCH_SIZE: parseInt(process.env.SOURCE_TRACKING_BATCH_SIZE || '100'),
};

/**
 * Check if feature should be used for a given IPO
 * Uses consistent hashing for percentage-based rollout
 */
export function shouldUseFeature(
  feature: keyof typeof FEATURE_FLAGS,
  ipoId?: string,
  scraperSource?: string
): boolean {
  const flag = FEATURE_FLAGS[feature];

  // Boolean flags
  if (typeof flag === 'boolean') {
    return flag;
  }

  // Percentage flags
  if (typeof flag === 'number' && ipoId && feature.includes('PERCENTAGE')) {
    // Use hash of IPO ID for consistent distribution
    const hash = simpleHash(ipoId);
    return (hash % 100) < flag;
  }

  // Array flags (scrapers, IPO IDs)
  if (Array.isArray(flag)) {
    if (scraperSource && flag.length > 0) {
      return flag.includes(scraperSource);
    }
    if (ipoId && flag.length > 0) {
      return flag.includes(ipoId);
    }
    // Empty array means all items
    return flag.length === 0;
  }

  return false;
}

/**
 * Simple hash function for consistent percentage-based rollout
 * Uses IPO ID to determine if feature should be enabled
 */
function simpleHash(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash);
}

/**
 * Get feature status summary (for logging/debugging)
 */
export function getFeatureStatus(): Record<string, boolean | number | string[]> {
  return {
    SOURCE_TRACKING: FEATURE_FLAGS.ENABLE_SOURCE_TRACKING,
    CONFLICT_DETECTION: FEATURE_FLAGS.ENABLE_CONFLICT_DETECTION,
    DATA_CONSOLIDATION: FEATURE_FLAGS.ENABLE_DATA_CONSOLIDATION,
    DRHP_EXTRACTION: FEATURE_FLAGS.ENABLE_DRHP_EXTRACTION,
    EARLY_DETECTION: FEATURE_FLAGS.ENABLE_EARLY_DETECTION,
    SOURCE_TRACKING_PCT: FEATURE_FLAGS.SOURCE_TRACKING_PERCENTAGE,
    CONFLICT_DETECTION_PCT: FEATURE_FLAGS.CONFLICT_DETECTION_PERCENTAGE,
    CONSOLIDATION_PCT: FEATURE_FLAGS.CONSOLIDATION_PERCENTAGE,
    DEBUG_MODE: FEATURE_FLAGS.DEBUG_DATA_FLOW,
    ENABLED_SCRAPERS: FEATURE_FLAGS.ENABLED_SCRAPERS,
  };
}

/**
 * Validate feature flag configuration
 * Throws error if invalid configuration detected
 */
export function validateFeatureFlags(): void {
  // Check percentage values are 0-100
  const percentageFlags = [
    'SOURCE_TRACKING_PERCENTAGE',
    'CONFLICT_DETECTION_PERCENTAGE',
    'CONSOLIDATION_PERCENTAGE',
  ] as const;

  for (const flag of percentageFlags) {
    const value = FEATURE_FLAGS[flag];
    if (value < 0 || value > 100) {
      throw new Error(`Feature flag ${flag} must be between 0 and 100, got ${value}`);
    }
  }

  // Warn if features enabled without corresponding percentage
  if (FEATURE_FLAGS.ENABLE_SOURCE_TRACKING && FEATURE_FLAGS.SOURCE_TRACKING_PERCENTAGE === 0) {
    console.warn('⚠️  SOURCE_TRACKING enabled but percentage is 0% - no IPOs will use it');
  }

  if (FEATURE_FLAGS.ENABLE_CONFLICT_DETECTION && FEATURE_FLAGS.CONFLICT_DETECTION_PERCENTAGE === 0) {
    console.warn('⚠️  CONFLICT_DETECTION enabled but percentage is 0% - no IPOs will use it');
  }

  if (FEATURE_FLAGS.ENABLE_DATA_CONSOLIDATION && FEATURE_FLAGS.CONSOLIDATION_PERCENTAGE === 0) {
    console.warn('⚠️  DATA_CONSOLIDATION enabled but percentage is 0% - no IPOs will use it');
  }
}

/**
 * Log feature flag status at startup
 */
export function logFeatureFlags(): void {
  console.log('\n📋 Data Flow Architecture - Feature Flags Status:');
  console.log('================================================');

  const status = getFeatureStatus();
  for (const [key, value] of Object.entries(status)) {
    const icon = value ? '✅' : '❌';
    if (Array.isArray(value)) {
      console.log(`${icon} ${key}: [${value.join(', ') || 'ALL'}]`);
    } else {
      console.log(`${icon} ${key}: ${value}`);
    }
  }

  console.log('================================================\n');

  // Validate configuration
  try {
    validateFeatureFlags();
  } catch (error) {
    console.error('❌ Feature flag validation failed:', error);
    throw error;
  }
}

// Export utility functions
export { simpleHash };
