/**
 * Test script to inspect BSE scraper output
 */

import { scrapeBSEIPOs } from '../scrapers/bse-scraper.js';

async function testBSE() {
  try {
    console.log('Running BSE scraper...');
    const result = await scrapeBSEIPOs();

    console.log(`\nTotal IPOs found: ${result.ipos.length}`);
    console.log(`SME: ${result.smeCount}, Mainboard: ${result.mainboardCount}\n`);

    // Show first 5 IPOs with their status and category
    console.log('First 5 IPOs:');
    result.ipos.slice(0, 5).forEach((ipo, index) => {
      console.log(`\n${index + 1}. ${ipo.companyName}`);
      console.log(`   Status: "${ipo.status}" (type: ${typeof ipo.status})`);
      console.log(`   Category: "${ipo.category}" (type: ${typeof ipo.category})`);
      console.log(`   Dates: ${ipo.openDate} to ${ipo.closeDate}`);
    });

    // Show last failing one
    if (result.ipos.length > 5) {
      console.log(`\n... and IPO #20 (one that was failing):`);
      const ipo = result.ipos[19];
      console.log(`\n20. ${ipo.companyName}`);
      console.log(`   Status: "${ipo.status}" (type: ${typeof ipo.status})`);
      console.log(`   Category: "${ipo.category}" (type: ${typeof ipo.category})`);
      console.log(`   Dates: ${ipo.openDate} to ${ipo.closeDate}`);
    }

  } catch (error) {
    console.error('Error:', error);
  }
}

testBSE();
