/**
 * Unit tests for StatusDot's accessible-name contract (#107).
 *
 * Class: any aria-labelled decorative element nested inside an
 * already-labeled interactive element (a Link/button) pollutes that
 * element's accessible name. StatusDot is nested inside the company
 * `<Link>` in both IPOListTable and ListingIndexClient — `decorative`
 * MUST be passed there so the dot contributes no accessible name.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import Link from 'next/link';
import { StatusDot } from '@/components/listing/ipo-status';

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
