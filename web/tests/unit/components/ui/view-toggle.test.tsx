import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ViewToggle } from '@/components/ui/view-toggle';
import { useRouter, useSearchParams } from 'next/navigation';

// Mock Next.js navigation hooks
vi.mock('next/navigation', () => ({
  useRouter: vi.fn(),
  useSearchParams: vi.fn()
}));

describe('ViewToggle', () => {
  const mockPush = vi.fn();
  const mockSearchParams = new URLSearchParams();

  beforeEach(() => {
    vi.clearAllMocks();
    (useRouter as ReturnType<typeof vi.fn>).mockReturnValue({ push: mockPush });
    (useSearchParams as ReturnType<typeof vi.fn>).mockReturnValue(mockSearchParams);
  });

  it('should render grid and list view buttons', () => {
    render(<ViewToggle currentView="grid" />);

    expect(screen.getByLabelText('Grid view')).toBeInTheDocument();
    expect(screen.getByLabelText('List view')).toBeInTheDocument();
  });

  it('should mark grid button as active when grid view is selected', () => {
    render(<ViewToggle currentView="grid" />);

    const gridButton = screen.getByLabelText('Grid view');
    expect(gridButton).toHaveAttribute('aria-pressed', 'true');
  });

  it('should mark list button as active when list view is selected', () => {
    render(<ViewToggle currentView="list" />);

    const listButton = screen.getByLabelText('List view');
    expect(listButton).toHaveAttribute('aria-pressed', 'true');
  });

  it('should call router.push when switching to list view', async () => {
    const user = userEvent.setup();
    render(<ViewToggle currentView="grid" />);

    const listButton = screen.getByLabelText('List view');
    await user.click(listButton);

    expect(mockPush).toHaveBeenCalledWith('/dashboard?view=list');
  });

  it('should call router.push when switching to grid view', async () => {
    const user = userEvent.setup();
    render(<ViewToggle currentView="list" />);

    const gridButton = screen.getByLabelText('Grid view');
    await user.click(gridButton);

    expect(mockPush).toHaveBeenCalledWith('/dashboard?view=grid');
  });

  it('should not call router.push when clicking current view', async () => {
    const user = userEvent.setup();
    render(<ViewToggle currentView="grid" />);

    const gridButton = screen.getByLabelText('Grid view');
    await user.click(gridButton);

    expect(mockPush).not.toHaveBeenCalled();
  });

  it('should preserve existing search params when changing view', async () => {
    const user = userEvent.setup();
    const paramsWithPage = new URLSearchParams('page=2');
    (useSearchParams as ReturnType<typeof vi.fn>).mockReturnValue(paramsWithPage);

    render(<ViewToggle currentView="grid" />);

    const listButton = screen.getByLabelText('List view');
    await user.click(listButton);

    expect(mockPush).toHaveBeenCalledWith('/dashboard?page=2&view=list');
  });

  it('should have proper accessibility attributes', () => {
    render(<ViewToggle currentView="grid" />);

    const container = screen.getByRole('group', { name: 'View toggle' });
    expect(container).toBeInTheDocument();
  });
});
