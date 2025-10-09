// CRITICAL: Load environment variables FIRST before any imports that use them
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: join(__dirname, '..', '..', '.env') });

import logger from '../utils/logger.js';
import { SchedulerService } from './scheduler.js';
import { config } from '../config.js';

/**
 * Scheduler Entry Point
 * Starts the IPODhan scheduler service
 */
async function main() {
  try {
    logger.info({
      env: config.env,
      intervalMode: process.env.SCRAPER_INTERVAL_MODE || 'prod',
      enabled: process.env.SCRAPER_ENABLED !== 'false'
    }, 'IPODhan Scheduler starting');

    // Create and initialize scheduler
    const scheduler = new SchedulerService();
    await scheduler.init();

    // Start all jobs
    await scheduler.start();

    logger.info('IPODhan Scheduler started successfully');

    // Keep process alive - scheduler runs indefinitely until SIGTERM/SIGINT
  } catch (error) {
    logger.error({
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined
    }, 'Scheduler startup failed');
    process.exit(1);
  }
}

// Start scheduler
main().catch(error => {
  logger.error({
    error: error instanceof Error ? error.message : String(error)
  }, 'Unhandled error in scheduler');
  process.exit(1);
});
