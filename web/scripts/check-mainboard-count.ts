import { getDb } from '../lib/db';
import { ipos } from '@/lib/db';
import { eq, sql } from 'drizzle-orm';

async function checkMainboardCount() {
  const db = await getDb();

  // Get total MAINBOARD count
  const mainboardCountResult = await db.execute(sql`SELECT COUNT(*) as count FROM ${ipos} WHERE segment = 'MAINBOARD'`);
  const mainboardCount = Number(mainboardCountResult.rows[0].count);

  // Get total SME count
  const smeCountResult = await db.execute(sql`SELECT COUNT(*) as count FROM ${ipos} WHERE segment = 'SME'`);
  const smeCount = Number(smeCountResult.rows[0].count);

  // Get segment breakdown
  const segmentBreakdown = await db.execute(sql`
    SELECT segment, COUNT(*) as count
    FROM ${ipos}
    WHERE segment IS NOT NULL
    GROUP BY segment
    ORDER BY segment
  `);

  // Get status breakdown for MAINBOARD
  const statusBreakdown = await db.execute(sql`
    SELECT status, COUNT(*) as count
    FROM ${ipos}
    WHERE segment = 'MAINBOARD'
    GROUP BY status
    ORDER BY status
  `);

  // Get sample MAINBOARD IPOs
  const sampleMainboard = await db.select({
    id: ipos.id,
    companyName: ipos.companyName,
    segment: ipos.segment,
    status: ipos.status,
    slug: ipos.slug
  })
    .from(ipos)
    .where(eq(ipos.segment, 'MAINBOARD'))
    .limit(10);

  console.log('=== Database MAINBOARD Count ===');
  console.log(`Total MAINBOARD IPOs: ${mainboardCount}`);
  console.log(`Total SME IPOs: ${smeCount}`);

  console.log('\n=== Segment Breakdown ===');
  console.table(segmentBreakdown.rows);

  console.log('\n=== MAINBOARD Status Breakdown ===');
  console.table(statusBreakdown.rows);

  console.log('\n=== Sample MAINBOARD IPOs ===');
  console.table(sampleMainboard);

  process.exit(0);
}

checkMainboardCount().catch(console.error);
