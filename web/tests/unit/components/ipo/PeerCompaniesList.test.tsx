/**
 * PeerCompaniesList Component Unit Tests
 * Story 4.10: Enhanced Financial Metrics Display
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PeerCompaniesList } from '@/components/ipo/PeerCompaniesList';

describe('PeerCompaniesList Component', () => {
  describe('with valid peer companies', () => {
    const mockPeers = [
      'Reliance Industries',
      'Tata Consultancy Services',
      'HDFC Bank',
      'Infosys',
      'ICICI Bank',
    ];

    it('displays peer companies as badges', () => {
      render(<PeerCompaniesList peerCompanies={mockPeers} />);

      mockPeers.forEach((peer) => {
        expect(screen.getByText(peer)).toBeInTheDocument();
      });
    });

    it('displays "Peer Companies" heading', () => {
      render(<PeerCompaniesList peerCompanies={mockPeers} />);
      expect(screen.getByText('Peer Companies')).toBeInTheDocument();
    });

    it('displays count metadata', () => {
      render(<PeerCompaniesList peerCompanies={mockPeers} />);
      expect(screen.getByText('5 peer companies identified')).toBeInTheDocument();
    });

    it('uses correct singular/plural grammar for count', () => {
      const { rerender } = render(<PeerCompaniesList peerCompanies={['Single Company']} />);
      expect(screen.getByText('1 peer company identified')).toBeInTheDocument();

      rerender(<PeerCompaniesList peerCompanies={mockPeers} />);
      expect(screen.getByText('5 peer companies identified')).toBeInTheDocument();
    });

    it('renders badges for each peer company', () => {
      render(<PeerCompaniesList peerCompanies={mockPeers} />);
      // Verify all peer companies are rendered (they use Badge component)
      mockPeers.forEach((peer) => {
        const peerElement = screen.getByText(peer);
        expect(peerElement).toBeInTheDocument();
      });
    });
  });

  describe('expand/collapse functionality', () => {
    const manyPeers = Array.from({ length: 15 }, (_, i) => `Company ${i + 1}`);

    it('displays only first 10 peers by default when more than 10', () => {
      render(<PeerCompaniesList peerCompanies={manyPeers} />);

      // First 10 should be visible
      for (let i = 1; i <= 10; i++) {
        expect(screen.getByText(`Company ${i}`)).toBeInTheDocument();
      }

      // 11-15 should NOT be visible
      for (let i = 11; i <= 15; i++) {
        expect(screen.queryByText(`Company ${i}`)).not.toBeInTheDocument();
      }
    });

    it('displays "See all" button when more than 10 peers', () => {
      render(<PeerCompaniesList peerCompanies={manyPeers} />);
      expect(screen.getByText(/See all 15 peers/i)).toBeInTheDocument();
    });

    it('does not display "See all" button when 10 or fewer peers', () => {
      const tenPeers = Array.from({ length: 10 }, (_, i) => `Company ${i + 1}`);
      render(<PeerCompaniesList peerCompanies={tenPeers} />);
      expect(screen.queryByText(/See all/i)).not.toBeInTheDocument();
    });

    it('expands to show all peers when "See all" is clicked', async () => {
      const user = userEvent.setup();
      render(<PeerCompaniesList peerCompanies={manyPeers} />);

      // Initially hidden
      expect(screen.queryByText('Company 11')).not.toBeInTheDocument();

      // Click "See all"
      const seeAllButton = screen.getByText(/See all 15 peers/i);
      await user.click(seeAllButton);

      // Now all should be visible
      for (let i = 1; i <= 15; i++) {
        expect(screen.getByText(`Company ${i}`)).toBeInTheDocument();
      }
    });

    it('displays "Show less" button when expanded', async () => {
      const user = userEvent.setup();
      render(<PeerCompaniesList peerCompanies={manyPeers} />);

      const seeAllButton = screen.getByText(/See all 15 peers/i);
      await user.click(seeAllButton);

      expect(screen.getByText(/Show less/i)).toBeInTheDocument();
    });

    it('collapses back to 10 peers when "Show less" is clicked', async () => {
      const user = userEvent.setup();
      render(<PeerCompaniesList peerCompanies={manyPeers} />);

      // Expand
      const seeAllButton = screen.getByText(/See all 15 peers/i);
      await user.click(seeAllButton);

      // Collapse
      const showLessButton = screen.getByText(/Show less/i);
      await user.click(showLessButton);

      // First 10 visible, rest hidden
      expect(screen.getByText('Company 10')).toBeInTheDocument();
      expect(screen.queryByText('Company 11')).not.toBeInTheDocument();
    });

    it('displays ChevronDown icon in "See all" button', () => {
      render(<PeerCompaniesList peerCompanies={manyPeers} />);
      const button = screen.getByText(/See all 15 peers/i).closest('button');
      const svg = button?.querySelector('svg');
      expect(svg).toBeInTheDocument();
    });

    it('displays ChevronUp icon in "Show less" button', async () => {
      const user = userEvent.setup();
      render(<PeerCompaniesList peerCompanies={manyPeers} />);

      const seeAllButton = screen.getByText(/See all 15 peers/i);
      await user.click(seeAllButton);

      const showLessButton = screen.getByText(/Show less/i).closest('button');
      const svg = showLessButton?.querySelector('svg');
      expect(svg).toBeInTheDocument();
    });
  });

  describe('empty/null state', () => {
    it('displays empty state for null peer companies', () => {
      render(<PeerCompaniesList peerCompanies={null} />);
      expect(screen.getByText('Peer companies data not yet available')).toBeInTheDocument();
    });

    it('displays empty state for empty array', () => {
      render(<PeerCompaniesList peerCompanies={[]} />);
      expect(screen.getByText('Peer companies data not yet available')).toBeInTheDocument();
    });

    it('applies dashed border to empty state', () => {
      const { container } = render(<PeerCompaniesList peerCompanies={null} />);
      const emptyState = container.querySelector('.border-dashed');
      expect(emptyState).toBeInTheDocument();
    });

    it('centers empty state text', () => {
      const { container } = render(<PeerCompaniesList peerCompanies={null} />);
      const emptyState = container.querySelector('.text-center');
      expect(emptyState).toBeInTheDocument();
    });

    it('does not display heading for empty state', () => {
      render(<PeerCompaniesList peerCompanies={null} />);
      expect(screen.queryByText('Peer Companies')).not.toBeInTheDocument();
    });

    it('does not display metadata for empty state', () => {
      render(<PeerCompaniesList peerCompanies={null} />);
      expect(screen.queryByText(/peer companies identified/i)).not.toBeInTheDocument();
    });
  });

  describe('custom styling', () => {
    const mockPeers = ['Company A', 'Company B'];

    it('applies custom className', () => {
      const { container } = render(
        <PeerCompaniesList peerCompanies={mockPeers} className="custom-class" />
      );
      const wrapper = container.firstChild;
      expect(wrapper).toHaveClass('custom-class');
    });

    it('applies custom className to empty state', () => {
      const { container } = render(
        <PeerCompaniesList peerCompanies={null} className="custom-class" />
      );
      const wrapper = container.firstChild;
      expect(wrapper).toHaveClass('custom-class');
    });

    it('applies hover effect to badges', () => {
      const { container } = render(<PeerCompaniesList peerCompanies={mockPeers} />);
      const badge = screen.getByText('Company A');
      expect(badge).toHaveClass('hover:bg-secondary/80');
    });

    it('applies transition to badges', () => {
      render(<PeerCompaniesList peerCompanies={mockPeers} />);
      const badge = screen.getByText('Company A');
      expect(badge).toHaveClass('transition-colors');
    });
  });

  describe('edge cases', () => {
    it('handles exactly 10 peers (no expand button)', () => {
      const tenPeers = Array.from({ length: 10 }, (_, i) => `Company ${i + 1}`);
      render(<PeerCompaniesList peerCompanies={tenPeers} />);

      // All 10 visible
      tenPeers.forEach((peer) => {
        expect(screen.getByText(peer)).toBeInTheDocument();
      });

      // No expand button
      expect(screen.queryByText(/See all/i)).not.toBeInTheDocument();
    });

    it('handles exactly 11 peers (shows expand button)', () => {
      const elevenPeers = Array.from({ length: 11 }, (_, i) => `Company ${i + 1}`);
      render(<PeerCompaniesList peerCompanies={elevenPeers} />);

      // First 10 visible
      expect(screen.getByText('Company 10')).toBeInTheDocument();

      // 11th hidden
      expect(screen.queryByText('Company 11')).not.toBeInTheDocument();

      // Expand button present
      expect(screen.getByText(/See all 11 peers/i)).toBeInTheDocument();
    });

    it('handles single peer company', () => {
      render(<PeerCompaniesList peerCompanies={['Single Company']} />);
      expect(screen.getByText('Single Company')).toBeInTheDocument();
      expect(screen.getByText('1 peer company identified')).toBeInTheDocument();
    });

    it('handles peer names with special characters', () => {
      const specialPeers = ['Company & Co.', 'Firm (India) Ltd.', 'Corp-X'];
      render(<PeerCompaniesList peerCompanies={specialPeers} />);

      specialPeers.forEach((peer) => {
        expect(screen.getByText(peer)).toBeInTheDocument();
      });
    });

    it('handles very long peer company names', () => {
      const longName = 'Very Long Company Name That Might Cause Layout Issues Ltd.';
      render(<PeerCompaniesList peerCompanies={[longName]} />);
      expect(screen.getByText(longName)).toBeInTheDocument();
    });
  });

  describe('accessibility', () => {
    const mockPeers = ['Company A', 'Company B', 'Company C'];

    it('renders heading as h4', () => {
      const { container } = render(<PeerCompaniesList peerCompanies={mockPeers} />);
      const heading = container.querySelector('h4');
      expect(heading).toBeInTheDocument();
      expect(heading).toHaveTextContent('Peer Companies');
    });

    it('expand/collapse button is keyboard accessible', () => {
      const manyPeers = Array.from({ length: 15 }, (_, i) => `Company ${i + 1}`);
      render(<PeerCompaniesList peerCompanies={manyPeers} />);

      const button = screen.getByText(/See all 15 peers/i).closest('button');
      expect(button).toBeInTheDocument();
      expect(button?.tagName).toBe('BUTTON');
    });

    it('uses semantic list rendering', () => {
      render(<PeerCompaniesList peerCompanies={mockPeers} />);
      const badges = screen.getAllByText(/Company/);
      expect(badges.length).toBe(mockPeers.length);
    });
  });
});
