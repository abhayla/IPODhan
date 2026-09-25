/**
 * Unit tests for StatusDot's accessible-name contract (#107).
 *
 * Class: any aria-labelled decorative element nested inside an
 * already-labeled interactive element (a Link/button) pollutes that
 * element's accessible name. StatusDot is nested inside the company
 * `<Link>` in both IPOListTable and ListingIndexClient — `decorative`
 * MUST be passed there so the dot contributes no accessible name.
 *
 * Round-1 review finding: making the dot decorative fixed the link's
 * accessible name but, combined with the standalone Status column being
 * `hidden md:table-cell` (out of the a11y tree below md), left mobile
 * screen-reader users with NO status announcement for the row at all.
 * `StatusSrLabel` (rendered as a sibling OUTSIDE the Link) is the fix —
 * covered below alongside the row-level "both must hold at once" case.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import Link from 'next/link';
import { StatusDot, StatusSrLabel } from '@/components/listing/ipo-status';

const openIpo = {
  openDate: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
  closeDate: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
  status: 'OPEN',
};

describe('StatusDot accessible name (#107)', () => {
  it('decorative: nested inside a Link, the link keeps the company name as its exact accessible name', () => {
    render(
      <Link href="/ipos/acme">
        <StatusDot ipo={openIpo} decorative />
        Acme Corp
      </Link>
    );
    // exact match — no "Open " prefix leaking into the accessible name
    expect(screen.getByRole('link', { name: 'Acme Corp' })).toBeInTheDocument();
  });

  it('decorative: is aria-hidden and carries no aria-label', () => {
    render(<StatusDot ipo={openIpo} decorative />);
    const dot = document.querySelector('span[title="Open"]');
    expect(dot).toHaveAttribute('aria-hidden', 'true');
    expect(dot).not.toHaveAttribute('aria-label');
  });

  it('non-decorative (default/standalone use): still carries its own aria-label', () => {
    render(<StatusDot ipo={openIpo} />);
    expect(screen.getByLabelText('Open')).toBeInTheDocument();
  });
});

describe('StatusSrLabel + decorative StatusDot together (round-1 review on #107)', () => {
  it('the link name is exactly the company name AND the row status is present in the accessible tree', () => {
    render(
      <div>
        <StatusSrLabel ipo={openIpo} />
        <Link href="/ipos/acme">
          <StatusDot ipo={openIpo} decorative />
          Acme Corp
        </Link>
      </div>
    );

    // (a) the link's accessible name carries no status-word prefix/pollution
    expect(screen.getByRole('link', { name: 'Acme Corp' })).toBeInTheDocument();
    // (b) the status label is still present in the accessible tree for the
    // row (sr-only, not aria-hidden/display:none) — a screen reader on
    // mobile hears it even though it renders no visible text.
    expect(screen.getByText('Open')).toBeInTheDocument();
  });

  it('is visually hidden (sr-only) so it adds no visible text', () => {
    render(<StatusSrLabel ipo={openIpo} />);
    expect(screen.getByText('Open')).toHaveClass('sr-only');
  });

  it('carries md:hidden so it drops out at the breakpoint the visible Status column appears, avoiding a double announcement', () => {
    render(<StatusSrLabel ipo={openIpo} />);
    expect(screen.getByText('Open')).toHaveClass('md:hidden');
  });
});
