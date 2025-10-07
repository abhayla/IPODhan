/**
 * Unit Tests for ComparisonTable Component
 *
 * Tests:
 * - Table rendering with comparison data
 * - Value highlighting logic (best values in each row)
 * - Loading state skeleton
 * - Error state display
 * - Empty state when no data
 * - Number formatting (currency, percentage)
 * - Responsive behavior
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ComparisonTable } from '@/components/tools/ComparisonTable';
import type { IPOComparison } from '@/lib/types/comparison';

// ==================== TEST DATA ====================

const mockComparisonData: IPOComparison[] = [
  {
    slug: 'alpha-tech-ipo',
    companyName: 'Alpha Tech IPO',
    priceRange: { min: 300, max: 350 },
    lotSize: 40,
    status: 'OPEN',
    subscription: {
      qib: 2.5,
      nii: 3.2,
      retail: 1.8,
      total: 2.4,
    },
    gmp: 50,
    financials: {
      peRatio: 25.5,
      roe: 18.5,
      revenueGrowth: 35.2,
      eps: 12.5,
    },
    rating: 4,
    ratingRationale: 'Good fundamentals and growth potential',
  },
  {
    slug: 'beta-finance-ipo',
    companyName: 'Beta Finance IPO',
    priceRange: { min: 500, max: 600 },
    lotSize: 25,
    status: 'UPCOMING',
    subscription: {
      qib: null,
      nii: null,
      retail: null,
      total: null,
    },
    gmp: 75,
    financials: {
      peRatio: 18.2,
      roe: 22.3,
      revenueGrowth: 28.7,
      eps: 18.9,
    },
    rating: 5,
    ratingRationale: 'Excellent opportunity with strong financials',
  },
  {
    slug: 'gamma-industries-ipo',
    companyName: 'Gamma Industries IPO',
    priceRange: { min: 150, max: 180 },
    lotSize: 75,
    status: 'CLOSED',
    subscription: {
      qib: 3.1,
      nii: 2.8,
      retail: 2.2,
      total: 2.9,
    },
    gmp: 30,
    financials: {
      peRatio: 30.1,
      roe: 15.8,
      revenueGrowth: 20.5,
      eps: 8.2,
    },
    rating: 3,
    ratingRationale: 'Average performance expected',
  },
];

// ==================== TESTS ====================

describe('ComparisonTable Component', () => {
  it('should render loading skeleton when isLoading is true', () => {
    render(<ComparisonTable comparisonData={[]} isLoading={true} />);

    // Check for skeleton elements using data-slot attribute
    const skeletons = screen.getAllByRole('generic', { hidden: true }).filter(
      (el) => el.getAttribute('data-slot') === 'skeleton'
    );
    expect(skeletons.length).toBeGreaterThan(0);
  });

  it('should render error state when error prop is provided', () => {
    const errorMessage = 'Failed to load comparison data';

    render(
      <ComparisonTable comparisonData={[]} error={errorMessage} />
    );

    expect(screen.getByText(errorMessage)).toBeInTheDocument();
  });

  it('should render empty state when no comparison data', () => {
    render(<ComparisonTable comparisonData={[]} />);

    expect(
      screen.getByText(/No comparison data available/i)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Please select at least 2 IPOs/i)
    ).toBeInTheDocument();
  });

  it('should render table with comparison data', () => {
    render(<ComparisonTable comparisonData={mockComparisonData} />);

    // Check for table header
    expect(screen.getByText('IPO Comparison')).toBeInTheDocument();
    expect(
      screen.getByText(/Side-by-side comparison/i)
    ).toBeInTheDocument();

    // Check for company names
    expect(screen.getByText('Alpha Tech IPO')).toBeInTheDocument();
    expect(screen.getByText('Beta Finance IPO')).toBeInTheDocument();
    expect(screen.getByText('Gamma Industries IPO')).toBeInTheDocument();
  });

  it('should display status badges for each IPO', () => {
    render(<ComparisonTable comparisonData={mockComparisonData} />);

    expect(screen.getByText('OPEN')).toBeInTheDocument();
    expect(screen.getByText('UPCOMING')).toBeInTheDocument();
    expect(screen.getByText('CLOSED')).toBeInTheDocument();
  });

  it('should format currency values correctly', () => {
    render(<ComparisonTable comparisonData={mockComparisonData} />);

    // Check for formatted price ranges
    expect(screen.getByText(/₹300 - ₹350/)).toBeInTheDocument();
    expect(screen.getByText(/₹500 - ₹600/)).toBeInTheDocument();
    expect(screen.getByText(/₹150 - ₹180/)).toBeInTheDocument();
  });

  it('should format subscription values correctly', () => {
    render(<ComparisonTable comparisonData={mockComparisonData} />);

    // Check for subscription values with 'x' suffix
    expect(screen.getByText('2.50x')).toBeInTheDocument();
    expect(screen.getByText('3.20x')).toBeInTheDocument();
    expect(screen.getByText('1.80x')).toBeInTheDocument();
  });

  it('should display "N/A" for null values', () => {
    render(<ComparisonTable comparisonData={mockComparisonData} />);

    // Beta Finance has null subscription values
    const naElements = screen.getAllByText('N/A');
    expect(naElements.length).toBeGreaterThan(0);
  });

  it('should display lot size with "shares" suffix', () => {
    render(<ComparisonTable comparisonData={mockComparisonData} />);

    expect(screen.getByText('40 shares')).toBeInTheDocument();
    expect(screen.getByText('25 shares')).toBeInTheDocument();
    expect(screen.getByText('75 shares')).toBeInTheDocument();
  });

  it('should highlight best rating value', () => {
    const { container } = render(
      <ComparisonTable comparisonData={mockComparisonData} />
    );

    // Beta Finance has rating of 5 (highest)
    // Find the cell containing "5/5"
    const ratingCells = container.querySelectorAll('td');
    const bestRatingCell = Array.from(ratingCells).find(
      (cell) => cell.textContent?.includes('5/5')
    );

    expect(bestRatingCell).toBeDefined();
    // Check for highlight class (green background)
    expect(bestRatingCell?.className).toContain('bg-green');
  });

  it('should highlight best GMP value', () => {
    const { container } = render(
      <ComparisonTable comparisonData={mockComparisonData} />
    );

    // Beta Finance has highest GMP (75)
    const cells = container.querySelectorAll('td');
    const gmpCell = Array.from(cells).find(
      (cell) => cell.textContent?.includes('₹75') && cell.className.includes('bg-green')
    );

    expect(gmpCell).toBeDefined();
  });

  it('should highlight best ROE value', () => {
    const { container } = render(
      <ComparisonTable comparisonData={mockComparisonData} />
    );

    // Beta Finance has highest ROE (22.3%)
    const cells = container.querySelectorAll('td');
    const roeCell = Array.from(cells).find(
      (cell) => cell.textContent?.includes('22.30%') && cell.className.includes('bg-green')
    );

    expect(roeCell).toBeDefined();
  });

  it('should highlight lowest P/E ratio (better value)', () => {
    const { container } = render(
      <ComparisonTable comparisonData={mockComparisonData} />
    );

    // Beta Finance has lowest P/E (18.2)
    const cells = container.querySelectorAll('td');
    const peCell = Array.from(cells).find(
      (cell) => cell.textContent?.includes('18.20') && cell.className.includes('bg-green')
    );

    expect(peCell).toBeDefined();
  });

  it('should render all metric rows', () => {
    render(<ComparisonTable comparisonData={mockComparisonData} />);

    // Check for all metric labels
    expect(screen.getByText('Price Range')).toBeInTheDocument();
    expect(screen.getByText('Lot Size')).toBeInTheDocument();
    expect(screen.getByText('QIB Subscription')).toBeInTheDocument();
    expect(screen.getByText('NII Subscription')).toBeInTheDocument();
    expect(screen.getByText('Retail Subscription')).toBeInTheDocument();
    expect(screen.getByText('Total Subscription')).toBeInTheDocument();
    expect(screen.getByText('Current GMP')).toBeInTheDocument();
    expect(screen.getByText('P/E Ratio')).toBeInTheDocument();
    expect(screen.getByText('Return on Equity (ROE)')).toBeInTheDocument();
    expect(screen.getByText('Revenue Growth (CAGR)')).toBeInTheDocument();
    expect(screen.getByText('Earnings Per Share (EPS)')).toBeInTheDocument();
    expect(screen.getByText('IPODhan Rating')).toBeInTheDocument();
  });

  it('should display rating rationale for IPOs with ratings', () => {
    render(<ComparisonTable comparisonData={mockComparisonData} />);

    expect(
      screen.getByText(/Good fundamentals and growth potential/i)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Excellent opportunity with strong financials/i)
    ).toBeInTheDocument();
  });

  it('should render legend explaining highlights', () => {
    render(<ComparisonTable comparisonData={mockComparisonData} />);

    expect(screen.getByText('Best value')).toBeInTheDocument();
    expect(screen.getByText(/N\/A = Data not available/i)).toBeInTheDocument();
  });

  it('should handle 2 IPO comparison', () => {
    const twoIPOs = mockComparisonData.slice(0, 2);

    render(<ComparisonTable comparisonData={twoIPOs} />);

    expect(screen.getByText('Alpha Tech IPO')).toBeInTheDocument();
    expect(screen.getByText('Beta Finance IPO')).toBeInTheDocument();
    expect(screen.queryByText('Gamma Industries IPO')).not.toBeInTheDocument();
  });

  it('should render table element for accessibility', () => {
    render(<ComparisonTable comparisonData={mockComparisonData} />);

    const table = screen.getByRole('table');
    expect(table).toBeInTheDocument();
  });
});
