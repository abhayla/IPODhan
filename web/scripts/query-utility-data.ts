import { getDb } from '../lib/db/index';
import { registrars, marketHolidays } from '@ipodhan/shared/db/schema';

async function main() {
  const db = await getDb();

  console.log('\n=== REGISTRARS DATA ===\n');
  const registrarsData = await db.select().from(registrars);
  console.log(`Total registrars: ${registrarsData.length}\n`);

  registrarsData.forEach((r, i) => {
    console.log(`${i + 1}. ${r.name}`);
    console.log(`   Short Name: ${r.shortName || 'N/A'}`);
    console.log(`   Email: ${r.email || 'N/A'}`);
    console.log(`   Phone: ${r.phone || 'N/A'}`);
    console.log(`   Website: ${r.website || 'N/A'}`);
    console.log(`   Allotment URL: ${r.allotmentCheckUrl || 'N/A'}`);
    console.log(`   Active: ${r.active}`);
    console.log('');
  });

  console.log('\n=== MARKET HOLIDAYS DATA ===\n');
  const holidaysData = await db.select().from(marketHolidays).orderBy(marketHolidays.date);
  console.log(`Total holidays: ${holidaysData.length}\n`);

  // Group by year
  const byYear: Record<number, typeof holidaysData> = {};
  holidaysData.forEach(h => {
    if (!byYear[h.year]) {
      byYear[h.year] = [];
    }
    byYear[h.year].push(h);
  });

  Object.keys(byYear).sort().forEach(year => {
    console.log(`\n--- ${year} (${byYear[Number(year)].length} holidays) ---`);
    byYear[Number(year)].forEach((h, i) => {
      console.log(`${i + 1}. ${h.date} - ${h.description} [${h.exchange}] [${h.type}]`);
    });
  });

  process.exit(0);
}

main().catch(console.error);
