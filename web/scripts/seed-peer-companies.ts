/**
 * Seed Peer Companies Script
 *
 * Creates peer company mappings based on sector matching
 * Populates the peer_companies table with sample peer data
 *
 * Strategy:
 * - Group IPOs by sector
 * - For each IPO, find 3-5 other IPOs in the same sector as peers
 * - Add realistic financial metrics for comparison
 *
 * Usage: npx tsx scripts/seed-peer-companies.ts
 */

import { config } from 'dotenv';
import { resolve } from 'path';
const envPath = resolve(__dirname, '../.env.local');
config({ path: envPath });

import { db } from '../lib/db/index';
import { ipos, peerCompanies } from '../lib/db';
import { sql } from 'drizzle-orm';

// Sample peer company names by sector
const PEER_TEMPLATES = {
  Technology: ['TCS', 'Infosys', 'Wipro', 'HCL Technologies', 'Tech Mahindra'],
  'Financial Services': ['HDFC Bank', 'ICICI Bank', 'Axis Bank', 'Kotak Mahindra Bank', 'SBI'],
  Pharmaceuticals: ['Sun Pharma', 'Dr. Reddy\'s', 'Cipla', 'Lupin', 'Aurobindo Pharma'],
  Manufacturing: ['Tata Motors', 'Mahindra & Mahindra', 'Bajaj Auto', 'Hero MotoCorp', 'Maruti Suzuki'],
  'Real Estate': ['DLF', 'Godrej Properties', 'Oberoi Realty', 'Brigade Enterprises', 'Prestige Estates'],
  Healthcare: ['Apollo Hospitals', 'Fortis Healthcare', 'Max Healthcare', 'Narayana Health', 'Manipal Health'],
  Energy: ['Reliance Industries', 'ONGC', 'IOC', 'BPCL', 'NTPC'],
  'Consumer Goods': ['ITC', 'Hindustan Unilever', 'Nestle India', 'Dabur', 'Britannia'],
  Retail: ['DMart', 'Reliance Retail', 'Shoppers Stop', 'Future Retail', 'Titan Company'],
  Default: ['Infosys', 'Reliance Industries', 'TCS', 'HDFC Bank', 'ITC'],
};

function generatePeerMetrics() {
  // Generate realistic financial metrics for peer companies
  const peRatio = 10 + Math.random() * 40; // 10-50
  const eps = 5 + Math.random() * 95; // 5-100
  const dilutedEps = eps * (0.9 + Math.random() * 0.2); // 90-110% of basic EPS
  const ronw = 5 + Math.random() * 25; // 5-30%
  const nav = 50 + Math.random() * 450; // 50-500
  const pbvRatio = 0.5 + Math.random() * 5; // 0.5-5.5

  return {
    peRatio: Number(peRatio.toFixed(2)),
    eps: Number(eps.toFixed(2)),
    dilutedEps: Number(dilutedEps.toFixed(2)),
    ronw: Number(ronw.toFixed(2)),
    nav: Number(nav.toFixed(2)),
    pbvRatio: Number(pbvRatio.toFixed(2)),
  };
}

function getPeerNames(sector: string | null): string[] {
  if (!sector) return PEER_TEMPLATES.Default;

  // Try exact match
  if (PEER_TEMPLATES[sector as keyof typeof PEER_TEMPLATES]) {
    return PEER_TEMPLATES[sector as keyof typeof PEER_TEMPLATES];
  }

  // Try partial match
  const sectorLower = sector.toLowerCase();
  for (const [key, value] of Object.entries(PEER_TEMPLATES)) {
    if (sectorLower.includes(key.toLowerCase()) || key.toLowerCase().includes(sectorLower)) {
      return value;
    }
  }

  return PEER_TEMPLATES.Default;
}

async function main() {
  console.log('\n🌱 Starting Peer Companies Seed Process...\n');
  console.log('='.repeat(60));

  try {
    // Fetch all IPOs with sectors
    const allIPOs = await db
      .select({
        id: ipos.id,
        companyName: ipos.companyName,
        sector: ipos.sector,
      })
      .from(ipos);

    console.log(`\n✓ Found ${allIPOs.length} IPOs in database\n`);

    if (allIPOs.length === 0) {
      console.log('⚠️  No IPOs found. Please seed IPOs first.');
      return;
    }

    // Group IPOs by sector
    const iposBySector = allIPOs.reduce((acc, ipo) => {
      const sector = ipo.sector || 'Unknown';
      if (!acc[sector]) {
        acc[sector] = [];
      }
      acc[sector].push(ipo);
      return acc;
    }, {} as Record<string, typeof allIPOs>);

    console.log(`📊 Sectors found: ${Object.keys(iposBySector).length}\n`);

    let totalPeersCreated = 0;
    let iposWithPeers = 0;

    // For each IPO, create 3 peer company entries
    for (const ipo of allIPOs) {
      try {
        const peerNames = getPeerNames(ipo.sector);
        const numPeers = Math.min(3, peerNames.length); // Create 3 peers per IPO

        for (let i = 0; i < numPeers; i++) {
          const metrics = generatePeerMetrics();

          await db.insert(peerCompanies).values({
            ipoId: ipo.id,
            companyName: peerNames[i],
            sector: ipo.sector,
            isListed: true,
            peRatio: metrics.peRatio.toString(),
            eps: metrics.eps.toString(),
            dilutedEps: metrics.dilutedEps.toString(),
            ronw: metrics.ronw.toString(),
            nav: metrics.nav.toString(),
            pbvRatio: metrics.pbvRatio.toString(),
            financialStatementType: 'CONSOLIDATED',
            dataSource: 'Generated for testing',
          });

          totalPeersCreated++;
        }

        iposWithPeers++;

        if (iposWithPeers % 50 === 0) {
          console.log(`✓ Processed ${iposWithPeers}/${allIPOs.length} IPOs (${totalPeersCreated} peers created)`);
        }
      } catch (error) {
        console.error(`✗ ${ipo.companyName}: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }

    console.log('\n' + '='.repeat(60));
    console.log('\n📊 Seed Summary:');
    console.log(`   IPOs processed: ${iposWithPeers}/${allIPOs.length}`);
    console.log(`   Total peer companies created: ${totalPeersCreated}`);
    console.log(`   Average peers per IPO: ${(totalPeersCreated / iposWithPeers).toFixed(1)}`);
    console.log(`   Coverage: ${((iposWithPeers / allIPOs.length) * 100).toFixed(1)}%`);
    console.log('\n✅ Peer Companies Seed Complete!\n');

  } catch (error) {
    console.error('\n❌ Seed failed:', error);
    process.exit(1);
  }

  process.exit(0);
}

main();
