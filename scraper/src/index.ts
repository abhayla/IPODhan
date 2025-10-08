#!/usr/bin/env node

import { runNSEScraper } from './scrapers/nse-scraper-orchestrator.js';
import logger from './utils/logger.js';

/**
 * CLI entry point for NSE scraper
 * Runs the scraper and exits with appropriate status code
 */
async function main() {
  try {
    logger.info('NSE Scraper CLI started');

    // Parse CLI arguments (future: add --source flag for BSE support)
    const args = process.argv.slice(2);
    const source = args.find(arg => arg.startsWith('--source='))?.split('=')[1] || 'nse';

    if (source !== 'nse') {
      logger.error({ source }, 'Invalid source. Only NSE is supported in this story.');
      process.exit(1);
    }

    // Run NSE scraper
    const result = await runNSEScraper();

    // Log final result
    logger.info(
      {
        success: result.success,
        iposProcessed: result.iposProcessed,
        iposInserted: result.iposInserted,
        iposUpdated: result.iposUpdated,
        iposFailed: result.iposFailed,
        subscriptionsCreated: result.subscriptionsCreated,
        errorCount: result.errors.length
      },
      'Scraper execution completed'
    );

    // Exit with appropriate code
    if (result.success) {
      logger.info('Scraper completed successfully');
      process.exit(0);
    } else {
      logger.error('Scraper completed with errors');
      if (result.errors.length > 0) {
        logger.error({ errors: result.errors }, 'Error details');
      }
      process.exit(1);
    }

  } catch (error) {
    logger.error(
      { error: error instanceof Error ? error.message : String(error) },
      'Scraper CLI failed with unhandled error'
    );
    process.exit(1);
  }
}

// Run CLI
main();
