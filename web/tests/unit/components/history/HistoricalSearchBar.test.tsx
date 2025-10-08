import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { HistoricalSearchBar } from '@/components/history/HistoricalSearchBar';

describe('HistoricalSearchBar', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders search input with placeholder', () => {
    const onSearch = vi.fn();
    render(<HistoricalSearchBar onSearch={onSearch} />);

    const input = screen.getByPlaceholderText('Search by company name...');
    expect(input).toBeInTheDocument();
  });

  it('renders with custom placeholder', () => {
    const onSearch = vi.fn();
    render(<HistoricalSearchBar onSearch={onSearch} placeholder="Custom placeholder" />);

    const input = screen.getByPlaceholderText('Custom placeholder');
    expect(input).toBeInTheDocument();
  });

  it('displays initial value', () => {
    const onSearch = vi.fn();
    render(<HistoricalSearchBar value="Test Company" onSearch={onSearch} />);

    const input = screen.getByDisplayValue('Test Company');
    expect(input).toBeInTheDocument();
  });

  it('debounces search with default 500ms delay', async () => {
    const onSearch = vi.fn();
    render(<HistoricalSearchBar onSearch={onSearch} />);

    const input = screen.getByPlaceholderText('Search by company name...');

    // Type in the input
    fireEvent.change(input, { target: { value: 'Reliance' } });

    // onSearch should not be called immediately
    expect(onSearch).not.toHaveBeenCalled();

    // Fast-forward time by 499ms
    vi.advanceTimersByTime(499);
    expect(onSearch).not.toHaveBeenCalled();

    // Fast-forward to 500ms
    vi.advanceTimersByTime(1);
    await waitFor(() => {
      expect(onSearch).toHaveBeenCalledWith('Reliance');
    });
  });

  it('debounces search with custom delay', async () => {
    const onSearch = vi.fn();
    render(<HistoricalSearchBar onSearch={onSearch} debounceMs={1000} />);

    const input = screen.getByPlaceholderText('Search by company name...');

    fireEvent.change(input, { target: { value: 'Tata' } });

    // Fast-forward by 999ms - should not call
    vi.advanceTimersByTime(999);
    expect(onSearch).not.toHaveBeenCalled();

    // Fast-forward to 1000ms
    vi.advanceTimersByTime(1);
    await waitFor(() => {
      expect(onSearch).toHaveBeenCalledWith('Tata');
    });
  });

  it('shows clear button when input has value', () => {
    const onSearch = vi.fn();
    render(<HistoricalSearchBar value="Test" onSearch={onSearch} />);

    const clearButton = screen.getByRole('button', { name: /Clear search/i });
    expect(clearButton).toBeInTheDocument();
  });

  it('hides clear button when input is empty', () => {
    const onSearch = vi.fn();
    render(<HistoricalSearchBar value="" onSearch={onSearch} />);

    const clearButton = screen.queryByRole('button', { name: /Clear search/i });
    expect(clearButton).not.toBeInTheDocument();
  });

  it('clears search when clear button is clicked', async () => {
    const onSearch = vi.fn();
    render(<HistoricalSearchBar value="Test" onSearch={onSearch} />);

    const clearButton = screen.getByRole('button', { name: /Clear search/i });
    fireEvent.click(clearButton);

    await waitFor(() => {
      expect(onSearch).toHaveBeenCalledWith(undefined);
    });

    const input = screen.getByPlaceholderText('Search by company name...');
    expect(input).toHaveValue('');
  });

  it('calls onSearch with undefined for empty string', async () => {
    const onSearch = vi.fn();
    render(<HistoricalSearchBar onSearch={onSearch} />);

    const input = screen.getByPlaceholderText('Search by company name...');

    // Type and then clear
    fireEvent.change(input, { target: { value: 'Test' } });
    vi.advanceTimersByTime(500);

    fireEvent.change(input, { target: { value: '' } });
    vi.advanceTimersByTime(500);

    await waitFor(() => {
      expect(onSearch).toHaveBeenLastCalledWith(undefined);
    });
  });

  it('cancels previous debounce on new input', async () => {
    const onSearch = vi.fn();
    render(<HistoricalSearchBar onSearch={onSearch} />);

    const input = screen.getByPlaceholderText('Search by company name...');

    // Type "Rel"
    fireEvent.change(input, { target: { value: 'Rel' } });
    vi.advanceTimersByTime(300);

    // Type "Reliance" before debounce completes
    fireEvent.change(input, { target: { value: 'Reliance' } });
    vi.advanceTimersByTime(500);

    await waitFor(() => {
      expect(onSearch).toHaveBeenCalledTimes(1);
      expect(onSearch).toHaveBeenCalledWith('Reliance');
    });
  });
});
