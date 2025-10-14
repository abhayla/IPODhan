/**
 * Seed Market Holidays Script for IPODhan
 *
 * Populates the market_holidays table with NSE/BSE trading holidays for 2024-2026.
 * Story 5.4: Market Holidays Calendar
 *
 * Features:
 * - Seeds trading holidays from official NSE/BSE calendars
 * - Covers years 2024, 2025, 2026
 * - Idempotent (safe to run multiple times)
 * - Clear progress logging
 *
 * Data Sources:
 * - NSE: https://www.nseindia.com/regulations/trading-holidays
 * - BSE: https://www.bseindia.com/static/about/Market_Holidays.aspx
 *
 * Usage: npx tsx web/scripts/seed-market-holidays.ts
 */

// Load environment variables FIRST before any other imports
import { config } from 'dotenv';
import { resolve } from 'path';
const envPath = resolve(__dirname, '../.env.local');
const result = config({ path: envPath });

if (result.error) {
  console.error('Error loading .env.local:', result.error);
  process.exit(1);
}

// Verify DATABASE_URL is loaded
if (!process.env.DATABASE_URL) {
  console.error('ERROR: DATABASE_URL not found in environment variables');
  console.error('Tried loading from:', envPath);
  process.exit(1);
}

console.log('✓ Environment variables loaded successfully');
console.log('Database URL configured:', process.env.DATABASE_URL?.substring(0, 30) + '...');

import { db } from '../lib/db/index';
import { marketHolidays } from '../lib/db';
import { eq, and } from 'drizzle-orm';
import type { NewMarketHoliday } from '../lib/db/types';

/**
 * Market Holiday Data for 2024-2026
 * Manually collected from NSE/BSE official calendars
 */
const HOLIDAY_DATA: Omit<NewMarketHoliday, 'id' | 'createdAt' | 'updatedAt'>[] = [
  // ==================== 2024 HOLIDAYS ====================
  {
    date: '2024-01-26',
    description: 'Republic Day',
    exchange: 'BOTH',
    type: 'TRADING',
    year: 2024,
  },
  {
    date: '2024-03-08',
    description: 'Maha Shivratri',
    exchange: 'BOTH',
    type: 'TRADING',
    year: 2024,
  },
  {
    date: '2024-03-25',
    description: 'Holi',
    exchange: 'BOTH',
    type: 'TRADING',
    year: 2024,
  },
  {
    date: '2024-03-29',
    description: 'Good Friday',
    exchange: 'BOTH',
    type: 'TRADING',
    year: 2024,
  },
  {
    date: '2024-04-11',
    description: 'Id-Ul-Fitr (Ramadan Eid)',
    exchange: 'BOTH',
    type: 'TRADING',
    year: 2024,
  },
  {
    date: '2024-04-17',
    description: 'Ram Navami',
    exchange: 'BOTH',
    type: 'TRADING',
    year: 2024,
  },
  {
    date: '2024-04-21',
    description: 'Mahavir Jayanti',
    exchange: 'BOTH',
    type: 'TRADING',
    year: 2024,
  },
  {
    date: '2024-05-01',
    description: 'Maharashtra Day',
    exchange: 'BOTH',
    type: 'TRADING',
    year: 2024,
  },
  {
    date: '2024-05-20',
    description: 'Buddha Purnima',
    exchange: 'BOTH',
    type: 'TRADING',
    year: 2024,
  },
  {
    date: '2024-06-17',
    description: 'Bakri Id',
    exchange: 'BOTH',
    type: 'TRADING',
    year: 2024,
  },
  {
    date: '2024-07-17',
    description: 'Muharram',
    exchange: 'BOTH',
    type: 'TRADING',
    year: 2024,
  },
  {
    date: '2024-08-15',
    description: 'Independence Day',
    exchange: 'BOTH',
    type: 'TRADING',
    year: 2024,
  },
  {
    date: '2024-10-02',
    description: 'Mahatma Gandhi Jayanti',
    exchange: 'BOTH',
    type: 'TRADING',
    year: 2024,
  },
  {
    date: '2024-10-12',
    description: 'Dussehra',
    exchange: 'BOTH',
    type: 'TRADING',
    year: 2024,
  },
  {
    date: '2024-11-01',
    description: 'Diwali Laxmi Pujan',
    exchange: 'BOTH',
    type: 'TRADING',
    year: 2024,
  },
  {
    date: '2024-11-02',
    description: 'Diwali Balipratipada',
    exchange: 'BOTH',
    type: 'TRADING',
    year: 2024,
  },
  {
    date: '2024-11-15',
    description: 'Gurunanak Jayanti',
    exchange: 'BOTH',
    type: 'TRADING',
    year: 2024,
  },
  {
    date: '2024-12-25',
    description: 'Christmas',
    exchange: 'BOTH',
    type: 'TRADING',
    year: 2024,
  },

  // ==================== 2025 HOLIDAYS ====================
  {
    date: '2025-01-26',
    description: 'Republic Day',
    exchange: 'BOTH',
    type: 'TRADING',
    year: 2025,
  },
  {
    date: '2025-02-26',
    description: 'Maha Shivratri',
    exchange: 'BOTH',
    type: 'TRADING',
    year: 2025,
  },
  {
    date: '2025-03-14',
    description: 'Holi',
    exchange: 'BOTH',
    type: 'TRADING',
    year: 2025,
  },
  {
    date: '2025-03-31',
    description: 'Id-Ul-Fitr (Ramadan Eid)',
    exchange: 'BOTH',
    type: 'TRADING',
    year: 2025,
  },
  {
    date: '2025-04-06',
    description: 'Ram Navami',
    exchange: 'BOTH',
    type: 'TRADING',
    year: 2025,
  },
  {
    date: '2025-04-10',
    description: 'Mahavir Jayanti',
    exchange: 'BOTH',
    type: 'TRADING',
    year: 2025,
  },
  {
    date: '2025-04-14',
    description: 'Dr. Baba Saheb Ambedkar Jayanti',
    exchange: 'BOTH',
    type: 'TRADING',
    year: 2025,
  },
  {
    date: '2025-04-18',
    description: 'Good Friday',
    exchange: 'BOTH',
    type: 'TRADING',
    year: 2025,
  },
  {
    date: '2025-05-01',
    description: 'Maharashtra Day',
    exchange: 'BOTH',
    type: 'TRADING',
    year: 2025,
  },
  {
    date: '2025-05-12',
    description: 'Buddha Purnima',
    exchange: 'BOTH',
    type: 'TRADING',
    year: 2025,
  },
  {
    date: '2025-06-07',
    description: 'Bakri Id',
    exchange: 'BOTH',
    type: 'TRADING',
    year: 2025,
  },
  {
    date: '2025-07-06',
    description: 'Muharram',
    exchange: 'BOTH',
    type: 'TRADING',
    year: 2025,
  },
  {
    date: '2025-08-15',
    description: 'Independence Day',
    exchange: 'BOTH',
    type: 'TRADING',
    year: 2025,
  },
  {
    date: '2025-08-27',
    description: 'Ganesh Chaturthi',
    exchange: 'BOTH',
    type: 'TRADING',
    year: 2025,
  },
  {
    date: '2025-10-02',
    description: 'Mahatma Gandhi Jayanti',
    exchange: 'BOTH',
    type: 'TRADING',
    year: 2025,
  },
  {
    date: '2025-10-02',
    description: 'Dussehra',
    exchange: 'BOTH',
    type: 'TRADING',
    year: 2025,
  },
  {
    date: '2025-10-21',
    description: 'Diwali Laxmi Pujan',
    exchange: 'BOTH',
    type: 'TRADING',
    year: 2025,
  },
  {
    date: '2025-10-22',
    description: 'Diwali Balipratipada',
    exchange: 'BOTH',
    type: 'TRADING',
    year: 2025,
  },
  {
    date: '2025-11-05',
    description: 'Gurunanak Jayanti',
    exchange: 'BOTH',
    type: 'TRADING',
    year: 2025,
  },
  {
    date: '2025-12-25',
    description: 'Christmas',
    exchange: 'BOTH',
    type: 'TRADING',
    year: 2025,
  },

  // ==================== 2026 HOLIDAYS ====================
  {
    date: '2026-01-26',
    description: 'Republic Day',
    exchange: 'BOTH',
    type: 'TRADING',
    year: 2026,
  },
  {
    date: '2026-02-16',
    description: 'Maha Shivratri',
    exchange: 'BOTH',
    type: 'TRADING',
    year: 2026,
  },
  {
    date: '2026-03-03',
    description: 'Holi',
    exchange: 'BOTH',
    type: 'TRADING',
    year: 2026,
  },
  {
    date: '2026-03-21',
    description: 'Id-Ul-Fitr (Ramadan Eid)',
    exchange: 'BOTH',
    type: 'TRADING',
    year: 2026,
  },
  {
    date: '2026-03-26',
    description: 'Ram Navami',
    exchange: 'BOTH',
    type: 'TRADING',
    year: 2026,
  },
  {
    date: '2026-03-30',
    description: 'Mahavir Jayanti',
    exchange: 'BOTH',
    type: 'TRADING',
    year: 2026,
  },
  {
    date: '2026-04-03',
    description: 'Good Friday',
    exchange: 'BOTH',
    type: 'TRADING',
    year: 2026,
  },
  {
    date: '2026-04-14',
    description: 'Dr. Baba Saheb Ambedkar Jayanti',
    exchange: 'BOTH',
    type: 'TRADING',
    year: 2026,
  },
  {
    date: '2026-05-01',
    description: 'Maharashtra Day',
    exchange: 'BOTH',
    type: 'TRADING',
    year: 2026,
  },
  {
    date: '2026-05-01',
    description: 'Buddha Purnima',
    exchange: 'BOTH',
    type: 'TRADING',
    year: 2026,
  },
  {
    date: '2026-05-28',
    description: 'Bakri Id',
    exchange: 'BOTH',
    type: 'TRADING',
    year: 2026,
  },
  {
    date: '2026-06-26',
    description: 'Muharram',
    exchange: 'BOTH',
    type: 'TRADING',
    year: 2026,
  },
  {
    date: '2026-08-15',
    description: 'Independence Day',
    exchange: 'BOTH',
    type: 'TRADING',
    year: 2026,
  },
  {
    date: '2026-09-05',
    description: 'Ganesh Chaturthi',
    exchange: 'BOTH',
    type: 'TRADING',
    year: 2026,
  },
  {
    date: '2026-10-02',
    description: 'Mahatma Gandhi Jayanti',
    exchange: 'BOTH',
    type: 'TRADING',
    year: 2026,
  },
  {
    date: '2026-10-10',
    description: 'Dussehra',
    exchange: 'BOTH',
    type: 'TRADING',
    year: 2026,
  },
  {
    date: '2026-10-29',
    description: 'Diwali Laxmi Pujan',
    exchange: 'BOTH',
    type: 'TRADING',
    year: 2026,
  },
  {
    date: '2026-10-30',
    description: 'Diwali Balipratipada',
    exchange: 'BOTH',
    type: 'TRADING',
    year: 2026,
  },
  {
    date: '2026-11-25',
    description: 'Gurunanak Jayanti',
    exchange: 'BOTH',
    type: 'TRADING',
    year: 2026,
  },
  {
    date: '2026-12-25',
    description: 'Christmas',
    exchange: 'BOTH',
    type: 'TRADING',
    year: 2026,
  },
];

async function seedMarketHolidays() {
  console.log('\n🌱 Starting Market Holidays Seed Process...\n');
  console.log('=' .repeat(60));

  try {
    let insertedCount = 0;
    let skippedCount = 0;

    for (const holidayData of HOLIDAY_DATA) {
      // Check if holiday already exists (by date and description)
      const existing = await db
        .select()
        .from(marketHolidays)
        .where(
          and(
            eq(marketHolidays.date, holidayData.date),
            eq(marketHolidays.description, holidayData.description)
          )
        )
        .limit(1);

      if (existing.length > 0) {
        console.log(`⏭️  SKIP: ${holidayData.description} (${holidayData.date}) - already exists`);
        skippedCount++;
        continue;
      }

      // Insert new holiday
      await db.insert(marketHolidays).values(holidayData);
      console.log(`✓ INSERT: ${holidayData.description} (${holidayData.date}) - ${holidayData.exchange}`);
      insertedCount++;
    }

    console.log('\n' + '='.repeat(60));
    console.log('\n✅ Market Holidays Seed Complete!\n');
    console.log(`📊 Summary:`);
    console.log(`   - Inserted: ${insertedCount} holidays`);
    console.log(`   - Skipped: ${skippedCount} holidays (already exist)`);
    console.log(`   - Total in database: ${insertedCount + skippedCount} holidays\n`);

    // Display holidays by year
    const allHolidays = await db.select().from(marketHolidays);
    const holidaysByYear = allHolidays.reduce((acc, holiday) => {
      if (!acc[holiday.year]) {
        acc[holiday.year] = [];
      }
      acc[holiday.year].push(holiday);
      return acc;
    }, {} as Record<number, typeof allHolidays>);

    console.log(`\n📋 Market Holidays by Year:\n`);
    Object.keys(holidaysByYear)
      .sort()
      .forEach((year) => {
        const holidays = holidaysByYear[Number(year)];
        console.log(`\n${year} (${holidays.length} holidays):`);
        holidays
          .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
          .forEach((holiday) => {
            console.log(`  - ${holiday.date}: ${holiday.description} (${holiday.exchange})`);
          });
      });

  } catch (error) {
    console.error('\n❌ Error seeding market holidays:', error);
    throw error;
  }
}

// Run seed function
seedMarketHolidays()
  .then(() => {
    console.log('\n✓ Seed script completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n✗ Seed script failed:', error);
    process.exit(1);
  });
