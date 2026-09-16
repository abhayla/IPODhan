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
import { FieldProvenanceLine } from '@/components/ipo-detail/FieldProvenanceLine';

const base = {
  chosenSource: 'DOC',
  chosenDocumentType: 'RHP',
  confirmedAt: new Date('2026-09-06T00:00:00Z'),
  isStale: false,
};

describe('FieldProvenanceLine', () => {
  it('renders nothing at all when there is no provenance', () => {
    const { container } = render(<FieldProvenanceLine provenance={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when a row exists but has no confirmation date to show', () => {
    const { container } = render(
      <FieldProvenanceLine provenance={{ ...base, confirmedAt: null }} />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('names the offer document and the date when the field is fresh', () => {
    render(<FieldProvenanceLine provenance={base} />);
    expect(
      screen.getByText('From the offer document, confirmed 6 September 2026')
    ).toBeInTheDocument();
  });

  it('says being rechecked, not a false confirmation, when the field is overdue', () => {
    render(<FieldProvenanceLine provenance={{ ...base, isStale: true }} />);
    expect(
      screen.getByText('last confirmed 6 September 2026, being rechecked')
    ).toBeInTheDocument();
    expect(screen.queryByText(/^From /)).not.toBeInTheDocument();
  });

  it('names the exchange when the exchange is what supplied the number', () => {
    render(<FieldProvenanceLine provenance={{ ...base, chosenSource: 'BSE', chosenDocumentType: null }} />);
    expect(screen.getByText('From BSE, confirmed 6 September 2026')).toBeInTheDocument();
  });

  it('does not pretend one source spoke when the block mixes several', () => {
    render(
      <FieldProvenanceLine
        provenance={{ ...base, chosenSource: 'MULTIPLE', chosenDocumentType: null }}
      />
    );
    expect(
      screen.getByText('From more than one source, confirmed 6 September 2026')
    ).toBeInTheDocument();
  });

  it('falls back to the source code rather than inventing a friendly name it does not have', () => {
    render(<FieldProvenanceLine provenance={{ ...base, chosenSource: 'SOMETHING_NEW', chosenDocumentType: null }} />);
    expect(screen.getByText(/SOMETHING_NEW/)).toBeInTheDocument();
  });

  it('greys the stale line so it reads as a caveat, not as a fact', () => {
    const { container } = render(<FieldProvenanceLine provenance={{ ...base, isStale: true }} />);
    expect(container.firstElementChild?.className).toMatch(/text-(gray|slate|neutral)-/);
  });

  it('carries the marker text the nightly detection check greps for', () => {
    const { container } = render(<FieldProvenanceLine provenance={base} />);
    expect(container.textContent).toMatch(/confirmed|being rechecked/);
  });
});
