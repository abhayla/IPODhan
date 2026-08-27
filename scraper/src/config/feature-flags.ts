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

  /**
   * Enable normalized-company-name matching for InvestorGain GMP rows.
   * When enabled, GMP rows resolve to an IPO by normalized company name FIRST,
   * falling back to exact open/close-date matching. Lifts GMP coverage from the
   * few date-exact matches to all current IPOs (incl. symbol-less SME). (#6/#8)
   * Default: false
   */
  ENABLE_GMP_NAME_MATCH: process.env.ENABLE_GMP_NAME_MATCH === 'true',

  /**
   * Enable persisting Moneycontrol-scraped subscription %s into the
   * subscriptions table, matched by normalized company name (covers SME IPOs
   * that lack an NSE/BSE symbol). NSE/BSE symbol-based capture stays primary.
   * Default: false
   */
  ENABLE_MONEYCONTROL_SUBSCRIPTION: process.env.ENABLE_MONEYCONTROL_SUBSCRIPTION === 'true',

  /**
   * Enable the in-app scheduled InvestorGain GMP job (runs the GMP writer every
   * 6h so gmp_records stays fresh — the root-cause fix for frozen GMP coverage).
   * GATED OFF by default; activation in prod is Abhay's call (it must be paired
   * with retiring the external PM2 GMP run to avoid double-writes). (#6/#8)
   * Default: false
   */
  ENABLE_GMP_SCHEDULED_JOB: process.env.ENABLE_GMP_SCHEDULED_JOB === 'true',

  /**
   * Source the BSE IPO list+detail from BSE's JSON API (IPO_HomePageDetail/w +
   * GetMkt_ISSUE_BBS_IPO/w) instead of the broken Puppeteer/HTML scrapers (BSE
   * migrated to a SPA). Fills issue_size/lot/registrar/price-band/lead-managers.
   * GATED OFF by default; activation in prod is Abhay's call (deploy). (#enrich)
   * Default: false
   */
  ENABLE_BSE_API: process.env.ENABLE_BSE_API === 'true',

  /**
   * Enable the primary-source document discovery spine (Stage B of the
   * 2026-06-19 IPO-data-pipeline contract): discover the company's own filings
   * (RHP/DRHP/ADDENDUM/ANCHOR) from NSE/BSE/SEBI incl. SME boards, instead of
   * relying only on the Chittorgarh aggregator. Pure parsing core ships first;
   * live fetch + persistence + scheduler wiring land in the network session.
   * GATED OFF by default; activation in prod is Abhay's call (deploy/cron).
   * Default: false
   */
  ENABLE_PRIMARY_SOURCE_DISCOVERY: process.env.ENABLE_PRIMARY_SOURCE_DISCOVERY === 'true',

  /**
   * Enable the stage-transition reconciler (Stage F of the 2026-06-19 IPO-data-
   * pipeline contract): compute each IPO's lifecycle stage and enqueue only the
   * data fetches that are due-but-missing as it crosses DRHP→RHP→OPEN→CLOSED→LISTED,
   * instead of blindly running every scraper on a fixed timer. Pure planner core
   * (stage-reconciler.ts) ships first; the live query+enqueue+cron wiring is GATED
   * OFF and activated only on Abhay's §GATE (deploy/cron).
   * Default: false
   */
  ENABLE_STAGE_RECONCILER: process.env.ENABLE_STAGE_RECONCILER === 'true',

  /**
   * Enable the periodic duplicate-IPO sweep job (P2-2b, round-4 review, T-293):
   * re-runs `merge-duplicate-ipos.ts`'s two-tier clustering (exact-normalized-
   * name UNION Levenshtein-typo) every cycle so a duplicate pair that slips
   * past the create-time check converges instead of living in prod forever.
   * Job runs DRY-RUN (report/log only) at all times, regardless of this flag —
   * this flag only gates whether the job runs AT ALL on the cron schedule.
   * Actual merge/delete (`dryRun: false`) is never wired to the cron path in
   * this build; a separate, explicit activation is Abhay's call.
   * Default: false
   */
  ENABLE_DUPLICATE_SWEEP_JOB: process.env.ENABLE_DUPLICATE_SWEEP_JOB === 'true',

  // ==================== ROLLOUT CONTROLS ====================




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
    // T-339: source tracking, conflict detection and data consolidation are
    // no longer flags — they are MANDATORY and always on. They are reported
    // here as constant `true` so the startup snapshot in scraper-out.log
    // keeps the same shape for anything parsing it, and so a reader can see
    // at a glance that the pipeline cannot be running without them.
    SOURCE_TRACKING: true,
    CONFLICT_DETECTION: true,
    DATA_CONSOLIDATION: true,
    DRHP_EXTRACTION: FEATURE_FLAGS.ENABLE_DRHP_EXTRACTION,
    EARLY_DETECTION: FEATURE_FLAGS.ENABLE_EARLY_DETECTION,
    DEBUG_MODE: FEATURE_FLAGS.DEBUG_DATA_FLOW,
    ENABLED_SCRAPERS: FEATURE_FLAGS.ENABLED_SCRAPERS,
  };
}

/**
 * Retired rollout knobs (T-339). Consolidation, conflict detection and source
 * tracking used to be independently switchable, and every OFF position was a
 * silent last-writer-wins write path. They are now unconditional, so these six
 * env vars no longer exist in `FEATURE_FLAGS`.
 *
 * They are still CHECKED, because deleting the code is not the same as
 * deleting the deployed env value: prod and staging both carry them today
 * (measured read-only 2026-08-26 — all three `true`, percentage `100`). Two
 * different leftovers need two different answers:
 *
 *   - a leftover value that means FULLY ON matches the new behaviour -> warn,
 *     list it for the next deploy wave's env cleanup, keep running.
 *   - a leftover value that means OFF or PARTIAL means an operator believes
 *     they can still disable/ration consolidation. They cannot, and the row
 *     would be written under rules they did not choose -> HARD-FAIL startup
 *     (`index.ts` turns this throw into a refusal to start).
 */
export const RETIRED_CONSOLIDATION_ENV_KEYS = [
  'ENABLE_DATA_CONSOLIDATION',
  'ENABLE_CONFLICT_DETECTION',
  'ENABLE_SOURCE_TRACKING',
  'CONSOLIDATION_PERCENTAGE',
  'SOURCE_TRACKING_PERCENTAGE',
  'CONFLICT_DETECTION_PERCENTAGE',
] as const;

const RETIRED_BOOLEAN_KEYS = new Set<string>([
  'ENABLE_DATA_CONSOLIDATION',
  'ENABLE_CONFLICT_DETECTION',
  'ENABLE_SOURCE_TRACKING',
]);

/**
 * `true` when the leftover value means "fully on" (and is therefore
 * compatible with the mandatory behaviour). Anything else — `false`, `0`,
 * `no`, `off`, a partial percentage, or an unparseable value — is treated as
 * an attempt to disable or ration consolidation.
 */
function retiredValueMeansFullyOn(key: string, rawValue: string): boolean {
  const v = rawValue.trim().toLowerCase();
  if (RETIRED_BOOLEAN_KEYS.has(key)) return v === 'true' || v === '1' || v === 'yes' || v === 'on';
  // percentage knobs: only a literal 100 is "fully on"
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) && n === 100;
}

/**
 * Hard-fail startup if any retired consolidation env var is still set to an
 * OFF or PARTIAL value. Returns the keys that are present-but-harmless (fully
 * ON leftovers) so the caller can surface the env-cleanup list.
 */
export function assertConsolidationFlagsNotDisabled(
  env: Record<string, string | undefined> = process.env
): string[] {
  const leftoversToClean: string[] = [];
  const disabling: string[] = [];

  for (const key of RETIRED_CONSOLIDATION_ENV_KEYS) {
    const raw = env[key];
    if (raw === undefined) continue;
    if (retiredValueMeansFullyOn(key, raw)) leftoversToClean.push(key);
    else disabling.push(`${key}=${raw}`);
  }

  if (disabling.length > 0) {
    throw new Error(
      `[T-339] Refusing to start: data consolidation is MANDATORY and can no longer be disabled, ` +
        `but the environment still tries to switch it off or ration it: ${disabling.join(', ')}. ` +
        `Remove these keys from the slot's scraper.env (see ` +
        `docs/architecture/write-path-hardening.md "prod env cleanup"). ` +
        `Retired keys: ${RETIRED_CONSOLIDATION_ENV_KEYS.join(', ')}.`
    );
  }

  return leftoversToClean;
}

/**
 * Validate feature flag configuration
 * Throws error if invalid configuration detected
 */
export function validateFeatureFlags(): void {
  // T-339: the ONLY remaining consolidation-related startup check. The
  // previous body validated three percentage knobs and warned about two
  // inert flag combinations (T-278 P3-5, T-309); all five of those knobs are
  // gone, and the combinations they warned about are now impossible by
  // construction rather than by warning.
  const leftovers = assertConsolidationFlagsNotDisabled();
  if (leftovers.length > 0) {
    console.warn(
      `[T-339] Retired consolidation env key(s) still present with a fully-ON value: ` +
        `${leftovers.join(', ')}. They are IGNORED — consolidation is mandatory. ` +
        `Remove them in the next deploy wave (docs/architecture/write-path-hardening.md).`
    );
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
