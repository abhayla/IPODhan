/**
 * Item 21 slice 4 — OD-39. The line under each key-facts block saying where
 * those numbers came from and when they were last confirmed.
 *
 * The rule this file exists to hold: when there is nothing to say, the
 * component renders NOTHING. Not "source unknown", not a grey placeholder, not
 * a skeleton. A reader who sees a provenance line must be able to trust it; a
 * placeholder teaches them the line means nothing.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FieldProvenanceLine, LiveFigureAsAt } from '@/components/ipo-detail/FieldProvenanceLine';

const base = {
  chosenSource: 'DOC',
  chosenDocumentType: 'RHP',
  confirmedAt: new Date('2026-09-06T00:00:00Z'),
};

describe('FieldProvenanceLine', () => {
  it('renders nothing at all when there is no provenance', () => {
    const { container } = render(<FieldProvenanceLine provenance={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('item 21 (OD-72): a source with no recorded read date names the source and shows NO date', () => {
    const { container } = render(
      <FieldProvenanceLine provenance={{ ...base, confirmedAt: null }} />
    );
    expect(container.textContent).toBe('From the offer document');
  });

  it('renders nothing when the row names no source', () => {
    const { container } = render(
      <FieldProvenanceLine provenance={{ ...base, chosenSource: null }} />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('item 21 (OD-72): a DOC field reads "From the offer document, read <IST date>"', () => {
    // 2026-09-20T20:00Z is 21 Sep 01:30 IST: the IST calendar date, not the UTC one.
    render(<FieldProvenanceLine provenance={{ ...base, confirmedAt: new Date('2026-09-20T20:00:00Z') }} />);
    expect(screen.getByText('From the offer document, read 21 Sep 2026')).toBeInTheDocument();
  });

  it('item 21 (OD-72): no age-based stale marker, whatever the date', () => {
    const { container } = render(
      <FieldProvenanceLine provenance={{ ...base, confirmedAt: new Date('2024-01-01T00:00:00Z') }} />
    );
    expect(container.textContent).not.toMatch(/stale|recheck|confirmed/i);
  });

  it('names the offer document and the date when the field is fresh', () => {
    render(<FieldProvenanceLine provenance={base} />);
    expect(
      screen.getByText('From the offer document, read 6 Sep 2026')
    ).toBeInTheDocument();
  });

  it('names the exchange when the exchange is what supplied the number', () => {
    render(<FieldProvenanceLine provenance={{ ...base, chosenSource: 'BSE', chosenDocumentType: null }} />);
    expect(screen.getByText('From BSE, read 6 Sep 2026')).toBeInTheDocument();
  });

  it('does not pretend one source spoke when the block mixes several', () => {
    render(
      <FieldProvenanceLine
        provenance={{ ...base, chosenSource: 'MULTIPLE', chosenDocumentType: null }}
      />
    );
    expect(
      screen.getByText('From more than one source, read 6 Sep 2026')
    ).toBeInTheDocument();
  });

  it('falls back to the source code rather than inventing a friendly name it does not have', () => {
    render(<FieldProvenanceLine provenance={{ ...base, chosenSource: 'SOMETHING_NEW', chosenDocumentType: null }} />);
    expect(screen.getByText(/SOMETHING_NEW/)).toBeInTheDocument();
  });

});

describe('LiveFigureAsAt (OD-72: a live figure shows the time of the figure, IST)', () => {
  it('"Subscription as at 10:30 PM, 22 Sep" for 22 Sep 17:00Z', () => {
    render(<LiveFigureAsAt label="Subscription" at={new Date('2026-09-22T17:00:00Z')} />);
    expect(screen.getByText('Subscription as at 10:30 PM, 22 Sep')).toBeInTheDocument();
  });

  it('accepts the ISO string a cached payload carries', () => {
    const { container } = render(<LiveFigureAsAt label="Subscription" at="2026-09-24T05:20:09.000Z" />);
    expect(container.textContent).toBe('Subscription as at 10:50 AM, 24 Sep');
  });

  it('renders nothing when there is no figure time', () => {
    const { container } = render(<LiveFigureAsAt label="Subscription" at={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});
