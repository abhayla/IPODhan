/**
 * Unit Tests for IssueTypeBadge Component (Story 4.11)
 * Tests issue type badge rendering with color-coded styles and tooltips
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { IssueTypeBadge } from '@/components/ipo/IssueTypeBadge';

describe('IssueTypeBadge', () => {
  describe('Issue Type Rendering', () => {
    it('should render BOOK_BUILDING badge with blue styling', () => {
      render(<IssueTypeBadge issueType="BOOK_BUILDING" />);

      const badge = screen.getByText('Book Building');
      expect(badge).toBeInTheDocument();
      expect(badge).toHaveClass('bg-blue-100');
      expect(badge).toHaveClass('text-blue-800');
    });

    it('should render FIXED_PRICE badge with green styling', () => {
      render(<IssueTypeBadge issueType="FIXED_PRICE" />);

      const badge = screen.getByText('Fixed Price');
      expect(badge).toBeInTheDocument();
      expect(badge).toHaveClass('bg-green-100');
      expect(badge).toHaveClass('text-green-800');
    });

    it('should render HYBRID badge with purple styling', () => {
      render(<IssueTypeBadge issueType="HYBRID" />);

      const badge = screen.getByText('Hybrid');
      expect(badge).toBeInTheDocument();
      expect(badge).toHaveClass('bg-purple-100');
      expect(badge).toHaveClass('text-purple-800');
    });
  });

  describe('Tooltip Attributes', () => {
    it('should have tooltip for BOOK_BUILDING explaining bidding process', () => {
      render(<IssueTypeBadge issueType="BOOK_BUILDING" />);

      const badge = screen.getByText('Book Building');
      expect(badge).toHaveAttribute('title', 'Price is determined through a bidding process. Investors can bid within the price band.');
      expect(badge).toHaveAttribute('role', 'tooltip');
    });

    it('should have tooltip for FIXED_PRICE explaining fixed pricing', () => {
      render(<IssueTypeBadge issueType="FIXED_PRICE" />);

      const badge = screen.getByText('Fixed Price');
      expect(badge).toHaveAttribute('title', 'Price is fixed and predetermined by the company. No bidding process involved.');
    });

    it('should have tooltip for HYBRID explaining combination', () => {
      render(<IssueTypeBadge issueType="HYBRID" />);

      const badge = screen.getByText('Hybrid');
      expect(badge).toHaveAttribute('title', 'Combination of both book building and fixed price mechanisms for different investor categories.');
    });
  });

  describe('Null/Undefined Handling', () => {
    it('should render "Not Specified" when issueType is null', () => {
      render(<IssueTypeBadge issueType={null} />);

      const badge = screen.getByText('Not Specified');
      expect(badge).toBeInTheDocument();
      expect(badge).toHaveClass('bg-gray-100');
      expect(badge).toHaveClass('text-gray-600');
    });

    it('should render "Not Specified" when issueType is undefined', () => {
      render(<IssueTypeBadge issueType={undefined} />);

      const badge = screen.getByText('Not Specified');
      expect(badge).toBeInTheDocument();
    });
  });

  describe('Custom Styling', () => {
    it('should apply custom className', () => {
      render(<IssueTypeBadge issueType="BOOK_BUILDING" className="custom-class" />);

      const badge = screen.getByText('Book Building');
      expect(badge).toHaveClass('custom-class');
    });
  });

  describe('Accessibility', () => {
    it('should be accessible with role attribute', () => {
      render(<IssueTypeBadge issueType="BOOK_BUILDING" />);

      const badge = screen.getByRole('tooltip');
      expect(badge).toBeInTheDocument();
    });

    it('should have proper semantic HTML structure', () => {
      const { container } = render(<IssueTypeBadge issueType="FIXED_PRICE" />);

      const badge = container.querySelector('span');
      expect(badge).toBeInTheDocument();
    });
  });
});
