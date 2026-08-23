/**
 * Unit tests for InfoSection (T-302 / P3-15)
 *
 * A LISTED IPO whose `ipoDetails.basisOfAllotmentDate` (a granular,
 * source-dependent field) is null, but whose `ipo.allotmentDate` (the same
 * date IPOTimelineWidget renders for its "Allotment" milestone) IS set, must
 * show that real date — never the "TBD" not-yet-known placeholder.
 */

import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { InfoSection } from '@/components/ipo/InfoSection';

/** Scope the assertion to the "Basis of Allotment" row — the page also
 * renders TBD for Refunds Initiated / Shares Credited, so a page-wide
 * getByText('TBD') is ambiguous. */
function getBasisOfAllotmentValue(): HTMLElement {
  const row = screen.getByText('Basis of Allotment').parentElement as HTMLElement;
  return row;
}

function buildListedIPO(overrides: Record<string, unknown> = {}) {
  return {
    id: 'listed-1',
    companyName: 'Symbiotec Specialities Limited',
    slug: 'symbiotec-specialities-limited',
    status: 'LISTED',
    isin: 'INE000X01011',
    listingDate: '2025-10-21',
    listingExchanges: ['NSE', 'BSE'],
    leadManagers: ['Example Capital'],
    registrar: 'KFin Technologies',
    registrarRelation: null,
    allotmentDate: '2025-10-17', // set on the base ipo row (what the timeline uses)
    ...overrides,
  } as never;
}

describe('InfoSection — Basis of Allotment (P3-15)', () => {
  it('falls back to ipo.allotmentDate when ipoDetails.basisOfAllotmentDate is null, for a LISTED IPO', () => {
    const ipo = buildListedIPO();

    render(<InfoSection ipo={ipo} ipoDetails={null} />);

    expect(screen.getByText('Basis of Allotment')).toBeInTheDocument();
    // Never the not-yet-known placeholder when a real allotment date exists.
    expect(within(getBasisOfAllotmentValue()).queryByText('TBD')).not.toBeInTheDocument();
    expect(within(getBasisOfAllotmentValue()).getByText('17 Oct 2025')).toBeInTheDocument();
  });

  it('prefers ipoDetails.basisOfAllotmentDate when both are present', () => {
    const ipo = buildListedIPO();

    render(
      <InfoSection
        ipo={ipo}
        ipoDetails={{ basisOfAllotmentDate: '2025-10-16' } as never}
      />
    );

    expect(within(getBasisOfAllotmentValue()).queryByText('TBD')).not.toBeInTheDocument();
    expect(within(getBasisOfAllotmentValue()).getByText('16 Oct 2025')).toBeInTheDocument();
  });

  it('still shows "TBD" for a CLOSED IPO with no allotment date anywhere yet', () => {
    const ipo = buildListedIPO({ status: 'CLOSED', allotmentDate: null });

    render(<InfoSection ipo={ipo} ipoDetails={null} />);

    expect(within(getBasisOfAllotmentValue()).getByText('TBD')).toBeInTheDocument();
  });
});
