/**
 * Debug NSE API response to see what fields are available
 */
import { fetchAllIPOs, fetchCurrentIPOs } from '../scrapers/nse-api-client.js';

async function debugNSEAPIResponse() {
  console.log('\n🔍 Debugging NSE API Response Fields\n');
  console.log('═══════════════════════════════════════════════════════════════════════════════\n');

  try {
    console.log('1. Fetching from /api/all-upcoming-issues?category=ipo\n');
    const ipoData = await fetchAllIPOs('ipo');

    if (ipoData.ipos.length > 0) {
      console.log(`   Found ${ipoData.ipos.length} IPOs\n`);
      console.log('   Sample IPO (first one):\n');
      console.log(JSON.stringify(ipoData.ipos[0], null, 2));
    }

    console.log('\n' + '─'.repeat(79) + '\n');

    console.log('2. Fetching from /api/all-upcoming-issues?category=rights\n');
    const rightsData = await fetchAllIPOs('rights');

    if (rightsData.ipos.length > 0) {
      console.log(`   Found ${rightsData.ipos.length} RIGHTS offerings\n`);
      console.log('   Sample RIGHTS offering (first one):\n');
      console.log(JSON.stringify(rightsData.ipos[0], null, 2));
    }

    console.log('\n' + '─'.repeat(79) + '\n');

    console.log('3. Fetching from /api/ipo-current-issue\n');
    const currentData = await fetchCurrentIPOs();

    if (currentData.ipos.length > 0) {
      console.log(`   Found ${currentData.ipos.length} current IPOs\n`);
      console.log('   Sample current IPO (first one):\n');
      console.log(JSON.stringify(currentData.ipos[0], null, 2));
    }

  } catch (error) {
    console.error('Error:', error);
  }

  console.log('\n═══════════════════════════════════════════════════════════════════════════════\n');
}

debugNSEAPIResponse().catch(console.error);
