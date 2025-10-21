import { getDb } from '../lib/db';
import { ipos } from '@/lib/db';
import { eq, sql } from 'drizzle-orm';

async function checkSMECount() {
  const db = await getDb();

  // Get total SME count
  const smeCountResult = await db.execute(sql`SELECT COUNT(*) as count FROM ${ipos} WHERE segment = 'SME'`);
  const smeCount = Number(smeCountResult.rows[0].count);

  // Get total Mainboard count
  const mainboardCountResult = await db.execute(sql`SELECT COUNT(*) as count FROM ${ipos} WHERE segment = 'MAINBOARD'`);
  const mainboardCount = Number(mainboardCountResult.rows[0].count);

  // Get sample SME IPOs
  const sampleSME = await db.select({
    id: ipos.id,
    companyName: ipos.companyName,
    segment: ipos.segment,
    status: ipos.status,
    slug: ipos.slug
  })
    .from(ipos)
    .where(eq(ipos.segment, 'SME'))
    .limit(10);

  console.log('=== Database SME Count ===');
  console.log(`Total SME IPOs: ${smeCount}`);
  console.log(`Total MAINBOARD IPOs: ${mainboardCount}`);
  console.log('\n=== Sample SME IPOs ===');
  console.table(sampleSME);

  process.exit(0);
}

checkSMECount().catch(console.error);
