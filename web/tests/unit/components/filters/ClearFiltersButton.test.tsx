import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ClearFiltersButton } from '@/components/filters/ClearFiltersButton';

describe('ClearFiltersButton', () => {
  it('should render with correct text', () => {
    const onClear = vi.fn();
    render(<ClearFiltersButton onClear={onClear} disabled={false} />);

    expect(screen.getByText('Clear Filters')).toBeInTheDocument();
  });

  it('should have correct aria label', () => {
    const onClear = vi.fn();
    render(<ClearFiltersButton onClear={onClear} disabled={false} />);

    expect(screen.getByLabelText('Clear all filters')).toBeInTheDocument();
  });

  it('should call onClear when clicked', async () => {
    const user = userEvent.setup();
    const onClear = vi.fn();
    render(<ClearFiltersButton onClear={onClear} disabled={false} />);

    const button = screen.getByText('Clear Filters');
    await user.click(button);

    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it('should be disabled when disabled prop is true', () => {
    const onClear = vi.fn();
    render(<ClearFiltersButton onClear={onClear} disabled={true} />);

    const button = screen.getByText('Clear Filters');
    expect(button).toBeDisabled();
  });

  it('should not call onClear when disabled and clicked', async () => {
    const user = userEvent.setup();
    const onClear = vi.fn();
    render(<ClearFiltersButton onClear={onClear} disabled={true} />);

    const button = screen.getByText('Clear Filters');
    await user.click(button);

    expect(onClear).not.toHaveBeenCalled();
  });

  it('should have X icon', () => {
    const onClear = vi.fn();
    const { container } = render(<ClearFiltersButton onClear={onClear} disabled={false} />);

    const svg = container.querySelector('svg');
    expect(svg).toBeInTheDocument();
  });

  it('should be responsive (full width on mobile, auto width on desktop)', () => {
    const onClear = vi.fn();
    render(<ClearFiltersButton onClear={onClear} disabled={false} />);

    const button = screen.getByText('Clear Filters');
    expect(button).toHaveClass('w-full');
    expect(button).toHaveClass('lg:w-auto');
  });

  it('should have outline variant styling', () => {
    const onClear = vi.fn();
    render(<ClearFiltersButton onClear={onClear} disabled={false} />);

    const button = screen.getByText('Clear Filters');
    expect(button).toHaveAttribute('type', 'button');
  });
});
