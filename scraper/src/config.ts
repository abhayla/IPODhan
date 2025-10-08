import dotenv from 'dotenv';

dotenv.config({ path: new URL('../.env', import.meta.url).pathname });

export const config = {
  database: {
    url: process.env.DATABASE_URL!,
    ssl: process.env.NODE_ENV === 'production'
      ? { rejectUnauthorized: true }
      : false
  },
  redis: {
    url: process.env.REDIS_URL!,
    password: process.env.REDIS_PASSWORD || undefined,
    tls: process.env.NODE_ENV === 'production'
  },
  scraper: {
    nseUrl: process.env.NSE_URL || 'https://www.nseindia.com/market-data/public-issues',
    timeout: parseInt(process.env.SCRAPER_TIMEOUT || '30000'),
    retryAttempts: parseInt(process.env.RETRY_ATTEMPTS || '3'),
    retryDelays: (process.env.RETRY_DELAYS || '1000,2000,4000')
      .split(',')
      .map(Number)
  },
  logging: {
    level: process.env.LOG_LEVEL || 'info'
  },
  env: process.env.NODE_ENV || 'development'
};
