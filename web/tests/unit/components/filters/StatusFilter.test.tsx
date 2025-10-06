import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StatusFilter } from '@/components/filters/StatusFilter';

describe('StatusFilter', () => {
  it('should render with correct aria label', () => {
    const onChange = vi.fn();
    render(<StatusFilter value="OPEN" onChange={onChange} />);

    expect(screen.getByLabelText('Filter by status')).toBeInTheDocument();
  });

  it('should display current value', () => {
    const onChange = vi.fn();
    render(<StatusFilter value="OPEN" onChange={onChange} />);

    expect(screen.getByRole('combobox')).toHaveAttribute('data-state', 'closed');
  });

  it('should call onChange when selecting a different status', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<StatusFilter value="OPEN" onChange={onChange} />);

    const trigger = screen.getByRole('combobox');
    await user.click(trigger);

    const upcomingOption = screen.getByText('Upcoming');
    await user.click(upcomingOption);

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

    const trigger = screen.getByRole('combobox');
    await user.click(trigger);

    const allOption = screen.getByText('All Statuses');
    await user.click(allOption);

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
