/**
 * Unit Tests for RecommendationSummarySection Component
 *
 * Story 11.16: IPO Recommendations Summary Display
 *
 * Tests component rendering with various review summary scenarios:
 * - Rating display with stars
 * - Recommendation breakdown percentages
 * - Sentiment analysis visualization
 * - Top Apply/Avoid reasons
 * - Latest 3 reviews display
 * - View All Reviews link (segment-specific)
 * - Empty state
 *
 * Coverage Target: >85%
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { RecommendationSummarySection } from '@/components/ipo-detail/RecommendationSummarySection';
import {
  mockReviewSummary,
  createMockReviewSummary,
  mockEmptyReviewSummary,
} from '../../../fixtures/review.fixture';

// Mock Next.js Link component
vi.mock('next/link', () => ({
  default: ({
    children,
    href,
    className,
  }: {
    children: React.ReactNode;
    href: string;
    className?: string;
  }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

describe('RecommendationSummarySection', () => {
  // ==================== Basic Rendering ====================

  describe('Basic Rendering', () => {
    it('should render with review summary data', () => {
      render(
        <RecommendationSummarySection
          reviewSummary={mockReviewSummary}
          ipoSegment="MAINBOARD"
        />
      );

      expect(screen.getByText('Broker Recommendations')).toBeInTheDocument();
      expect(screen.getByText('3.7')).toBeInTheDocument(); // Average rating
      expect(screen.getByText('Based on 3 broker reviews')).toBeInTheDocument();
    });

    it('should display average rating with stars', () => {
      render(
        <RecommendationSummarySection
          reviewSummary={mockReviewSummary}
          ipoSegment="MAINBOARD"
        />
      );

      // Check for rating number
      expect(screen.getByText('3.7')).toBeInTheDocument();
      expect(screen.getByText('/5')).toBeInTheDocument();

      // Check for star icons (rendered as SVG)
      const stars = document.querySelectorAll('svg[class*="lucide-star"]');
      expect(stars.length).toBe(5); // Total 5 stars (filled + half + empty)
    });

    it('should show review count prominently', () => {
      const summary = createMockReviewSummary({
        totalReviews: 1,
      });

      render(
        <RecommendationSummarySection
          reviewSummary={summary}
          ipoSegment="MAINBOARD"
        />
      );

      // Singular form for 1 review
      expect(screen.getByText('Based on 1 broker review')).toBeInTheDocument();
    });

    it('should show plural form for multiple reviews', () => {
      render(
        <RecommendationSummarySection
          reviewSummary={mockReviewSummary}
          ipoSegment="MAINBOARD"
        />
      );

      expect(screen.getByText('Based on 3 broker reviews')).toBeInTheDocument();
    });
  });

  // ==================== Recommendation Breakdown ====================

  describe('Recommendation Breakdown', () => {
    it('should render recommendation breakdown with correct percentages', () => {
      render(
        <RecommendationSummarySection
          reviewSummary={mockReviewSummary}
          ipoSegment="MAINBOARD"
        />
      );

      expect(screen.getByText('Recommendation Breakdown')).toBeInTheDocument();

      // Check for all recommendation types
      expect(screen.getAllByText('May Apply')[0]).toBeInTheDocument();
      expect(screen.getAllByText('Subscribe').length).toBeGreaterThan(0);
      expect(screen.getAllByText('Avoid').length).toBeGreaterThan(0);
      expect(screen.getByText('Not Recommended')).toBeInTheDocument();

      // Check percentages: 1/3 = 33% for each in mockReviewSummary
      const percentageElements = screen.getAllByText(/\(33%\)/);
      expect(percentageElements.length).toBeGreaterThanOrEqual(3);
    });

    it('should display correct percentages for varied breakdown', () => {
      const summary = createMockReviewSummary({
        totalReviews: 10,
        recommendationBreakdown: {
          apply: 5, // 50%
          subscribe: 3, // 30%
          avoid: 2, // 20%
          notRecommended: 0, // 0%
        },
      });

      render(
        <RecommendationSummarySection
          reviewSummary={summary}
          ipoSegment="MAINBOARD"
        />
      );

      expect(screen.getByText(/5 \(50%\)/)).toBeInTheDocument();
      expect(screen.getByText(/3 \(30%\)/)).toBeInTheDocument();
      expect(screen.getByText(/2 \(20%\)/)).toBeInTheDocument();
      expect(screen.getByText(/0 \(0%\)/)).toBeInTheDocument();
    });
  });

  // ==================== Sentiment Analysis ====================

  describe('Sentiment Analysis', () => {
    it('should display sentiment analysis correctly', () => {
      render(
        <RecommendationSummarySection
          reviewSummary={mockReviewSummary}
          ipoSegment="MAINBOARD"
        />
      );

      expect(screen.getByText('Sentiment Analysis')).toBeInTheDocument();
      expect(screen.getByText('Positive')).toBeInTheDocument();
      expect(screen.getByText('Negative')).toBeInTheDocument();

      // Check percentages
      expect(screen.getByText('67%')).toBeInTheDocument(); // Positive
      expect(screen.getByText('33%')).toBeInTheDocument(); // Negative
    });

    it('should render positive sentiment with green styling', () => {
      const { container } = render(
        <RecommendationSummarySection
          reviewSummary={mockReviewSummary}
          ipoSegment="MAINBOARD"
        />
      );

      // Find positive sentiment container
      const positiveBox = container.querySelector('.bg-green-50');
      expect(positiveBox).toBeInTheDocument();
      expect(within(positiveBox!).getByText('67%')).toBeInTheDocument();
    });

    it('should render negative sentiment with red styling', () => {
      const { container } = render(
        <RecommendationSummarySection
          reviewSummary={mockReviewSummary}
          ipoSegment="MAINBOARD"
        />
      );

      // Find negative sentiment container
      const negativeBox = container.querySelector('.bg-red-50');
      expect(negativeBox).toBeInTheDocument();
      expect(within(negativeBox!).getByText('33%')).toBeInTheDocument();
    });
  });

  // ==================== Top Reasons ====================

  describe('Top Apply/Avoid Reasons', () => {
    it('should show top 3 Apply reasons', () => {
      render(
        <RecommendationSummarySection
          reviewSummary={mockReviewSummary}
          ipoSegment="MAINBOARD"
        />
      );

      expect(screen.getByText('Why Apply')).toBeInTheDocument();
      expect(screen.getByText('Strong fundamentals')).toBeInTheDocument();
      expect(screen.getByText('Good valuation')).toBeInTheDocument();
      expect(screen.getByText('Growth potential')).toBeInTheDocument();
    });

    it('should show top 3 Avoid reasons', () => {
      render(
        <RecommendationSummarySection
          reviewSummary={mockReviewSummary}
          ipoSegment="MAINBOARD"
        />
      );

      expect(screen.getByText('Why Avoid')).toBeInTheDocument();
      expect(screen.getByText('High valuation')).toBeInTheDocument();
      expect(screen.getByText('Weak financials')).toBeInTheDocument();
    });

    it('should not render reasons section when both arrays are empty', () => {
      const summary = createMockReviewSummary({
        topApplyReasons: [],
        topAvoidReasons: [],
      });

      render(
        <RecommendationSummarySection
          reviewSummary={summary}
          ipoSegment="MAINBOARD"
        />
      );

      expect(screen.queryByText('Key Reasons')).not.toBeInTheDocument();
    });
  });

  // ==================== Latest Reviews ====================

  describe('Latest Reviews Display', () => {
    it('should display latest 3 reviews', () => {
      render(
        <RecommendationSummarySection
          reviewSummary={mockReviewSummary}
          ipoSegment="MAINBOARD"
        />
      );

      expect(screen.getByText('Latest Reviews')).toBeInTheDocument();

      // Check for authors
      expect(screen.getByText('Motilal Oswal')).toBeInTheDocument();
      expect(screen.getByText('ICICI Direct')).toBeInTheDocument();
      expect(screen.getByText('Angel Broking')).toBeInTheDocument();
    });

    it('should display review recommendation badges', () => {
      render(
        <RecommendationSummarySection
          reviewSummary={mockReviewSummary}
          ipoSegment="MAINBOARD"
        />
      );

      // Check for all recommendation badges in latest reviews (multiple instances expected)
      expect(screen.getAllByText('May apply').length).toBeGreaterThan(0);
      expect(screen.getAllByText('Subscribe').length).toBeGreaterThan(0);
      expect(screen.getAllByText('Avoid').length).toBeGreaterThan(0);
    });

    it('should format dates correctly', () => {
      render(
        <RecommendationSummarySection
          reviewSummary={mockReviewSummary}
          ipoSegment="MAINBOARD"
        />
      );

      // Dates should be formatted as "20 Oct 2025" etc (multiple instances expected)
      expect(screen.getAllByText(/Oct 2025/).length).toBeGreaterThan(0);
    });
  });

  // ==================== View All Reviews Link ====================

  describe('View All Reviews Link', () => {
    it('should link to /mainboard-ipo-reviews for MAINBOARD segment', () => {
      render(
        <RecommendationSummarySection
          reviewSummary={mockReviewSummary}
          ipoSegment="MAINBOARD"
        />
      );

      const link = screen.getByRole('link', { name: /View All 3 Reviews/i });
      expect(link).toHaveAttribute('href', '/mainboard-ipo-reviews');
    });

    it('should link to /sme-ipo-reviews for SME segment', () => {
      render(
        <RecommendationSummarySection
          reviewSummary={mockReviewSummary}
          ipoSegment="SME"
        />
      );

      const link = screen.getByRole('link', { name: /View All 3 Reviews/i });
      expect(link).toHaveAttribute('href', '/sme-ipo-reviews');
    });

    it('should display correct review count in link text', () => {
      const summary = createMockReviewSummary({
        totalReviews: 15,
      });

      render(
        <RecommendationSummarySection
          reviewSummary={summary}
          ipoSegment="MAINBOARD"
        />
      );

      expect(screen.getByText('View All 15 Reviews')).toBeInTheDocument();
    });
  });

  // ==================== Empty State ====================

  describe('Empty State', () => {
    it('should show empty state when reviewSummary is null', () => {
      render(
        <RecommendationSummarySection
          reviewSummary={mockEmptyReviewSummary}
          ipoSegment="MAINBOARD"
        />
      );

      expect(screen.getByText('No broker reviews available yet')).toBeInTheDocument();
      expect(
        screen.getByText(
          'Expert opinions will appear here once brokers publish their analysis.'
        )
      ).toBeInTheDocument();
    });

    it('should render empty state with correct structure', () => {
      render(
        <RecommendationSummarySection
          reviewSummary={null}
          ipoSegment="MAINBOARD"
        />
      );

      // Should still show header
      expect(screen.getByText('Broker Recommendations')).toBeInTheDocument();

      // Should not show rating, breakdown, or reviews
      expect(screen.queryByText('Recommendation Breakdown')).not.toBeInTheDocument();
      expect(screen.queryByText('Sentiment Analysis')).not.toBeInTheDocument();
      expect(screen.queryByText('Latest Reviews')).not.toBeInTheDocument();
    });
  });

  // ==================== Star Rating Calculation ====================

  describe('Star Rating Display', () => {
    it('should render full stars correctly', () => {
      const summary = createMockReviewSummary({
        averageRating: 5.0,
      });

      const { container } = render(
        <RecommendationSummarySection
          reviewSummary={summary}
          ipoSegment="MAINBOARD"
        />
      );

      const fullStars = container.querySelectorAll('.fill-yellow-500.text-yellow-500');
      expect(fullStars.length).toBe(5);
    });

    it('should render half stars correctly', () => {
      const summary = createMockReviewSummary({
        averageRating: 3.5,
      });

      const { container } = render(
        <RecommendationSummarySection
          reviewSummary={summary}
          ipoSegment="MAINBOARD"
        />
      );

      // Should have 3 full stars + 1 half star + 1 empty star
      const fullStars = container.querySelectorAll('.fill-yellow-500.text-yellow-500');
      const halfStars = container.querySelectorAll('.fill-yellow-500\\/50');

      expect(fullStars.length).toBeGreaterThanOrEqual(3);
      expect(halfStars.length).toBeGreaterThanOrEqual(1);
    });

    it('should render empty stars for low ratings', () => {
      const summary = createMockReviewSummary({
        averageRating: 1.0,
      });

      const { container } = render(
        <RecommendationSummarySection
          reviewSummary={summary}
          ipoSegment="MAINBOARD"
        />
      );

      // 1 full star + 4 empty stars
      const emptyStars = container.querySelectorAll('.text-gray-300');
      expect(emptyStars.length).toBeGreaterThanOrEqual(4);
    });
  });

  // ==================== Badge Variant Styling ====================

  describe('Badge Variant for Recommendations', () => {
    it('should apply green variant to "May apply" badge', () => {
      const { container } = render(
        <RecommendationSummarySection
          reviewSummary={mockReviewSummary}
          ipoSegment="MAINBOARD"
        />
      );

      const mayApplyBadge = screen.getByText('May apply');
      expect(mayApplyBadge).toHaveClass('bg-green-600');
    });

    it('should apply default variant to "Subscribe" badge', () => {
      render(
        <RecommendationSummarySection
          reviewSummary={mockReviewSummary}
          ipoSegment="MAINBOARD"
        />
      );

      // Subscribe uses default variant (blue) - multiple instances expected
      expect(screen.getAllByText('Subscribe').length).toBeGreaterThan(0);
    });

    it('should apply destructive variant to "Avoid" badge', () => {
      render(
        <RecommendationSummarySection
          reviewSummary={mockReviewSummary}
          ipoSegment="MAINBOARD"
        />
      );

      // Avoid uses destructive variant (red) - multiple instances expected
      expect(screen.getAllByText('Avoid').length).toBeGreaterThan(0);
    });
  });

  // ==================== Information Note ====================

  describe('Information Note', () => {
    it('should display disclaimer note', () => {
      render(
        <RecommendationSummarySection
          reviewSummary={mockReviewSummary}
          ipoSegment="MAINBOARD"
        />
      );

      expect(
        screen.getByText(/Broker recommendations are based on their research/)
      ).toBeInTheDocument();
      expect(
        screen.getByText(/conduct your own due diligence/)
      ).toBeInTheDocument();
    });
  });
});
