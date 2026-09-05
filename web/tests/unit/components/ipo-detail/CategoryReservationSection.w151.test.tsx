/**
 * W-151 — an `ipo_details` row now exists for every IPO whose filing was
 * persisted, so the row's PRESENCE no longer implies it carries reservation
 * data. The section must stay invisible for an all-null row.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CategoryReservationSection } from '@/components/ipo-detail/CategoryReservationSection';

const ALL_NULL = {
  qibSharesOffered: null,
  niiSharesOffered: null,
  retailSharesOffered: null,
  retailMaxAllottees: null,
  employeeSharesOffered: null,
  anchorSharesOffered: null,
};

describe('CategoryReservationSection (W-151 identity row)', () => {
  it('renders nothing when every reservation column is null', () => {
    const { container } = render(
      <CategoryReservationSection
        reservationData={ALL_NULL}
        allocationPct={null}
        designatedExchange={null}
      />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('still renders when a share count is present', () => {
    render(
      <CategoryReservationSection
        reservationData={{ ...ALL_NULL, qibSharesOffered: 1_000_000 }}
        allocationPct={null}
        designatedExchange={null}
      />
    );
    expect(screen.getAllByText(/Qualified Institutional Buyers/).length).toBeGreaterThan(0);
  });

  it('still renders when only the advertised allocation split is known', () => {
    const { container } = render(
      <CategoryReservationSection
        reservationData={ALL_NULL}
        allocationPct={{ qib: 50, nii: 15, retail: 35 }}
        designatedExchange={null}
      />
    );
    expect(container).not.toBeEmptyDOMElement();
  });
});
