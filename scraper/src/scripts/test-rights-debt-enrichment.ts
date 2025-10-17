/**
 * Test Script: Rights/Debt Issue Enrichment
 *
 * Story: 11.1 - Implement Rights/Debt IPO Detail Scraper
 * Created: 2025-10-17
 *
 * Purpose:
 * - Test Rights Issue enrichment from Chittorgarh
 * - Test Debt Issue enrichment from Chittorgarh
 * - Verify fuzzy matching algorithm (85% similarity threshold)
 * - Verify data merging logic
 * - Measure enrichment success rate
 */

import logger from '../utils/logger.js';
import type { ScrapedIPO } from '../utils/validators.js';
import {
  enrichRightsIssuesFromChittorgarh,
  enrichDebtIssuesFromChittorgarh,
  findBestMatch,
  mergeEnrichmentData,
  validateEnrichmentData,
  type RightsDebtEnrichmentData,
} from '../scrapers/rights-debt-enrichment-scraper.js';
import {
  fetchRightsIssuesFromChittorgarh,
  fetchDebtIssuesFromChittorgarh,
} from '../scrapers/chittorgarh-rights-debt-adapter.js';

// Mock BSE Rights Issues (from actual BSE scraping)
const mockBSERightsIPOs: ScrapedIPO[] = [
  {
    companyName: 'INDIA INFRASTRUCTURE TRUST - INVIT',
    issueSize: 0, // Missing
    priceRangeMin: 0,
    priceRangeMax: 0,
    openDate: '2025-10-01',
    closeDate: '2025-10-10',
    listingExchange: 'BSE',
    category: 'RIGHTS',
    sector: '',
    status: 'OPEN',
    lotSize: 100, // Default
    faceValue: 10, // Default
  },
  {
    companyName: 'POWER GRID INVIT',
    issueSize: 0,
    priceRangeMin: 0,
    priceRangeMax: 0,
    openDate: '2025-09-15',
    closeDate: '2025-09-25',
    listingExchange: 'BSE',
    category: 'RIGHTS',
    sector: '',
    status: 'CLOSED',
    lotSize: 100,
    faceValue: 10,
  },
];

// Mock BSE Debt Issues
const mockBSEDebtIPOs: ScrapedIPO[] = [
  {
    companyName: 'HDFC BANK NCD ISSUE',
    issueSize: 0, // Missing
    priceRangeMin: 0,
    priceRangeMax: 0,
    openDate: '2025-10-05',
    closeDate: '2025-10-15',
    listingExchange: 'BSE',
    category: 'NCD',
    sector: '',
    status: 'OPEN',
    lotSize: 100, // Default
    faceValue: 10, // Default
  },
  {
    companyName: 'TATA CAPITAL NCD',
    issueSize: 0,
    priceRangeMin: 0,
    priceRangeMax: 0,
    openDate: '2025-09-20',
    closeDate: '2025-09-30',
    listingExchange: 'BSE',
    category: 'NCD',
    sector: '',
    status: 'CLOSED',
    lotSize: 100,
    faceValue: 10,
  },
];

/**
 * Test fuzzy matching algorithm
 */
async function testFuzzyMatching() {
  console.log('\n========== TEST: Fuzzy Matching Algorithm ==========\n');

  const testCases = [
    {
      bseName: 'HDFC BANK LIMITED',
      chittorgarhName: 'HDFC Bank Ltd',
      expectedMatch: true,
    },
    {
      bseName: 'TATA MOTORS COMPANY',
      chittorgarhName: 'Tata Motors Ltd',
      expectedMatch: true,
    },
    {
      bseName: 'RELIANCE INDUSTRIES',
      chittorgarhName: 'Reliance Petrol Corp',
      expectedMatch: false, // Different companies
    },
    {
      bseName: 'POWER GRID INVIT',
      chittorgarhName: 'Power Grid Infrastructure Investment Trust',
      expectedMatch: true,
    },
  ];

  for (const testCase of testCases) {
    const mockBSEIPO: ScrapedIPO = {
      companyName: testCase.bseName,
      issueSize: 0,
      priceRangeMin: 0,
      priceRangeMax: 0,
      openDate: '2025-10-01',
      closeDate: '2025-10-10',
      listingExchange: 'BSE',
      category: 'RIGHTS',
      sector: '',
      status: 'OPEN',
      lotSize: 100,
      faceValue: 10,
    };

    const mockChittorgarhData: RightsDebtEnrichmentData[] = [
      {
        companyName: testCase.chittorgarhName,
        issueSize: 100000000,
        lotSize: 50,
        faceValue: 5,
        priceRangeMin: 100,
        priceRangeMax: 120,
        openDate: '2025-10-01',
        closeDate: '2025-10-10',
        registrar: 'Test Registrar',
        leadManagers: ['Test Manager'],
        category: 'RIGHTS',
        dataSource: 'CHITTORGARH',
      },
    ];

    const match = findBestMatch(mockBSEIPO, mockChittorgarhData);

    console.log(`Test Case: "${testCase.bseName}" vs "${testCase.chittorgarhName}"`);
    console.log(`  Expected Match: ${testCase.expectedMatch}`);
    console.log(`  Actual Match: ${match !== null}`);
    console.log(`  Result: ${(match !== null) === testCase.expectedMatch ? '✅ PASS' : '❌ FAIL'}\n`);
  }
}

/**
 * Test data merging logic
 */
async function testDataMerging() {
  console.log('\n========== TEST: Data Merging Logic ==========\n');

  const mockBSEIPO: ScrapedIPO = {
    companyName: 'TEST IPO LIMITED',
    issueSize: 0, // Should be enriched
    priceRangeMin: 0, // Should be enriched
    priceRangeMax: 0, // Should be enriched
    openDate: '2025-10-01', // Already set, should not be overwritten
    closeDate: '2025-10-10',
    listingExchange: 'BSE',
    category: 'RIGHTS',
    sector: '',
    status: 'OPEN',
    lotSize: 100, // Default, should be enriched
    faceValue: 10, // Default, should be enriched
  };

  const mockEnrichment: RightsDebtEnrichmentData = {
    companyName: 'TEST IPO LTD',
    issueSize: 500000000,
    lotSize: 75,
    faceValue: 2,
    priceRangeMin: 150,
    priceRangeMax: 180,
    openDate: '2025-10-02', // Different, but BSE has value so shouldn't overwrite
    closeDate: '2025-10-11',
    registrar: 'Test Registrar Ltd',
    leadManagers: ['Manager A', 'Manager B'],
    category: 'RIGHTS',
    dataSource: 'CHITTORGARH',
  };

  const enriched = mergeEnrichmentData(mockBSEIPO, mockEnrichment);

  console.log('Original BSE IPO:');
  console.log(`  issueSize: ${mockBSEIPO.issueSize}`);
  console.log(`  lotSize: ${mockBSEIPO.lotSize}`);
  console.log(`  faceValue: ${mockBSEIPO.faceValue}`);
  console.log(`  openDate: ${mockBSEIPO.openDate}`);
  console.log();

  console.log('Enrichment Data:');
  console.log(`  issueSize: ${mockEnrichment.issueSize}`);
  console.log(`  lotSize: ${mockEnrichment.lotSize}`);
  console.log(`  faceValue: ${mockEnrichment.faceValue}`);
  console.log(`  openDate: ${mockEnrichment.openDate}`);
  console.log();

  console.log('Merged Result:');
  console.log(`  issueSize: ${enriched.issueSize} ${enriched.issueSize === mockEnrichment.issueSize ? '✅' : '❌'}`);
  console.log(`  lotSize: ${enriched.lotSize} ${enriched.lotSize === mockEnrichment.lotSize ? '✅' : '❌'}`);
  console.log(`  faceValue: ${enriched.faceValue} ${enriched.faceValue === mockEnrichment.faceValue ? '✅' : '❌'}`);
  console.log(`  openDate: ${enriched.openDate} ${enriched.openDate === mockBSEIPO.openDate ? '✅ (preserved)' : '❌'}`);
  console.log(`  registrar: ${(enriched as any).registrar} ${(enriched as any).registrar === mockEnrichment.registrar ? '✅' : '❌'}`);
  console.log();
}

/**
 * Test data validation
 */
async function testDataValidation() {
  console.log('\n========== TEST: Data Validation ==========\n');

  const validData: RightsDebtEnrichmentData = {
    companyName: 'VALID IPO LIMITED',
    issueSize: 100000000,
    lotSize: 50,
    faceValue: 10,
    priceRangeMin: 100,
    priceRangeMax: 120,
    openDate: '2025-10-01',
    closeDate: '2025-10-10',
    registrar: 'Valid Registrar',
    leadManagers: ['Manager 1'],
    category: 'RIGHTS',
    dataSource: 'CHITTORGARH',
  };

  const invalidData: RightsDebtEnrichmentData = {
    companyName: '',
    issueSize: -1000,
    lotSize: -10,
    faceValue: -5,
    priceRangeMin: 150,
    priceRangeMax: 100, // Invalid: min > max
    openDate: '2025-10-01',
    closeDate: '2025-10-10',
    registrar: null,
    leadManagers: null,
    category: 'INVALID' as any,
    dataSource: 'CHITTORGARH',
  };

  console.log('Valid Data:');
  const validResult = validateEnrichmentData(validData);
  console.log(`  isValid: ${validResult.isValid ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`  errors: ${validResult.errors.length === 0 ? '✅ None' : `❌ ${validResult.errors.join(', ')}`}`);
  console.log();

  console.log('Invalid Data:');
  const invalidResult = validateEnrichmentData(invalidData);
  console.log(`  isValid: ${!invalidResult.isValid ? '✅ PASS (correctly identified as invalid)' : '❌ FAIL'}`);
  console.log(`  errors: ${invalidResult.errors.join(', ')}`);
  console.log();
}

/**
 * Test live Rights Issue enrichment
 */
async function testLiveRightsEnrichment() {
  console.log('\n========== TEST: Live Rights Issue Enrichment ==========\n');

  try {
    console.log('Fetching Rights Issue data from Chittorgarh API...');
    const rightsData = await fetchRightsIssuesFromChittorgarh();

    console.log(`✅ Fetched ${rightsData.length} Rights Issues from Chittorgarh\n`);

    if (rightsData.length > 0) {
      console.log('Sample Rights Issue Data:');
      const sample = rightsData[0];
      console.log(`  Company: ${sample.companyName}`);
      console.log(`  Issue Size: ₹${(sample.issueSize / 10000000).toFixed(2)} Cr`);
      console.log(`  Lot Size: ${sample.lotSize}`);
      console.log(`  Face Value: ₹${sample.faceValue}`);
      console.log(`  Price Range: ₹${sample.priceRangeMin} - ₹${sample.priceRangeMax}`);
      console.log(`  Open Date: ${sample.openDate}`);
      console.log(`  Close Date: ${sample.closeDate}`);
      console.log(`  Registrar: ${sample.registrar || 'N/A'}`);
      console.log(`  Lead Managers: ${sample.leadManagers?.join(', ') || 'N/A'}`);
      console.log();

      // Test enrichment with mock BSE data
      console.log('Testing enrichment with mock BSE Rights IPOs...');
      const result = await enrichRightsIssuesFromChittorgarh(mockBSERightsIPOs, rightsData);

      console.log('\nEnrichment Results:');
      console.log(`  Total Processed: ${result.stats.totalProcessed}`);
      console.log(`  Enriched Count: ${result.stats.enrichedCount}`);
      console.log(`  Failed Matches: ${result.stats.failedMatches}`);
      console.log(`  Errors: ${result.errors.length}`);
      console.log(`  Success Rate: ${((result.stats.enrichedCount / result.stats.totalProcessed) * 100).toFixed(1)}%`);
      console.log();

      if (result.errors.length > 0) {
        console.log('Errors:');
        result.errors.forEach(err => console.log(`  - ${err}`));
        console.log();
      }

      if (result.enriched.length > 0) {
        console.log('Enriched IPOs:');
        result.enriched.forEach((ipo, idx) => {
          console.log(`  ${idx + 1}. ${ipo.companyName}`);
          console.log(`     Issue Size: ₹${(ipo.issueSize / 10000000).toFixed(2)} Cr (was 0)`);
          console.log(`     Lot Size: ${ipo.lotSize} (was 100)`);
          console.log(`     Face Value: ₹${ipo.faceValue} (was 10)`);
          console.log();
        });
      }
    } else {
      console.warn('⚠️  No Rights Issue data available from Chittorgarh');
    }

  } catch (error) {
    console.error('❌ Rights Issue enrichment test failed:', error);
  }
}

/**
 * Test live Debt Issue enrichment
 */
async function testLiveDebtEnrichment() {
  console.log('\n========== TEST: Live Debt Issue Enrichment ==========\n');

  try {
    console.log('Fetching Debt Issue data from Chittorgarh API...');
    const debtData = await fetchDebtIssuesFromChittorgarh();

    console.log(`✅ Fetched ${debtData.length} Debt Issues from Chittorgarh\n`);

    if (debtData.length > 0) {
      console.log('Sample Debt Issue Data:');
      const sample = debtData[0];
      console.log(`  Company: ${sample.companyName}`);
      console.log(`  Issue Size: ₹${(sample.issueSize / 10000000).toFixed(2)} Cr`);
      console.log(`  Lot Size: ${sample.lotSize}`);
      console.log(`  Face Value: ₹${sample.faceValue}`);
      console.log(`  Price Range: ₹${sample.priceRangeMin} - ₹${sample.priceRangeMax}`);
      console.log(`  Open Date: ${sample.openDate}`);
      console.log(`  Close Date: ${sample.closeDate}`);
      console.log(`  Registrar: ${sample.registrar || 'N/A'}`);
      console.log(`  Lead Managers: ${sample.leadManagers?.join(', ') || 'N/A'}`);
      console.log();

      // Test enrichment with mock BSE data
      console.log('Testing enrichment with mock BSE Debt IPOs...');
      const result = await enrichDebtIssuesFromChittorgarh(mockBSEDebtIPOs, debtData);

      console.log('\nEnrichment Results:');
      console.log(`  Total Processed: ${result.stats.totalProcessed}`);
      console.log(`  Enriched Count: ${result.stats.enrichedCount}`);
      console.log(`  Failed Matches: ${result.stats.failedMatches}`);
      console.log(`  Errors: ${result.errors.length}`);
      console.log(`  Success Rate: ${((result.stats.enrichedCount / result.stats.totalProcessed) * 100).toFixed(1)}%`);
      console.log();

      if (result.errors.length > 0) {
        console.log('Errors:');
        result.errors.forEach(err => console.log(`  - ${err}`));
        console.log();
      }

      if (result.enriched.length > 0) {
        console.log('Enriched IPOs:');
        result.enriched.forEach((ipo, idx) => {
          console.log(`  ${idx + 1}. ${ipo.companyName}`);
          console.log(`     Issue Size: ₹${(ipo.issueSize / 10000000).toFixed(2)} Cr (was 0)`);
          console.log(`     Lot Size: ${ipo.lotSize} (was 100)`);
          console.log(`     Face Value: ₹${ipo.faceValue} (was 10)`);
          console.log();
        });
      }
    } else {
      console.warn('⚠️  No Debt Issue data available from Chittorgarh');
    }

  } catch (error) {
    console.error('❌ Debt Issue enrichment test failed:', error);
  }
}

/**
 * Main test runner
 */
async function runAllTests() {
  console.log('╔════════════════════════════════════════════════════════════════╗');
  console.log('║   Rights/Debt Issue Enrichment - Comprehensive Test Suite     ║');
  console.log('║   Story 11.1 - Rights/Debt IPO Detail Scraper                 ║');
  console.log('╚════════════════════════════════════════════════════════════════╝');

  try {
    await testFuzzyMatching();
    await testDataMerging();
    await testDataValidation();
    await testLiveRightsEnrichment();
    await testLiveDebtEnrichment();

    console.log('\n╔════════════════════════════════════════════════════════════════╗');
    console.log('║   ✅ ALL TESTS COMPLETED                                       ║');
    console.log('╚════════════════════════════════════════════════════════════════╝\n');

  } catch (error) {
    console.error('\n❌ TEST SUITE FAILED:', error);
    process.exit(1);
  }
}

// Run tests
runAllTests().catch(console.error);
