/**
 * Item 18 fix regression: `field_source_overrides.expires_at` reaches this module from a raw
 * `tx.execute(sql\`...\`)` read, so it can arrive as a naive wall-clock TEXT value or an already-
 * parsed `Date`. `expiresAtToIso` MUST read a naive TEXT value as UTC regardless of the process's
 * local timezone (`.claude/rules/ist-timezone.md`, `.claude/rules/utc-naive-timestamp-normalization.md`)
 * — never via a bare `new Date(<string>)`, which parses at the process's local offset.
 */
import { describe, expect, it } from 'vitest';
import { expiresAtToIso, planInputsChanged } from './plan-invalidating-rebuild';

describe('expiresAtToIso', () => {
  it('parses a naive text timestamp as UTC regardless of process TZ', () => {
    expect(expiresAtToIso('2026-10-01 00:00:00')).toBe('2026-10-01T00:00:00.000Z');
  });

  it('re-serialises an already-parsed Date value directly', () => {
    const d = new Date('2026-10-01T00:00:00.000Z');
    expect(expiresAtToIso(d)).toBe('2026-10-01T00:00:00.000Z');
  });
});

describe('planInputsChanged (PR #1327 CI-fix: rebuild only when the plan would differ)', () => {
  const manifest = {
    version: 1,
    fields: {
      'ipos.lot_size': { rank: { MAINBOARD: ['NSE'], SME_BSE: ['BSE'] }, na: ['BUYBACK', 'TENDER'] },
      'ipos.open_date': { rank: { MAINBOARD: ['NSE'], SME_BSE: ['BSE'] } },
    },
  };
  const mb = { segment: 'MAINBOARD', listingExchanges: ['BSE'] } as const;

  it('an offering type change that moves no na list (FPO -> IPO) changes nothing', () => {
    expect(planInputsChanged(manifest, { ...mb, offeringType: 'FPO' }, { ...mb, offeringType: 'IPO' })).toBe(false);
  });
  it('two types with the same na set (BUYBACK -> TENDER) change nothing', () => {
    expect(planInputsChanged(manifest, { ...mb, offeringType: 'BUYBACK' }, { ...mb, offeringType: 'TENDER' })).toBe(false);
  });
  it('an offering type change that changes the na set (IPO -> BUYBACK) rebuilds', () => {
    expect(planInputsChanged(manifest, { ...mb, offeringType: 'IPO' }, { ...mb, offeringType: 'BUYBACK' })).toBe(true);
  });
  it('a type key change rebuilds even with the offering type unchanged', () => {
    expect(planInputsChanged(manifest, { ...mb, offeringType: 'IPO' }, { segment: 'SME', listingExchanges: ['BSE'], offeringType: 'IPO' })).toBe(true);
  });
});
