/**
 * SME IPO Performance Service
 *
 * Provides data access for SME IPO Performance Tracker functionality.
 * Filters data for category=SME and status=LISTED IPOs.
 *
 * Story 9.11: SME IPO Performance Tracker Page
 *
 * Key Functions:
 * - getSMEIPOPerformance(year?): Fetch SME IPO performance data for a specific year
 *
 * Filter Criteria:
 * - category = 'SME'
 * - status = 'LISTED'
 * - listingDate year matches requested year (if provided)
 *
 * Performance Metrics:
 * - Listing Day Gain = ((listingClose - issuePrice) / issuePrice) × 100
 * - Profit/Loss = ((currentPrice - issuePrice) / issuePrice) × 100
 */

// ==================== TYPES ====================

/**
 * SME IPO Performance Data
 * Represents performance metrics for a single SME IPO
 */
export interface SMEIPOPerformanceData {
  id: string;
  companyName: string;
  slug: string;
  listedOn: string | null; // Listing date
  issuePrice: number; // Price per share
  listingDayClose: number; // Closing price on listing day
  listingDayGain: number; // Calculated percentage
  currentPrice: number | null; // Latest market price
  profitLoss: number | null; // Calculated percentage from issue price
}

// ==================== HELPER FUNCTIONS ====================

/**
 * Calculate Listing Day Gain Percentage
 * Formula: ((listingDayClose - issuePrice) / issuePrice) × 100
 */
function calculateListingDayGain(issuePrice: number, listingDayClose: number): number {
  if (issuePrice === 0) return 0;
  return ((listingDayClose - issuePrice) / issuePrice) * 100;
}

/**
 * Calculate Profit/Loss Percentage
 * Formula: ((currentPrice - issuePrice) / issuePrice) × 100
 */
function calculateProfitLoss(issuePrice: number, currentPrice: number | null): number | null {
  if (currentPrice === null || currentPrice === undefined) return null;
  if (issuePrice === 0) return 0;
  return ((currentPrice - issuePrice) / issuePrice) * 100;
}

// ==================== MAIN SERVICE FUNCTION ====================

/**
 * Get SME IPO Performance Data
 *
 * Fetches performance tracking data for SME IPOs that have been listed.
 * Filters by:
 * - category = SME
 * - status = LISTED
 * - listingDate year (if year parameter provided)
 *
 * @param year - Optional year to filter listings (e.g., 2025)
 * @returns Array of SME IPO performance data, sorted by listing date descending
 *
 * @example
 * ```typescript
 * // Get all SME IPO performance for 2025
 * const performance2025 = await getSMEIPOPerformance(2025);
 *
 * // Get all SME IPO performance (all years)
 * const allPerformance = await getSMEIPOPerformance();
 * ```
 */
export async function getSMEIPOPerformance(
  year?: number
): Promise<SMEIPOPerformanceData[]> {
  try {
    // TODO: Replace with actual database query when schema is ready
    // Expected query:
    // SELECT
    //   i.id,
    //   i.companyName,
    //   i.slug,
    //   i.listingDate as listedOn,
    //   i.pricePerShare as issuePrice,
    //   lp.listingDayClose,
    //   lp.currentPrice
    // FROM ipos i
    // LEFT JOIN listing_performance lp ON i.id = lp.ipoId
    // WHERE i.category = 'SME'
    //   AND i.status = 'LISTED'
    //   AND (year IS NULL OR EXTRACT(YEAR FROM i.listingDate) = year)
    // ORDER BY i.listingDate DESC

    // MOCK DATA for demonstration
    // This should be replaced with actual database query
    const mockData: SMEIPOPerformanceData[] = generateMockData(year);

    return mockData;
  } catch (error) {
    console.error('Error fetching SME IPO performance data:', error);
    throw new Error('Failed to fetch SME IPO performance data');
  }
}

// ==================== MOCK DATA GENERATOR ====================

/**
 * Generate mock SME IPO performance data
 * This function simulates the database query result
 * Replace this with actual API/database call in production
 */
function generateMockData(year?: number): SMEIPOPerformanceData[] {
  const currentYear = new Date().getFullYear();
  const targetYear = year || currentYear;

  // Return empty if future year
  if (targetYear > currentYear) {
    return [];
  }

  // Sample SME IPO performance data
  const rawData = [
    {
      id: 'sme-1',
      companyName: 'SME Tech Ventures Ltd',
      slug: 'sme-tech-ventures-ltd',
      listedOn: `${targetYear}-10-25`,
      issuePrice: 50,
      listingDayClose: 68.5,
      currentPrice: 75.2,
    },
    {
      id: 'sme-2',
      companyName: 'Small Cap Manufacturing Ltd',
      slug: 'small-cap-manufacturing-ltd',
      listedOn: `${targetYear}-09-18`,
      issuePrice: 80,
      listingDayClose: 72.0,
      currentPrice: 68.5,
    },
    {
      id: 'sme-3',
      companyName: 'SME Digital Services India',
      slug: 'sme-digital-services-india',
      listedOn: `${targetYear}-08-12`,
      issuePrice: 120,
      listingDayClose: 156.0,
      currentPrice: 180.5,
    },
    {
      id: 'sme-4',
      companyName: 'Green SME Solutions Ltd',
      slug: 'green-sme-solutions-ltd',
      listedOn: `${targetYear}-07-08`,
      issuePrice: 95,
      listingDayClose: 98.5,
      currentPrice: 105.3,
    },
    {
      id: 'sme-5',
      companyName: 'SME Pharma Innovations',
      slug: 'sme-pharma-innovations',
      listedOn: `${targetYear}-06-22`,
      issuePrice: 150,
      listingDayClose: 195.0,
      currentPrice: 220.5,
    },
    {
      id: 'sme-6',
      companyName: 'Regional SME Finance Ltd',
      slug: 'regional-sme-finance-ltd',
      listedOn: `${targetYear}-05-15`,
      issuePrice: 60,
      listingDayClose: 54.0,
      currentPrice: 58.2,
    },
    {
      id: 'sme-7',
      companyName: 'SME Logistics Solutions',
      slug: 'sme-logistics-solutions',
      listedOn: `${targetYear}-04-10`,
      issuePrice: 110,
      listingDayClose: 143.0,
      currentPrice: 165.5,
    },
    {
      id: 'sme-8',
      companyName: 'Emerging SME Textiles Ltd',
      slug: 'emerging-sme-textiles-ltd',
      listedOn: `${targetYear}-03-05`,
      issuePrice: 75,
      listingDayClose: 69.0,
      currentPrice: 72.3,
    },
  ];

  // Calculate performance metrics for each IPO
  const performanceData: SMEIPOPerformanceData[] = rawData.map((ipo) => ({
    ...ipo,
    listingDayGain: calculateListingDayGain(ipo.issuePrice, ipo.listingDayClose),
    profitLoss: calculateProfitLoss(ipo.issuePrice, ipo.currentPrice),
  }));

  // Sort by listing date descending (newest first)
  performanceData.sort((a, b) => {
    const dateA = a.listedOn ? new Date(a.listedOn).getTime() : 0;
    const dateB = b.listedOn ? new Date(b.listedOn).getTime() : 0;
    return dateB - dateA;
  });

  return performanceData;
}

// ==================== EXPORTS ====================

export default {
  getSMEIPOPerformance,
};
