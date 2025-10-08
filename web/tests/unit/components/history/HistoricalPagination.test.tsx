import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { HistoricalPagination } from '@/components/history/HistoricalPagination';

describe('HistoricalPagination', () => {
  it('does not render when totalPages is 1', () => {
    const onPageChange = vi.fn();
    const { container } = render(
      <HistoricalPagination
        currentPage={1}
        totalPages={1}
        hasNext={false}
        hasPrev={false}
        onPageChange={onPageChange}
      />
    );

    expect(container.firstChild).toBeNull();
  });

  it('renders pagination for multiple pages', () => {
    const onPageChange = vi.fn();
    render(
      <HistoricalPagination
        currentPage={1}
        totalPages={5}
        hasNext={true}
        hasPrev={false}
        onPageChange={onPageChange}
      />
    );

    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument();
  });

  it('disables previous button on first page', () => {
    const onPageChange = vi.fn();
    render(
      <HistoricalPagination
        currentPage={1}
        totalPages={5}
        hasNext={true}
        hasPrev={false}
        onPageChange={onPageChange}
      />
    );

    const prevButton = screen.getByText(/Previous/);
    expect(prevButton.parentElement).toHaveClass('pointer-events-none');
    expect(prevButton.parentElement).toHaveClass('opacity-50');
  });

  it('disables next button on last page', () => {
    const onPageChange = vi.fn();
    render(
      <HistoricalPagination
        currentPage={5}
        totalPages={5}
        hasNext={false}
        hasPrev={true}
        onPageChange={onPageChange}
      />
    );

    const nextButton = screen.getByText(/Next/);
    expect(nextButton.parentElement).toHaveClass('pointer-events-none');
    expect(nextButton.parentElement).toHaveClass('opacity-50');
  });

  it('calls onPageChange when page number is clicked', () => {
    const onPageChange = vi.fn();
    render(
      <HistoricalPagination
        currentPage={1}
        totalPages={5}
        hasNext={true}
        hasPrev={false}
        onPageChange={onPageChange}
      />
    );

    const page3 = screen.getByText('3');
    fireEvent.click(page3);

    expect(onPageChange).toHaveBeenCalledWith(3);
  });

  it('calls onPageChange when next button is clicked', () => {
    const onPageChange = vi.fn();
    render(
      <HistoricalPagination
        currentPage={2}
        totalPages={5}
        hasNext={true}
        hasPrev={true}
        onPageChange={onPageChange}
      />
    );

    const nextButton = screen.getByText(/Next/);
    fireEvent.click(nextButton);

    expect(onPageChange).toHaveBeenCalledWith(3);
  });

  it('calls onPageChange when previous button is clicked', () => {
    const onPageChange = vi.fn();
    render(
      <HistoricalPagination
        currentPage={3}
        totalPages={5}
        hasNext={true}
        hasPrev={true}
        onPageChange={onPageChange}
      />
    );

    const prevButton = screen.getByText(/Previous/);
    fireEvent.click(prevButton);

    expect(onPageChange).toHaveBeenCalledWith(2);
  });

  it('displays ellipsis for large page counts', () => {
    const onPageChange = vi.fn();
    render(
      <HistoricalPagination
        currentPage={5}
        totalPages={20}
        hasNext={true}
        hasPrev={true}
        onPageChange={onPageChange}
      />
    );

    // Should have ellipsis
    const ellipsis = screen.getAllByText('…');
    expect(ellipsis.length).toBeGreaterThan(0);

    // First and last pages should be visible
    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.getByText('20')).toBeInTheDocument();
  });

  it('shows all pages when total is 7 or less', () => {
    const onPageChange = vi.fn();
    render(
      <HistoricalPagination
        currentPage={3}
        totalPages={7}
        hasNext={true}
        hasPrev={true}
        onPageChange={onPageChange}
      />
    );

    // All pages should be visible
    for (let i = 1; i <= 7; i++) {
      expect(screen.getByText(i.toString())).toBeInTheDocument();
    }

    // No ellipsis
    expect(screen.queryByText('…')).not.toBeInTheDocument();
  });

  it('highlights current page', () => {
    const onPageChange = vi.fn();
    render(
      <HistoricalPagination
        currentPage={3}
        totalPages={5}
        hasNext={true}
        hasPrev={true}
        onPageChange={onPageChange}
      />
    );

    const page3Link = screen.getByText('3').closest('a');
    expect(page3Link).toHaveClass('cursor-pointer');
  });
});
