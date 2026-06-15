/**
 * C7 — verifies the honest-GMP rendering on the live header card:
 *  - C1/G15: an "as of <date>" staleness label sourced from the NEWEST GMP record.
 *  - C2/G16: a real GMP of 0 renders as a value, never collapsed to "N/A".
 */
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { KeyMetricsCardsEnhanced } from '@/components/ipo/KeyMetricsCardsEnhanced';

describe('KeyMetricsCardsEnhanced — GMP staleness + zero (C1/C2)', () => {
  it('renders "as of <date>" from the newest GMP record, not an older one (C1)', () => {
    render(
      <KeyMetricsCardsEnhanced
        issueSize={1_000_000_000}
        subscription={2.5}
        gmp={50}
        gmpPercent={10}
        gmpRecords={[
          { ipoId: 'x', timestamp: new Date('2026-06-10T00:00:00Z'), gmp: 40 },
          { ipoId: 'x', timestamp: new Date('2026-06-14T00:00:00Z'), gmp: 50 },
        ]}
      />,
    );
    const label = screen.getByTestId('gmp-as-of');
    expect(label.textContent).toMatch(/as of/i);
    expect(label.textContent).toMatch(/14 Jun 2026/); // newest record wins, order-agnostic
    expect(label.textContent).not.toMatch(/10 Jun/);
  });

  it('shows a real GMP of 0 as a value, not "N/A" (C2 substance)', () => {
    render(
      <KeyMetricsCardsEnhanced
        issueSize={1_000_000_000}
        subscription={1}
        gmp={0}
        gmpPercent={0}
        gmpRecords={[{ ipoId: 'x', timestamp: new Date('2026-06-14T00:00:00Z'), gmp: 0 }]}
      />,
    );
    // formatCurrency(0) renders "₹0"; a real zero GMP must be shown, never 'N/A'
    expect(screen.getByText(/₹\s?0(?!\d)/)).toBeTruthy();
  });

  it('omits the as-of label when there are no GMP records', () => {
    render(
      <KeyMetricsCardsEnhanced
        issueSize={1_000_000_000}
        subscription={1}
        gmp={null}
        gmpPercent={null}
        gmpRecords={[]}
      />,
    );
    expect(screen.queryByTestId('gmp-as-of')).toBeNull();
  });
});
