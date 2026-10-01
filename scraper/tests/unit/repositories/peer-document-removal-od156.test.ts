import { describe, it, expect } from 'vitest';
import { documentPeerMayBeRemoved } from '../../../src/repositories/peer-company-repository';

// OD-156 (#1166 item 1): which stored peer a document peer list may remove when it no longer names it.
describe('documentPeerMayBeRemoved (OD-156)', () => {
  const doc = (t: string | null) => ({ dataSource: 'DRHP', sourceDocumentType: t });

  it('removes a document peer of the same or an older type', () => {
    expect(documentPeerMayBeRemoved(doc('DRHP'), 'DRHP')).toBe(true);
    expect(documentPeerMayBeRemoved(doc('DRHP'), 'RHP')).toBe(true);
    expect(documentPeerMayBeRemoved(doc('RHP'), 'PROSPECTUS')).toBe(true);
    expect(documentPeerMayBeRemoved(doc('PROSPECTUS'), 'PROSPECTUS')).toBe(true);
  });

  it('never removes a peer a NEWER document stored', () => {
    expect(documentPeerMayBeRemoved(doc('RHP'), 'DRHP')).toBe(false);
    expect(documentPeerMayBeRemoved(doc('PROSPECTUS'), 'RHP')).toBe(false);
  });

  it('never removes a Chittorgarh or admin row, even one carrying a document type', () => {
    expect(documentPeerMayBeRemoved({ dataSource: 'CHITTORGARH', sourceDocumentType: 'DRHP' }, 'RHP')).toBe(false);
    expect(documentPeerMayBeRemoved({ dataSource: 'ADMIN', sourceDocumentType: 'DRHP' }, 'RHP')).toBe(false);
    expect(documentPeerMayBeRemoved({ dataSource: null, sourceDocumentType: 'DRHP' }, 'RHP')).toBe(false);
  });

  it('fails closed on an unknown or unordered type (legacy rows, the price band advertisement)', () => {
    expect(documentPeerMayBeRemoved(doc(null), 'PROSPECTUS')).toBe(false);
    expect(documentPeerMayBeRemoved(doc('PRICE_BAND_AD'), 'PROSPECTUS')).toBe(false);
    expect(documentPeerMayBeRemoved(doc('DRHP'), 'PRICE_BAND_AD')).toBe(false);
  });
});
