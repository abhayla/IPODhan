/**
 * Unit tests for BrokerGrid (issue #97)
 *
 * #97 found the /affiliates page rendering invented broker claims (4.5
 * rating, "1 Cr+" users, "₹300/year" AMC, "Zero brokerage on equity
 * delivery", a fake "Most Popular" badge) with no Zerodha-AP disclosure --
 * a compliance defect the moment a real row exists. These tests pin the
 * fix at the component that actually renders the cards.
 */

import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import '@testing-library/jest-dom';
import { BrokerGrid } from '@/components/affiliate/BrokerGrid';

const ZERODHA = {
  name: 'Zerodha',
  logo: '/logos/zerodha.svg',
  ctaText: 'Open Zerodha account',
  ctaLink: 'https://signup.zerodha.com/?c=PIFS1234',
};

describe('BrokerGrid', () => {
  it('renders exactly one card for one broker row, with the real CTA link', () => {
    render(<BrokerGrid brokers={[ZERODHA]} />);

    const cards = screen.getAllByTestId('broker-card');
    expect(cards).toHaveLength(1);

    const link = screen.getByRole('link', { name: /Open Zerodha account/i });
    expect(link).toHaveAttribute('href', ZERODHA.ctaLink);
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
    expect(link).toHaveAttribute('rel', expect.stringContaining('sponsored'));
  });

  it('shows the Zerodha-AP disclosure verbatim', () => {
    render(<BrokerGrid brokers={[ZERODHA]} />);

    expect(
      screen.getByText(/SEBI Registration no\.: INZ000031633/)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/AP2516003693/)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Investments in securities market are subject to market risks/)
    ).toBeInTheDocument();
  });

  it('never renders invented claims', () => {
    render(<BrokerGrid brokers={[ZERODHA]} />);

    const html = document.body.innerHTML;
    expect(html).not.toContain('4.5');
    expect(html).not.toContain('1 Cr+');
    expect(html).not.toContain('₹300/year');
    expect(html).not.toContain('Most Popular');
    expect(html).not.toContain('Zero brokerage');
  });

  it('shows a neutral empty state with zero rows, never "temporarily unavailable"', () => {
    render(<BrokerGrid brokers={[]} />);

    expect(screen.getByText(/being updated/i)).toBeInTheDocument();
    expect(screen.queryByText(/temporarily unavailable/i)).not.toBeInTheDocument();
    expect(screen.queryByTestId('broker-card')).not.toBeInTheDocument();
  });
});
