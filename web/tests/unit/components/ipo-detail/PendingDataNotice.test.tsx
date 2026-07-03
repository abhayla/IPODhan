import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PendingDataNotice } from '@/components/ipo-detail/PendingDataNotice';

describe('PendingDataNotice', () => {
  it('renders nothing when no sections are pending', () => {
    const { container } = render(<PendingDataNotice pendingSections={[]} status="OPEN" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('names every pending section once, joined compactly', () => {
    render(
      <PendingDataNotice
        pendingSections={['Financials & KPIs', 'Peer comparison']}
        status="OPEN"
      />
    );
    expect(screen.getByText(/Financials & KPIs · Peer comparison/)).toBeInTheDocument();
    expect(screen.getByText('Awaiting data:')).toBeInTheDocument();
  });

  it('uses prospectus-filing copy for UPCOMING status', () => {
    render(<PendingDataNotice pendingSections={['IPODhan score']} status="UPCOMING" />);
    expect(screen.getByText(/prospectus is filed/)).toBeInTheDocument();
  });
});
