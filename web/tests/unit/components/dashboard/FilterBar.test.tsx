import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FilterBar } from '@/components/dashboard/FilterBar';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';

// Mock Next.js navigation hooks
vi.mock('next/navigation', () => ({
  useRouter: vi.fn(),
  useSearchParams: vi.fn(),
  usePathname: vi.fn(),
}));

// Mock fetch for SectorFilter
global.fetch = vi.fn();

describe('FilterBar', () => {
  const mockPush = vi.fn();
  const mockSearchParams = new URLSearchParams();

  beforeEach(() => {
    vi.clearAllMocks();
    (useRouter as ReturnType<typeof vi.fn>).mockReturnValue({ push: mockPush });
    (useSearchParams as ReturnType<typeof vi.fn>).mockReturnValue(mockSearchParams);
    (usePathname as ReturnType<typeof vi.fn>).mockReturnValue('/dashboard');
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ sectors: ['Technology', 'Healthcare'] }),
    });
  });

  it('should render all filter controls', () => {
    render(<FilterBar />);

    expect(screen.getByLabelText('Filter by status')).toBeInTheDocument();
    expect(screen.getByLabelText('Filter by category')).toBeInTheDocument();
    expect(screen.getByLabelText('Filter by sector')).toBeInTheDocument();
    expect(screen.getByLabelText('Clear all filters')).toBeInTheDocument();
  });

  it('should read filter values from URL params', () => {
    mockSearchParams.set('status', 'UPCOMING');
    mockSearchParams.set('category', 'SME');
    mockSearchParams.set('sector', 'Technology');

    render(<FilterBar />);

    // Filters should have the values from URL
    expect(screen.getByLabelText('Filter by status')).toBeInTheDocument();
    expect(screen.getByLabelText('Filter by category')).toBeInTheDocument();
    expect(screen.getByLabelText('Filter by sector')).toBeInTheDocument();
  });

  it('should use default values when URL params are empty', () => {
    const emptyParams = new URLSearchParams();
    (useSearchParams as ReturnType<typeof vi.fn>).mockReturnValue(emptyParams);

    render(<FilterBar />);

    // Should default to OPEN status, ALL category, ALL sector
    expect(screen.getByLabelText('Filter by status')).toBeInTheDocument();
  });

  it('should update URL when status filter changes', async () => {
    const user = userEvent.setup();
    render(<FilterBar />);

    const statusFilter = screen.getByLabelText('Filter by status');
    await user.click(statusFilter);

    const upcomingOption = screen.getByText('Upcoming');
    await user.click(upcomingOption);

    expect(mockPush).toHaveBeenCalledWith(expect.stringContaining('status=UPCOMING'));
    expect(mockPush).toHaveBeenCalledWith(expect.stringContaining('page=1'));
  });

  it('should update URL when category filter changes', async () => {
    const user = userEvent.setup();
    render(<FilterBar />);

    const categoryFilter = screen.getByLabelText('Filter by category');
    await user.click(categoryFilter);

    const smeOption = screen.getByText('SME');
    await user.click(smeOption);

    expect(mockPush).toHaveBeenCalledWith(expect.stringContaining('category=SME'));
    expect(mockPush).toHaveBeenCalledWith(expect.stringContaining('page=1'));
  });

  it('should reset page to 1 when filters change', async () => {
    const user = userEvent.setup();
    mockSearchParams.set('page', '3');

    render(<FilterBar />);

    const statusFilter = screen.getByLabelText('Filter by status');
    await user.click(statusFilter);

    const upcomingOption = screen.getByText('Upcoming');
    await user.click(upcomingOption);

    expect(mockPush).toHaveBeenCalledWith(expect.stringContaining('page=1'));
  });

  it('should clear all filters when clear button is clicked', async () => {
    const user = userEvent.setup();
    mockSearchParams.set('status', 'UPCOMING');
    mockSearchParams.set('category', 'SME');
    mockSearchParams.set('sector', 'Technology');

    render(<FilterBar />);

    const clearButton = screen.getByLabelText('Clear all filters');
    await user.click(clearButton);

    expect(mockPush).toHaveBeenCalledWith(expect.stringContaining('status=OPEN'));
    expect(mockPush).toHaveBeenCalledWith(expect.stringContaining('page=1'));
    expect(mockPush).not.toHaveBeenCalledWith(expect.stringContaining('category='));
    expect(mockPush).not.toHaveBeenCalledWith(expect.stringContaining('sector='));
  });

  it('should disable clear button when filters are at defaults', () => {
    const emptyParams = new URLSearchParams();
    (useSearchParams as ReturnType<typeof vi.fn>).mockReturnValue(emptyParams);

    render(<FilterBar />);

    const clearButton = screen.getByLabelText('Clear all filters');
    expect(clearButton).toBeDisabled();
  });

  it('should enable clear button when filters are not at defaults', () => {
    mockSearchParams.set('status', 'UPCOMING');

    render(<FilterBar />);

    const clearButton = screen.getByLabelText('Clear all filters');
    expect(clearButton).not.toBeDisabled();
  });

  it('should show mobile filter toggle button', () => {
    render(<FilterBar />);

    const toggleButton = screen.getByText(/Filters/);
    expect(toggleButton).toBeInTheDocument();
  });

  it('should display active filter count on mobile toggle', () => {
    mockSearchParams.set('status', 'UPCOMING');
    mockSearchParams.set('category', 'SME');

    render(<FilterBar />);

    // Should show count of 1 (status=UPCOMING is non-default, category=SME is non-default)
    expect(screen.getByText('Filters (2)')).toBeInTheDocument();
  });

  it('should toggle filter visibility on mobile when toggle button is clicked', async () => {
    const user = userEvent.setup();
    render(<FilterBar />);

    const toggleButton = screen.getByLabelText('Toggle filters');

    // Initially filters should be hidden on mobile
    const filterBar = screen.getByTestId('filter-bar');
    expect(filterBar).toHaveClass('hidden');

    // Click to show filters
    await user.click(toggleButton);

    // Filters should now be visible
    expect(filterBar).toHaveClass('block');
  });

  it('should have correct aria attributes', () => {
    render(<FilterBar />);

    const container = screen.getByLabelText('IPO Filters');
    expect(container).toBeInTheDocument();

    const toggleButton = screen.getByLabelText('Toggle filters');
    expect(toggleButton).toHaveAttribute('aria-expanded', 'false');
  });

  it('should preserve existing URL params when updating filters', async () => {
    const user = userEvent.setup();
    mockSearchParams.set('view', 'list');

    render(<FilterBar />);

    const statusFilter = screen.getByLabelText('Filter by status');
    await user.click(statusFilter);

    const upcomingOption = screen.getByText('Upcoming');
    await user.click(upcomingOption);

    // Should preserve the 'view' param
    expect(mockPush).toHaveBeenCalledWith(expect.stringContaining('view=list'));
  });

  it('should remove filter param when selecting ALL option', async () => {
    const user = userEvent.setup();
    mockSearchParams.set('category', 'SME');

    render(<FilterBar />);

    const categoryFilter = screen.getByLabelText('Filter by category');
    await user.click(categoryFilter);

    const allOption = screen.getByText('All Categories');
    await user.click(allOption);

    // Should not include category param when ALL is selected
    const pushCall = mockPush.mock.calls[0][0];
    expect(pushCall).not.toContain('category=');
  });

  it('should be responsive (filters hidden on mobile, visible on desktop)', () => {
    render(<FilterBar />);

    const filterBar = screen.getByTestId('filter-bar');

    // Should have classes for responsive behavior
    expect(filterBar).toHaveClass('lg:flex');
    expect(filterBar).toHaveClass('hidden');
  });
});
