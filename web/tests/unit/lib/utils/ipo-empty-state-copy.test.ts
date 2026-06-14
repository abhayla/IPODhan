import { describe, it, expect } from 'vitest';
import { ipoEmptyStateMessage } from '@/lib/utils/ipo-empty-state-copy';

describe('ipoEmptyStateMessage', () => {
  // The bug (#8): an OPEN IPO with no data must NOT show upcoming-state copy.
  describe('subscription', () => {
    it('uses upcoming copy only for UPCOMING', () => {
      expect(ipoEmptyStateMessage('subscription', 'UPCOMING', 'Acme Ltd')).toMatch(
        /once bidding begins for Acme Ltd/,
      );
    });

    it.each(['OPEN', 'CLOSED', 'LISTED'])(
      'uses neutral copy (no "once bidding begins") for %s',
      (status) => {
        const msg = ipoEmptyStateMessage('subscription', status, 'Acme Ltd');
        expect(msg).not.toMatch(/once bidding begins/);
        expect(msg).toMatch(/not available yet/);
        expect(msg).toContain('Acme Ltd');
      },
    );

    it('defaults to neutral copy when status is missing/unknown', () => {
      expect(ipoEmptyStateMessage('subscription', undefined, 'Acme Ltd')).not.toMatch(
        /once bidding begins/,
      );
      expect(ipoEmptyStateMessage('subscription', null, 'Acme Ltd')).not.toMatch(
        /once bidding begins/,
      );
    });
  });

  describe('financial', () => {
    it('uses prospectus-filing copy only for UPCOMING', () => {
      expect(ipoEmptyStateMessage('financial', 'UPCOMING', 'Acme Ltd')).toMatch(
        /files its prospectus/,
      );
    });

    it.each(['OPEN', 'CLOSED', 'LISTED'])(
      'never tells an %s IPO to "check back after it files its prospectus"',
      (status) => {
        const msg = ipoEmptyStateMessage('financial', status, 'Acme Ltd');
        expect(msg).not.toMatch(/files its prospectus/);
        expect(msg).toContain('Acme Ltd');
      },
    );
  });

  it('falls back to a generic subject when companyName is blank', () => {
    expect(ipoEmptyStateMessage('subscription', 'OPEN', '   ')).toContain('this company');
  });

  it('is case-insensitive on status', () => {
    expect(ipoEmptyStateMessage('subscription', 'upcoming', 'Acme Ltd')).toMatch(
      /once bidding begins/,
    );
  });
});
