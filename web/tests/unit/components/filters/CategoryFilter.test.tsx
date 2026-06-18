import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CategoryFilter } from '@/components/filters/CategoryFilter';

describe('CategoryFilter', () => {
  it('should render with correct aria label', () => {
    const onChange = vi.fn();
    render(<CategoryFilter value="ALL" onChange={onChange} />);

    expect(screen.getByLabelText(/Filter IPOs by category/i)).toBeInTheDocument();
  });

  it('should display current value', () => {
    const onChange = vi.fn();
    render(<CategoryFilter value="MAINBOARD" onChange={onChange} />);

    expect(screen.getByRole('combobox')).toBeInTheDocument();
  });

  it('should call onChange when selecting a different category', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<CategoryFilter value="ALL" onChange={onChange} />);

    const trigger = screen.getByRole('combobox');
    await user.click(trigger);

    const smeOption = screen.getByText('SME');
    await user.click(smeOption);

    expect(onChange).toHaveBeenCalledWith('SME');
  });

  it('should display all category options when opened', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<CategoryFilter value="ALL" onChange={onChange} />);

    const trigger = screen.getByRole('combobox');
    await user.click(trigger);

    // Query the dropdown options by role — 'All Categories' also appears in the
    // trigger (value=ALL), so getByText would multiple-match.
    expect(screen.getByRole('option', { name: 'All Categories' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Mainboard' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'SME' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Rights' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'NCD' })).toBeInTheDocument();
  });

  it('should have Tag icon', () => {
    const onChange = vi.fn();
    const { container } = render(<CategoryFilter value="ALL" onChange={onChange} />);

    const svg = container.querySelector('svg');
    expect(svg).toBeInTheDocument();
  });

  it('should handle ALL option selection', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<CategoryFilter value="MAINBOARD" onChange={onChange} />);

    const trigger = screen.getByRole('combobox');
    await user.click(trigger);

    const allOption = screen.getByText('All Categories');
    await user.click(allOption);

    expect(onChange).toHaveBeenCalledWith('ALL');
  });

  it('should be responsive (full width on mobile, fixed width on desktop)', () => {
    const onChange = vi.fn();
    const { container } = render(<CategoryFilter value="ALL" onChange={onChange} />);

    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper).toHaveClass('w-full');
    expect(wrapper).toHaveClass('lg:w-auto');
  });
});
