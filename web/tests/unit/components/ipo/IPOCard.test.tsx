import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { IPOCard } from '@/components/ipo/IPOCard';
import { IPO, IPOStatus, IPOCategory } from '@/lib/db/types';

// Mock Next.js Link component
vi.mock('next/link', () => ({
  default: ({
    children,
    href,
    onClick,
    className,
  }: {
    children: React.ReactNode;
    href: string;
    onClick?: () => void;
    className?: string;
  }) => (
    <a href={href} onClick={onClick} className={className}>
      {children}
    </a>
  ),
}));

// Helper function to create mock IPO data
const mockIPO = (overrides?: Partial<IPO>): IPO => ({
  id: '123e4567-e89b-12d3-a456-426614174000',
  companyName: 'Example Corp',
  slug: 'example-corp',
  category: 'MAINBOARD' as IPOCategory,
  sector: 'Technology',
  issueSize: '500',
  priceRangeMin: 100,
  priceRangeMax: 120,
  lotSize: 125,
  status: 'OPEN' as IPOStatus,
  openDate: '2025-01-10',
  closeDate: '2025-01-12',
  allotmentDate: '2025-01-15',
  listingDate: '2025-01-17',
  companyDescription: 'A technology company',
  faceValue: 10,
  listingExchanges: ['NSE', 'BSE'],
  registrar: 'Link Intime',
  registrarId: null,
  leadManagers: ['ICICI Securities', 'HDFC Securities'],
  rating: 4,
  ratingRationale: 'Strong fundamentals',
  ratingOverride: false,
  createdAt: new Date('2025-01-01'),
  updatedAt: new Date('2025-01-01'),
  ...overrides,
});

describe('IPOCard', () => {
  describe('Rendering', () => {
    it('should render company name', () => {
      const ipo = mockIPO();
      render(<IPOCard ipo={ipo} />);
      expect(screen.getByText('Example Corp')).toBeInTheDocument();
    });

    it('should render all required fields', () => {
      const ipo = mockIPO();
      render(<IPOCard ipo={ipo} />);

      expect(screen.getByText('Example Corp')).toBeInTheDocument();
      expect(screen.getByText('Open')).toBeInTheDocument();
      expect(screen.getByText('Technology')).toBeInTheDocument();
      expect(screen.getByText('MAINBOARD')).toBeInTheDocument();
      expect(screen.getByText(/₹100/)).toBeInTheDocument();
      expect(screen.getByText(/₹120/)).toBeInTheDocument();
      expect(screen.getByText('125 shares')).toBeInTheDocument();
    });

    it('should handle missing optional fields gracefully', () => {
      const ipo = mockIPO({
        sector: null,
        lotSize: null,
        rating: null,
      });
      render(<IPOCard ipo={ipo} />);

      expect(screen.getByText('Example Corp')).toBeInTheDocument();
      expect(screen.getByText('Not Rated')).toBeInTheDocument();
    });
  });

  describe('Status Badge', () => {
    it.each([
      ['UPCOMING', 'Upcoming', 'bg-blue-500'],
      ['OPEN', 'Open', 'bg-green-500'],
      ['CLOSED', 'Closed', 'bg-gray-500'],
      ['LISTED', 'Listed', 'bg-purple-500'],
    ])('should render %s status with %s label and %s color', (status, label, colorClass) => {
      const ipo = mockIPO({ status: status as IPOStatus });
      render(<IPOCard ipo={ipo} />);

      const badge = screen.getByText(label);
      expect(badge).toBeInTheDocument();
      expect(badge).toHaveClass(colorClass);
    });
  });

  describe('Category Badge', () => {
    it.each([
      ['MAINBOARD'],
      ['SME'],
      ['RIGHTS'],
      ['NCD'],
    ])('should render %s category', (category) => {
      const ipo = mockIPO({ category: category as IPOCategory });
      render(<IPOCard ipo={ipo} />);

      expect(screen.getByText(category)).toBeInTheDocument();
    });
  });

  describe('Price Formatting', () => {
    it('should format price range with ₹ symbol', () => {
      const ipo = mockIPO({ priceRangeMin: 100, priceRangeMax: 120 });
      render(<IPOCard ipo={ipo} />);

      expect(screen.getByText(/₹100/)).toBeInTheDocument();
      expect(screen.getByText(/₹120/)).toBeInTheDocument();
    });

    it('should handle large numbers with comma separators', () => {
      const ipo = mockIPO({ priceRangeMin: 1000, priceRangeMax: 1500 });
      render(<IPOCard ipo={ipo} />);

      // Indian number format uses ₹1,000
      expect(screen.getByText(/₹1,000/)).toBeInTheDocument();
      expect(screen.getByText(/₹1,500/)).toBeInTheDocument();
    });

    it('should handle null price range', () => {
      const ipo = mockIPO({ priceRangeMin: null, priceRangeMax: null });
      render(<IPOCard ipo={ipo} />);

      expect(screen.getByText(/N\/A/)).toBeInTheDocument();
    });
  });

  describe('Date Formatting', () => {
    it('should format dates as "dd MMM yyyy"', () => {
      const ipo = mockIPO({
        openDate: '2025-01-10',
        closeDate: '2025-01-12',
      });
      render(<IPOCard ipo={ipo} />);

      expect(screen.getByText('10 Jan 2025')).toBeInTheDocument();
      expect(screen.getByText('12 Jan 2025')).toBeInTheDocument();
    });

    it('should handle null dates', () => {
      const ipo = mockIPO({
        openDate: null,
        closeDate: null,
      });
      render(<IPOCard ipo={ipo} />);

      // Should show TBA for missing dates
      const tbaElements = screen.getAllByText('TBA');
      expect(tbaElements.length).toBeGreaterThan(0);
    });
  });

  describe('Rating Display', () => {
    it('should display rating stars for rated IPO', () => {
      const ipo = mockIPO({ rating: 4 });
      const { container } = render(<IPOCard ipo={ipo} />);

      // Should display rating value
      expect(screen.getByText('4.0')).toBeInTheDocument();

      // Should render star icons
      const stars = container.querySelectorAll('svg');
      expect(stars.length).toBeGreaterThan(0);
    });

    it('should display half stars for decimal ratings', () => {
      const ipo = mockIPO({ rating: 4.5 });
      render(<IPOCard ipo={ipo} />);

      expect(screen.getByText('4.5')).toBeInTheDocument();
    });

    it('should handle null rating gracefully', () => {
      const ipo = mockIPO({ rating: null });
      render(<IPOCard ipo={ipo} />);

      expect(screen.getByText('Not Rated')).toBeInTheDocument();
    });

    it.each([
      [1, '1.0'],
      [2, '2.0'],
      [3, '3.0'],
      [4, '4.0'],
      [5, '5.0'],
    ])('should display %s star rating', (rating, display) => {
      const ipo = mockIPO({ rating });
      render(<IPOCard ipo={ipo} />);

      expect(screen.getByText(display)).toBeInTheDocument();
    });
  });

  describe('Navigation', () => {
    it('should navigate to IPO detail page on click', () => {
      const ipo = mockIPO({ slug: 'example-corp' });
      render(<IPOCard ipo={ipo} />);

      const link = screen.getByRole('link');
      expect(link).toHaveAttribute('href', '/ipos/example-corp');
    });

    it('should call onClick handler when provided', async () => {
      const user = userEvent.setup();
      const handleClick = vi.fn();
      const ipo = mockIPO();

      render(<IPOCard ipo={ipo} onClick={handleClick} />);

      const link = screen.getByRole('link');
      await user.click(link);

      expect(handleClick).toHaveBeenCalledOnce();
    });

    it('should have correct href for different slugs', () => {
      const ipo = mockIPO({ slug: 'test-company-ipo' });
      render(<IPOCard ipo={ipo} />);

      const link = screen.getByRole('link');
      expect(link).toHaveAttribute('href', '/ipos/test-company-ipo');
    });
  });

  describe('Hover and Visual States', () => {
    it('should apply hover styles', () => {
      const ipo = mockIPO();
      const { container } = render(<IPOCard ipo={ipo} />);

      const link = screen.getByRole('link');
      expect(link).toHaveClass('hover:scale-[1.02]');

      const card = container.querySelector('[data-slot="card"]');
      expect(card).toHaveClass('hover:border-primary');
      expect(card).toHaveClass('hover:shadow-lg');
    });

    it('should have cursor pointer on card', () => {
      const ipo = mockIPO();
      const { container } = render(<IPOCard ipo={ipo} />);

      const card = container.querySelector('[data-slot="card"]');
      expect(card).toHaveClass('cursor-pointer');
    });

    it('should have transition effects', () => {
      const ipo = mockIPO();
      const { container } = render(<IPOCard ipo={ipo} />);

      const link = screen.getByRole('link');
      expect(link).toHaveClass('transition-all');
      expect(link).toHaveClass('duration-200');

      const card = container.querySelector('[data-slot="card"]');
      expect(card).toHaveClass('transition-all');
    });
  });

  describe('Responsive Layout', () => {
    it('should render card with proper structure', () => {
      const ipo = mockIPO();
      const { container } = render(<IPOCard ipo={ipo} />);

      const card = container.querySelector('[data-slot="card"]');
      expect(card).toBeInTheDocument();

      const cardContent = container.querySelector('[data-slot="card-content"]');
      expect(cardContent).toBeInTheDocument();
    });

    it('should have full height card', () => {
      const ipo = mockIPO();
      const { container } = render(<IPOCard ipo={ipo} />);

      const card = container.querySelector('[data-slot="card"]');
      expect(card).toHaveClass('h-full');
    });
  });

  describe('Sector Display', () => {
    it('should display sector when provided', () => {
      const ipo = mockIPO({ sector: 'Healthcare' });
      render(<IPOCard ipo={ipo} />);

      expect(screen.getByText('Healthcare')).toBeInTheDocument();
    });

    it('should not display sector when null', () => {
      const ipo = mockIPO({ sector: null });
      render(<IPOCard ipo={ipo} />);

      // Should still render other elements
      expect(screen.getByText('Example Corp')).toBeInTheDocument();
    });
  });

  describe('Lot Size Display', () => {
    it('should display lot size when provided', () => {
      const ipo = mockIPO({ lotSize: 125 });
      render(<IPOCard ipo={ipo} />);

      expect(screen.getByText('125 shares')).toBeInTheDocument();
    });

    it('should not display lot size when null', () => {
      const ipo = mockIPO({ lotSize: null });
      render(<IPOCard ipo={ipo} />);

      expect(screen.queryByText(/shares/)).not.toBeInTheDocument();
    });
  });

  describe('Accessibility', () => {
    it('should render as a clickable link', () => {
      const ipo = mockIPO();
      render(<IPOCard ipo={ipo} />);

      const link = screen.getByRole('link');
      expect(link).toBeInTheDocument();
    });

    it('should have proper heading hierarchy', () => {
      const ipo = mockIPO();
      render(<IPOCard ipo={ipo} />);

      const heading = screen.getByRole('heading', { level: 3 });
      expect(heading).toHaveTextContent('Example Corp');
    });
  });

  describe('Edge Cases', () => {
    it('should truncate very long company names', () => {
      const longName = 'Very Long Company Name That Should Be Truncated In The Display Area';
      const ipo = mockIPO({ companyName: longName });
      render(<IPOCard ipo={ipo} />);

      const heading = screen.getByText(longName);
      expect(heading).toHaveClass('line-clamp-2');
    });

    it('should handle zero rating', () => {
      const ipo = mockIPO({ rating: 0 });
      render(<IPOCard ipo={ipo} />);

      expect(screen.getByText('0.0')).toBeInTheDocument();
    });

    it('should handle maximum rating', () => {
      const ipo = mockIPO({ rating: 5 });
      render(<IPOCard ipo={ipo} />);

      expect(screen.getByText('5.0')).toBeInTheDocument();
    });
  });
});
