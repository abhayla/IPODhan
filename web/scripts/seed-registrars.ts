/**
 * Seed Registrars Script for IPODhan
 *
 * Populates the registrars table with major Indian IPO registrars.
 * Story 4.6: Allotment Status Checker
 * Story 5.3: Registrar Directory - Expanded to 15 registrars
 *
 * Features:
 * - Seeds 15 major registrar companies
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
import { registrars } from '../lib/db';
import { eq } from 'drizzle-orm';
import type { NewRegistrar } from '../lib/db/types';

const REGISTRAR_DATA: Omit<NewRegistrar, 'id' | 'createdAt' | 'updatedAt'>[] = [
  {
    name: 'Alankit Assignments Limited',
    shortName: 'Alankit',
    email: 'rta@alankit.com',
    phone: '011-42541234',
    website: 'https://www.alankit.com',
    allotmentCheckUrl: 'https://www.alankit.com/IPO/StatusCheck.aspx',
    address: 'Alankit House, 2E/21, Jhandewalan Extension, New Delhi - 110055',
    logoUrl: null,
    active: true,
  },
  {
    name: 'Beacon Trusteeship Limited',
    shortName: 'Beacon',
    email: 'info@beacontrustee.co.in',
    phone: '022-26598054',
    website: 'https://www.beacontrustee.co.in',
    allotmentCheckUrl: 'https://www.beacontrustee.co.in/ipo-allotment-status',
    address: '4C & D, Siddhivinayak Chambers, Gandhi Nagar, Bandra (East), Mumbai - 400051',
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
  {
    name: 'Integrated Registry Management Services Pvt Ltd',
    shortName: 'IRMS',
    email: 'grievances@integratedindia.in',
    phone: '011-23517520',
    website: 'https://www.integratedindia.in',
    allotmentCheckUrl: 'https://www.integratedindia.in/ipo-status-check.aspx',
    address: '30, Ramana Residency, 4th Cross, Sampige Road, Malleswaram, Bangalore - 560003',
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
    name: 'Mas Services Limited',
    shortName: 'MAS',
    email: 'info@masserv.com',
    phone: '011-26387281',
    website: 'https://www.masserv.com',
    allotmentCheckUrl: 'https://www.masserv.com/ipo-status.aspx',
    address: 'T-34, 2nd Floor, Okhla Industrial Area, Phase-II, New Delhi - 110020',
    logoUrl: null,
    active: true,
  },
  {
    name: 'Niche Technologies Pvt Ltd',
    shortName: 'Niche',
    email: 'nichetech@nichetechpl.com',
    phone: '033-22806413',
    website: 'https://www.nichetechpl.com',
    allotmentCheckUrl: 'https://www.nichetechpl.com/ipo_status.asp',
    address: 'D-511, Bagree Market, 71, B.R.B. Basu Road, Kolkata - 700001',
    logoUrl: null,
    active: true,
  },
  {
    name: 'Purva Sharegistry India Pvt Ltd',
    shortName: 'Purva Sharegistry',
    email: 'busicomp@vsnl.com',
    phone: '022-22671564',
    website: 'https://www.purvashare.com',
    allotmentCheckUrl: 'https://www.purvashare.com/ipo-status',
    address: '9, Shiv Shakti Industrial Estate, Gr. Floor, Sitaram Mill Compound, J.R. Boricha Marg, Mumbai - 400011',
    logoUrl: null,
    active: true,
  },
  {
    name: 'Skyline Financial Services Pvt Ltd',
    shortName: 'Skyline',
    email: 'compliances@skylinerta.com',
    phone: '022-28591759',
    website: 'https://www.skylinerta.com',
    allotmentCheckUrl: 'https://www.skylinerta.com/ipo-status',
    address: 'D-153A, 1st Floor, Okhla Industrial Area, Phase-I, New Delhi - 110020',
    logoUrl: null,
    active: true,
  },
  {
    name: 'Venture Capital and Corporate Investments Pvt Ltd',
    shortName: 'VCCIPL',
    email: 'support@vccipl.com',
    phone: '022-28382736',
    website: 'https://www.vccipl.com',
    allotmentCheckUrl: 'https://www.vccipl.com/ipo-allotment-status.php',
    address: '12/13, Jhaveri Chambers, 1st Floor, Dadiseth Lane, Mumbai - 400002',
    logoUrl: null,
    active: true,
  },
  {
    name: 'Abhipra Capital Limited',
    shortName: 'Abhipra',
    email: 'abhipra@abhipra.com',
    phone: '011-26415693',
    website: 'https://www.abhipra.com',
    allotmentCheckUrl: 'https://www.abhipra.com/ipo-allotment',
    address: '1101-1103, 11th Floor, Chiranjiv Tower, 43, Nehru Place, New Delhi - 110019',
    logoUrl: null,
    active: true,
  },
  {
    name: 'Satellite Corporate Services Pvt Ltd',
    shortName: 'Satellite',
    email: 'info@satellitecorporate.com',
    phone: '022-28465656',
    website: 'https://www.satellitecorporate.com',
    allotmentCheckUrl: 'https://www.satellitecorporate.com/ipo-status.aspx',
    address: 'Suyojit Plaza, 5th Floor, Off Thakur Complex, Kandivali (East), Mumbai - 400101',
    logoUrl: null,
    active: true,
  },
  {
    name: 'Maheshwari Datamatics Pvt Ltd',
    shortName: 'Maheshwari',
    email: 'mdpl@yahoo.com',
    phone: '011-23271805',
    website: 'https://www.mdpl.in',
    allotmentCheckUrl: 'https://www.mdpl.in/ipo-allotment-status',
    address: '6, Mangoe Lane, 2nd Floor, Kolkata - 700001',
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
