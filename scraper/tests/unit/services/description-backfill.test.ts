/**
 * GitHub #69 — buildDescriptionScrapedIPO pure logic.
 * Verifies the upsertIPO payload sets company_description, carries sector through,
 * preserves the existing status (a description backfill must not change status),
 * and refuses to write a blank/short description.
 */
import { describe, it, expect } from 'vitest';
import { buildDescriptionScrapedIPO, type DescBackfillIpo } from '../../../src/services/description-backfill.js';

function ipo(p: Partial<DescBackfillIpo>): DescBackfillIpo {
  return {
    id: 'id-1', companyName: 'Acme Ltd', slug: 'acme', symbol: 'ACME', isin: 'INE111A01011',
    segment: 'MAINBOARD', offeringType: 'IPO', status: 'CLOSED',
    openDate: '2026-01-01', closeDate: '2026-01-03', listingDate: null,
    issueSize: '1000000000', sector: null, companyDescription: null,
    ...p,
  };
}
const DESC = 'Incorporated in 2010, Acme Limited manufactures industrial widgets across India.';

describe('buildDescriptionScrapedIPO (#69)', () => {
  it('sets the description and preserves existing status (does NOT force LISTED)', () => {
    const p = buildDescriptionScrapedIPO(ipo({ status: 'UPCOMING' }), DESC);
    expect(p.companyDescription).toBe(DESC);
    expect(p.status).toBe('UPCOMING');
    expect(p.offeringType).toBe('IPO');
  });

  it('carries existing sector through unchanged (sector→peers cascade input)', () => {
    expect(buildDescriptionScrapedIPO(ipo({ sector: 'Healthcare' }), DESC).sector).toBe('Healthcare');
    expect(buildDescriptionScrapedIPO(ipo({ sector: null }), DESC).sector).toBeUndefined();
  });

  it('preserves identifiers and listing date', () => {
    const p = buildDescriptionScrapedIPO(ipo({ symbol: 'GKSL', isin: 'INE0V0W01025', listingDate: '2025-12-30' }), DESC);
    expect(p.symbol).toBe('GKSL');
    expect(p.isin).toBe('INE0V0W01025');
    expect(p.listingDate).toBe('2025-12-30');
  });

  it('refuses to write an implausibly short description', () => {
    expect(() => buildDescriptionScrapedIPO(ipo({}), 'too short')).toThrow();
  });

  it('handles null issueSize as 0 (sentinel, low-priority consolidated)', () => {
    expect(buildDescriptionScrapedIPO(ipo({ issueSize: null }), DESC).issueSize).toBe(0);
  });
});
