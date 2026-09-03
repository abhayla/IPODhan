/**
 * Unit tests for DocumentList (W-87)
 *
 * The heading must be the document TYPE; the exchange/SEBI source is a caption
 * derived from the stored URL's host, and the stored link is never rewritten.
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { DocumentList } from '@/components/ipo/DocumentList';

type DocumentRow = Parameters<typeof DocumentList>[0]['documents'][number];

function doc(overrides: Partial<DocumentRow> & Pick<DocumentRow, 'id' | 'type' | 'title' | 'url'>) {
  return {
    fileSize: 1024 * 1024,
    uploadedAt: new Date('2026-08-20T00:00:00Z'),
    ...overrides,
  } as DocumentRow;
}

describe('DocumentList (W-87)', () => {
  it('labels each document by its type, not by the stored title', () => {
    render(
      <DocumentList
        documents={[
          doc({
            id: '1',
            type: 'RHP',
            title: 'DEEPA_RHP_FINAL.pdf',
            url: 'https://www.bseindia.com/downloads/ipo/deepa-rhp.pdf',
          }),
          doc({
            id: '2',
            type: 'PRICE_BAND_AD',
            title: 'pba.pdf',
            url: 'https://www.sebi.gov.in/filings/price-band.pdf',
          }),
        ]}
      />
    );

    expect(screen.getByText('Red Herring Prospectus')).toBeInTheDocument();
    expect(screen.getByText('Price Band Advertisement')).toBeInTheDocument();
    expect(screen.queryByText('DEEPA_RHP_FINAL.pdf')).not.toBeInTheDocument();
  });

  it('captions the source from the URL host', () => {
    render(
      <DocumentList
        documents={[
          doc({
            id: '1',
            type: 'DRHP',
            title: 'drhp.pdf',
            url: 'https://www.sebi.gov.in/filings/drhp.pdf',
          }),
          doc({
            id: '2',
            type: 'RHP',
            title: 'rhp.pdf',
            url: 'https://nseindia.com/ipo/rhp.pdf',
          }),
        ]}
      />
    );

    expect(screen.getByText('SEBI')).toBeInTheDocument();
    expect(screen.getByText('NSE')).toBeInTheDocument();
  });

  it('disambiguates two documents of the same type with the stored title', () => {
    render(
      <DocumentList
        documents={[
          doc({
            id: '1',
            type: 'CORRIGENDUM',
            title: 'Corrigendum dated 20 Aug',
            url: 'https://www.bseindia.com/a.pdf',
          }),
          doc({
            id: '2',
            type: 'CORRIGENDUM',
            title: 'Corrigendum dated 22 Aug',
            url: 'https://www.bseindia.com/b.pdf',
          }),
        ]}
      />
    );

    expect(screen.getByText('BSE · Corrigendum dated 20 Aug')).toBeInTheDocument();
    expect(screen.getByText('BSE · Corrigendum dated 22 Aug')).toBeInTheDocument();
  });

  it('leaves the stored link untouched for an unrecognised host', () => {
    render(
      <DocumentList
        documents={[
          doc({
            id: '1',
            type: 'PROSPECTUS',
            title: 'prospectus.pdf',
            url: 'https://example.com/prospectus.pdf',
          }),
        ]}
      />
    );

    expect(screen.getByText('Prospectus')).toBeInTheDocument();
    expect(screen.queryByText('SEBI')).not.toBeInTheDocument();
    expect(screen.queryByText('BSE')).not.toBeInTheDocument();
  });
});
