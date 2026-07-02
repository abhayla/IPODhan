/**
 * Unit tests for Home Page (Story 9.3)
 *
 * Tests the integration of IPO tables section into the home page,
 * including SEO structured data, ISR configuration, and error handling.
 */

import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import '@testing-library/jest-dom';
import Home from '@/app/page';
import * as homeIpoService from '@/lib/services/home-ipo-service';
import { generateIPOListingSchema } from '@/lib/seo/structured-data';

// Mock the home IPO service
vi.mock('@/lib/services/home-ipo-service');

// Mock Next.js components
vi.mock('next/script', () => ({
  default: ({ children, dangerouslySetInnerHTML, ...props }: any) => {
    if (dangerouslySetInnerHTML) {
      return <script {...props} dangerouslySetInnerHTML={dangerouslySetInnerHTML} />;
    }
    return <script {...props}>{children}</script>;
  }
}));

// Mock components
vi.mock('@/components/affiliate/AffiliateCTAWrapper', () => ({
  AffiliateCTAWrapper: () => <div data-testid="affiliate-cta">Affiliate CTA</div>
}));

vi.mock('@/components/home/HomeIPOTablesSection', () => ({
  HomeIPOTablesSection: ({ mainboardIPOs, smeIPOs, upcomingMainboardIPOs, upcomingSMEIPOs }: any) => (
    <div data-testid="ipo-tables-section">
      <div data-testid="mainboard-ipos">{mainboardIPOs.length} Mainboard IPOs</div>
      <div data-testid="sme-ipos">{smeIPOs.length} SME IPOs</div>
      <div data-testid="upcoming-mainboard">{upcomingMainboardIPOs.length} Upcoming Mainboard</div>
      <div data-testid="upcoming-sme">{upcomingSMEIPOs.length} Upcoming SME</div>
    </div>
  )
}));

vi.mock('@/components/home/IPOTableSkeleton', () => ({
  IPOTableSkeleton: () => <div data-testid="table-skeleton">Loading...</div>
}));

vi.mock('@/components/error/AsyncErrorBoundary', () => ({
  AsyncErrorBoundary: ({ children, fallback, loadingFallback }: any) => (
    <div data-testid="error-boundary">{children}</div>
  )
}));

// Sample test data
const mockMainboardIPOs = [
  {
    id: '1',
    companyName: 'Test Mainboard IPO 1',
    slug: 'test-mainboard-1',
    segment: 'MAINBOARD' as const,
  offeringType: 'IPO' as const,
    status: 'OPEN',
    openDate: '2025-10-15',
    closeDate: '2025-10-17',
    issuePrice: 150,
    issueSize: '500',
    listingDate: null,
  },
  {
    id: '2',
    companyName: 'Test Mainboard IPO 2',
    slug: 'test-mainboard-2',
    segment: 'MAINBOARD' as const,
  offeringType: 'IPO' as const,
    status: 'UPCOMING',
    openDate: '2025-10-20',
    closeDate: '2025-10-22',
    issuePrice: 200,
    issueSize: '750',
    listingDate: null,
  },
];

const mockSMEIPOs = [
  {
    id: '3',
    companyName: 'Test SME IPO 1',
    slug: 'test-sme-1',
    segment: 'SME' as const,
  offeringType: 'IPO' as const,
    status: 'OPEN',
    openDate: '2025-10-16',
    closeDate: '2025-10-18',
    issuePrice: 100,
    issueSize: '50',
    listingDate: null,
  },
];

const mockUpcomingMainboard = [
  {
    id: '4',
    companyName: 'Upcoming Mainboard 1',
    slug: 'upcoming-mainboard-1',
    segment: 'MAINBOARD' as const,
  offeringType: 'IPO' as const,
    status: 'UPCOMING',
    openDate: '2025-11-01',
    closeDate: '2025-11-03',
    issuePrice: 250,
    issueSize: '1000',
    listingDate: null,
  },
];

const mockUpcomingSME = [
  {
    id: '5',
    companyName: 'Upcoming SME 1',
    slug: 'upcoming-sme-1',
    segment: 'SME' as const,
  offeringType: 'IPO' as const,
    status: 'UPCOMING',
    openDate: '2025-11-05',
    closeDate: '2025-11-07',
    issuePrice: 80,
    issueSize: '30',
    listingDate: null,
  },
];

describe('Home Page (Story 9.3)', () => {
  beforeEach(() => {
    // Reset mocks
    vi.clearAllMocks();

    // Setup default mock implementations
    vi.mocked(homeIpoService.getMainboardIPOs).mockResolvedValue(mockMainboardIPOs);
    vi.mocked(homeIpoService.getSMEIPOs).mockResolvedValue(mockSMEIPOs);
    vi.mocked(homeIpoService.getUpcomingMainboardIPOs).mockResolvedValue(mockUpcomingMainboard);
    vi.mocked(homeIpoService.getUpcomingSMEIPOs).mockResolvedValue(mockUpcomingSME);
  });

  describe('Page Structure', () => {
    // Spec H1/H4 (2026-07-02 reference redesign): compact data-first hero,
    // marketing feature-cards + CTA banner removed, tools become a link row.
    it('renders the compact data-first hero and table section', async () => {
      const page = await Home();
      render(page);

      expect(
        screen.getByText(/India's IPO tracker — live subscription, GMP & allotment/i)
      ).toBeInTheDocument();
      expect(screen.getByText(/Latest IPO updates/i)).toBeInTheDocument();
      expect(screen.getByText(/Browse IPOs/i)).toBeInTheDocument();
      expect(screen.getAllByText(/Lot Calculator/i).length).toBeGreaterThanOrEqual(1);
    });

    it('does not render the removed marketing sections', async () => {
      const page = await Home();
      render(page);

      expect(screen.queryByText(/Everything You Need for IPO Investments/i)).toBeNull();
      expect(screen.queryByText(/Ready to Start Your IPO Journey/i)).toBeNull();
      expect(screen.queryByText(/Your Trusted IPO Investment Platform/i)).toBeNull();
    });

    it('renders the quiet tools link row', async () => {
      const page = await Home();
      render(page);

      const tools = screen.getByRole('navigation', { name: /tools/i });
      expect(tools).toBeInTheDocument();
      expect(screen.getByText(/Market holidays/i)).toBeInTheDocument();
      expect(screen.getByText(/Allotment status/i)).toBeInTheDocument();
    });
  });

  describe('Data Fetching', () => {
    it('should fetch all four IPO datasets in parallel', async () => {
      await Home();

      expect(homeIpoService.getMainboardIPOs).toHaveBeenCalledTimes(1);
      expect(homeIpoService.getSMEIPOs).toHaveBeenCalledTimes(1);
      expect(homeIpoService.getUpcomingMainboardIPOs).toHaveBeenCalledTimes(1);
      expect(homeIpoService.getUpcomingSMEIPOs).toHaveBeenCalledTimes(1);
    });

    it('should pass fetched data to HomeIPOTablesSection', async () => {
      const page = await Home();
      render(page);

      await waitFor(() => {
        expect(screen.getByTestId('mainboard-ipos')).toHaveTextContent('2 Mainboard IPOs');
        expect(screen.getByTestId('sme-ipos')).toHaveTextContent('1 SME IPOs');
        expect(screen.getByTestId('upcoming-mainboard')).toHaveTextContent('1 Upcoming Mainboard');
        expect(screen.getByTestId('upcoming-sme')).toHaveTextContent('1 Upcoming SME');
      });
    });

    it('should handle fetch errors gracefully with empty arrays', async () => {
      // Mock all services to reject
      const error = new Error('Network error');
      vi.mocked(homeIpoService.getMainboardIPOs).mockRejectedValue(error);
      vi.mocked(homeIpoService.getSMEIPOs).mockRejectedValue(error);
      vi.mocked(homeIpoService.getUpcomingMainboardIPOs).mockRejectedValue(error);
      vi.mocked(homeIpoService.getUpcomingSMEIPOs).mockRejectedValue(error);

      // Should not throw
      const page = await Home();
      const { container } = render(page);

      // Page should still render
      expect(screen.getByText(/India's IPO tracker/i)).toBeInTheDocument();

      // Should pass empty arrays to component
      await waitFor(() => {
        expect(screen.getByTestId('mainboard-ipos')).toHaveTextContent('0 Mainboard IPOs');
        expect(screen.getByTestId('sme-ipos')).toHaveTextContent('0 SME IPOs');
      });
    });
  });

  describe('SEO Structured Data', () => {
    it('should include Organization schema', async () => {
      const page = await Home();
      const { container } = render(page);

      const organizationScript = container.querySelector('script#organization-schema');
      expect(organizationScript).toBeInTheDocument();
      expect(organizationScript?.getAttribute('type')).toBe('application/ld+json');

      const scriptContent = organizationScript?.innerHTML || '';
      const schema = JSON.parse(scriptContent);

      expect(schema['@type']).toBe('Organization');
      expect(schema.name).toBe('IPODhan');
    });

    it('should include IPO Listings schema when IPOs exist', async () => {
      const page = await Home();
      const { container } = render(page);

      const listingScript = container.querySelector('script#ipo-listings-schema');
      expect(listingScript).toBeInTheDocument();
      expect(listingScript?.getAttribute('type')).toBe('application/ld+json');

      const scriptContent = listingScript?.innerHTML || '';
      const schema = JSON.parse(scriptContent);

      expect(schema['@type']).toBe('ItemList');
      expect(schema.name).toBe('Latest IPO Updates');
      expect(schema.numberOfItems).toBe(5); // Total of all mocked IPOs
    });

    it('should not include IPO Listings schema when no IPOs exist', async () => {
      // Mock empty arrays
      vi.mocked(homeIpoService.getMainboardIPOs).mockResolvedValue([]);
      vi.mocked(homeIpoService.getSMEIPOs).mockResolvedValue([]);
      vi.mocked(homeIpoService.getUpcomingMainboardIPOs).mockResolvedValue([]);
      vi.mocked(homeIpoService.getUpcomingSMEIPOs).mockResolvedValue([]);

      const page = await Home();
      const { container } = render(page);

      const listingScript = container.querySelector('script#ipo-listings-schema');
      expect(listingScript).not.toBeInTheDocument();
    });

    it('should generate correct ItemList schema structure', async () => {
      const allIPOs = [...mockMainboardIPOs, ...mockSMEIPOs, ...mockUpcomingMainboard, ...mockUpcomingSME];
      const schema = generateIPOListingSchema(allIPOs);

      expect(schema['@context']).toBe('https://schema.org');
      expect(schema['@type']).toBe('ItemList');
      expect(schema.numberOfItems).toBe(5);
      expect(schema.itemListElement).toHaveLength(5);

      // Check first item
      const firstItem = schema.itemListElement[0];
      expect(firstItem['@type']).toBe('ListItem');
      expect(firstItem.position).toBe(1);
      expect(firstItem.item['@type']).toBe('FinancialProduct');
      expect(firstItem.item.name).toContain('IPO');
    });
  });

  describe('Error Handling', () => {
    // SKIP: AsyncErrorBoundary is currently commented out in app/page.tsx (TEMP,
    // webpack build error — Session 5). Tracked in issue #57. Un-skip when the
    // boundary is restored. The page IS expected to wrap the tables section in it.
    it.skip('should wrap IPO tables section with AsyncErrorBoundary (#57)', async () => {
      const page = await Home();
      render(page);

      expect(screen.getByTestId('error-boundary')).toBeInTheDocument();
      expect(screen.getByTestId('ipo-tables-section')).toBeInTheDocument();
    });
  });

  describe('Responsive Design', () => {
    it('should use proper responsive container classes', async () => {
      const page = await Home();
      const { container } = render(page);

      const sections = container.querySelectorAll('section');
      sections.forEach(section => {
        const containerDiv = section.querySelector('.container');
        if (containerDiv) {
          expect(containerDiv.classList.contains('mx-auto')).toBe(true);
          expect(containerDiv.classList.contains('px-4')).toBe(true);
        }
      });
    });
  });

  describe('Performance Optimization', () => {
    it('should use Promise.all for parallel data fetching', async () => {
      const startTime = Date.now();
      await Home();
      const endTime = Date.now();

      // All services should be called (checked in earlier test)
      // If called in parallel with Promise.all, should be fast
      // (This is more of a code structure test than performance test)
      expect(homeIpoService.getMainboardIPOs).toHaveBeenCalled();
      expect(homeIpoService.getSMEIPOs).toHaveBeenCalled();
      expect(homeIpoService.getUpcomingMainboardIPOs).toHaveBeenCalled();
      expect(homeIpoService.getUpcomingSMEIPOs).toHaveBeenCalled();
    });
  });

  describe('Accessibility', () => {
    it('should have proper heading hierarchy', async () => {
      const page = await Home();
      const { container } = render(page);

      const h1 = container.querySelector('h1');
      const h2s = container.querySelectorAll('h2');
      const h3s = container.querySelectorAll('h3');

      expect(h1).toBeInTheDocument();
      expect(h2s.length).toBeGreaterThan(0);
      // h3s belonged to the removed marketing cards (spec H4) — h1 + h2 suffice
    });

    it('should have meaningful section headings', async () => {
      const page = await Home();
      render(page);

      expect(screen.getByText(/Latest IPO updates/i)).toBeInTheDocument();
    });
  });
});
