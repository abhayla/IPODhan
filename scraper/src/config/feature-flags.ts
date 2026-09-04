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
   * Enable the per-document fetch STATE MACHINE (T-403 WP B): replace the
   * once-daily, NSE-only, memoryless discovery pass with a per-cycle,
   * BSE-first pass that asks `document_fetch_state` what is still missing and
   * makes zero network calls for an IPO whose filings are all accounted for.
   *
   * Separate from ENABLE_PRIMARY_SOURCE_DISCOVERY (already true in prod) on
   * purpose: that flag gates whether document discovery runs at all, this one
   * gates WHICH implementation runs. Turning the new machine on and off is a
   * one-variable, reversible decision, and state rows persist across the flip (R13).
   *
   * HONEST SCOPE (T-403 M5): this flag does NOT gate everything in T-403. The
   * CLASSIFIER fix lives in `primary-source-discovery.ts`, which the flag-OFF
   * legacy backfill also calls, so with the flag off that path still classifies
   * better than it used to. It is prevented from emitting a post-0035 enum value
   * into a database that lacks it by `toPre0035DocumentType`.
   *
   * DEPLOY DEPENDENCY: migration 0035 MUST be applied before this flag is turned
   * on. `deploy-linux.sh` migrates before flipping traffic and
   * `assert-migrations-applied.sh` blocks the deploy on any gap, so the ordering
   * is enforced rather than assumed — but flipping the flag on a database
   * without 0035 would fail on the first document write.
   * GATED OFF by default; activation in prod is Abhay's call (deploy). (T-403)
   * Default: false
   */
  ENABLE_DOCUMENT_STATE_MACHINE: process.env.ENABLE_DOCUMENT_STATE_MACHINE === 'true',

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

  /**
   * Enable the "due-step" cycle (S-02 §5): replaces the flat "run every
   * source every 30 minutes regardless of IPO status or time of day" shape
   * of `--source=all` with a schedule-aware cycle — NSE/BSE discovery only at
   * 4 fixed IST slots/day (with catch-up), the stage reconciler every cycle,
   * live data (subscription/GMP/demand graph) only during market hours for
   * OPEN IPOs, and aggregator refresh (Moneycontrol/Chittorgarh) only for
   * UPCOMING/OPEN IPOs at most once/day. A Redis lock (`scraper:cycle`)
   * makes this safe under PM2's 30-minute `cron_restart` force-kill.
   * With the flag OFF (default), the SCHEDULE is unchanged — every source runs
   * on every 30-minute cycle, the legacy rollback path.
   *
   * What the flag does NOT gate (round-3 correction): the no-op write
   * suppression and the strict normalized field comparison at the `ipos` write
   * door (`data-persister.ts#diffFieldsForWrite`) apply on BOTH paths. They are
   * correctness fixes — do not write a row that is already identical, and do
   * write one that differs — not scheduling behaviour.
   *
   * Also flag-gated, alongside the schedule: the freshness SLO set
   * (`config/freshness-slo.ts#getActiveFreshnessSLOs`), because the flat-cadence
   * thresholds would page P1 hourly against the spaced-out due-step schedule.
   * See `scraper/src/scheduler/due-step-cycle.ts`.
   * Default: false
   */
  ENABLE_DUE_STEP_SCHEDULER: process.env.ENABLE_DUE_STEP_SCHEDULER === 'true',

  /**
   * Enable AUTOMATIC filing extraction + persistence inside the document cycle
   * (S-02). MAJOR-4: this flag gates ONLY the python extraction + persist
   * block below — it does NOT gate the step ledger. With the flag OFF, which
   * is the default and what production runs today, the discovery, document,
   * live-number, and reconciler hooks in `step-ledger-recorders.ts` still run
   * on every cycle and still write `ipo_pipeline_steps` rows (52 rows per new
   * IPO via `initStepLedger`, plus per-cycle step upserts; `writeSteps` never
   * throws, so a ledger failure cannot fail a scrape). What does NOT happen
   * with the flag off: the document cycle discovers and stores PDFs and stops
   * there — a stored RHP / price-band ad is turned into `ipos`,
   * `financial_statements`, `promoters`, `ipo_valuation`, … rows only by a
   * human running `scripts/persist-filing.ts`.
   *
   * With the flag on, `processPendingFilings` spawns the deterministic python
   * extractor for every stored-but-not-yet-extracted document and writes the
   * result through the SAME write door the CLI uses (`persistFilingExtraction`
   * with the admin protection filter and the W-45 paired-agreement gate) —
   * never a second write path. It is capped at `DEFAULT_MAX_SPAWNS_PER_CYCLE`
   * python spawns per document cycle and serialized across cycles by a Redis
   * lock (`filing-auto-persist.ts` / `document-cycle.ts`, MAJOR-1).
   *
   * Separate from ENABLE_DOCUMENT_STATE_MACHINE on purpose: that flag decides
   * whether documents are FOUND at all; this one decides whether finding one
   * automatically changes published data. Turning it on in production is a
   * distinct owner decision (§GATE) because it is the first time a scrape can
   * rewrite a static field with no human in the loop.
   * Default: false
   */
  ENABLE_FILING_AUTO_PERSIST: process.env.ENABLE_FILING_AUTO_PERSIST === 'true',

  /**
   * D-15 lift: let SME candidates through the SAME auto-persist door as
   * MAINBOARD, instead of the unconditional skip in `processPendingFilings`
   * (which otherwise writes an E1 ledger row with evidence reason
   * `sme_not_validated` and spawns nothing for every SME IPO).
   *
   * With this flag on, an SME candidate is extracted+persisted through the
   * identical write path MAINBOARD already uses — `persistFilingExtraction`
   * with the admin protection filter and the W-45 paired-agreement gate — with
   * `sme: true` passed to the extractor and the W-129 plausibility checks
   * (issue-size-wired) applied exactly as they are for MAINBOARD. No second
   * write path, no relaxed gate.
   *
   * With this flag off (the default), behaviour is byte-for-byte what shipped
   * under D-15: every SME candidate is skipped and gets one E1 ledger row.
   *
   * Independent of `ENABLE_FILING_AUTO_PERSIST` — this flag only matters once
   * that one is already on; it narrows/widens which SEGMENT the already-on
   * auto-persist path covers.
   *
   * The SME walk (W-128 financials exact, W-129 plausibility with issue-size
   * wiring, W-130 subscription, W-132 anchors) passed in production on
   * Qualiance International on 2026-09-04. Turning this on is a distinct
   * owner decision (§GATE), same class as `ENABLE_FILING_AUTO_PERSIST` itself.
   * Default: false
   */
  ENABLE_SME_FILING_AUTO_PERSIST: process.env.ENABLE_SME_FILING_AUTO_PERSIST === 'true',

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
    EARLY_DETECTION: FEATURE_FLAGS.ENABLE_EARLY_DETECTION,
    SOURCE_TRACKING_PCT: FEATURE_FLAGS.SOURCE_TRACKING_PERCENTAGE,
    CONFLICT_DETECTION_PCT: FEATURE_FLAGS.CONFLICT_DETECTION_PERCENTAGE,
    CONSOLIDATION_PCT: FEATURE_FLAGS.CONSOLIDATION_PERCENTAGE,
    FILING_AUTO_PERSIST: FEATURE_FLAGS.ENABLE_FILING_AUTO_PERSIST,
    SME_FILING_AUTO_PERSIST: FEATURE_FLAGS.ENABLE_SME_FILING_AUTO_PERSIST,
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

  // T-309 (T-305 round-6 P3): SOURCE_TRACKING_PERCENTAGE and
  // CONFLICT_DETECTION_PERCENTAGE are NEVER consulted by shouldUseFeature() at
  // any call site (grep confirms ENABLE_SOURCE_TRACKING / ENABLE_CONFLICT_DETECTION
  // gate `data-consolidation-service.ts` and `data-persister.ts` as PLAIN
  // BOOLEANS, with no percentage check anywhere) — unlike DATA_CONSOLIDATION,
  // whose CONSOLIDATION_PERCENTAGE genuinely IS read via
  // `shouldUseFeature('CONSOLIDATION_PERCENTAGE', ...)` in
  // data-consolidation-service.ts. A warning that checks a percentage which is
  // not the real gate is FALSE: it fired every cycle in prod
  // (ENABLE_SOURCE_TRACKING=true, SOURCE_TRACKING_PERCENTAGE unset=0) while
  // `field_sources`/`data_conflicts` were genuinely being written (~40x/cycle,
  // 695KB of misleading noise). Removed for these two flags; kept for
  // DATA_CONSOLIDATION below, whose percentage is the real gate.
  if (FEATURE_FLAGS.ENABLE_DATA_CONSOLIDATION && FEATURE_FLAGS.CONSOLIDATION_PERCENTAGE === 0) {
    console.warn('⚠️  DATA_CONSOLIDATION enabled but percentage is 0% - no IPOs will use it');
  }

  // T-278 P3-5: ENABLE_SOURCE_TRACKING is a hard prerequisite for
  // ENABLE_CONFLICT_DETECTION to ever record anything. Conflict detection
  // compares an incoming value against the LAST source recorded in
  // field_sources; if source tracking is off, that baseline is never
  // written, so consolidateField() always takes the "no existing value"
  // branch and conflictsDetected stays 0 forever even while consolidation
  // itself runs normally. This combination previously shipped silently —
  // warn loudly so it's never invisible again.
  if (FEATURE_FLAGS.ENABLE_DATA_CONSOLIDATION && !FEATURE_FLAGS.ENABLE_SOURCE_TRACKING) {
    console.warn(
      '⚠️  DATA_CONSOLIDATION is enabled but SOURCE_TRACKING is not — conflictsDetected will stay 0 forever (no field_sources baseline is ever persisted). See T-278 P3-5.'
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
