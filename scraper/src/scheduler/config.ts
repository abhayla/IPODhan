import dotenv from 'dotenv';

dotenv.config();

/**
 * Job schedule configuration interface
 * Defines cron schedules for different time periods and timezone
 */
export interface JobSchedule {
  enabled: boolean;         // Per-job enable/disable
  marketHours?: string;     // Cron expression for market hours (9 AM-5 PM weekdays)
  afterHours?: string;      // Cron expression for after hours (5 PM-9 AM weekdays)
  weekends?: string;        // Cron expression for weekends
  schedule?: string;        // Cron expression for jobs that run 24/7
  timezone: string;         // Timezone for cron (Asia/Kolkata)
}

/**
 * Complete scheduler configuration interface
 */
export interface SchedulerConfig {
  enabled: boolean;                    // Master switch: enable/disable scheduler
  intervalMode: 'dev' | 'prod';        // Dev mode uses longer intervals for testing
  jobs: {
    nse: JobSchedule;
    bse: JobSchedule;
    moneycontrol: JobSchedule;
    chittorgarh: JobSchedule;
    gmpInvestorgain: JobSchedule;      // GMP coverage revival: scheduled InvestorGain GMP writer (flag-gated OFF)
    listingPerformanceUpdate: JobSchedule; // ISS-001 Fix: Current price updates
    statusUpdater: JobSchedule;        // Phase 5 Fix: Auto-update IPO statuses based on dates
    financialData: JobSchedule;        // NEW: Financial data scraper from DRHP PDFs
    peerCompanies: JobSchedule;        // NEW: Peer companies scraper from Moneycontrol
    anchorInvestors: JobSchedule;      // NEW: Anchor investors scraper from DRHP PDFs
    ipoReviews: JobSchedule;           // NEW: IPO reviews aggregator from multiple sources
    objectives: JobSchedule;           // NEW: Objectives scraper from DRHP PDFs
    healthCheck: JobSchedule;
    dailySummary: JobSchedule;
    logCleanup: JobSchedule;
    stageReconciler: JobSchedule;      // Stage F: stage-transition reconciler (flag-gated OFF; activation §GATE)
    duplicateSweep: JobSchedule;       // P2-2b (T-293): periodic duplicate-IPO cluster sweep (flag-gated OFF; activation §GATE)
    registrarHealthCheck: JobSchedule; // P1-2 (T-300): daily registrar allotment-URL health check + owner alert on dead URLs
  };
}

/**
 * Production cron schedules - for production deployment
 * Market hours: Every 15 minutes during 9 AM-5 PM weekdays
 * After hours: Every 30 minutes during off hours weekdays
 * Weekends: Every 1 hour on Saturday/Sunday
 */
const PROD_SCHEDULES = {
  nse: {
    enabled: true,
    marketHours: '*/30 9-15 * * 1-5',      // Every 30 min, 9:15 AM-3:30 PM trading hours, Mon-Fri (Story 11.2)
    afterHours: '*/30 0-8,16-23 * * 1-5',  // Every 30 min, off hours, Mon-Fri
    weekends: '0 */1 * * 0,6',             // Every hour, Sat-Sun
    timezone: 'Asia/Kolkata'
  },
  bse: {
    enabled: true,
    marketHours: '*/15 9-17 * * 1-5',      // Every 15 min, 9 AM-5 PM, Mon-Fri
    afterHours: '*/30 0-8,18-23 * * 1-5',  // Every 30 min, off hours, Mon-Fri
    weekends: '0 */1 * * 0,6',             // Every hour, Sat-Sun
    timezone: 'Asia/Kolkata'
  },
  moneycontrol: {
    enabled: true,
    schedule: '*/30 * * * *',              // Every 30 minutes, 24/7 (Story 7.6b)
    timezone: 'Asia/Kolkata'
  },
  chittorgarh: {
    enabled: true,
    schedule: '*/45 * * * *',              // Every 45 minutes, 24/7 (Story 7.6b - includes GMP data)
    timezone: 'Asia/Kolkata'
  },
  gmpInvestorgain: {
    enabled: process.env.ENABLE_GMP_SCHEDULED_JOB === 'true', // GATED OFF; Abhay enables in prod
    schedule: '0 */6 * * *',               // Every 6 hours (GMP coverage revival #6/#8)
    timezone: 'Asia/Kolkata'
  },
  listingPerformanceUpdate: {
    enabled: true,
    marketHours: '*/30 9-17 * * 1-5',      // Every 30 min during market hours (ISS-001 Fix)
    afterHours: '0 */2 0-8,18-23 * * 1-5', // Every 2 hours after hours
    weekends: '0 */4 * * 0,6',             // Every 4 hours on weekends
    timezone: 'Asia/Kolkata'
  },
  statusUpdater: {
    enabled: true,
    schedule: '0 * * * *',                 // Every hour, 24/7 (Phase 5 Fix)
    timezone: 'Asia/Kolkata'
  },
  financialData: {
    enabled: true,
    schedule: '0 3 * * *',                 // Daily at 3 AM (after BSE document scraper)
    timezone: 'Asia/Kolkata'
  },
  peerCompanies: {
    enabled: true,
    schedule: '0 4 * * *',                 // Daily at 4 AM (after financial data scraper)
    timezone: 'Asia/Kolkata'
  },
  anchorInvestors: {
    enabled: true,
    schedule: '0 5 * * *',                 // Daily at 5 AM (after peer companies scraper)
    timezone: 'Asia/Kolkata'
  },
  ipoReviews: {
    enabled: true,
    schedule: '0 */6 * * *',               // Every 6 hours (reviews update less frequently)
    timezone: 'Asia/Kolkata'
  },
  objectives: {
    enabled: true,
    schedule: '0 6 * * *',                 // Daily at 6 AM (after anchor investors scraper)
    timezone: 'Asia/Kolkata'
  },
  healthCheck: {
    enabled: true,
    schedule: '*/5 * * * *',               // Every 5 minutes, 24/7
    timezone: 'Asia/Kolkata'
  },
  dailySummary: {
    enabled: true,
    schedule: '0 8 * * *',                 // 8 AM daily
    timezone: 'Asia/Kolkata'
  },
  logCleanup: {
    enabled: true,
    schedule: '0 2 * * *',                 // 2 AM daily
    timezone: 'Asia/Kolkata'
  },
  stageReconciler: {
    enabled: process.env.ENABLE_STAGE_RECONCILER === 'true', // GATED OFF; Abhay enables in prod (§GATE)
    schedule: '15 */3 * * *',              // Stage F: every 3 hours (computes due-but-missing fetches per IPO)
    timezone: 'Asia/Kolkata'
  },
  duplicateSweep: {
    enabled: process.env.ENABLE_DUPLICATE_SWEEP_JOB === 'true', // GATED OFF; Abhay enables in prod (§GATE)
    schedule: '30 4 * * *',                // P2-2b (T-293): once daily — not time-critical, dry-run report only
    timezone: 'Asia/Kolkata'
  },
  registrarHealthCheck: {
    enabled: true,                         // P1-2 (T-300): read-only fetches + a non-destructive status write; on by default like healthCheck/dailySummary
    schedule: '30 6 * * *',                // Once daily, ahead of dailySummary (8 AM) — not time-critical
    timezone: 'Asia/Kolkata'
  }
};

/**
 * Development cron schedules - slower intervals for testing
 * Uses longer intervals to reduce resource usage during development
 */
const DEV_SCHEDULES = {
  nse: {
    enabled: true,
    marketHours: '*/30 9-17 * * 1-5',      // Every 30 min (slower for dev)
    afterHours: '0 */2 0-8,18-23 * * 1-5', // Every 2 hours (slower for dev)
    weekends: '0 */2 * * 0,6',             // Every 2 hours
    timezone: 'Asia/Kolkata'
  },
  bse: {
    enabled: true,
    marketHours: '*/30 9-17 * * 1-5',      // Every 30 min (slower for dev)
    afterHours: '0 */2 0-8,18-23 * * 1-5', // Every 2 hours (slower for dev)
    weekends: '0 */2 * * 0,6',             // Every 2 hours
    timezone: 'Asia/Kolkata'
  },
  moneycontrol: {
    enabled: true,
    schedule: '0 */1 * * *',               // Every hour (slower for dev)
    timezone: 'Asia/Kolkata'
  },
  chittorgarh: {
    enabled: true,
    schedule: '15 */1 * * *',              // Every hour at 15 mins past (slower for dev, offset from moneycontrol)
    timezone: 'Asia/Kolkata'
  },
  gmpInvestorgain: {
    enabled: process.env.ENABLE_GMP_SCHEDULED_JOB === 'true', // GATED OFF (manual trigger in dev)
    schedule: '0 */6 * * *',               // Every 6 hours (GMP coverage revival #6/#8)
    timezone: 'Asia/Kolkata'
  },
  listingPerformanceUpdate: {
    enabled: true,
    marketHours: '0 */1 9-17 * * 1-5',     // Every hour during market hours (dev mode - ISS-001 Fix)
    afterHours: '0 */4 0-8,18-23 * * 1-5', // Every 4 hours after hours (dev)
    weekends: '0 */6 * * 0,6',             // Every 6 hours on weekends (dev)
    timezone: 'Asia/Kolkata'
  },
  statusUpdater: {
    enabled: true,
    schedule: '0 */2 * * *',               // Every 2 hours in dev mode (Phase 5 Fix)
    timezone: 'Asia/Kolkata'
  },
  financialData: {
    enabled: false,                        // Disable in dev (can trigger manually)
    schedule: '0 3 * * *',                 // Daily at 3 AM (manual trigger in dev)
    timezone: 'Asia/Kolkata'
  },
  peerCompanies: {
    enabled: false,                        // Disable in dev (can trigger manually)
    schedule: '0 4 * * *',                 // Daily at 4 AM (manual trigger in dev)
    timezone: 'Asia/Kolkata'
  },
  anchorInvestors: {
    enabled: false,                        // Disable in dev (can trigger manually)
    schedule: '0 5 * * *',                 // Daily at 5 AM (manual trigger in dev)
    timezone: 'Asia/Kolkata'
  },
  ipoReviews: {
    enabled: false,                        // Disable in dev (can trigger manually)
    schedule: '0 */6 * * *',               // Every 6 hours (manual trigger in dev)
    timezone: 'Asia/Kolkata'
  },
  objectives: {
    enabled: false,                        // Disable in dev (can trigger manually)
    schedule: '0 6 * * *',                 // Daily at 6 AM (manual trigger in dev)
    timezone: 'Asia/Kolkata'
  },
  healthCheck: {
    enabled: true,
    schedule: '*/10 * * * *',              // Every 10 minutes (slower for dev)
    timezone: 'Asia/Kolkata'
  },
  dailySummary: {
    enabled: false,                        // Disable daily summary in dev (can trigger manually)
    schedule: '0 8 * * *',                 // 8 AM daily
    timezone: 'Asia/Kolkata'
  },
  logCleanup: {
    enabled: false,                        // Disable log cleanup in dev (can trigger manually)
    schedule: '0 2 * * *',                 // 2 AM daily
    timezone: 'Asia/Kolkata'
  },
  stageReconciler: {
    enabled: process.env.ENABLE_STAGE_RECONCILER === 'true', // GATED OFF; §GATE
    schedule: '15 */3 * * *',              // Stage F: every 3 hours
    timezone: 'Asia/Kolkata'
  },
  duplicateSweep: {
    enabled: process.env.ENABLE_DUPLICATE_SWEEP_JOB === 'true', // GATED OFF; §GATE
    schedule: '30 4 * * *',
    timezone: 'Asia/Kolkata'
  },
  registrarHealthCheck: {
    enabled: false,                        // Disable in dev (can trigger manually); no schedule field needed
    schedule: '30 6 * * *',
    timezone: 'Asia/Kolkata'
  }
};

/**
 * Main scheduler configuration
 * Loads configuration from environment variables
 */
export const schedulerConfig: SchedulerConfig = {
  enabled: process.env.SCRAPER_ENABLED !== 'false',  // Default: true
  intervalMode: (process.env.SCRAPER_INTERVAL_MODE as 'dev' | 'prod') || 'prod',
  jobs: process.env.SCRAPER_INTERVAL_MODE === 'dev' ? DEV_SCHEDULES : PROD_SCHEDULES
};

/**
 * Lock TTL (Time To Live) in seconds
 * Determines how long a job lock is held before automatic expiration
 */
export const LOCK_TTL = {
  scraper: 300,          // 5 minutes for NSE/BSE scrapers
  gmpInvestorgain: 600,  // 10 minutes for InvestorGain GMP job (fetch ipo+sme, match all current IPOs)
  statusUpdater: 60,     // 1 minute for status updater (fast operation)
  financialData: 3600,   // 1 hour for financial data scraper (long-running PDF processing)
  peerCompanies: 1800,   // 30 minutes for peer companies scraper (external API calls)
  anchorInvestors: 2700, // 45 minutes for anchor investors scraper (long-running PDF processing)
  ipoReviews: 3600,      // 1 hour for IPO reviews aggregator (scrapes 3 sources per IPO)
  objectives: 1800,      // 30 minutes for objectives scraper (PDF processing)
  healthCheck: 60,       // 1 minute for health check
  dailySummary: 120,     // 2 minutes for daily summary
  logCleanup: 300,       // 5 minutes for log cleanup
  registrarHealthCheck: 300 // 5 minutes for registrar URL health check (~19 sequential outbound fetches)
} as const;
