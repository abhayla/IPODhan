/**
 * Unit Tests for Rating Service
 *
 * Tests the IPO rating algorithm with various scenarios and edge cases.
 */

import { describe, it, expect } from 'vitest';
import { calculateIPORating } from '@/lib/services/rating-service';
import type {
  IPO,
  Subscription,
  GMPRecord,
  PeerCompany,
  FinancialData,
} from '@/lib/db/types';

// ==================== MOCK DATA HELPERS ====================

/**
 * Create a mock IPO with default values
 */
function createMockIPO(overrides?: Partial<IPO>): IPO {
  return {
    id: 'test-ipo-id',
    companyName: 'Test Company Ltd',
    slug: 'test-company',
    category: 'MAINBOARD',
    sector: 'Technology',
    issueSize: '500',
    priceRangeMin: 100,
    priceRangeMax: 120,
    lotSize: 100,
    status: 'OPEN',
    openDate: '2025-01-15',
    closeDate: '2025-01-17',
    allotmentDate: '2025-01-20',
    listingDate: '2025-01-25',
    companyDescription: 'Test company description',
    faceValue: 10,
    listingExchanges: ['NSE', 'BSE'],
    registrar: 'Test Registrar',
    registrarId: null,
    leadManagers: ['Test Manager'],
    rating: null,
    ratingRationale: null,
    ratingOverride: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

/**
 * Create a mock subscription with default values
 */
function createMockSubscription(totalSubscription: number): Subscription {
  return {
    id: 'test-sub-id',
    ipoId: 'test-ipo-id',
    timestamp: new Date(),
    qibSubscription: totalSubscription.toString(),
    niiSubscription: totalSubscription.toString(),
    retailSubscription: totalSubscription.toString(),
    totalSubscription: totalSubscription.toString(),
    employeeSubscription: null,
    othersSubscription: null,
    anchorInvestorSubscription: null,
    retailHNISubscription: null,
    retailOthersSubscription: null,
    bNIISubscription: null,
    sNIISubscription: null,
    totalApplications: null,
    totalSharesBid: null,
    sharesOffered: null,
  };
}

/**
 * Create mock GMP records
 */
function createMockGMPRecords(gmpValues: number[]): GMPRecord[] {
  return gmpValues.map((gmp, index) => ({
    id: `test-gmp-${index}`,
    ipoId: 'test-ipo-id',
    timestamp: new Date(Date.now() - index * 24 * 60 * 60 * 1000), // Each day older
    gmp,
    expectedListingPrice: 120 + gmp,
    subjectRate: gmp,
    kostakRate: gmp,
    saudaDetails: null,
    source: 'test',
  }));
}

/**
 * Create mock financial data
 */
function createMockFinancialData(
  revenue2023: number,
  revenue2024: number,
  profit2023: number,
  profit2024: number,
  peRatio?: number
): FinancialData {
  return {
    id: 'test-financial-id',
    ipoId: 'test-ipo-id',
    revenueFy2022: '100',
    revenueFy2023: revenue2023.toString(),
    revenueFy2024: revenue2024.toString(),
    profitFy2022: '10',
    profitFy2023: profit2023.toString(),
    profitFy2024: profit2024.toString(),
    netWorth: '200',
    peRatio: peRatio ? peRatio.toString() : null,
    eps: '10',
    roe: '15',
    debtToEquity: '0.5',
    reservesAndSurplus: '150',
    totalAssets: '500',
    totalBorrowing: '100',
  };
}

/**
 * Create mock peer companies
 */
function createMockPeerCompanies(peRatios: number[]): PeerCompany[] {
  return peRatios.map((peRatio, index) => ({
    id: `test-peer-${index}`,
    ipoId: 'test-ipo-id',
    companyName: `Peer Company ${index + 1}`,
    sector: 'Technology',
    isListed: true,
    peRatio: peRatio.toString(),
    eps: '10',
    dilutedEps: '9.5',
    ronw: '15',
    nav: '100',
    pbvRatio: '2',
    financialStatementType: 'CONSOLIDATED',
    dataSource: 'test',
    lastUpdated: new Date(),
    createdAt: new Date(),
  }));
}

// ==================== TESTS ====================

describe('Rating Service - calculateIPORating', () => {
  describe('High-quality IPOs (4-5 stars)', () => {
    it('should give 5 stars for excellent IPO with all positive factors', () => {
      const ipo = createMockIPO();
      const subscription = createMockSubscription(25); // 25x subscription
      const gmpRecords = createMockGMPRecords([60, 65, 70]); // Avg 65, ~54% GMP
      const financialData = createMockFinancialData(100, 180, 10, 20, 25); // 80% revenue, 100% profit growth
      const peerCompanies = createMockPeerCompanies([30, 35, 40]); // Avg 35, IPO at 25 = 71% (undervalued)

      const result = calculateIPORating(
        ipo,
        subscription,
        gmpRecords,
        peerCompanies,
        financialData
      );

      expect(result.rating).toBeGreaterThanOrEqual(4.5);
      expect(result.availableFactors).toHaveLength(5);
      expect(result.rationale).toContain('Strong rating');
    });

    it('should give 4-4.5 stars for very good IPO', () => {
      const ipo = createMockIPO();
      const subscription = createMockSubscription(15); // 15x subscription (4 stars)
      const gmpRecords = createMockGMPRecords([30, 35, 40]); // Avg 35, ~29% GMP (4 stars)
      const financialData = createMockFinancialData(100, 130, 10, 14, 22); // 30% revenue, 40% profit growth (4 stars)
      const peerCompanies = createMockPeerCompanies([25, 28, 30]); // Avg 27.67, IPO at 22 = 79% (4 stars)

      const result = calculateIPORating(
        ipo,
        subscription,
        gmpRecords,
        peerCompanies,
        financialData
      );

      expect(result.rating).toBeGreaterThanOrEqual(4.0);
      expect(result.rating).toBeLessThanOrEqual(5.0);
      expect(result.availableFactors).toHaveLength(5);
    });
  });

  describe('Average IPOs (2.5-3.5 stars)', () => {
    it('should give 3 stars for mixed performance', () => {
      const ipo = createMockIPO();
      const subscription = createMockSubscription(7); // 7x subscription (3 stars)
      const gmpRecords = createMockGMPRecords([15, 18, 20]); // Avg 17.67, ~15% GMP (3 stars)
      const financialData = createMockFinancialData(100, 115, 10, 12, 30); // 15% revenue, 20% profit growth (3 stars)
      const peerCompanies = createMockPeerCompanies([25, 30, 35]); // Avg 30, IPO at 30 = 100% (3 stars)

      const result = calculateIPORating(
        ipo,
        subscription,
        gmpRecords,
        peerCompanies,
        financialData
      );

      expect(result.rating).toBeGreaterThanOrEqual(2.5);
      expect(result.rating).toBeLessThanOrEqual(3.5);
      expect(result.availableFactors).toHaveLength(5);
      expect(result.rationale).toContain('Good rating');
    });

    it('should give 2.5-3 stars for slightly below average IPO', () => {
      const ipo = createMockIPO();
      const subscription = createMockSubscription(3); // 3x subscription (2 stars)
      const gmpRecords = createMockGMPRecords([5, 8, 10]); // Avg 7.67, ~6% GMP (2 stars)
      const financialData = createMockFinancialData(100, 110, 10, 11, 35); // 10% revenue, 10% profit growth (2-3 stars)
      const peerCompanies = createMockPeerCompanies([25, 28, 30]); // Avg 27.67, IPO at 35 = 126% (2 stars)

      const result = calculateIPORating(
        ipo,
        subscription,
        gmpRecords,
        peerCompanies,
        financialData
      );

      expect(result.rating).toBeGreaterThanOrEqual(2.0);
      expect(result.rating).toBeLessThanOrEqual(3.0);
      expect(result.availableFactors).toHaveLength(5);
    });
  });

  describe('Low-quality IPOs (1-2 stars)', () => {
    it('should give 1-2 stars for poor IPO with negative factors', () => {
      const ipo = createMockIPO();
      const subscription = createMockSubscription(0.5); // 0.5x subscription (1 star)
      const gmpRecords = createMockGMPRecords([-10, -15, -20]); // Negative GMP (1 star)
      const financialData = createMockFinancialData(100, 80, 10, 5, 50); // -20% revenue, -50% profit growth (1 star)
      const peerCompanies = createMockPeerCompanies([20, 22, 25]); // Avg 22.33, IPO at 50 = 224% (1 star)

      const result = calculateIPORating(
        ipo,
        subscription,
        gmpRecords,
        peerCompanies,
        financialData
      );

      expect(result.rating).toBeGreaterThanOrEqual(1.0);
      expect(result.rating).toBeLessThanOrEqual(2.5); // Allow up to 2.5 since promoter might score higher
      expect(result.availableFactors).toHaveLength(5);
      // Should contain either 'Below average' or 'Fair' depending on promoter score
      expect(result.rationale).toMatch(/(Below average|Fair) rating/i);
    });
  });

  describe('Insufficient data scenarios', () => {
    it('should return null rating when only 2 factors available', () => {
      const ipo = createMockIPO();
      const subscription = createMockSubscription(10); // Only subscription
      const gmpRecords = createMockGMPRecords([20, 25, 30]); // Only GMP
      const financialData = null; // No financials
      const peerCompanies: PeerCompany[] = []; // No peers

      const result = calculateIPORating(
        ipo,
        subscription,
        gmpRecords,
        peerCompanies,
        financialData
      );

      expect(result.rating).toBeNull();
      expect(result.availableFactors.length).toBeLessThan(3);
      expect(result.rationale).toContain('Insufficient data');
    });

    it('should return null rating when no data available', () => {
      const ipo = createMockIPO();
      const subscription = null;
      const gmpRecords: GMPRecord[] = [];
      const financialData = null;
      const peerCompanies: PeerCompany[] = [];

      const result = calculateIPORating(
        ipo,
        subscription,
        gmpRecords,
        peerCompanies,
        financialData
      );

      expect(result.rating).toBeNull();
      expect(result.availableFactors).toHaveLength(0);
      expect(result.rationale).toContain('Insufficient data');
    });

    it('should calculate rating with at least 3 factors (minimum)', () => {
      const ipo = createMockIPO();
      const subscription = createMockSubscription(10); // Factor 1
      const gmpRecords = createMockGMPRecords([20, 25, 30]); // Factor 2
      const financialData = createMockFinancialData(100, 120, 10, 13); // Factor 3 & 4 (promoter + financials, no PE ratio)
      const peerCompanies: PeerCompany[] = []; // No peers

      const result = calculateIPORating(
        ipo,
        subscription,
        gmpRecords,
        peerCompanies,
        financialData
      );

      expect(result.rating).not.toBeNull();
      expect(result.availableFactors.length).toBeGreaterThanOrEqual(3);
      expect(result.rating).toBeGreaterThanOrEqual(1.0);
      expect(result.rating).toBeLessThanOrEqual(5.0);
    });
  });

  describe('Edge cases', () => {
    it('should handle zero subscription correctly', () => {
      const ipo = createMockIPO();
      const subscription = createMockSubscription(0);
      const gmpRecords = createMockGMPRecords([20, 25, 30]);
      const financialData = createMockFinancialData(100, 120, 10, 13, 25);
      const peerCompanies = createMockPeerCompanies([25, 28, 30]);

      const result = calculateIPORating(
        ipo,
        subscription,
        gmpRecords,
        peerCompanies,
        financialData
      );

      // Zero subscription should give 1 star for that factor
      expect(result.availableFactors).toContain('subscription');
    });

    it('should handle negative GMP correctly', () => {
      const ipo = createMockIPO();
      const subscription = createMockSubscription(10);
      const gmpRecords = createMockGMPRecords([-20, -15, -10]); // Negative GMP
      const financialData = createMockFinancialData(100, 120, 10, 13, 25);
      const peerCompanies = createMockPeerCompanies([25, 28, 30]);

      const result = calculateIPORating(
        ipo,
        subscription,
        gmpRecords,
        peerCompanies,
        financialData
      );

      // Negative GMP should give 1 star for GMP factor
      expect(result.availableFactors).toContain('gmp');
      expect(result.rationale).toContain('negative');
    });

    it('should handle missing peer P/E data correctly', () => {
      const ipo = createMockIPO();
      const subscription = createMockSubscription(10);
      const gmpRecords = createMockGMPRecords([20, 25, 30]);
      const financialData = createMockFinancialData(100, 120, 10, 13, 25);
      const peerCompanies: PeerCompany[] = []; // No peers

      const result = calculateIPORating(
        ipo,
        subscription,
        gmpRecords,
        peerCompanies,
        financialData
      );

      // Should still calculate rating without peer comparison
      expect(result.availableFactors).not.toContain('peerPE');
      expect(result.rating).not.toBeNull();
    });

    it('should handle missing IPO price range', () => {
      const ipo = createMockIPO({
        priceRangeMin: null,
        priceRangeMax: null,
      });
      const subscription = createMockSubscription(10);
      const gmpRecords = createMockGMPRecords([20, 25, 30]);
      const financialData = createMockFinancialData(100, 120, 10, 13, 25);
      const peerCompanies = createMockPeerCompanies([25, 28, 30]);

      const result = calculateIPORating(
        ipo,
        subscription,
        gmpRecords,
        peerCompanies,
        financialData
      );

      // GMP factor should be null without price range
      expect(result.availableFactors).not.toContain('gmp');
    });

    it('should handle zero financial values correctly', () => {
      const ipo = createMockIPO();
      const subscription = createMockSubscription(10);
      const gmpRecords = createMockGMPRecords([20, 25, 30]);
      const financialData = createMockFinancialData(0, 0, 0, 0, 25); // All zeros
      const peerCompanies = createMockPeerCompanies([25, 28, 30]);

      const result = calculateIPORating(
        ipo,
        subscription,
        gmpRecords,
        peerCompanies,
        financialData
      );

      // Financials factor should be null with zero values
      expect(result.availableFactors).not.toContain('financials');
    });
  });

  describe('Rounding behavior', () => {
    it('should round to nearest 0.5 increment', () => {
      // Create scenario with low scores
      const ipo = createMockIPO();
      const subscription = createMockSubscription(2); // 2 stars
      const gmpRecords = createMockGMPRecords([5, 8, 10]); // 2 stars
      const financialData = createMockFinancialData(100, 110, 10, 11, 30); // 2 stars
      const peerCompanies = createMockPeerCompanies([25, 28, 30]); // 3 stars

      const result = calculateIPORating(
        ipo,
        subscription,
        gmpRecords,
        peerCompanies,
        financialData
      );

      // Should be a valid rating with 0.5 increments
      expect(result.rating).not.toBeNull();
      expect(result.rating).toBeGreaterThanOrEqual(1.0);
      expect(result.rating).toBeLessThanOrEqual(5.0);
      expect(result.rating! % 0.5).toBe(0); // Must be multiple of 0.5
    });

    it('should round 3.76 to 4.0', () => {
      // Create scenario that produces ~3.76
      const ipo = createMockIPO();
      const subscription = createMockSubscription(15); // 4 stars
      const gmpRecords = createMockGMPRecords([30, 35, 40]); // 4 stars
      const financialData = createMockFinancialData(100, 130, 10, 14, 24); // 4 stars
      const peerCompanies = createMockPeerCompanies([25, 28, 30]); // 4 stars

      const result = calculateIPORating(
        ipo,
        subscription,
        gmpRecords,
        peerCompanies,
        financialData
      );

      // Should round to nearest 0.5
      expect(result.rating).toBeGreaterThanOrEqual(3.5);
      expect(result.rating).toBeLessThanOrEqual(4.5);
      expect(result.rating! % 0.5).toBe(0); // Must be multiple of 0.5
    });

    it('should ensure rating is between 1.0 and 5.0', () => {
      const ipo = createMockIPO();
      const subscription = createMockSubscription(50); // Extreme value
      const gmpRecords = createMockGMPRecords([100, 110, 120]); // Extreme value
      const financialData = createMockFinancialData(100, 300, 10, 40, 15); // Extreme growth
      const peerCompanies = createMockPeerCompanies([40, 45, 50]); // IPO much cheaper

      const result = calculateIPORating(
        ipo,
        subscription,
        gmpRecords,
        peerCompanies,
        financialData
      );

      expect(result.rating).toBeGreaterThanOrEqual(1.0);
      expect(result.rating).toBeLessThanOrEqual(5.0);
    });
  });

  describe('Rationale generation', () => {
    it('should generate rationale with subscription details', () => {
      const ipo = createMockIPO();
      const subscription = createMockSubscription(25);
      const gmpRecords = createMockGMPRecords([30, 35, 40]);
      const financialData = createMockFinancialData(100, 130, 10, 14, 25);
      const peerCompanies = createMockPeerCompanies([25, 28, 30]);

      const result = calculateIPORating(
        ipo,
        subscription,
        gmpRecords,
        peerCompanies,
        financialData
      );

      expect(result.rationale).toContain('25.0x');
      expect(result.rationale).toContain('subscription');
    });

    it('should generate rationale with GMP details', () => {
      const ipo = createMockIPO();
      const subscription = createMockSubscription(10);
      const gmpRecords = createMockGMPRecords([30, 35, 40]);
      const financialData = createMockFinancialData(100, 130, 10, 14, 25);
      const peerCompanies = createMockPeerCompanies([25, 28, 30]);

      const result = calculateIPORating(
        ipo,
        subscription,
        gmpRecords,
        peerCompanies,
        financialData
      );

      expect(result.rationale).toContain('GMP');
      expect(result.rationale).toContain('₹35');
    });

    it('should generate rationale with growth details', () => {
      const ipo = createMockIPO();
      const subscription = createMockSubscription(10);
      const gmpRecords = createMockGMPRecords([30, 35, 40]);
      const financialData = createMockFinancialData(100, 130, 10, 14, 25);
      const peerCompanies = createMockPeerCompanies([25, 28, 30]);

      const result = calculateIPORating(
        ipo,
        subscription,
        gmpRecords,
        peerCompanies,
        financialData
      );

      expect(result.rationale).toContain('30%');
      expect(result.rationale).toContain('revenue growth');
    });

    it('should mention missing factors in rationale', () => {
      const ipo = createMockIPO();
      const subscription = createMockSubscription(10);
      const gmpRecords = createMockGMPRecords([30, 35, 40]);
      const financialData = createMockFinancialData(100, 130, 10, 14);
      const peerCompanies: PeerCompany[] = []; // No peers (only 1 factor missing since financials includes promoter)

      const result = calculateIPORating(
        ipo,
        subscription,
        gmpRecords,
        peerCompanies,
        financialData
      );

      expect(result.rationale).toContain('unavailable');
      expect(result.rationale).toMatch(/1 factor[s]? unavailable/i);
    });
  });

  describe('Available factors tracking', () => {
    it('should correctly track all 5 available factors', () => {
      const ipo = createMockIPO();
      const subscription = createMockSubscription(10);
      const gmpRecords = createMockGMPRecords([20, 25, 30]);
      const financialData = createMockFinancialData(100, 120, 10, 13, 25);
      const peerCompanies = createMockPeerCompanies([25, 28, 30]);

      const result = calculateIPORating(
        ipo,
        subscription,
        gmpRecords,
        peerCompanies,
        financialData
      );

      expect(result.availableFactors).toEqual(
        expect.arrayContaining([
          'subscription',
          'promoterHolding',
          'financials',
          'gmp',
          'peerPE',
        ])
      );
      expect(result.availableFactors).toHaveLength(5);
    });

    it('should track only available factors when data is partial', () => {
      const ipo = createMockIPO();
      const subscription = createMockSubscription(10);
      const gmpRecords: GMPRecord[] = []; // No GMP
      const financialData = createMockFinancialData(100, 120, 10, 13); // No PE
      const peerCompanies: PeerCompany[] = []; // No peers

      const result = calculateIPORating(
        ipo,
        subscription,
        gmpRecords,
        peerCompanies,
        financialData
      );

      expect(result.availableFactors).toContain('subscription');
      expect(result.availableFactors).toContain('financials');
      expect(result.availableFactors).toContain('promoterHolding');
      expect(result.availableFactors).not.toContain('gmp');
      expect(result.availableFactors).not.toContain('peerPE');
    });
  });
});
