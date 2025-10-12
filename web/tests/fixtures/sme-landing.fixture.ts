/**
 * Test Fixtures for SME IPOs Landing Page
 * Story 9.16: SME IPOs Landing Page
 *
 * Provides sample SME IPO data for unit, integration, and E2E tests.
 */

import type { IPO } from '@/lib/api-client';
import type {
  SMESummaryMetrics,
  ReviewWithIPO,
  PerformanceHighlight,
  SubscriptionStatusData,
} from '@/lib/services/sme-landing-service';

// ==================== SME IPO FIXTURES ====================

/**
 * Sample SME IPO data with various statuses
 * Note: These are partial IPO objects for testing - missing fields are not required for the tests
 */
export const smeIPOFixtures: IPO[] = [
  // OPEN Status IPOs (Current)
  {
    id: 'sme-ipo-1',
    companyName: 'SmartTech Innovations Ltd',
    slug: 'smarttech-innovations-ltd',
    category: 'SME',
    status: 'OPEN',
    openDate: '2025-10-01',
    closeDate: '2025-10-14',
    listingDate: null,
    priceRangeMin: 75,
    priceRangeMax: 85,
    issueSize: "120",
    lotSize: 1600,
    sector: 'Technology',
    listingExchanges: ['NSE'],
  },
  {
    id: 'sme-ipo-2',
    companyName: 'Biomedical Devices Co',
    slug: 'biomedical-devices-co',
    category: 'SME',
    status: 'OPEN',
    openDate: '2025-10-05',
    closeDate: '2025-10-15',
    listingDate: null,
    priceRangeMin: 95,
    priceRangeMax: 110,
    issueSize: "150",
    lotSize: 1200,
    sector: 'Healthcare',
    listingExchanges: ['BSE'],
  },
  {
    id: 'sme-ipo-3',
    companyName: 'Solar Solutions SME',
    slug: 'solar-solutions-sme',
    category: 'SME',
    status: 'OPEN',
    openDate: '2025-10-08',
    closeDate: '2025-10-18',
    listingDate: null,
    priceRangeMin: 120,
    priceRangeMax: 135,
    issueSize: "200",
    lotSize: 1000,
    sector: 'Renewable Energy',
    listingExchanges: ['NSE', 'BSE'],
  },

  // UPCOMING Status IPOs
  {
    id: 'sme-ipo-4',
    companyName: 'FinTech Services Ltd',
    slug: 'fintech-services-ltd',
    category: 'SME',
    status: 'UPCOMING',
    openDate: '2025-10-20',
    closeDate: '2025-10-30',
    listingDate: null,
    priceRangeMin: 88,
    priceRangeMax: 95,
    issueSize: "90",
    lotSize: 1400,
    sector: 'Financial Services',
    listingExchanges: ['NSE'],
  },
  {
    id: 'sme-ipo-5',
    companyName: 'Manufacturing Pro SME',
    slug: 'manufacturing-pro-sme',
    category: 'SME',
    status: 'UPCOMING',
    openDate: '2025-10-25',
    closeDate: '2025-11-05',
    listingDate: null,
    priceRangeMin: 102,
    priceRangeMax: 115,
    issueSize: "180",
    lotSize: 1100,
    sector: 'Manufacturing',
    listingExchanges: ['BSE'],
  },
  {
    id: 'sme-ipo-6',
    companyName: 'E-Commerce Hub',
    slug: 'e-commerce-hub',
    category: 'SME',
    status: 'UPCOMING',
    openDate: '2025-11-01',
    closeDate: '2025-11-10',
    listingDate: null,
    priceRangeMin: 65,
    priceRangeMax: 72,
    issueSize: "110",
    lotSize: 1800,
    sector: 'E-Commerce',
    listingExchanges: ['NSE'],
  },

  // LISTED Status IPOs (Recently Listed)
  {
    id: 'sme-ipo-7',
    companyName: 'Auto Parts SME Ltd',
    slug: 'auto-parts-sme-ltd',
    category: 'SME',
    status: 'LISTED',
    openDate: '2025-09-01',
    closeDate: '2025-09-10',
    listingDate: '2025-09-15',
    priceRangeMin: 140,
    priceRangeMax: 155,
    issueSize: "250",
    lotSize: 900,
    sector: 'Automobile',
    listingExchanges: ['BSE'],
  },
  {
    id: 'sme-ipo-8',
    companyName: 'Pharma SME Solutions',
    slug: 'pharma-sme-solutions',
    category: 'SME',
    status: 'LISTED',
    openDate: '2025-08-15',
    closeDate: '2025-08-25',
    listingDate: '2025-08-30',
    priceRangeMin: 175,
    priceRangeMax: 190,
    issueSize: "300",
    lotSize: 700,
    sector: 'Pharmaceuticals',
    listingExchanges: ['NSE'],
  },
  {
    id: 'sme-ipo-9',
    companyName: 'Construction SME Group',
    slug: 'construction-sme-group',
    category: 'SME',
    status: 'LISTED',
    openDate: '2025-08-01',
    closeDate: '2025-08-10',
    listingDate: '2025-08-18',
    priceRangeMin: 210,
    priceRangeMax: 225,
    issueSize: "350",
    lotSize: 600,
    sector: 'Construction',
    listingExchanges: ['BSE'],
  },
  {
    id: 'sme-ipo-10',
    companyName: 'IT Consulting SME',
    slug: 'it-consulting-sme',
    category: 'SME',
    status: 'LISTED',
    openDate: '2025-07-10',
    closeDate: '2025-07-20',
    listingDate: '2025-07-25',
    priceRangeMin: 98,
    priceRangeMax: 110,
    issueSize: "130",
    lotSize: 1300,
    sector: 'IT Services',
    listingExchanges: ['NSE'],
  },
  {
    id: 'sme-ipo-11',
    companyName: 'Telecom SME Network',
    slug: 'telecom-sme-network',
    category: 'SME',
    status: 'LISTED',
    openDate: '2025-07-01',
    closeDate: '2025-07-12',
    listingDate: '2025-07-18',
    priceRangeMin: 68,
    priceRangeMax: 75,
    issueSize: "95",
    lotSize: 1700,
    sector: 'Telecom',
    listingExchanges: ['BSE'],
  },
  {
    id: 'sme-ipo-12',
    companyName: 'Food Processing SME',
    slug: 'food-processing-sme',
    category: 'SME',
    status: 'LISTED',
    openDate: '2025-06-15',
    closeDate: '2025-06-25',
    listingDate: '2025-06-30',
    priceRangeMin: 55,
    priceRangeMax: 62,
    issueSize: "80",
    lotSize: 2000,
    sector: 'FMCG',
    listingExchanges: ['NSE'],
  },

  // CLOSED Status IPOs
  {
    id: 'sme-ipo-13',
    companyName: 'Logistics SME Solutions',
    slug: 'logistics-sme-solutions',
    category: 'SME',
    status: 'CLOSED',
    openDate: '2025-09-15',
    closeDate: '2025-09-25',
    listingDate: null,
    priceRangeMin: 82,
    priceRangeMax: 90,
    issueSize: "105",
    lotSize: 1500,
    sector: 'Logistics',
    listingExchanges: ['BSE'],
  },
  {
    id: 'sme-ipo-14',
    companyName: 'Real Estate SME',
    slug: 'real-estate-sme',
    category: 'SME',
    status: 'CLOSED',
    openDate: '2025-09-10',
    closeDate: '2025-09-20',
    listingDate: null,
    priceRangeMin: 115,
    priceRangeMax: 125,
    issueSize: "165",
    lotSize: 1100,
    sector: 'Real Estate',
    listingExchanges: ['NSE'],
  },

  // Additional LISTED IPOs for performance calculations
  {
    id: 'sme-ipo-15',
    companyName: 'Chemical SME Industries',
    slug: 'chemical-sme-industries',
    category: 'SME',
    status: 'LISTED',
    openDate: '2025-05-01',
    closeDate: '2025-05-10',
    listingDate: '2025-05-15',
    priceRangeMin: 92,
    priceRangeMax: 105,
    issueSize: "140",
    lotSize: 1250,
    sector: 'Chemicals',
    listingExchanges: ['BSE'],
  },
] as IPO[];

// ==================== SUMMARY METRICS FIXTURES ====================

export const summaryMetricsFixture: SMESummaryMetrics = {
  totalIPOs: 15,
  listedInGain: 4,
  listedInLoss: 3,
  upcomingAndOngoing: 6,
  gainAOT: 30.0,
  lossAOT: 20.0,
};

// ==================== REVIEW FIXTURES ====================

export const reviewFixtures: ReviewWithIPO[] = [
  {
    reviewId: 'sme-review-1',
    reviewTitle: 'SmartTech Innovations IPO: Emerging Tech Leader',
    reviewUrl: '/ipo-reviews/sme-review-1',
    author: 'SME IPO Experts',
    recommendation: 'Subscribe',
    publishedDate: '2025-09-30',
    ipoId: 'sme-ipo-1',
    ipoName: 'SmartTech Innovations Ltd',
    ipoSlug: 'smarttech-innovations-ltd',
  },
  {
    reviewId: 'sme-review-2',
    reviewTitle: 'Biomedical Devices IPO: Healthcare Opportunity',
    reviewUrl: '/ipo-reviews/sme-review-2',
    author: 'Healthcare Analysts',
    recommendation: 'May Apply',
    publishedDate: '2025-10-04',
    ipoId: 'sme-ipo-2',
    ipoName: 'Biomedical Devices Co',
    ipoSlug: 'biomedical-devices-co',
  },
  {
    reviewId: 'sme-review-3',
    reviewTitle: 'Solar Solutions IPO: Green Energy Play',
    reviewUrl: '/ipo-reviews/sme-review-3',
    author: 'Energy Sector Experts',
    recommendation: 'Subscribe',
    publishedDate: '2025-10-07',
    ipoId: 'sme-ipo-3',
    ipoName: 'Solar Solutions SME',
    ipoSlug: 'solar-solutions-sme',
  },
  {
    reviewId: 'sme-review-4',
    reviewTitle: 'FinTech Services IPO: Digital Finance Pioneer',
    reviewUrl: '/ipo-reviews/sme-review-4',
    author: 'Financial Tech Advisors',
    recommendation: 'May Apply',
    publishedDate: '2025-10-15',
    ipoId: 'sme-ipo-4',
    ipoName: 'FinTech Services Ltd',
    ipoSlug: 'fintech-services-ltd',
  },
  {
    reviewId: 'sme-review-5',
    reviewTitle: 'Manufacturing Pro IPO: SME Industrial Growth',
    reviewUrl: '/ipo-reviews/sme-review-5',
    author: 'Industry Analysts',
    recommendation: 'Subscribe',
    publishedDate: '2025-10-20',
    ipoId: 'sme-ipo-5',
    ipoName: 'Manufacturing Pro SME',
    ipoSlug: 'manufacturing-pro-sme',
  },
  {
    reviewId: 'sme-review-6',
    reviewTitle: 'E-Commerce Hub IPO: Digital Marketplace',
    reviewUrl: '/ipo-reviews/sme-review-6',
    author: 'E-Commerce Experts',
    recommendation: 'Avoid',
    publishedDate: '2025-10-25',
    ipoId: 'sme-ipo-6',
    ipoName: 'E-Commerce Hub',
    ipoSlug: 'e-commerce-hub',
  },
];

// ==================== PERFORMANCE HIGHLIGHT FIXTURES ====================

export const performanceHighlightFixtures = {
  topGainers: [
    {
      id: 'sme-ipo-7',
      companyName: 'Auto Parts SME Ltd',
      slug: 'auto-parts-sme-ltd',
      issuePrice: 155,
      currentPrice: 248, // +60% gain
      gainPercent: 60.0,
      listingDate: '2025-09-15',
    },
    {
      id: 'sme-ipo-8',
      companyName: 'Pharma SME Solutions',
      slug: 'pharma-sme-solutions',
      issuePrice: 190,
      currentPrice: 285, // +50% gain
      gainPercent: 50.0,
      listingDate: '2025-08-30',
    },
    {
      id: 'sme-ipo-9',
      companyName: 'Construction SME Group',
      slug: 'construction-sme-group',
      issuePrice: 225,
      currentPrice: 315, // +40% gain
      gainPercent: 40.0,
      listingDate: '2025-08-18',
    },
  ] as PerformanceHighlight[],
  topLosers: [
    {
      id: 'sme-ipo-12',
      companyName: 'Food Processing SME',
      slug: 'food-processing-sme',
      issuePrice: 62,
      currentPrice: 47, // -24% loss
      gainPercent: -24.0,
      listingDate: '2025-06-30',
    },
    {
      id: 'sme-ipo-11',
      companyName: 'Telecom SME Network',
      slug: 'telecom-sme-network',
      issuePrice: 75,
      currentPrice: 60, // -20% loss
      gainPercent: -20.0,
      listingDate: '2025-07-18',
    },
    {
      id: 'sme-ipo-10',
      companyName: 'IT Consulting SME',
      slug: 'it-consulting-sme',
      issuePrice: 110,
      currentPrice: 94, // -14.5% loss
      gainPercent: -14.5,
      listingDate: '2025-07-25',
    },
  ] as PerformanceHighlight[],
};

// ==================== SUBSCRIPTION STATUS FIXTURES ====================

export const subscriptionStatusFixtures: SubscriptionStatusData[] = [
  {
    id: 'sme-ipo-1',
    companyName: 'SmartTech Innovations Ltd',
    slug: 'smarttech-innovations-ltd',
    totalSubscription: 14.3,
    qibSubscription: 22.5,
    niiSubscription: 12.8,
    retailSubscription: 9.4,
    closeDate: '2025-10-14',
  },
  {
    id: 'sme-ipo-2',
    companyName: 'Biomedical Devices Co',
    slug: 'biomedical-devices-co',
    totalSubscription: 9.7,
    qibSubscription: 15.2,
    niiSubscription: 8.3,
    retailSubscription: 6.1,
    closeDate: '2025-10-15',
  },
  {
    id: 'sme-ipo-3',
    companyName: 'Solar Solutions SME',
    slug: 'solar-solutions-sme',
    totalSubscription: 18.5,
    qibSubscription: 26.8,
    niiSubscription: 16.4,
    retailSubscription: 13.2,
    closeDate: '2025-10-18',
  },
];

// ==================== HELPER FUNCTIONS ====================

/**
 * Filter fixtures by status
 */
export function filterByStatus(status: string): IPO[] {
  return smeIPOFixtures.filter((ipo) => ipo.status === status);
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
  return smeIPOFixtures.filter((ipo) => {
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
  return smeIPOFixtures.filter((ipo) =>
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
