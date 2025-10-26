/**
 * Unit Tests for AnchorInvestorsSection Component (Story 11.10)
 * Tests all acceptance criteria with >80% coverage target
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AnchorInvestorsSection } from '@/components/ipo/AnchorInvestorsSection';
import type { IndividualInvestor } from '@ipodhan/shared/db/schema';

// ==================== TEST FIXTURES ====================

const mockInvestorList: IndividualInvestor[] = [
  {
    name: 'HDFC Mutual Fund',
    type: 'Mutual Fund',
    shares: 500000,
    amount: 125.50,
    percentOfIssue: 2.5,
  },
  {
    name: 'SBI Life Insurance',
    type: 'Insurance',
    shares: 350000,
    amount: 87.75,
    percentOfIssue: 1.75,
  },
  {
    name: 'Foreign Institutional Investor',
    type: 'FII',
    shares: 250000,
    amount: 62.50,
    percentOfIssue: 1.25,
  },
];

const mockAnchorData = {
  bidDate: '2025-01-15',
  totalSharesOffered: 1000000,
  totalAmountRaised: 250.0,
  anchorInvestorsCount: 25,
  lockIn50PercentDate: '2025-02-14',
  lockInRemainingDate: '2025-04-15',
  investorList: mockInvestorList,
};

// ==================== AGGREGATE SUMMARY RENDERING ====================

describe('AnchorInvestorsSection - Aggregate Summary', () => {
  it('should display bid date with correct formatting (DD MMM YYYY)', () => {
    render(<AnchorInvestorsSection {...mockAnchorData} />);

    expect(screen.getByText('15 Jan 2025')).toBeInTheDocument();
  });

  it('should display shares offered with thousand separators', () => {
    render(<AnchorInvestorsSection {...mockAnchorData} />);

    // Indian number format: 10,00,000
    expect(screen.getByText('10,00,000')).toBeInTheDocument();
  });

  it('should display anchor portion amount (₹ Cr) with 2 decimals', () => {
    render(<AnchorInvestorsSection {...mockAnchorData} />);

    expect(screen.getByText(/₹250\.00 Cr/)).toBeInTheDocument();
  });

  it('should display investor count correctly', () => {
    render(<AnchorInvestorsSection {...mockAnchorData} />);

    expect(screen.getByText('25')).toBeInTheDocument();
  });

  it('should display all four aggregate metric labels', () => {
    render(<AnchorInvestorsSection {...mockAnchorData} />);

    expect(screen.getByText('Anchor Bid Date')).toBeInTheDocument();
    expect(screen.getByText('Shares Offered')).toBeInTheDocument();
    expect(screen.getByText('Anchor Portion')).toBeInTheDocument();
    expect(screen.getByText('Total Investors')).toBeInTheDocument();
  });
});

// ==================== LOCK-IN DATES ====================

describe('AnchorInvestorsSection - Lock-in Dates', () => {
  it('should display 50% lock-in date with correct formatting', () => {
    render(<AnchorInvestorsSection {...mockAnchorData} />);

    expect(screen.getByText('14 Feb 2025')).toBeInTheDocument();
  });

  it('should display remaining lock-in date with correct formatting', () => {
    render(<AnchorInvestorsSection {...mockAnchorData} />);

    expect(screen.getByText('15 Apr 2025')).toBeInTheDocument();
  });

  it('should display lock-in period explanation text', () => {
    render(<AnchorInvestorsSection {...mockAnchorData} />);

    expect(screen.getByText(/30 days from bid date/)).toBeInTheDocument();
    expect(screen.getByText(/90 days from bid date/)).toBeInTheDocument();
  });

  it('should display lock-in period details section title', () => {
    render(<AnchorInvestorsSection {...mockAnchorData} />);

    expect(screen.getByText('Lock-in Period Details')).toBeInTheDocument();
  });
});

// ==================== INVESTOR LIST TABLE ====================

describe('AnchorInvestorsSection - Investor List Table', () => {
  it('should render table when investor_list has data', () => {
    render(<AnchorInvestorsSection {...mockAnchorData} />);

    expect(screen.getByText('Individual Investor Allocations')).toBeInTheDocument();
  });

  it('should display all 5 column headers', () => {
    render(<AnchorInvestorsSection {...mockAnchorData} />);

    expect(screen.getByText('Investor Name')).toBeInTheDocument();
    expect(screen.getByText('Type')).toBeInTheDocument();
    expect(screen.getByText('Shares Allocated')).toBeInTheDocument();
    expect(screen.getByText(/Amount \(₹ Cr\)/)).toBeInTheDocument();
    expect(screen.getByText('% of Issue')).toBeInTheDocument();
  });

  it('should display all investor names', () => {
    render(<AnchorInvestorsSection {...mockAnchorData} />);

    expect(screen.getByText('HDFC Mutual Fund')).toBeInTheDocument();
    expect(screen.getByText('SBI Life Insurance')).toBeInTheDocument();
    expect(screen.getByText('Foreign Institutional Investor')).toBeInTheDocument();
  });

  it('should display shares allocated with thousand separators', () => {
    render(<AnchorInvestorsSection {...mockAnchorData} />);

    expect(screen.getByText('5,00,000')).toBeInTheDocument(); // HDFC
    expect(screen.getByText('3,50,000')).toBeInTheDocument(); // SBI
    expect(screen.getByText('2,50,000')).toBeInTheDocument(); // FII
  });

  it('should display amounts with 2 decimal places', () => {
    render(<AnchorInvestorsSection {...mockAnchorData} />);

    expect(screen.getByText(/₹125\.50/)).toBeInTheDocument();
    expect(screen.getByText(/₹87\.75/)).toBeInTheDocument();
    expect(screen.getByText(/₹62\.50/)).toBeInTheDocument();
  });

  it('should display percentage with 2 decimal places', () => {
    render(<AnchorInvestorsSection {...mockAnchorData} />);

    expect(screen.getByText('2.50%')).toBeInTheDocument();
    expect(screen.getByText('1.75%')).toBeInTheDocument();
    expect(screen.getByText('1.25%')).toBeInTheDocument();
  });

  it('should render type badges for each investor', () => {
    render(<AnchorInvestorsSection {...mockAnchorData} />);

    expect(screen.getByText('Mutual Fund')).toBeInTheDocument();
    expect(screen.getByText('Insurance')).toBeInTheDocument();
    expect(screen.getByText('FII')).toBeInTheDocument();
  });

  it('should not render table when investorList is null', () => {
    render(
      <AnchorInvestorsSection
        {...mockAnchorData}
        investorList={null}
      />
    );

    expect(screen.queryByText('Individual Investor Allocations')).not.toBeInTheDocument();
  });

  it('should not render table when investorList is empty array', () => {
    render(
      <AnchorInvestorsSection
        {...mockAnchorData}
        investorList={[]}
      />
    );

    expect(screen.queryByText('Individual Investor Allocations')).not.toBeInTheDocument();
  });
});

// ==================== EMPTY STATE ====================

describe('AnchorInvestorsSection - Empty State', () => {
  it('should show empty state when bidDate is null', () => {
    render(
      <AnchorInvestorsSection
        bidDate={null}
        totalSharesOffered={1000000}
        totalAmountRaised={250.0}
        anchorInvestorsCount={25}
        lockIn50PercentDate="2025-02-14"
        lockInRemainingDate="2025-04-15"
        investorList={mockInvestorList}
      />
    );

    expect(screen.getByText('Anchor Data Not Available Yet')).toBeInTheDocument();
  });

  it('should show empty state when totalSharesOffered is null', () => {
    render(
      <AnchorInvestorsSection
        bidDate="2025-01-15"
        totalSharesOffered={null}
        totalAmountRaised={250.0}
        anchorInvestorsCount={25}
        lockIn50PercentDate="2025-02-14"
        lockInRemainingDate="2025-04-15"
        investorList={mockInvestorList}
      />
    );

    expect(screen.getByText('Anchor Data Not Available Yet')).toBeInTheDocument();
  });

  it('should show empty state when totalAmountRaised is null', () => {
    render(
      <AnchorInvestorsSection
        bidDate="2025-01-15"
        totalSharesOffered={1000000}
        totalAmountRaised={null}
        anchorInvestorsCount={25}
        lockIn50PercentDate="2025-02-14"
        lockInRemainingDate="2025-04-15"
        investorList={mockInvestorList}
      />
    );

    expect(screen.getByText('Anchor Data Not Available Yet')).toBeInTheDocument();
  });

  it('should show empty state when anchorInvestorsCount is null', () => {
    render(
      <AnchorInvestorsSection
        bidDate="2025-01-15"
        totalSharesOffered={1000000}
        totalAmountRaised={250.0}
        anchorInvestorsCount={null}
        lockIn50PercentDate="2025-02-14"
        lockInRemainingDate="2025-04-15"
        investorList={mockInvestorList}
      />
    );

    expect(screen.getByText('Anchor Data Not Available Yet')).toBeInTheDocument();
  });

  it('should display correct empty state message text', () => {
    render(
      <AnchorInvestorsSection
        bidDate={null}
        totalSharesOffered={null}
        totalAmountRaised={null}
        anchorInvestorsCount={null}
        lockIn50PercentDate={null}
        lockInRemainingDate={null}
        investorList={null}
      />
    );

    expect(
      screen.getByText(/Anchor investor allocation details will be available/)
    ).toBeInTheDocument();
  });

  it('should show "Individual Investor Details Not Available" when no investor list', () => {
    render(
      <AnchorInvestorsSection
        {...mockAnchorData}
        investorList={null}
      />
    );

    expect(screen.getByText('Individual Investor Details Not Available')).toBeInTheDocument();
  });
});

// ==================== EDGE CASES ====================

describe('AnchorInvestorsSection - Edge Cases', () => {
  it('should handle very large numbers with correct formatting', () => {
    render(
      <AnchorInvestorsSection
        bidDate="2025-01-15"
        totalSharesOffered={999999999}
        totalAmountRaised={9999.99}
        anchorInvestorsCount={100}
        lockIn50PercentDate="2025-02-14"
        lockInRemainingDate="2025-04-15"
        investorList={null}
      />
    );

    expect(screen.getByText('99,99,99,999')).toBeInTheDocument();
    expect(screen.getByText(/₹9,999\.99 Cr/)).toBeInTheDocument();
  });

  it('should handle zero investor count', () => {
    render(
      <AnchorInvestorsSection
        {...mockAnchorData}
        anchorInvestorsCount={0}
      />
    );

    expect(screen.getByText('0')).toBeInTheDocument();
  });

  it('should handle single investor in list', () => {
    const singleInvestor = [mockInvestorList[0]];

    render(
      <AnchorInvestorsSection
        {...mockAnchorData}
        investorList={singleInvestor}
      />
    );

    expect(screen.getByText('HDFC Mutual Fund')).toBeInTheDocument();
    expect(screen.queryByText('SBI Life Insurance')).not.toBeInTheDocument();
  });

  it('should handle decimal amounts correctly', () => {
    render(
      <AnchorInvestorsSection
        {...mockAnchorData}
        totalAmountRaised={123.45}
      />
    );

    expect(screen.getByText(/₹123\.45 Cr/)).toBeInTheDocument();
  });

  it('should handle investor with 0% of issue', () => {
    const customInvestor: IndividualInvestor[] = [
      {
        name: 'Test Investor',
        type: 'HNI',
        shares: 100,
        amount: 0.01,
        percentOfIssue: 0.0,
      },
    ];

    render(
      <AnchorInvestorsSection
        {...mockAnchorData}
        investorList={customInvestor}
      />
    );

    expect(screen.getByText('0.00%')).toBeInTheDocument();
  });

  it('should format invalid date as "Invalid Date"', () => {
    render(
      <AnchorInvestorsSection
        {...mockAnchorData}
        bidDate="invalid-date"
      />
    );

    expect(screen.getByText('Invalid Date')).toBeInTheDocument();
  });

  it('should display helper note text at bottom', () => {
    render(<AnchorInvestorsSection {...mockAnchorData} />);

    expect(
      screen.getByText(/Anchor investor data is sourced from/)
    ).toBeInTheDocument();
  });

  it('should render component title correctly', () => {
    render(<AnchorInvestorsSection {...mockAnchorData} />);

    expect(screen.getByText('Anchor Investors Details')).toBeInTheDocument();
  });
});

// ==================== FORMATTING FUNCTIONS ====================

describe('AnchorInvestorsSection - Formatting Functions', () => {
  it('should format numbers in Indian locale (lakhs/crores)', () => {
    render(
      <AnchorInvestorsSection
        {...mockAnchorData}
        totalSharesOffered={12345678}
      />
    );

    // Indian format: 1,23,45,678
    expect(screen.getByText('1,23,45,678')).toBeInTheDocument();
  });

  it('should maintain precision for decimal amounts', () => {
    const preciseInvestor: IndividualInvestor[] = [
      {
        name: 'Precise Investor',
        type: 'Corporate',
        shares: 1000,
        amount: 0.01,
        percentOfIssue: 0.01,
      },
    ];

    render(
      <AnchorInvestorsSection
        {...mockAnchorData}
        investorList={preciseInvestor}
      />
    );

    expect(screen.getByText(/₹0\.01/)).toBeInTheDocument();
    expect(screen.getByText('0.01%')).toBeInTheDocument();
  });

  it('should handle null lock-in dates gracefully', () => {
    render(
      <AnchorInvestorsSection
        {...mockAnchorData}
        lockIn50PercentDate={null}
        lockInRemainingDate={null}
      />
    );

    const naTexts = screen.getAllByText('N/A');
    expect(naTexts.length).toBeGreaterThanOrEqual(2);
  });
});
