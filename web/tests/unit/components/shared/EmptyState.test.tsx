import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { EmptyState } from '@/components/shared/EmptyState';
import { HiMagnifyingGlass, HiInboxArrowDown } from 'react-icons/hi2';

describe('EmptyState', () => {
  it('renders with title only', () => {
    render(<EmptyState title="No results found" />);
    expect(screen.getByText('No results found')).toBeInTheDocument();
  });

  it('renders with title and description', () => {
    render(
      <EmptyState
        title="No results found"
        description="Try different search terms"
      />
    );
    expect(screen.getByText('No results found')).toBeInTheDocument();
    expect(screen.getByText('Try different search terms')).toBeInTheDocument();
  });

  it('renders with icon when provided', () => {
    const { container } = render(
      <EmptyState
        icon={Search}
        title="No results"
      />
    );
    const svg = container.querySelector('svg');
    expect(svg).toBeInTheDocument();
  });

  it('renders action button when provided', () => {
    const handleClick = vi.fn();
    render(
      <EmptyState
        title="No results"
        action={{
          label: 'Clear Search',
          onClick: handleClick,
        }}
      />
    );
    const button = screen.getByRole('button', { name: 'Clear Search' });
    expect(button).toBeInTheDocument();
  });

  it('calls action onClick when button is clicked', () => {
    const handleClick = vi.fn();
    render(
      <EmptyState
        title="No results"
        action={{
          label: 'Clear Search',
          onClick: handleClick,
        }}
      />
    );
    const button = screen.getByRole('button', { name: 'Clear Search' });
    fireEvent.click(button);
    expect(handleClick).toHaveBeenCalledOnce();
  });

  it('does not render action button when action is not provided', () => {
    render(<EmptyState title="No results" />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('applies custom className', () => {
    render(
      <EmptyState
        title="No results"
        className="custom-class"
      />
    );
    expect(screen.getByTestId('empty-state')).toHaveClass('custom-class');
  });

  it('renders different icons correctly', () => {
    const { container, rerender } = render(
      <EmptyState
        icon={Search}
        title="Search empty"
      />
    );

    let svg = container.querySelector('svg');
    expect(svg).toBeInTheDocument();

    rerender(
      <EmptyState
        icon={Inbox}
        title="Inbox empty"
      />
    );

    svg = container.querySelector('svg');
    expect(svg).toBeInTheDocument();
  });

  it('has centered layout', () => {
    render(<EmptyState title="No results" />);
    const emptyState = screen.getByTestId('empty-state');
    expect(emptyState).toHaveClass('flex', 'flex-col', 'items-center', 'justify-center', 'text-center');
  });
});
