import { config } from 'dotenv';
import { resolve } from 'path';
import { db } from '../lib/db';
import { ipos } from '@ipodhan/shared/db/schema';
import { gte, sql } from 'drizzle-orm';

config({ path: resolve(__dirname, '../.env.local') });

async function countLargeIPOs() {
  try {
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)` })
      .from(ipos)
      .where(gte(ipos.issueSize, '1000.00'));

    console.log(`\n✅ Total IPOs with issue_size >= ₹1000 crores: ${count}`);

    // Also get the top 5 largest
    const top5 = await db
      .select({
        name: ipos.companyName,
        size: ipos.issueSize,
      })
      .from(ipos)
      .where(gte(ipos.issueSize, '1000.00'))
      .orderBy(sql`${ipos.issueSize} DESC`)
      .limit(5);

    console.log('\nTop 5 Largest IPOs:');
    top5.forEach((ipo, i) => {
      console.log(`${i + 1}. ${ipo.name}: ₹${ipo.size} crores`);
    });

    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

countLargeIPOs();
