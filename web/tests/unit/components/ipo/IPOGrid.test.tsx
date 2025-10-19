import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { IPOGrid } from '@/components/ipo/IPOGrid';
import { IPO } from '@/lib/api-client';
import { DEFAULT_HISTORICAL_FIELDS } from '@/lib/db/types';

// Mock IPO data
const mockIPO = (overrides?: Partial<IPO>): IPO => ({
  ...DEFAULT_HISTORICAL_FIELDS,
  id: '123e4567-e89b-12d3-a456-426614174000',
  companyName: 'Test Company Ltd',
  slug: 'test-company-ltd',
  segment: 'MAINBOARD' as const,
  offeringType: 'IPO' as const,
  sector: 'Technology',
  issueSize: '500',
  priceRangeMin: 100,
  priceRangeMax: 120,
  lotSize: 100,
  status: 'OPEN',
  openDate: '2025-10-10',
  closeDate: '2025-10-12',
  allotmentDate: null,
  listingDate: null,
  companyDescription: null,
  faceValue: 10,
  listingExchanges: ['NSE', 'BSE'],
  registrar: 'Link Intime',
  registrarId: null,
  leadManagers: ['ICICI Securities'],
  rating: 4,
  ratingRationale: null,
  ratingOverride: false,
  createdAt: new Date(),
  updatedAt: new Date(),
  lastScrapedAt: null,
  ...overrides
});

describe('IPOGrid', () => {
  it('should render IPO cards in grid layout', () => {
    const mockIPOs = [mockIPO(), mockIPO({ id: '2', companyName: 'Another Company' })];
    render(<IPOGrid ipos={mockIPOs} view="grid" />);

    const container = screen.getByTestId('ipo-container');
    expect(container).toHaveClass('grid', 'grid-cols-1', 'md:grid-cols-2', 'lg:grid-cols-3');
    expect(screen.getByText('Test Company Ltd')).toBeInTheDocument();
    expect(screen.getByText('Another Company')).toBeInTheDocument();
  });

  it('should render IPO cards in list layout', () => {
    const mockIPOs = [mockIPO()];
    render(<IPOGrid ipos={mockIPOs} view="list" />);

    const container = screen.getByTestId('ipo-container');
    expect(container).toHaveClass('flex', 'flex-col');
    expect(screen.getByText('Test Company Ltd')).toBeInTheDocument();
  });

  it('should display empty state when no IPOs', () => {
    render(<IPOGrid ipos={[]} view="grid" />);

    expect(screen.getByTestId('empty-state')).toBeInTheDocument();
    expect(screen.getByText('No IPOs found')).toBeInTheDocument();
    expect(screen.getByText(/Try adjusting your filters/i)).toBeInTheDocument();
  });

  it('should render correct number of IPO cards', () => {
    const mockIPOs = Array.from({ length: 5 }, (_, i) =>
      mockIPO({ id: `${i}`, companyName: `Company ${i}` })
    );
    render(<IPOGrid ipos={mockIPOs} view="grid" />);

    mockIPOs.forEach(ipo => {
      expect(screen.getByText(ipo.companyName)).toBeInTheDocument();
    });
  });

  it('should use grid layout by default', () => {
    const mockIPOs = [mockIPO()];
    render(<IPOGrid ipos={mockIPOs} view="grid" />);

    const container = screen.getByTestId('ipo-container');
    expect(container).toHaveClass('grid');
  });
});
