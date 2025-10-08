import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ResultsCount } from '@/components/history/ResultsCount';

describe('ResultsCount', () => {
  it('displays correct range for first page', () => {
    render(<ResultsCount total={100} showing={20} page={1} limit={20} />);

    expect(screen.getByText(/Showing/)).toBeInTheDocument();
    expect(screen.getByText('1-20')).toBeInTheDocument();
    expect(screen.getByText('100')).toBeInTheDocument();
  });

  it('displays correct range for middle page', () => {
    render(<ResultsCount total={100} showing={20} page={3} limit={20} />);

    expect(screen.getByText('41-60')).toBeInTheDocument();
    expect(screen.getByText('100')).toBeInTheDocument();
  });

  it('displays correct range for last page with partial results', () => {
    render(<ResultsCount total={95} showing={15} page={5} limit={20} />);

    expect(screen.getByText('81-95')).toBeInTheDocument();
    expect(screen.getByText('95')).toBeInTheDocument();
  });

  it('displays "No results found" when total is 0', () => {
    render(<ResultsCount total={0} showing={0} page={1} limit={20} />);

    expect(screen.getByText('No results found')).toBeInTheDocument();
    expect(screen.queryByText(/Showing/)).not.toBeInTheDocument();
  });

  it('displays correct text for single result', () => {
    render(<ResultsCount total={1} showing={1} page={1} limit={20} />);

    expect(screen.getByText('1-1')).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument();
  });
});
