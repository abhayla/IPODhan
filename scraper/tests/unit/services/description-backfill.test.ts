/**
 * GitHub #69 — buildDescriptionScrapedIPO pure logic.
 * Verifies the upsertIPO payload sets company_description, carries sector through,
 * preserves the existing status (a description backfill must not change status),
 * and refuses to write a blank/short description.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { buildDescriptionScrapedIPO, type DescBackfillIpo } from '../../../src/services/description-backfill.js';
import { istDateIso } from '../../../src/scheduler/due-step-cycle.js';

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

describe('buildDescriptionScrapedIPO today fallback uses the IST day (#687 slice 2)', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('falls back to the IST today, not the UTC today, when openDate/closeDate are null', () => {
    // 2026-09-15T20:30:00Z = 02:00 IST on 2026-09-16 — a naive
    // `new Date().toISOString().split('T')[0]` reads UTC day 2026-09-15,
    // one day BEHIND the real IST calendar day.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-15T20:30:00Z'));
    expect(istDateIso(new Date())).toBe('2026-09-16');

    const p = buildDescriptionScrapedIPO(ipo({ openDate: null, closeDate: null }), DESC);
    expect(p.openDate).toBe('2026-09-16');
    expect(p.closeDate).toBe('2026-09-16');
  });
});
