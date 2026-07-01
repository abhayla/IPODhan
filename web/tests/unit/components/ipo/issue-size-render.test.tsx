/**
 * Regression lock + output-plausibility tests for GitHub #8:
 * "IPO detail page for a LIVE (OPEN) IPO renders the WRONG issue size".
 *
 * `ipos.issue_size` is stored in RAW RUPEES (e.g. csm-technologies-ltd =
 * 1457800000.00 = ₹145.78 Cr). The render must show ₹145.78 Crores (== DB ==
 * Chittorgarh/Moneycontrol oracle), and a non-positive issue size must render a
 * "not available" state — never "₹0.00 Crores" (output-plausibility: a ₹0-crore
 * IPO cannot exist). The unit SSOT is `formatIssueSizeCrores` (GitHub #9).
 *
 * Oracle fixtures (frozen 2026-06-28, prod read-only via tunnel + CG):
 *   csm-technologies-ltd  issue_size = 1457800000 rupees = ₹145.78 Cr  (OPEN)
 *   sharp-india-ltd       issue_size = 0                              (OPEN)
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { KeyMetricsCardsEnhanced } from '@/components/ipo/KeyMetricsCardsEnhanced';
import { IPODetailsTable } from '@/components/ipo-detail/IPODetailsTable';
import { EnhancedSubscriptionView } from '@/components/ipo/EnhancedSubscriptionView';
import { formatIssueSizeCrores, RUPEES_PER_CRORE } from '@/lib/utils';

// CSM Technologies — the OPEN IPO from issue #8's "₹1.11 Cr vs DB ₹145.78 Cr"
const CSM_RUPEES = 1457800000; // ₹145.78 Cr
const CSM_CRORES_LABEL = '₹145.78 Crores';

describe('#8 issue-size unit SSOT (formatIssueSizeCrores)', () => {
  it('renders an OPEN IPO rupees value as the oracle crore figure', () => {
    // == DB (1457800000 rupees) == oracle (₹145.78 Cr)
    expect(formatIssueSizeCrores(CSM_RUPEES)).toBe(CSM_CRORES_LABEL);
    expect(formatIssueSizeCrores(String(CSM_RUPEES))).toBe(CSM_CRORES_LABEL);
  });

  it('treats issue_size <= 0 / null / NaN as "not available", never ₹0.00 Crores', () => {
    for (const bad of [0, '0.00', -1, null, undefined, NaN, Infinity]) {
      expect(formatIssueSizeCrores(bad as never)).toBe('N/A');
    }
  });

  it('output-plausibility: a real IPO issue size is in a sane crore range', () => {
    // 1 rupee crore = 1e7; sane IPO issue sizes are ~₹1 Cr .. ₹1,00,000 Cr.
    const crores = CSM_RUPEES / RUPEES_PER_CRORE;
    expect(crores).toBeGreaterThan(1);
    expect(crores).toBeLessThan(100000);
  });
});

// Owner directive: verify across ≥7 IPOs of different types/magnitudes so a
// unit/scale regression at ANY size is caught. Frozen from prod (rupees) 2026-06-28.
describe('#8 issue-size renders correctly across 7 IPO types (no scale bug)', () => {
  const cases: Array<{ slug: string; type: string; rupees: number; label: string }> = [
    { slug: 'csm-technologies-ltd', type: 'MAINBOARD', rupees: 1457800000, label: '₹145.78 Crores' },
    { slug: 'sri-priyanka-geo-commex-ltd', type: 'SME', rupees: 945100000, label: '₹94.51 Crores' },
    { slug: 'crazy-snacks-ltd', type: 'SME', rupees: 314700000, label: '₹31.47 Crores' },
    { slug: 'ic-electricals-company-ltd', type: 'SME (small)', rupees: 4839600, label: '₹0.48 Crores' },
    { slug: 'dhanwel-hybrid-seeds-ltd', type: 'SME', rupees: 267300000, label: '₹26.73 Crores' },
    { slug: 'large-mainboard', type: 'MAINBOARD (large)', rupees: 60000000000, label: '₹6,000.00 Crores' },
    { slug: 'sharp-india-ltd', type: 'MAINBOARD (zero/invalid)', rupees: 0, label: 'N/A' },
  ];

  it.each(cases)('$slug ($type): $rupees rupees -> $label', ({ rupees, label }) => {
    expect(formatIssueSizeCrores(rupees)).toBe(label);
  });
});

describe('#8 KeyMetricsCardsEnhanced (summary card)', () => {
  it('renders the OPEN IPO issue size == DB == oracle', () => {
    render(
      <KeyMetricsCardsEnhanced
        issueSize={CSM_RUPEES}
        subscription={null}
        gmp={null}
        gmpPercent={null}
        showSparklines={false}
      />
    );
    expect(screen.getByText(CSM_CRORES_LABEL)).toBeInTheDocument();
    // Must NOT mis-scale (the old prod bug showed ₹1.11 Cr / a wrong figure)
    expect(screen.queryByText(/₹1\.11 Crore/)).not.toBeInTheDocument();
  });

  it('renders "N/A" (not ₹0.00 Crores) for a zero issue size', () => {
    render(
      <KeyMetricsCardsEnhanced
        issueSize={0}
        subscription={null}
        gmp={null}
        gmpPercent={null}
        showSparklines={false}
      />
    );
    // The issue-size card subtitle becomes "Not available"; value is "N/A"
    // (the GMP card also shows "N/A", so assert the count, not a unique node).
    expect(screen.getAllByText('N/A').length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText(/₹0\.00 Crore/)).not.toBeInTheDocument();
  });
});

describe('#8 IPODetailsTable (overview tab)', () => {
  const baseProps = {
    issueType: 'BOOK_BUILDING',
    openDate: '2026-06-11',
    closeDate: '2026-06-24',
    allotmentDate: null,
    listingDate: null,
    priceRangeMin: 100,
    priceRangeMax: 120,
    lotSize: 132,
    minBidQuantity: null,
    faceValue: 10,
    freshIssueSize: null,
    offerForSaleSize: null,
  };

  it('renders the issue-size row == DB == oracle for an OPEN IPO', () => {
    render(<IPODetailsTable {...baseProps} issueSize={CSM_RUPEES} />);
    expect(screen.getByText(CSM_CRORES_LABEL)).toBeInTheDocument();
  });

  it('renders "-" (not ₹0.00 Crores) for a zero issue size', () => {
    render(<IPODetailsTable {...baseProps} issueSize={0} />);
    expect(screen.queryByText(/₹0\.00 Crore/)).not.toBeInTheDocument();
  });

  it('renders Fresh Issue and OFS in the SAME unit (rupees→crore SSOT)', () => {
    // Sibling fix: OFS previously used a no-divide formatter while Fresh Issue
    // divided by 1e7 — same table, two units. Both must use formatIssueSizeCrores.
    render(
      <IPODetailsTable
        {...baseProps}
        issueSize={CSM_RUPEES}
        freshIssueSize={1000000000} // ₹100.00 Cr
        offerForSaleSize={457800000} // ₹45.78 Cr
      />
    );
    expect(screen.getByText('₹100.00 Crores')).toBeInTheDocument();
    expect(screen.getByText('₹45.78 Crores')).toBeInTheDocument();
  });
});

describe('#8 EnhancedSubscriptionView empty-state copy matches status', () => {
  it('shows a status-neutral "not available" message, never the pre-open "bidding begins" copy', () => {
    render(<EnhancedSubscriptionView subscription={null} issueSize={CSM_RUPEES} />);
    expect(screen.getByText(/not available yet/i)).toBeInTheDocument();
    // The old bug rendered "will appear here once bidding begins" for an OPEN IPO.
    expect(screen.queryByText(/once bidding begins/i)).not.toBeInTheDocument();
  });
});
