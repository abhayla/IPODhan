import dotenv from 'dotenv';

dotenv.config({ path: new URL('../.env', import.meta.url).pathname });

/**
 * Resolve the pg `ssl` option from DATABASE_SSL (T-242 M3 handoff H6).
 * Default 'off' preserves current Windows-prod behavior — nothing changes
 * until the env var is set. This field is currently unused (nothing reads
 * `config.database.ssl`; the scraper's actual pool is
 * `packages/shared/src/db/index.ts`) but is fixed for hygiene/consistency
 * across every pg client config site in the repo.
 */
function resolveDatabaseSsl(env: NodeJS.ProcessEnv = process.env): false | { rejectUnauthorized: boolean } {
  const mode = (env.DATABASE_SSL || 'off').toLowerCase();
  if (mode === 'require') {
    return { rejectUnauthorized: false };
  }
  return false;
}

export const config = {
  database: {
    url: process.env.DATABASE_URL!,
    ssl: resolveDatabaseSsl()
  },
  redis: {
    url: process.env.REDIS_URL!,
    password: process.env.REDIS_PASSWORD || undefined,
    tls: process.env.NODE_ENV === 'production'
  },
  scraper: {
    nseUrl: process.env.NSE_URL || 'https://www.nseindia.com/market-data/public-issues',
    bseUrl: process.env.BSE_URL || 'https://www.bseindia.com/publicissue.html',
    ipoAlertsApiUrl: process.env.IPO_ALERTS_API_URL || 'https://api.ipoalerts.in',
    ipoAlertsApiKey: process.env.IPO_ALERTS_API_KEY || '',
    timeout: parseInt(process.env.SCRAPER_TIMEOUT || '30000'),
    retryAttempts: parseInt(process.env.RETRY_ATTEMPTS || '3'),
    retryDelays: (process.env.RETRY_DELAYS || '1000,2000,4000')
      .split(',')
      .map(Number)
  },
  rateLimit: {
    maxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100'),
    window: parseInt(process.env.RATE_LIMIT_WINDOW || '3600000')
  },
  logging: {
    level: process.env.LOG_LEVEL || 'info'
  },
  env: process.env.NODE_ENV || 'development'
};
