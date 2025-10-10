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
    healthCheck: JobSchedule;
    dailySummary: JobSchedule;
    logCleanup: JobSchedule;
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
    marketHours: '*/15 9-17 * * 1-5',      // Every 15 min, 9 AM-5 PM, Mon-Fri
    afterHours: '*/30 0-8,18-23 * * 1-5',  // Every 30 min, off hours, Mon-Fri
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
  scraper: 300,      // 5 minutes for NSE/BSE scrapers
  healthCheck: 60,   // 1 minute for health check
  dailySummary: 120, // 2 minutes for daily summary
  logCleanup: 300    // 5 minutes for log cleanup
} as const;
