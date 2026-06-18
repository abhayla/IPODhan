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

    expect(screen.getByLabelText(/Filter IPOs by sector/i)).toBeInTheDocument();
  });

  it('should show loading state initially', () => {
    const onChange = vi.fn();
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ sectors: [] }),
    });

    render(<SectorFilter value="ALL" onChange={onChange} />);

    // Native <select>: the ALL option reads "Loading sectors..." while fetching.
    expect(screen.getByText('Loading sectors...')).toBeInTheDocument();
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
    const onChange = vi.fn();
    const mockSectors = ['Technology', 'Healthcare', 'Finance'];

    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ sectors: mockSectors }),
    });

    render(<SectorFilter value="ALL" onChange={onChange} />);

    // Native <select> renders all <option>s in the DOM — no open needed.
    await waitFor(() => {
      expect(screen.getByText('Technology')).toBeInTheDocument();
    });

    expect(screen.getByText('All Sectors')).toBeInTheDocument();
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
      expect(screen.getByText('Technology')).toBeInTheDocument();
    });

    // Native <select>: change via selectOptions, not click-to-open.
    await user.selectOptions(screen.getByRole('combobox'), 'Technology');
    expect(onChange).toHaveBeenCalledWith('Technology');
  });

  it('should handle fetch error gracefully', async () => {
    const onChange = vi.fn();
    (global.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Network error'));

    render(<SectorFilter value="ALL" onChange={onChange} />);

    await waitFor(() => {
      // On fetch error the native ALL option degrades to "All Sectors (Limited)".
      expect(screen.getByText('All Sectors (Limited)')).toBeInTheDocument();
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
