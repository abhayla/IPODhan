import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FactRibbon } from '@/components/ipo-detail/FactRibbon';

describe('FactRibbon', () => {
  it('renders nothing when there are no cells', () => {
    const { container } = render(<FactRibbon cells={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders a plain cell with no dispute marker by default', () => {
    render(<FactRibbon cells={[{ label: 'Lot Size', value: '100' }]} />);
    expect(screen.getByText('Lot Size')).toBeInTheDocument();
    expect(screen.getByText('100')).toBeInTheDocument();
    expect(screen.queryByText('Under verification')).not.toBeInTheDocument();
  });

  // T-328 DoD item 4: a disputed HIGH_VALUE field on a live IPO must show the
  // "Under verification" marker instead of asserting the value as settled fact.
  it('renders the "Under verification" marker when a cell is disputed', () => {
    render(
      <FactRibbon
        cells={[{ label: 'Price Band', value: '₹250 – ₹260', disputed: true }]}
      />
    );
    expect(screen.getByText('₹250 – ₹260')).toBeInTheDocument();
    expect(screen.getByText('Under verification')).toBeInTheDocument();
  });

  it('does not render the marker for a disputed=false cell', () => {
    render(
      <FactRibbon cells={[{ label: 'Open–Close', value: '26 Aug – 29 Aug', disputed: false }]} />
    );
    expect(screen.queryByText('Under verification')).not.toBeInTheDocument();
  });

  it('renders the marker independently per cell — only the disputed one shows it', () => {
    render(
      <FactRibbon
        cells={[
          { label: 'Price Band', value: '₹250 – ₹260', disputed: true },
          { label: 'Lot Size', value: '100' },
          { label: 'Open–Close', value: '26 Aug – 29 Aug', disputed: false },
        ]}
      />
    );
    expect(screen.getAllByText('Under verification')).toHaveLength(1);
  });
});
