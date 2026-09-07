import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FinancialTable, hasEnhancedMetrics } from '@/components/ipo/FinancialTable';
import type { FinancialData, IpoFinancials } from '@/lib/db/types';

const financialData: FinancialData = {
  id: 'fd-1',
  ipoId: 'ipo-1',
  revenueFy2022: '300.00',
  revenueFy2023: '380.10',
  revenueFy2024: '450.50',
  profitFy2022: '20.00',
  profitFy2023: '30.00',
  profitFy2024: '45.20',
  netWorth: null,
  peRatio: '25.50',
  eps: null,
  roe: '18.30',
  debtToEquity: '0.45',
  reservesAndSurplus: null,
  totalAssets: null,
  totalBorrowing: null,
  promoterHoldingPreIssue: null,
  promoterHoldingPostIssue: null,
} as unknown as FinancialData;

function ipoFinancialsFixture(overrides: Partial<IpoFinancials> = {}): IpoFinancials {
  return {
    id: 'ipf-1',
    ipoId: 'ipo-1',
    revenueFy1: '450.50',
    revenueFy2: '380.10',
    revenueFy3: '300.00',
    profitFy1: '45.20',
    profitFy2: '30.00',
    profitFy3: '20.00',
    peRatio: '25.50',
    roePercentage: '18.30',
    debtToEquity: '0.45',
    pbRatio: null,
    rocePercentage: null,
    industryPe: null,
    peerCompanies: null,
    financialYearEnd: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as unknown as IpoFinancials;
}

describe('hasEnhancedMetrics (T-477 round 2, N1)', () => {
  it('is false when ipoFinancials is null/undefined', () => {
    expect(hasEnhancedMetrics(null)).toBe(false);
    expect(hasEnhancedMetrics(undefined)).toBe(false);
  });

  it('is false when all five enhanced fields are NULL (a migrated-but-not-extracted row)', () => {
    expect(hasEnhancedMetrics(ipoFinancialsFixture())).toBe(false);
  });

  it('is true when pbRatio is present', () => {
    expect(hasEnhancedMetrics(ipoFinancialsFixture({ pbRatio: '2.10' }))).toBe(true);
  });

  it('is true when peerCompanies has entries', () => {
    expect(hasEnhancedMetrics(ipoFinancialsFixture({ peerCompanies: ['Peer A'] }))).toBe(true);
  });
});

describe('FinancialTable Enhanced Metrics section gating (T-477 round 2, N1)', () => {
  it('does NOT render "Enhanced Metrics" when ipoFinancials has all five fields NULL', () => {
    render(<FinancialTable financialData={financialData} ipoFinancials={ipoFinancialsFixture()} />);
    expect(screen.queryByText('Enhanced Metrics')).not.toBeInTheDocument();
  });

  it('DOES render "Enhanced Metrics" when pbRatio is present', () => {
    render(
      <FinancialTable
        financialData={financialData}
        ipoFinancials={ipoFinancialsFixture({ pbRatio: '2.10' })}
      />
    );
    expect(screen.getByText('Enhanced Metrics')).toBeInTheDocument();
  });
});
