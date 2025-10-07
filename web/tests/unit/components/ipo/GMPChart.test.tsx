import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { GMPChart } from '@/components/ipo/GMPChart';
import type { GMPRecord } from '@/lib/db/types';

const mockGMPRecords: GMPRecord[] = [
  {
    id: '1',
    ipoId: 'ipo-1',
    timestamp: new Date('2025-01-01'),
    gmp: 100,
    expectedListingPrice: 220,
    subjectRate: 50,
    kostakRate: 30,
    saudaDetails: null,
    source: 'Market',
  },
  {
    id: '2',
    ipoId: 'ipo-1',
    timestamp: new Date('2025-01-02'),
    gmp: 120,
    expectedListingPrice: 240,
    subjectRate: 60,
    kostakRate: 35,
    saudaDetails: null,
    source: 'Market',
  },
  {
    id: '3',
    ipoId: 'ipo-1',
    timestamp: new Date('2025-01-03'),
    gmp: 110,
    expectedListingPrice: 230,
    subjectRate: 55,
    kostakRate: 32,
    saudaDetails: null,
    source: 'Market',
  },
];

describe('GMPChart', () => {
  it('should display "no data" message when gmpRecords is empty', () => {
    render(<GMPChart gmpRecords={[]} />);
    expect(screen.getByText('No GMP data available yet')).toBeInTheDocument();
  });

  it('should render chart with data', () => {
    render(<GMPChart gmpRecords={mockGMPRecords} />);
    expect(screen.getByText('Grey Market Premium Trend')).toBeInTheDocument();
  });

  it('should display latest GMP value', () => {
    render(<GMPChart gmpRecords={mockGMPRecords} />);
    // Latest record has GMP of 110
    expect(screen.getByText(/₹110/)).toBeInTheDocument();
  });

  it('should display expected listing price', () => {
    render(<GMPChart gmpRecords={mockGMPRecords} />);
    expect(screen.getByText(/Expected Listing Price/)).toBeInTheDocument();
    expect(screen.getByText(/₹230/)).toBeInTheDocument();
  });

  it('should apply green color for positive GMP', () => {
    const { container } = render(<GMPChart gmpRecords={mockGMPRecords} />);
    const positiveGMP = container.querySelector('.text-green-600');
    expect(positiveGMP).toBeInTheDocument();
  });

  it('should apply red color for negative GMP', () => {
    const negativeRecords = [
      {
        ...mockGMPRecords[0],
        gmp: -50,
        expectedListingPrice: 70,
      },
    ];
    const { container } = render(<GMPChart gmpRecords={negativeRecords} />);
    const negativeGMP = container.querySelector('.text-red-600');
    expect(negativeGMP).toBeInTheDocument();
  });

  it('should handle single record', () => {
    render(<GMPChart gmpRecords={[mockGMPRecords[0]]} />);
    expect(screen.getByText('Grey Market Premium Trend')).toBeInTheDocument();
  });
});
