import { describe, it, expect } from 'vitest';
import { documentPeerMayBeRemoved, isDocumentPeerRow, keptDocumentType } from '../../../src/repositories/peer-company-repository';

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

// OD-156 round 2 (item 4): a document list with figures from an OLDER type keeps the higher stamp.
describe('keptDocumentType (OD-156 round 2)', () => {
  it('keeps the newer stored type when an older document rewrites the row', () => {
    expect(keptDocumentType('PROSPECTUS', 'DRHP')).toBe('PROSPECTUS');
    expect(keptDocumentType('RHP', 'DRHP')).toBe('RHP');
  });

  it('takes the incoming type when it is the same or newer, or the stored type is unknown', () => {
    expect(keptDocumentType('DRHP', 'RHP')).toBe('RHP');
    expect(keptDocumentType('RHP', 'RHP')).toBe('RHP');
    expect(keptDocumentType(null, 'DRHP')).toBe('DRHP');
    expect(keptDocumentType('PRICE_BAND_AD', 'DRHP')).toBe('DRHP');
  });

  it('never lowers an ordered stored type to an unordered incoming one', () => {
    expect(keptDocumentType('RHP', 'PRICE_BAND_AD')).toBe('RHP');
  });
});

// Section 1.7 / OD-156 round 2: which stored rows the Chittorgarh (no document type) list may never delete.
describe('isDocumentPeerRow', () => {
  it('a document row by data source or by a recorded type (fail closed)', () => {
    expect(isDocumentPeerRow({ dataSource: 'DRHP', sourceDocumentType: null })).toBe(true);
    expect(isDocumentPeerRow({ dataSource: 'CHITTORGARH', sourceDocumentType: 'RHP' })).toBe(true);
    expect(isDocumentPeerRow({ dataSource: 'CHITTORGARH', sourceDocumentType: null })).toBe(false);
    expect(isDocumentPeerRow({ dataSource: 'MONEYCONTROL', sourceDocumentType: null })).toBe(false);
  });
});
