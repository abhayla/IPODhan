/**
 * Unit Tests for Peer Comparison Service
 *
 * Tests for:
 * - getPeerComparison function
 * - Industry average calculation
 * - Edge cases (null values, empty arrays)
 *
 * Story 4.8: Peer Comparison Tab
 */

import { describe, it, expect } from 'vitest';
import { getPeerComparison } from '@/lib/services/peer-comparison-service';
import type { PeerCompany, FinancialData } from '@ipodhan/shared/types/types';

// ==================== TEST FIXTURES ====================

const mockFinancialData: FinancialData = {
  id: 'financial-1',
  ipoId: 'ipo-1',
  revenueFy2022: '100',
  revenueFy2023: '120',
  revenueFy2024: '150',
  profitFy2022: '10',
  profitFy2023: '15',
  profitFy2024: '20',
  netWorth: '500',
  peRatio: '25.5',
  eps: '15.75',
  roe: '18.5',
  debtToEquity: '0.5',
  reservesAndSurplus: '200',
  totalAssets: '800',
  totalBorrowing: '100',
};

const mockPeerCompanies: PeerCompany[] = [
  {
    id: 'peer-1',
    ipoId: 'ipo-1',
    companyName: 'Peer Company A',
    sector: 'Technology',
    isListed: true,
    peRatio: '20.0',
    eps: '12.5',
    dilutedEps: '12.0',
    ronw: '15.0',
    nav: '100.0',
    pbvRatio: '3.5',
    financialStatementType: 'CONSOLIDATED',
    dataSource: 'Moneycontrol',
    lastUpdated: new Date('2024-01-15'),
    createdAt: new Date('2024-01-10'),
  },
  {
    id: 'peer-2',
    ipoId: 'ipo-1',
    companyName: 'Peer Company B',
    sector: 'Technology',
    isListed: true,
    peRatio: '22.0',
    eps: '14.0',
    dilutedEps: '13.5',
    ronw: '17.0',
    nav: '120.0',
    pbvRatio: '4.0',
    financialStatementType: 'CONSOLIDATED',
    dataSource: 'Moneycontrol',
    lastUpdated: new Date('2024-01-20'),
    createdAt: new Date('2024-01-10'),
  },
  {
    id: 'peer-3',
    ipoId: 'ipo-1',
    companyName: 'Peer Company C',
    sector: 'Technology',
    isListed: false,
    peRatio: '18.0',
    eps: '11.0',
    dilutedEps: '10.8',
    ronw: '14.0',
    nav: '90.0',
    pbvRatio: '3.0',
    financialStatementType: 'STANDALONE',
    dataSource: 'Moneycontrol',
    lastUpdated: new Date('2024-01-18'),
    createdAt: new Date('2024-01-10'),
  },
];

// ==================== TESTS ====================

describe('getPeerComparison', () => {
  it('should return null when peer companies array is empty', () => {
    const result = getPeerComparison(
      'Test Company',
      'Technology',
      mockFinancialData,
      []
    );

    expect(result).toBeNull();
  });

  it('should return null when peer companies is null', () => {
    const result = getPeerComparison(
      'Test Company',
      'Technology',
      mockFinancialData,
      null as any
    );

    expect(result).toBeNull();
  });

  it('should calculate correct industry averages', () => {
    const result = getPeerComparison(
      'Test Company',
      'Technology',
      mockFinancialData,
      mockPeerCompanies
    );

    expect(result).not.toBeNull();
    expect(result!.industryAverageRow).toMatchObject({
      companyName: 'Industry Average',
      sector: 'Technology',
      listedStatus: '-',
      isIPO: false,
      isIndustryAverage: true,
    });

    // P/E average: (20 + 22 + 18) / 3 = 20
    expect(result!.industryAverageRow.peRatio).toBe(20);

    // EPS average: (12.5 + 14 + 11) / 3 = 12.5
    expect(result!.industryAverageRow.eps).toBe(12.5);

    // Diluted EPS average: (12 + 13.5 + 10.8) / 3 = 12.1
    expect(result!.industryAverageRow.dilutedEps).toBeCloseTo(12.1, 1);

    // RONW average: (15 + 17 + 14) / 3 = 15.33...
    expect(result!.industryAverageRow.ronw).toBeCloseTo(15.33, 1);

    // NAV average: (100 + 120 + 90) / 3 = 103.33...
    expect(result!.industryAverageRow.nav).toBeCloseTo(103.33, 1);

    // PBV average: (3.5 + 4 + 3) / 3 = 3.5
    expect(result!.industryAverageRow.pbvRatio).toBeCloseTo(3.5, 1);
  });

  it('should create correct IPO row from financial data', () => {
    const result = getPeerComparison(
      'Test Company',
      'Technology',
      mockFinancialData,
      mockPeerCompanies
    );

    expect(result).not.toBeNull();
    expect(result!.ipoRow).toMatchObject({
      companyName: 'Test Company',
      sector: 'Technology',
      listedStatus: 'IPO',
      peRatio: 25.5,
      eps: 15.75,
      ronw: 18.5, // Using ROE as proxy
      isIPO: true,
      isIndustryAverage: false,
    });

    // Fields not available in IPO financialData should be null
    expect(result!.ipoRow.dilutedEps).toBeNull();
    expect(result!.ipoRow.nav).toBeNull();
    expect(result!.ipoRow.pbvRatio).toBeNull();
  });

  it('should create correct peer rows', () => {
    const result = getPeerComparison(
      'Test Company',
      'Technology',
      mockFinancialData,
      mockPeerCompanies
    );

    expect(result).not.toBeNull();
    expect(result!.peerRows).toHaveLength(3);

    expect(result!.peerRows[0]).toMatchObject({
      companyName: 'Peer Company A',
      sector: 'Technology',
      listedStatus: 'Listed',
      peRatio: 20,
      eps: 12.5,
      dilutedEps: 12,
      ronw: 15,
      nav: 100,
      pbvRatio: 3.5,
      isIPO: false,
      isIndustryAverage: false,
    });

    expect(result!.peerRows[2]).toMatchObject({
      companyName: 'Peer Company C',
      listedStatus: 'Unlisted',
    });
  });

  it('should handle null financial data for IPO', () => {
    const result = getPeerComparison(
      'Test Company',
      'Technology',
      null,
      mockPeerCompanies
    );

    expect(result).not.toBeNull();
    expect(result!.ipoRow).toMatchObject({
      companyName: 'Test Company',
      sector: 'Technology',
      listedStatus: 'IPO',
      peRatio: null,
      eps: null,
      dilutedEps: null,
      ronw: null,
      nav: null,
      pbvRatio: null,
      isIPO: true,
    });
  });

  it('should handle peers with null values in average calculation', () => {
    const peersWithNulls: PeerCompany[] = [
      ...mockPeerCompanies,
      {
        id: 'peer-4',
        ipoId: 'ipo-1',
        companyName: 'Peer Company D',
        sector: 'Technology',
        isListed: true,
        peRatio: null,
        eps: null,
        dilutedEps: null,
        ronw: null,
        nav: null,
        pbvRatio: null,
        financialStatementType: null,
        dataSource: 'Moneycontrol',
        lastUpdated: null,
        createdAt: new Date('2024-01-10'),
      },
    ];

    const result = getPeerComparison(
      'Test Company',
      'Technology',
      mockFinancialData,
      peersWithNulls
    );

    expect(result).not.toBeNull();

    // Averages should be calculated only from non-null values (3 peers, not 4)
    expect(result!.industryAverageRow.peRatio).toBe(20);
    expect(result!.industryAverageRow.eps).toBe(12.5);
  });

  it('should set data source and last updated correctly', () => {
    const result = getPeerComparison(
      'Test Company',
      'Technology',
      mockFinancialData,
      mockPeerCompanies
    );

    expect(result).not.toBeNull();
    expect(result!.dataSource).toBe('Moneycontrol');

    // Should use the latest date (2024-01-20)
    expect(result!.lastUpdated).toEqual(new Date('2024-01-20'));
  });

  it('should handle missing sector gracefully', () => {
    const result = getPeerComparison(
      'Test Company',
      null,
      mockFinancialData,
      mockPeerCompanies
    );

    expect(result).not.toBeNull();
    expect(result!.ipoRow.sector).toBeNull();
    expect(result!.industryAverageRow.sector).toBeNull();
  });

  it('should determine most common financial statement type', () => {
    const result = getPeerComparison(
      'Test Company',
      'Technology',
      mockFinancialData,
      mockPeerCompanies
    );

    expect(result).not.toBeNull();
    // 2 CONSOLIDATED vs 1 STANDALONE, should pick CONSOLIDATED
    expect(result!.financialStatementType).toBe('CONSOLIDATED');
  });

  it('should handle all peers with null financial statement type', () => {
    const peersNoStatementType: PeerCompany[] = mockPeerCompanies.map(peer => ({
      ...peer,
      financialStatementType: null,
    }));

    const result = getPeerComparison(
      'Test Company',
      'Technology',
      mockFinancialData,
      peersNoStatementType
    );

    expect(result).not.toBeNull();
    expect(result!.financialStatementType).toBeNull();
  });

  it('should handle peers with no last updated date', () => {
    const peersNoDate: PeerCompany[] = mockPeerCompanies.map(peer => ({
      ...peer,
      lastUpdated: null,
    }));

    const result = getPeerComparison(
      'Test Company',
      'Technology',
      mockFinancialData,
      peersNoDate
    );

    expect(result).not.toBeNull();
    expect(result!.lastUpdated).toBeNull();
  });
});
