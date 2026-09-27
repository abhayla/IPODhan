/**
 * TerminalIpoNotice — the OD-8 freeze mechanism (#975, DELISTED half).
 *
 * Class: every IPO row whose status is DELISTED or WITHDRAWN gets the same
 * frozen-page notice; the underlying data stays, but nothing implies the
 * issue is still live.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TerminalIpoNotice } from '@/components/ipo-detail/TerminalIpoNotice';

describe('TerminalIpoNotice', () => {
  it('renders nothing for a non-terminal status', () => {
    const { container } = render(
      <TerminalIpoNotice status="OPEN" delistedAt={null} />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('names the delisting date (IST) for a DELISTED row', () => {
    render(
      <TerminalIpoNotice status="DELISTED" delistedAt="2026-09-20T18:30:00.000Z" />
    );
    // 2026-09-20T18:30:00Z is 2026-09-21 00:00 IST
    expect(screen.getByText(/delisted on 21 Sept? 2026/i)).toBeInTheDocument();
    expect(screen.getByText(/no longer trades/i)).toBeInTheDocument();
  });

  it('shows the withdrawal notice for a WITHDRAWN row without a delisting date', () => {
    render(<TerminalIpoNotice status="WITHDRAWN" delistedAt={null} />);
    expect(screen.getByText(/will not proceed/i)).toBeInTheDocument();
  });

  it('is a live region so the notice is never mistaken for a stale render', () => {
    render(<TerminalIpoNotice status="DELISTED" delistedAt="2026-09-20T18:30:00.000Z" />);
    expect(screen.getByRole('status')).toBeInTheDocument();
  });
});
