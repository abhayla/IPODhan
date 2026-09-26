/**
 * Unit Tests: Mainboard "Recently Listed" cards show the real listing gain
 *
 * Issue #58 / OD-124 (docs/design/data-sourcing-pull-model.md §2.11, read side):
 * a LISTED IPO shown on a card (IPOCardEnhanced, used by the Recently Listed
 * section and any other card surface) shows its listing gain as a signed,
 * colour-coded percent, sourced from `listing_performance.listing_gain_percent`.
 * When the value is missing it shows NOTHING — never a fabricated 0%. A real
 * 0.00% gain (a flat listing) is a distinct case from "missing" and must render.
 *
 * Class covered: LISTED IPOs, positive / negative / zero-exact / missing gain.
 * Real rows used below (docs/design/data-sourcing-pull-model.md OD-124):
 *   Karamtara Engineering  Rs 254 -> Rs 352     (+38.58%)
 *   Rentomojo              Rs 404 -> Rs 534.25  (+32.24%)
 *   Manika Plastech        Rs 43  -> Rs 43.14   (+0.33%)
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { IPOCardEnhanced } from '@/components/ipo/IPOCardEnhanced';
import { mockIPO, type IPO, type ListingPerformance } from '@/lib/db/types';

function buildIPO(overrides: Partial<IPO> = {}): IPO {
  return mockIPO({
    id: '11111111-1111-1111-1111-111111111111',
    companyName: 'Karamtara Engineering',
    slug: 'karamtara-engineering',
    segment: 'MAINBOARD',
    offeringType: 'IPO',
    sector: 'Industrials',
    status: 'LISTED',
    priceRangeMin: 250,
    priceRangeMax: 254,
    lotSize: 50,
    openDate: '2026-09-01',
    closeDate: '2026-09-03',
    allotmentDate: '2026-09-04',
    listingDate: '2026-09-08',
    ...overrides,
  });
}

function buildListingPerformance(
  listingGainPercent: ListingPerformance['listingGainPercent']
): ListingPerformance {
  return {
    id: '22222222-2222-2222-2222-222222222222',
    ipoId: '11111111-1111-1111-1111-111111111111',
    listingPrice: 352,
    issuePrice: 254,
    listingGainPercent,
    currentPrice: null,
    currentPriceBSE: null,
    currentPriceNSE: null,
    currentGainPercent: null,
    lastUpdated: new Date('2026-09-08T00:00:00.000Z'),
  };
}


function getGainBadge(container: HTMLElement): HTMLElement | null {
  const badges = Array.from(
    container.querySelectorAll<HTMLElement>('span[data-slot="badge"]')
  );
  return badges.find((badge) => badge.textContent?.includes('%')) ?? null;
}

describe('MainboardContentSections — Recently Listed card gain (#58, OD-124)', () => {
  it('should show gain/loss percentages for listed IPOs', () => {
    // Real row: Karamtara Engineering Rs 254 -> Rs 352 (+38.58%). DB numeric
    // columns arrive as strings, so the fixture uses a string on purpose.
    const ipo = {
      ...buildIPO(),
      listingPerformance: buildListingPerformance('38.58'),
    };

    render(<IPOCardEnhanced ipo={ipo} />);

    expect(screen.getByText('+38.58%')).toBeInTheDocument();
  });

  it('renders a negative listing gain with no plus sign, colour-coded loss', () => {
    // Real-shaped negative case (not one of the three OD-124 sample rows,
    // which are all positive) — proves the loss branch, not just the gain one.
    const ipo = {
      ...buildIPO({ companyName: 'Sample Loser Ltd', slug: 'sample-loser-ltd' }),
      listingPerformance: buildListingPerformance(-12.4),
    };

    const { container } = render(<IPOCardEnhanced ipo={ipo} />);

    expect(screen.getByText('-12.40%')).toBeInTheDocument();
    const badge = getGainBadge(container);
    expect(badge).toHaveClass('bg-red-100');
    expect(badge).toHaveClass('text-red-700');
  });

  it('renders an exact 0.00% gain (a flat listing), never blank', () => {
    // 0.00% is a REAL value, distinct from "missing" — must still render.
    const ipo = {
      ...buildIPO({ companyName: 'Flat Listing Ltd', slug: 'flat-listing-ltd' }),
      listingPerformance: buildListingPerformance(0),
    };

    render(<IPOCardEnhanced ipo={ipo} />);

    expect(screen.getByText('0.00%')).toBeInTheDocument();
  });

  it('renders nothing for the gain badge when listingPerformance is missing', () => {
    const ipo = { ...buildIPO(), listingPerformance: null };

    const { container } = render(<IPOCardEnhanced ipo={ipo} />);

    expect(getGainBadge(container)).not.toBeInTheDocument();
  });

  it('renders nothing for the gain badge when listingGainPercent is null on a real row', () => {
    const ipo = {
      ...buildIPO(),
      listingPerformance: buildListingPerformance(null as unknown as string),
    };

    const { container } = render(<IPOCardEnhanced ipo={ipo} />);

    expect(getGainBadge(container)).not.toBeInTheDocument();
  });

  it('never shows the gain badge for a non-LISTED IPO even if the row exists', () => {
    // The row can exist (e.g. a re-listed corporate action edge case) while
    // status has not (yet) transitioned to LISTED — the badge is gated on
    // status, not on row presence. Only the badge is asserted here: the
    // hover-layer QuickStatsGrid renders its own "Listing Gain" stat from the
    // same row independent of card status — a separate, pre-existing surface.
    const ipo = {
      ...buildIPO({ status: 'OPEN' }),
      listingPerformance: buildListingPerformance('38.58'),
    };

    const { container } = render(<IPOCardEnhanced ipo={ipo} />);

    expect(getGainBadge(container)).not.toBeInTheDocument();
  });

  it('carries an accessible "Listing gain" label on the badge, not colour alone', () => {
    // Rentomojo Rs 404 -> Rs 534.25 (+32.24%): the sign character and a
    // screen-reader label are the non-colour cues (OD-124 accessibility).
    const ipo = {
      ...buildIPO({ companyName: 'Rentomojo', slug: 'rentomojo' }),
      listingPerformance: buildListingPerformance('32.24'),
    };

    const { container } = render(<IPOCardEnhanced ipo={ipo} />);

    const badge = getGainBadge(container);
    expect(badge).not.toBeNull();
    expect(badge?.textContent).toContain('+32.24%');
    expect(badge?.querySelector('.sr-only')?.textContent).toContain('Listing gain');
  });

  it('handles a small positive gain formatted to two decimals (Manika Plastech +0.33%)', () => {
    const ipo = {
      ...buildIPO({ companyName: 'Manika Plastech', slug: 'manika-plastech' }),
      listingPerformance: buildListingPerformance('0.33'),
    };

    render(<IPOCardEnhanced ipo={ipo} />);

    expect(screen.getByText('+0.33%')).toBeInTheDocument();
  });
});
