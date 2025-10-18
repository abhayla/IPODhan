import 'dotenv/config';
import { db } from '../web/lib/db';
import { ipos, subscriptions, gmpRecords, scraperLogs } from '@ipodhan/shared/db/schema';
import { sql } from 'drizzle-orm';

async function getDatabaseState() {
  try {
    console.log('=== DATABASE STATE BEFORE SCRAPING ===\n');

    // IPOs by status
    const byStatus = await db.execute(sql`SELECT status, COUNT(*) as count FROM ${ipos} GROUP BY status ORDER BY status`);
    console.log('IPOs by Status:');
    console.table(byStatus.rows);

    // IPOs by category
    const byCategory = await db.execute(sql`SELECT category, COUNT(*) as count FROM ${ipos} GROUP BY category ORDER BY category`);
    console.log('\nIPOs by Category:');
    console.table(byCategory.rows);

    // Total counts
    const totals = await db.execute(sql`
      SELECT
        (SELECT COUNT(*) FROM ${ipos}) as total_ipos,
        (SELECT COUNT(*) FROM ${subscriptions}) as total_subscriptions,
        (SELECT COUNT(*) FROM ${gmpRecords}) as total_gmp_records,
        (SELECT COUNT(*) FROM ${scraperLogs}) as total_scraper_logs
    `);
    console.log('\nTotal Records:');
    console.table(totals.rows);

    console.log('\n=== STATE CAPTURED SUCCESSFULLY ===');
    process.exit(0);
  } catch (error) {
    console.error('Error getting database state:', error);
    process.exit(1);
  }
}

getDatabaseState();
