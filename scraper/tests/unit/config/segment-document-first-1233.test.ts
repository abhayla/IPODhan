/**
 * #1233 (OD-129, spec row 23 "DOC, NSE, BSE"): the write-priority matrix must let the offer
 * document (writer source DRHP) decide `ipos.segment` above the feeds, below ADMIN, and let a
 * later, higher-ranked filing replace an earlier document's board (OD-30; the same-source
 * refresh ranks the two documents by type).
 */
import { describe, it, expect } from 'vitest';
import { getSourcePriority, allowsSameSourceRefresh } from '../../../src/config/field-priority-matrix';

describe('#1233 segment is document-first in the write-priority matrix', () => {
  it('ranks ADMIN first, then the document (DRHP), then NSE, BSE, Chittorgarh', () => {
    const rank = (s: string) => getSourcePriority('segment', s as never, 'ipos');
    expect(rank('ADMIN')).toBe(0);
    expect(rank('DRHP')).toBe(1);
    expect(rank('DRHP')).toBeLessThan(rank('NSE'));
    expect(rank('NSE')).toBeLessThan(rank('BSE'));
    expect(rank('BSE')).toBeLessThan(rank('CHITTORGARH'));
  });

  it('a later document may refresh a board an earlier document set (OD-30), a feed may not', () => {
    expect(allowsSameSourceRefresh('segment', 'DRHP' as never, 'ipos')).toBe(true);
    expect(allowsSameSourceRefresh('segment', 'NSE' as never, 'ipos')).toBe(false);
  });
});
