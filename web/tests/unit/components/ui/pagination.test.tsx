import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Pagination } from '@/components/ui/pagination';
import { useRouter, useSearchParams } from 'next/navigation';

// Mock Next.js navigation hooks
vi.mock('next/navigation', () => ({
  useRouter: vi.fn(),
  useSearchParams: vi.fn()
}));

describe('Pagination', () => {
  const mockPush = vi.fn();
  const mockSearchParams = new URLSearchParams();

  beforeEach(() => {
    vi.clearAllMocks();
    (useRouter as ReturnType<typeof vi.fn>).mockReturnValue({ push: mockPush });
    (useSearchParams as ReturnType<typeof vi.fn>).mockReturnValue(mockSearchParams);
  });

  it('should render page numbers correctly', () => {
    render(<Pagination currentPage={1} totalPages={5} hasMore={true} />);

    expect(screen.getByLabelText('Page 1')).toBeInTheDocument();
    expect(screen.getByLabelText('Page 1')).toHaveAttribute('aria-current', 'page');
  });

  it('should disable previous button on first page', () => {
    render(<Pagination currentPage={1} totalPages={5} hasMore={true} />);

    const prevButton = screen.getByLabelText('Previous page');
    expect(prevButton).toBeDisabled();
  });

  it('should disable next button on last page', () => {
    render(<Pagination currentPage={5} totalPages={5} hasMore={false} />);

    const nextButton = screen.getByLabelText('Next page');
    expect(nextButton).toBeDisabled();
  });

  it('should disable next button when hasMore is false', () => {
    render(<Pagination currentPage={3} totalPages={5} hasMore={false} />);

    const nextButton = screen.getByLabelText('Next page');
    expect(nextButton).toBeDisabled();
  });

  it('should enable previous and next buttons on middle page', () => {
    render(<Pagination currentPage={3} totalPages={5} hasMore={true} />);

    const prevButton = screen.getByLabelText('Previous page');
    const nextButton = screen.getByLabelText('Next page');

    expect(prevButton).not.toBeDisabled();
    expect(nextButton).not.toBeDisabled();
  });

  it('should call router.push with correct page number on next click', async () => {
    const user = userEvent.setup();
    render(<Pagination currentPage={1} totalPages={5} hasMore={true} />);

    const nextButton = screen.getByLabelText('Next page');
    await user.click(nextButton);

    expect(mockPush).toHaveBeenCalledWith('/dashboard?page=2', { scroll: true });
  });

  it('should call router.push with correct page number on previous click', async () => {
    const user = userEvent.setup();
    render(<Pagination currentPage={3} totalPages={5} hasMore={true} />);

    const prevButton = screen.getByLabelText('Previous page');
    await user.click(prevButton);

    expect(mockPush).toHaveBeenCalledWith('/dashboard?page=2', { scroll: true });
  });

  it('should call router.push when clicking page number', async () => {
    const user = userEvent.setup();
    render(<Pagination currentPage={1} totalPages={5} hasMore={true} />);

    const pageButton = screen.getByLabelText('Page 3');
    await user.click(pageButton);

    expect(mockPush).toHaveBeenCalledWith('/dashboard?page=3', { scroll: true });
  });

  it('should display ellipsis for large page ranges', () => {
    render(<Pagination currentPage={5} totalPages={10} hasMore={true} />);

    // Check for ellipsis (...)
    const container = screen.getByTestId('pagination');
    expect(container.textContent).toContain('...');
  });

  it('should disable all buttons when loading', () => {
    render(<Pagination currentPage={2} totalPages={5} hasMore={true} isLoading={true} />);

    const prevButton = screen.getByLabelText('Previous page');
    const nextButton = screen.getByLabelText('Next page');

    expect(prevButton).toBeDisabled();
    expect(nextButton).toBeDisabled();
  });

  it('should show mobile page indicator on small screens', () => {
    render(<Pagination currentPage={2} totalPages={5} hasMore={true} />);

    // Mobile indicator has specific text format
    expect(screen.getByText('Page 2 of 5')).toBeInTheDocument();
  });

  it('should render all pages when total is small', () => {
    render(<Pagination currentPage={1} totalPages={3} hasMore={true} />);

    expect(screen.getByLabelText('Page 1')).toBeInTheDocument();
    expect(screen.getByLabelText('Page 2')).toBeInTheDocument();
    expect(screen.getByLabelText('Page 3')).toBeInTheDocument();
  });
});
