import { db } from '@/lib/db';
import { ipos } from '@/lib/db/schema';

async function countIPOs() {
  const result = await db.select().from(ipos);

  console.log('Total IPOs in database:', result.length);
  console.log('\nStatus breakdown:');

  const statuses = result.reduce((acc, ipo) => {
    acc[ipo.status] = (acc[ipo.status] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  for (const [status, count] of Object.entries(statuses)) {
    console.log(`  ${status}: ${count}`);
  }

  process.exit(0);
}

countIPOs();
