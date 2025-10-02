import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { IPOCard } from '@/components/ipo/IPOCard';
import type { IPO, IPOScore } from '@/types/ipo';

const mockIPO: IPO = {
  id: '1',
  symbol: 'TEST',
  companyName: 'Test Company Ltd',
  issueSize: 500000000,
  priceBand: { low: 100, high: 120 },
  lotSize: 100,
  dates: {
    open: new Date('2025-10-05'),
    close: new Date('2025-10-08'),
    listing: new Date('2025-10-12'),
  },
  status: 'LIVE',
  category: 'MAINBOARD',
  createdAt: new Date(),
  updatedAt: new Date(),
};

const mockScore: IPOScore = {
  id: '1',
  ipoId: '1',
  totalScore: 75,
  components: {
    fundamental: 30,
    sentiment: 25,
    subscription: 15,
    sector: 5,
  },
  verdict: 'APPLY',
  confidence: 'HIGH',
  reasoning: 'Strong fundamentals',
  algorithmVersion: '1.0',
  calculatedAt: new Date(),
};

describe('IPOCard', () => {
  it('renders IPO company name and symbol', () => {
    render(<IPOCard ipo={mockIPO} />);

    expect(screen.getByText('Test Company Ltd')).toBeInTheDocument();
    expect(screen.getByText('TEST')).toBeInTheDocument();
  });

  it('displays score when provided', () => {
    render(<IPOCard ipo={mockIPO} score={mockScore} />);

    expect(screen.getByText('75')).toBeInTheDocument();
  });

  it('displays category badge', () => {
    render(<IPOCard ipo={mockIPO} />);

    expect(screen.getByText('MAINBOARD')).toBeInTheDocument();
  });

  it('displays price band correctly', () => {
    render(<IPOCard ipo={mockIPO} />);

    expect(screen.getByText(/₹100 - ₹120/)).toBeInTheDocument();
  });

  it('shows View Details button', () => {
    render(<IPOCard ipo={mockIPO} />);

    expect(screen.getByRole('button', { name: /view details/i })).toBeInTheDocument();
  });

  it('renders SME category with different styling', () => {
    const smeIPO = { ...mockIPO, category: 'SME' as const };
    render(<IPOCard ipo={smeIPO} />);

    expect(screen.getByText('SME')).toBeInTheDocument();
  });
});
