import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FactRibbon } from '@/components/ipo-detail/FactRibbon';

describe('FactRibbon', () => {
  it('renders nothing when there are no cells', () => {
    const { container } = render(<FactRibbon cells={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders a plain cell', () => {
    render(<FactRibbon cells={[{ label: 'Lot Size', value: '100' }]} />);
    expect(screen.getByText('Lot Size')).toBeInTheDocument();
    expect(screen.getByText('100')).toBeInTheDocument();
    expect(screen.queryByText('Under verification')).not.toBeInTheDocument();
  });

  // OD-61 (owner, 2026-09-18): "keep everything admin only... no user should
  // see any disagreement." These three cases REPLACE the T-328 tests that
  // required an "Under verification" marker: that marker WAS the violation.
  // The cells no longer carry a `disputed` flag at all, so the strongest
  // assertion available is that the marker's text can never reach the DOM —
  // whatever a caller passes.
  it('OD-61: never renders an "Under verification" marker for a live-IPO price band', () => {
    render(<FactRibbon cells={[{ label: 'Price Band', value: '₹250 – ₹260' }]} />);
    expect(screen.getByText('₹250 – ₹260')).toBeInTheDocument();
    expect(screen.queryByText('Under verification')).not.toBeInTheDocument();
  });

  it('OD-61: never renders a dispute marker for open/close dates', () => {
    render(<FactRibbon cells={[{ label: 'Open–Close', value: '26 Aug – 29 Aug' }]} />);
    expect(screen.queryByText('Under verification')).not.toBeInTheDocument();
  });

  // The guard that matters: a stray `disputed` property passed by any future
  // caller must not resurrect the marker. Cast through unknown because the
  // prop is deliberately gone from RibbonCell — this asserts the RENDERER is
  // the enforcement point, not merely the type.
  it('OD-61: a stray `disputed` prop from a caller cannot resurrect the marker', () => {
    const rogueCell = { label: 'Price Band', value: '₹250 – ₹260', disputed: true } as unknown as {
      label: string;
      value: string;
    };
    render(<FactRibbon cells={[rogueCell]} />);
    expect(screen.getByText('₹250 – ₹260')).toBeInTheDocument();
    expect(screen.queryByText('Under verification')).not.toBeInTheDocument();
  });

  it('renders several cells, none of them carrying a dispute marker', () => {
    render(
      <FactRibbon
        cells={[
          { label: 'Price Band', value: '₹250 – ₹260' },
          { label: 'Lot Size', value: '100' },
        ]}
      />
    );
    expect(screen.getByText('₹250 – ₹260')).toBeInTheDocument();
    expect(screen.getByText('100')).toBeInTheDocument();
    expect(screen.queryByText('Under verification')).not.toBeInTheDocument();
  });
});
