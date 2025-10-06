import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SectorFilter } from '@/components/filters/SectorFilter';

// Mock fetch
global.fetch = vi.fn();

describe('SectorFilter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render with correct aria label', () => {
    const onChange = vi.fn();
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ sectors: [] }),
    });

    render(<SectorFilter value="ALL" onChange={onChange} />);

    expect(screen.getByLabelText('Filter by sector')).toBeInTheDocument();
  });

  it('should show loading state initially', () => {
    const onChange = vi.fn();
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ sectors: [] }),
    });

    render(<SectorFilter value="ALL" onChange={onChange} />);

    expect(screen.getByText('Loading...')).toBeInTheDocument();
  });

  it('should fetch sectors on mount', async () => {
    const onChange = vi.fn();
    const mockSectors = ['Technology', 'Healthcare', 'Finance'];

    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ sectors: mockSectors }),
    });

    render(<SectorFilter value="ALL" onChange={onChange} />);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/sectors');
    });
  });

  it('should display sectors after loading', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const mockSectors = ['Technology', 'Healthcare', 'Finance'];

    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ sectors: mockSectors }),
    });

    render(<SectorFilter value="ALL" onChange={onChange} />);

    await waitFor(() => {
      expect(screen.queryByText('Loading...')).not.toBeInTheDocument();
    });

    const trigger = screen.getByRole('combobox');
    await user.click(trigger);

    expect(screen.getByText('All Sectors')).toBeInTheDocument();
    expect(screen.getByText('Technology')).toBeInTheDocument();
    expect(screen.getByText('Healthcare')).toBeInTheDocument();
    expect(screen.getByText('Finance')).toBeInTheDocument();
  });

  it('should call onChange when selecting a sector', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const mockSectors = ['Technology', 'Healthcare'];

    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ sectors: mockSectors }),
    });

    render(<SectorFilter value="ALL" onChange={onChange} />);

    await waitFor(() => {
      expect(screen.queryByText('Loading...')).not.toBeInTheDocument();
    });

    const trigger = screen.getByRole('combobox');
    await user.click(trigger);

    const techOption = screen.getByText('Technology');
    await user.click(techOption);

    expect(onChange).toHaveBeenCalledWith('Technology');
  });

  it('should handle fetch error gracefully', async () => {
    const onChange = vi.fn();
    (global.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Network error'));

    render(<SectorFilter value="ALL" onChange={onChange} />);

    await waitFor(() => {
      expect(screen.getByText('Error loading sectors')).toBeInTheDocument();
    });
  });

  it('should disable select while loading', () => {
    const onChange = vi.fn();
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ sectors: [] }),
    });

    render(<SectorFilter value="ALL" onChange={onChange} />);

    const trigger = screen.getByRole('combobox');
    expect(trigger).toBeDisabled();
  });

  it('should have Search icon', () => {
    const onChange = vi.fn();
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ sectors: [] }),
    });

    const { container } = render(<SectorFilter value="ALL" onChange={onChange} />);

    const svg = container.querySelector('svg');
    expect(svg).toBeInTheDocument();
  });

  it('should be responsive (full width on mobile, fixed width on desktop)', () => {
    const onChange = vi.fn();
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ sectors: [] }),
    });

    const { container } = render(<SectorFilter value="ALL" onChange={onChange} />);

    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper).toHaveClass('w-full');
    expect(wrapper).toHaveClass('lg:w-auto');
  });
});
