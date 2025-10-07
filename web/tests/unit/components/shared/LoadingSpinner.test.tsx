import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LoadingSpinner } from '@/components/shared/LoadingSpinner';

describe('LoadingSpinner', () => {
  it('renders without crashing', () => {
    render(<LoadingSpinner />);
    const status = screen.getByRole('status');
    expect(status).toBeInTheDocument();
  });

  it('renders with default medium size', () => {
    const { container } = render(<LoadingSpinner />);
    const svg = container.querySelector('svg');
    expect(svg).toHaveClass('h-6', 'w-6');
  });

  it('renders with small size when specified', () => {
    const { container } = render(<LoadingSpinner size="sm" />);
    const svg = container.querySelector('svg');
    expect(svg).toHaveClass('h-4', 'w-4');
  });

  it('renders with large size when specified', () => {
    const { container } = render(<LoadingSpinner size="lg" />);
    const svg = container.querySelector('svg');
    expect(svg).toHaveClass('h-12', 'w-12');
  });

  it('displays custom label when provided', () => {
    render(<LoadingSpinner label="Loading IPOs..." />);
    expect(screen.getByText('Loading IPOs...')).toBeInTheDocument();
  });

  it('has spin animation', () => {
    const { container } = render(<LoadingSpinner />);
    const svg = container.querySelector('svg');
    expect(svg).toHaveClass('animate-spin');
  });

  it('has screen reader text', () => {
    render(<LoadingSpinner />);
    expect(screen.getByText('Loading...', { selector: '.sr-only' })).toBeInTheDocument();
  });

  it('applies custom className', () => {
    const { container } = render(<LoadingSpinner className="text-blue-500" />);
    const svg = container.querySelector('svg');
    expect(svg).toHaveClass('text-blue-500');
  });

  it('has appropriate ARIA attributes', () => {
    render(<LoadingSpinner />);
    const status = screen.getByRole('status');
    expect(status).toHaveAttribute('aria-live', 'polite');
  });
});
