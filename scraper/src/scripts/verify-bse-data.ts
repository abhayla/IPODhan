/**
 * Verify BSE detail page data in database
 */

import { drizzle } from 'drizzle-orm/node-postgres';
import { eq, ilike } from 'drizzle-orm';
import pg from 'pg';
import * as schema from '@ipodhan/shared/db/schema';
import logger from '../utils/logger.js';

const { Pool } = pg;

async function verifyBSEData() {
  // Create database connection
  const pool = new Pool({
    host: process.env.DATABASE_HOST || '103.118.16.189',
    port: parseInt(process.env.DATABASE_PORT || '5432'),
    database: process.env.DATABASE_NAME || 'ipodhan',
    user: process.env.DATABASE_USER || 'postgres',
    password: process.env.DATABASE_PASSWORD,
  });

  const db = drizzle(pool, { schema });

  try {
    logger.info('Verifying BSE detail page data in database');

    // Check MIDWEST LIMITED (should have all detail page fields)
    const midwestIPO = await db
      .select()
      .from(schema.ipos)
      .where(ilike(schema.ipos.companyName, '%midwest%'))
      .limit(1);

    if (midwestIPO.length > 0) {
      const ipo = midwestIPO[0];
      console.log('\n=== MIDWEST LIMITED IPO ===');
      console.log(JSON.stringify({
        companyName: ipo.companyName,
        issueSize: ipo.issueSize,
        lotSize: ipo.lotSize,
        faceValue: ipo.faceValue,
        registrar: ipo.registrar,
        symbol: ipo.symbol,
        priceMin: ipo.priceMin,
        priceMax: ipo.priceMax,
      }, null, 2));

      // Validation checks
      const checks = {
        'Issue size > 0': ipo.issueSize > 0,
        'Lot size populated': ipo.lotSize > 0,
        'Face value populated': ipo.faceValue > 0,
        'Registrar exists': !!ipo.registrar,
        'Symbol exists': !!ipo.symbol,
      };

      console.log('\nValidation checks:');
      console.log(checks);

      const allPassed = Object.values(checks).every(v => v === true);
      if (allPassed) {
        logger.info('✅ All checks passed for MIDWEST LIMITED!');
      } else {
        logger.warn('⚠️ Some checks failed for MIDWEST LIMITED');
      }
    } else {
      logger.warn('MIDWEST LIMITED IPO not found in database');
    }

    // Count BSE IPOs with issue_size > 0
    const bseIPOs = await db
      .select()
      .from(schema.ipos)
      .where(eq(schema.ipos.listingExchange, 'BSE'));

    const iposWithIssueSize = bseIPOs.filter(ipo => ipo.issueSize > 0);

    console.log('\n=== BSE IPO Statistics ===');
    console.log({
      totalBSEIPOs: bseIPOs.length,
      iposWithIssueSize: iposWithIssueSize.length,
      iposWithoutIssueSize: bseIPOs.length - iposWithIssueSize.length,
      percentageComplete: ((iposWithIssueSize.length / bseIPOs.length) * 100).toFixed(1) + '%',
    });

    // Show sample of enriched IPOs
    const enrichedIPOs = bseIPOs.filter(ipo => ipo.issueSize > 0).slice(0, 5);
    console.log('\n=== Sample Enriched IPOs ===');
    enrichedIPOs.forEach(ipo => {
      console.log({
        companyName: ipo.companyName,
        issueSize: ipo.issueSize,
        lotSize: ipo.lotSize,
        registrar: ipo.registrar,
      });
    });

  } catch (error) {
    logger.error({ error }, 'Verification failed');
    throw error;
  } finally {
    await pool.end();
  }
}

verifyBSEData()
  .then(() => {
    logger.info('Verification completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    logger.error('Verification failed');
    process.exit(1);
  });
