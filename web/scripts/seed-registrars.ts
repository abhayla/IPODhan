/**
 * Seed Registrars Script for IPODhan
 *
 * Populates the registrars table with major Indian IPO registrars.
 * Story 4.6: Allotment Status Checker
 *
 * Features:
 * - Seeds major registrar companies (Link Intime, KFin, Bigshare, Cameo)
 * - Includes allotment check URLs for each registrar
 * - Idempotent (safe to run multiple times)
 * - Clear progress logging
 *
 * Usage: npx tsx web/scripts/seed-registrars.ts
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
import { registrars } from '../lib/db/schema';
import { eq } from 'drizzle-orm';
import type { NewRegistrar } from '../lib/db/types';

const REGISTRAR_DATA: Omit<NewRegistrar, 'id' | 'createdAt' | 'updatedAt'>[] = [
  {
    name: 'Link Intime India Pvt Ltd',
    shortName: 'Link Intime',
    email: 'rnt.helpdesk@linkintime.co.in',
    phone: '022-49186000',
    website: 'https://linkintime.co.in',
    allotmentCheckUrl: 'https://linkintime.co.in/MIPO/Ipoallotment.html',
    address: 'C-101, 1st Floor, 247 Park, Lal Bahadur Shastri Marg, Vikhroli (West), Mumbai - 400083',
    logoUrl: null,
    active: true,
  },
  {
    name: 'KFin Technologies Limited',
    shortName: 'KFin Technologies',
    email: 'einward.ris@kfintech.com',
    phone: '040-67162222',
    website: 'https://www.kfintech.com',
    allotmentCheckUrl: 'https://kosmic.kfintech.com/ipostatus/',
    address: 'Selenium Building, Tower B, Plot No- 31 & 32, Financial District, Nanakramguda, Serilingampally, Hyderabad, Rangareddi, Telangana - 500032',
    logoUrl: null,
    active: true,
  },
  {
    name: 'Bigshare Services Pvt Ltd',
    shortName: 'Bigshare',
    email: 'info@bigshareonline.com',
    phone: '022-62638200',
    website: 'https://www.bigshareonline.com',
    allotmentCheckUrl: 'https://ipo.bigshareonline.com/ipo_status.html',
    address: '1st Floor, Bharat Tin Works Building, Opp. Vasant Oasis, Makwana Road, Marol, Andheri (East), Mumbai - 400059',
    logoUrl: null,
    active: true,
  },
  {
    name: 'Cameo Corporate Services Limited',
    shortName: 'Cameo',
    email: 'investor@cameoindia.com',
    phone: '044-28460390',
    website: 'https://www.cameoindia.com',
    allotmentCheckUrl: 'https://www.cameoindia.com/Ipoallotment.aspx',
    address: 'Subramanian Building, No.1, Club House Road, Chennai - 600002',
    logoUrl: null,
    active: true,
  },
];

async function seedRegistrars() {
  console.log('\n🌱 Starting Registrar Seed Process...\n');
  console.log('=' .repeat(60));

  try {
    let insertedCount = 0;
    let skippedCount = 0;

    for (const registrarData of REGISTRAR_DATA) {
      // Check if registrar already exists
      const existing = await db
        .select()
        .from(registrars)
        .where(eq(registrars.name, registrarData.name))
        .limit(1);

      if (existing.length > 0) {
        console.log(`⏭️  SKIP: ${registrarData.name} (already exists)`);
        skippedCount++;
        continue;
      }

      // Insert new registrar
      await db.insert(registrars).values(registrarData);
      console.log(`✓ INSERT: ${registrarData.name}`);
      insertedCount++;
    }

    console.log('\n' + '='.repeat(60));
    console.log('\n✅ Registrar Seed Complete!\n');
    console.log(`📊 Summary:`);
    console.log(`   - Inserted: ${insertedCount} registrars`);
    console.log(`   - Skipped: ${skippedCount} registrars (already exist)`);
    console.log(`   - Total in database: ${insertedCount + skippedCount} registrars\n`);

    // Display all registrars
    const allRegistrars = await db.select().from(registrars);
    console.log(`\n📋 All Registrars in Database:\n`);
    allRegistrars.forEach((reg, index) => {
      console.log(`${index + 1}. ${reg.shortName}`);
      console.log(`   Name: ${reg.name}`);
      console.log(`   Website: ${reg.website}`);
      console.log(`   Allotment URL: ${reg.allotmentCheckUrl}`);
      console.log(`   Active: ${reg.active ? 'Yes' : 'No'}`);
      console.log('');
    });

  } catch (error) {
    console.error('\n❌ Error seeding registrars:', error);
    throw error;
  }
}

// Run seed function
seedRegistrars()
  .then(() => {
    console.log('✓ Seed script completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('✗ Seed script failed:', error);
    process.exit(1);
  });
