import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StatusFilter } from '@/components/filters/StatusFilter';

describe('StatusFilter', () => {
  it('should render with correct aria label', () => {
    const onChange = vi.fn();
    render(<StatusFilter value="OPEN" onChange={onChange} />);

    expect(screen.getByLabelText(/Filter IPOs by status/i)).toBeInTheDocument();
  });

  it('should display current value', () => {
    const onChange = vi.fn();
    render(<StatusFilter value="OPEN" onChange={onChange} />);

    // Native <select> reflects the current value (no Radix data-state attribute).
    expect(screen.getByRole('combobox')).toHaveValue('OPEN');
  });

  it('should call onChange when selecting a different status', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<StatusFilter value="OPEN" onChange={onChange} />);

    // Native <select>: change via selectOptions (by option value).
    await user.selectOptions(screen.getByRole('combobox'), 'UPCOMING');
    expect(onChange).toHaveBeenCalledWith('UPCOMING');
  });

  it('should display all status options when opened', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<StatusFilter value="OPEN" onChange={onChange} />);

    const trigger = screen.getByRole('combobox');
    await user.click(trigger);

    expect(screen.getByText('All Statuses')).toBeInTheDocument();
    expect(screen.getByText('Upcoming')).toBeInTheDocument();
    expect(screen.getByText('Open')).toBeInTheDocument();
    expect(screen.getByText('Closed')).toBeInTheDocument();
    expect(screen.getByText('Listed')).toBeInTheDocument();
  });

  it('should have Filter icon', () => {
    const onChange = vi.fn();
    const { container } = render(<StatusFilter value="OPEN" onChange={onChange} />);

    const svg = container.querySelector('svg');
    expect(svg).toBeInTheDocument();
  });

  it('should handle ALL option selection', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<StatusFilter value="OPEN" onChange={onChange} />);

    await user.selectOptions(screen.getByRole('combobox'), 'ALL');
    expect(onChange).toHaveBeenCalledWith('ALL');
  });

  it('should be responsive (full width on mobile, fixed width on desktop)', () => {
    const onChange = vi.fn();
    const { container } = render(<StatusFilter value="OPEN" onChange={onChange} />);

    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper).toHaveClass('w-full');
    expect(wrapper).toHaveClass('lg:w-auto');
  });
});
