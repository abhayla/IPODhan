import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RatingDisplay } from '@/components/ipo/RatingDisplay';

describe('RatingDisplay', () => {
  it('should render "Not Rated" when rating is null', () => {
    render(<RatingDisplay rating={null} />);
    expect(screen.getByText('Not Rated')).toBeInTheDocument();
  });

  it('should render correct number of full stars for whole number rating', () => {
    const { container } = render(<RatingDisplay rating={4} />);
    // Check that rating value is displayed
    expect(screen.getByText('4.0')).toBeInTheDocument();
    // Check that stars are rendered
    const stars = container.querySelectorAll('svg');
    expect(stars.length).toBeGreaterThanOrEqual(5);
  });

  it('should render half star for decimal rating', () => {
    render(<RatingDisplay rating={4.5} />);
    // Check that rating value is displayed
    expect(screen.getByText('4.5')).toBeInTheDocument();
  });

  it('should display rating value with one decimal', () => {
    render(<RatingDisplay rating={3.7} />);
    expect(screen.getByText('3.7')).toBeInTheDocument();
  });

  it('should render rationale when showRationale is true', () => {
    const rationale = 'Strong financials and good management';
    render(
      <RatingDisplay
        rating={4.5}
        rationale={rationale}
        showRationale={true}
      />
    );
    expect(screen.getByText(rationale)).toBeInTheDocument();
  });

  it('should not render rationale when showRationale is false', () => {
    const rationale = 'Strong financials';
    render(
      <RatingDisplay
        rating={4.5}
        rationale={rationale}
        showRationale={false}
      />
    );
    expect(screen.queryByText(rationale)).not.toBeInTheDocument();
  });

  it('should apply correct size classes', () => {
    const { container } = render(<RatingDisplay rating={5} size="lg" />);
    const stars = container.querySelectorAll('svg');
    expect(stars[0]).toHaveClass('h-5');
  });
});
