/**
 * Test Fixtures for Mainboard IPOs Landing Page
 * Story 9.15: Mainboard IPOs Landing Page
 *
 * Provides sample Mainboard IPO data for unit, integration, and E2E tests.
 */

import type { IPO } from '@/lib/api-client';
import type {
  MainboardSummaryMetrics,
  ReviewWithIPO,
  PerformanceHighlight,
  SubscriptionStatusData,
} from '@/lib/services/mainboard-landing-service';

// ==================== MAINBOARD IPO FIXTURES ====================

/**
 * Sample Mainboard IPO data with various statuses
 * Note: These are partial IPO objects for testing - missing fields are not required for the tests
 */
export const mainboardIPOFixtures: IPO[] = [
  // OPEN Status IPOs (Current)
  {
    id: 'mb-ipo-1',
    companyName: 'Tech Solutions Ltd',
    slug: 'tech-solutions-ltd',
    category: 'MAINBOARD',
    status: 'OPEN',
    openDate: '2025-10-01',
    closeDate: '2025-10-14',
    listingDate: null,
    priceRangeMin: 300,
    priceRangeMax: 350,
    issueSize: "2500",
    lotSize: 42,
    sector: 'Technology',
    listingExchanges: ['NSE', 'BSE'],
  },
  {
    id: 'mb-ipo-2',
    companyName: 'Healthcare Innovations',
    slug: 'healthcare-innovations',
    category: 'MAINBOARD',
    status: 'OPEN',
    openDate: '2025-10-05',
    closeDate: '2025-10-15',
    listingDate: null,
    priceRangeMin: 450,
    priceRangeMax: 500,
    issueSize: "3000",
    lotSize: 30,
    sector: 'Healthcare',
    listingExchanges: ['NSE', 'BSE'],
  },
  {
    id: 'mb-ipo-3',
    companyName: 'Green Energy Corp',
    slug: 'green-energy-corp',
    category: 'MAINBOARD',
    status: 'OPEN',
    openDate: '2025-10-08',
    closeDate: '2025-10-18',
    listingDate: null,
    priceRangeMin: 600,
    priceRangeMax: 650,
    issueSize: "5000",
    lotSize: 23,
    sector: 'Energy',
    listingExchanges: ['NSE', 'BSE'],
  },

  // UPCOMING Status IPOs
  {
    id: 'mb-ipo-4',
    companyName: 'Financial Services Ltd',
    slug: 'financial-services-ltd',
    category: 'MAINBOARD',
    status: 'UPCOMING',
    openDate: '2025-10-20',
    closeDate: '2025-10-30',
    listingDate: null,
    priceRangeMin: 400,
    priceRangeMax: 450,
    issueSize: "2000",
    lotSize: 33,
    sector: 'Financial Services',
    listingExchanges: ['NSE', 'BSE'],
  },
  {
    id: 'mb-ipo-5',
    companyName: 'Manufacturing Giants',
    slug: 'manufacturing-giants',
    category: 'MAINBOARD',
    status: 'UPCOMING',
    openDate: '2025-10-25',
    closeDate: '2025-11-05',
    listingDate: null,
    priceRangeMin: 550,
    priceRangeMax: 600,
    issueSize: "4000",
    lotSize: 25,
    sector: 'Manufacturing',
    listingExchanges: ['NSE', 'BSE'],
  },
  {
    id: 'mb-ipo-6',
    companyName: 'Retail Chain Co',
    slug: 'retail-chain-co',
    category: 'MAINBOARD',
    status: 'UPCOMING',
    openDate: '2025-11-01',
    closeDate: '2025-11-10',
    listingDate: null,
    priceRangeMin: 250,
    priceRangeMax: 280,
    issueSize: "1500",
    lotSize: 53,
    sector: 'Retail',
    listingExchanges: ['NSE', 'BSE'],
  },

  // LISTED Status IPOs (Recently Listed)
  {
    id: 'mb-ipo-7',
    companyName: 'Auto Components Ltd',
    slug: 'auto-components-ltd',
    category: 'MAINBOARD',
    status: 'LISTED',
    openDate: '2025-09-01',
    closeDate: '2025-09-10',
    listingDate: '2025-09-15',
    priceRangeMin: 700,
    priceRangeMax: 750,
    issueSize: "3500",
    lotSize: 20,
    sector: 'Automobile',
    listingExchanges: ['NSE', 'BSE'],
  },
  {
    id: 'mb-ipo-8',
    companyName: 'Pharma Innovations',
    slug: 'pharma-innovations',
    category: 'MAINBOARD',
    status: 'LISTED',
    openDate: '2025-08-15',
    closeDate: '2025-08-25',
    listingDate: '2025-08-30',
    priceRangeMin: 850,
    priceRangeMax: 900,
    issueSize: "4500",
    lotSize: 17,
    sector: 'Pharmaceuticals',
    listingExchanges: ['NSE', 'BSE'],
  },
  {
    id: 'mb-ipo-9',
    companyName: 'Infrastructure Builders',
    slug: 'infrastructure-builders',
    category: 'MAINBOARD',
    status: 'LISTED',
    openDate: '2025-08-01',
    closeDate: '2025-08-10',
    listingDate: '2025-08-18',
    priceRangeMin: 1000,
    priceRangeMax: 1100,
    issueSize: "6000",
    lotSize: 14,
    sector: 'Infrastructure',
    listingExchanges: ['NSE', 'BSE'],
  },
  {
    id: 'mb-ipo-10',
    companyName: 'IT Services Global',
    slug: 'it-services-global',
    category: 'MAINBOARD',
    status: 'LISTED',
    openDate: '2025-07-10',
    closeDate: '2025-07-20',
    listingDate: '2025-07-25',
    priceRangeMin: 500,
    priceRangeMax: 550,
    issueSize: "2800",
    lotSize: 27,
    sector: 'IT Services',
    listingExchanges: ['NSE', 'BSE'],
  },
  {
    id: 'mb-ipo-11',
    companyName: 'Telecom Networks',
    slug: 'telecom-networks',
    category: 'MAINBOARD',
    status: 'LISTED',
    openDate: '2025-07-01',
    closeDate: '2025-07-12',
    listingDate: '2025-07-18',
    priceRangeMin: 320,
    priceRangeMax: 360,
    issueSize: "2200",
    lotSize: 41,
    sector: 'Telecom',
    listingExchanges: ['NSE', 'BSE'],
  },
  {
    id: 'mb-ipo-12',
    companyName: 'Food Processing Ltd',
    slug: 'food-processing-ltd',
    category: 'MAINBOARD',
    status: 'LISTED',
    openDate: '2025-06-15',
    closeDate: '2025-06-25',
    listingDate: '2025-06-30',
    priceRangeMin: 280,
    priceRangeMax: 320,
    issueSize: "1800",
    lotSize: 46,
    sector: 'FMCG',
    listingExchanges: ['NSE', 'BSE'],
  },

  // CLOSED Status IPOs
  {
    id: 'mb-ipo-13',
    companyName: 'Logistics Solutions',
    slug: 'logistics-solutions',
    category: 'MAINBOARD',
    status: 'CLOSED',
    openDate: '2025-09-15',
    closeDate: '2025-09-25',
    listingDate: null,
    priceRangeMin: 400,
    priceRangeMax: 450,
    issueSize: "2600",
    lotSize: 33,
    sector: 'Logistics',
    listingExchanges: ['NSE', 'BSE'],
  },
  {
    id: 'mb-ipo-14',
    companyName: 'Real Estate Developers',
    slug: 'real-estate-developers',
    category: 'MAINBOARD',
    status: 'CLOSED',
    openDate: '2025-09-10',
    closeDate: '2025-09-20',
    listingDate: null,
    priceRangeMin: 600,
    priceRangeMax: 650,
    issueSize: "4200",
    lotSize: 23,
    sector: 'Real Estate',
    listingExchanges: ['NSE', 'BSE'],
  },

  // Additional LISTED IPOs for performance calculations
  {
    id: 'mb-ipo-15',
    companyName: 'Chemical Industries',
    slug: 'chemical-industries',
    category: 'MAINBOARD',
    status: 'LISTED',
    openDate: '2025-05-01',
    closeDate: '2025-05-10',
    listingDate: '2025-05-15',
    priceRangeMin: 450,
    priceRangeMax: 500,
    issueSize: "3200",
    lotSize: 30,
    sector: 'Chemicals',
    listingExchanges: ['NSE', 'BSE'],
  },
] as IPO[];

// ==================== SUMMARY METRICS FIXTURES ====================

export const summaryMetricsFixture: MainboardSummaryMetrics = {
  totalIPOs: 15,
  listedInGain: 5,
  listedInLoss: 3,
  upcomingAndOngoing: 6,
  gainAOT: 25.0,
  lossAOT: 15.0,
};

// ==================== REVIEW FIXTURES ====================

export const reviewFixtures: ReviewWithIPO[] = [
  {
    reviewId: 'review-1',
    reviewTitle: 'Tech Solutions Ltd IPO: Strong Technology Play',
    reviewUrl: '/ipo-reviews/review-1',
    author: 'IPO Expert Team',
    recommendation: 'Subscribe',
    publishedDate: '2025-09-30',
    ipoId: 'mb-ipo-1',
    ipoName: 'Tech Solutions Ltd',
    ipoSlug: 'tech-solutions-ltd',
  },
  {
    reviewId: 'review-2',
    reviewTitle: 'Healthcare Innovations IPO: Emerging Healthcare Leader',
    reviewUrl: '/ipo-reviews/review-2',
    author: 'Market Analysts',
    recommendation: 'May Apply',
    publishedDate: '2025-10-04',
    ipoId: 'mb-ipo-2',
    ipoName: 'Healthcare Innovations',
    ipoSlug: 'healthcare-innovations',
  },
  {
    reviewId: 'review-3',
    reviewTitle: 'Green Energy Corp IPO: Renewable Energy Opportunity',
    reviewUrl: '/ipo-reviews/review-3',
    author: 'Sector Experts',
    recommendation: 'Subscribe',
    publishedDate: '2025-10-07',
    ipoId: 'mb-ipo-3',
    ipoName: 'Green Energy Corp',
    ipoSlug: 'green-energy-corp',
  },
  {
    reviewId: 'review-4',
    reviewTitle: 'Financial Services Ltd IPO: Solid Financials',
    reviewUrl: '/ipo-reviews/review-4',
    author: 'Financial Advisors',
    recommendation: 'May Apply',
    publishedDate: '2025-10-15',
    ipoId: 'mb-ipo-4',
    ipoName: 'Financial Services Ltd',
    ipoSlug: 'financial-services-ltd',
  },
  {
    reviewId: 'review-5',
    reviewTitle: 'Manufacturing Giants IPO: Industrial Growth Story',
    reviewUrl: '/ipo-reviews/review-5',
    author: 'Industry Experts',
    recommendation: 'Subscribe',
    publishedDate: '2025-10-20',
    ipoId: 'mb-ipo-5',
    ipoName: 'Manufacturing Giants',
    ipoSlug: 'manufacturing-giants',
  },
  {
    reviewId: 'review-6',
    reviewTitle: 'Retail Chain Co IPO: Consumer Market Play',
    reviewUrl: '/ipo-reviews/review-6',
    author: 'Retail Analysts',
    recommendation: 'Avoid',
    publishedDate: '2025-10-25',
    ipoId: 'mb-ipo-6',
    ipoName: 'Retail Chain Co',
    ipoSlug: 'retail-chain-co',
  },
];

// ==================== PERFORMANCE HIGHLIGHT FIXTURES ====================

export const performanceHighlightFixtures = {
  topGainers: [
    {
      id: 'mb-ipo-7',
      companyName: 'Auto Components Ltd',
      slug: 'auto-components-ltd',
      issuePrice: 750,
      currentPrice: 1125, // +50% gain
      gainPercent: 50.0,
      listingDate: '2025-09-15',
    },
    {
      id: 'mb-ipo-8',
      companyName: 'Pharma Innovations',
      slug: 'pharma-innovations',
      issuePrice: 900,
      currentPrice: 1260, // +40% gain
      gainPercent: 40.0,
      listingDate: '2025-08-30',
    },
    {
      id: 'mb-ipo-9',
      companyName: 'Infrastructure Builders',
      slug: 'infrastructure-builders',
      issuePrice: 1100,
      currentPrice: 1430, // +30% gain
      gainPercent: 30.0,
      listingDate: '2025-08-18',
    },
  ] as PerformanceHighlight[],
  topLosers: [
    {
      id: 'mb-ipo-12',
      companyName: 'Food Processing Ltd',
      slug: 'food-processing-ltd',
      issuePrice: 320,
      currentPrice: 256, // -20% loss
      gainPercent: -20.0,
      listingDate: '2025-06-30',
    },
    {
      id: 'mb-ipo-11',
      companyName: 'Telecom Networks',
      slug: 'telecom-networks',
      issuePrice: 360,
      currentPrice: 306, // -15% loss
      gainPercent: -15.0,
      listingDate: '2025-07-18',
    },
    {
      id: 'mb-ipo-10',
      companyName: 'IT Services Global',
      slug: 'it-services-global',
      issuePrice: 550,
      currentPrice: 495, // -10% loss
      gainPercent: -10.0,
      listingDate: '2025-07-25',
    },
  ] as PerformanceHighlight[],
};

// ==================== SUBSCRIPTION STATUS FIXTURES ====================

export const subscriptionStatusFixtures: SubscriptionStatusData[] = [
  {
    id: 'mb-ipo-1',
    companyName: 'Tech Solutions Ltd',
    slug: 'tech-solutions-ltd',
    totalSubscription: 12.5,
    qibSubscription: 18.3,
    niiSubscription: 10.2,
    retailSubscription: 8.7,
    closeDate: '2025-10-14',
  },
  {
    id: 'mb-ipo-2',
    companyName: 'Healthcare Innovations',
    slug: 'healthcare-innovations',
    totalSubscription: 8.2,
    qibSubscription: 12.5,
    niiSubscription: 6.8,
    retailSubscription: 5.3,
    closeDate: '2025-10-15',
  },
  {
    id: 'mb-ipo-3',
    companyName: 'Green Energy Corp',
    slug: 'green-energy-corp',
    totalSubscription: 15.7,
    qibSubscription: 22.4,
    niiSubscription: 14.1,
    retailSubscription: 11.6,
    closeDate: '2025-10-18',
  },
];

// ==================== HELPER FUNCTIONS ====================

/**
 * Filter fixtures by status
 */
export function filterByStatus(status: string): IPO[] {
  return mainboardIPOFixtures.filter((ipo) => ipo.status === status);
}

/**
 * Get OPEN IPOs (current)
 */
export function getCurrentIPOs(): IPO[] {
  return filterByStatus('OPEN').slice(0, 6);
}

/**
 * Get UPCOMING IPOs
 */
export function getUpcomingIPOs(): IPO[] {
  return filterByStatus('UPCOMING').slice(0, 6);
}

/**
 * Get LISTED IPOs (recently listed)
 */
export function getRecentlyListedIPOs(): IPO[] {
  return filterByStatus('LISTED').slice(0, 6);
}

/**
 * Get all LISTED IPOs for performance calculations
 */
export function getAllListedIPOs(): IPO[] {
  return filterByStatus('LISTED');
}

/**
 * Filter fixtures by year
 */
export function filterByYear(year: number): IPO[] {
  return mainboardIPOFixtures.filter((ipo) => {
    if (!ipo.openDate) return false;
    const ipoYear = new Date(ipo.openDate).getFullYear();
    return ipoYear === year;
  });
}

/**
 * Search by company name
 */
export function searchByCompany(searchTerm: string): IPO[] {
  const lowerSearch = searchTerm.toLowerCase();
  return mainboardIPOFixtures.filter((ipo) =>
    ipo.companyName.toLowerCase().includes(lowerSearch)
  );
}

/**
 * Mock API response structure
 */
export function createMockAPIResponse(data: IPO[]) {
  return {
    data,
    pagination: {
      page: 1,
      limit: data.length,
      total: data.length,
      hasMore: false,
    },
  };
}

/**
 * Empty fixtures for testing empty states
 */
export const emptyFixtures = {
  ipos: [],
  reviews: [],
  performanceHighlights: { topGainers: [], topLosers: [] },
  subscriptionStatus: [],
  summaryMetrics: {
    totalIPOs: 0,
    listedInGain: 0,
    listedInLoss: 0,
    upcomingAndOngoing: 0,
    gainAOT: 0,
    lossAOT: 0,
  },
};
