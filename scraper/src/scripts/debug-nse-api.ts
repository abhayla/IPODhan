/**
 * Debug NSE API responses
 */

const BASE_URL = 'https://www.nseindia.com';

const ENDPOINTS = {
  CURRENT_IPOS: '/api/ipo-current-issue',
  ALL_IPOS: '/api/all-upcoming-issues',
  IPO_DETAIL: '/api/ipo-detail',
};

const DEFAULT_HEADERS = {
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Referer': 'https://www.nseindia.com/market-data/all-upcoming-issues-ipo',
  'Accept-Encoding': 'gzip, deflate, br',
  'Cache-Control': 'no-cache'
};

async function debugAPI() {
  console.log('\n=== DEBUGGING NSE API ===\n');

  // Test 1: Current IPOs
  console.log('1. Testing /api/ipo-current-issue');
  try {
    const response = await fetch(BASE_URL + ENDPOINTS.CURRENT_IPOS, {
      method: 'GET',
      headers: DEFAULT_HEADERS
    });
    console.log(`   Status: ${response.status} ${response.statusText}`);
    console.log(`   Content-Type: ${response.headers.get('content-type')}`);

    const text = await response.text();
    console.log(`   Response length: ${text.length} bytes`);
    console.log(`   Response preview: ${text.substring(0, 200)}`);

    try {
      const json = JSON.parse(text);
      console.log(`   Parsed JSON type: ${Array.isArray(json) ? 'Array' : typeof json}`);
      if (Array.isArray(json)) {
        console.log(`   Array length: ${json.length}`);
        if (json.length > 0) {
          console.log(`   First item keys: ${Object.keys(json[0]).join(', ')}`);
        }
      }
    } catch {
      console.log(`   Failed to parse as JSON`);
    }
  } catch (error) {
    console.log(`   Error: ${error}`);
  }

  console.log('\n2. Testing /api/all-upcoming-issues?category=ipo');
  try {
    const url = BASE_URL + ENDPOINTS.ALL_IPOS + '?category=ipo';
    const response = await fetch(url, {
      method: 'GET',
      headers: DEFAULT_HEADERS
    });
    console.log(`   Status: ${response.status} ${response.statusText}`);
    console.log(`   Content-Type: ${response.headers.get('content-type')}`);

    const text = await response.text();
    console.log(`   Response length: ${text.length} bytes`);
    console.log(`   Response preview: ${text.substring(0, 200)}`);

    try {
      const json = JSON.parse(text);
      console.log(`   Parsed JSON type: ${Array.isArray(json) ? 'Array' : typeof json}`);
      if (Array.isArray(json)) {
        console.log(`   Array length: ${json.length}`);
        if (json.length > 0) {
          console.log(`   First item: ${JSON.stringify(json[0], null, 2)}`);
        }
      }
    } catch {
      console.log(`   Failed to parse as JSON`);
    }
  } catch (error) {
    console.log(`   Error: ${error}`);
  }

  console.log('\n3. Testing specific IPO detail (RUBICON)');
  try {
    const url = BASE_URL + ENDPOINTS.IPO_DETAIL + '?symbol=RUBICON';
    const response = await fetch(url, {
      method: 'GET',
      headers: DEFAULT_HEADERS
    });
    console.log(`   Status: ${response.status} ${response.statusText}`);

    const text = await response.text();
    console.log(`   Response length: ${text.length} bytes`);
    console.log(`   Response: ${text.substring(0, 500)}`);
  } catch (error) {
    console.log(`   Error: ${error}`);
  }

  console.log('\n=== END DEBUG ===\n');
}

debugAPI();
