import { describe, it, expect } from 'vitest';
import { formatIssueSizeCrores } from '@/lib/utils';

// issue_size is stored in RUPEES (GitHub #9). The formatter is the display SSOT:
// every table/card MUST render through it — the /100 "lakhs" helpers it replaces
// produced ₹43950000 Cr-style absurdities (2026-07-02 UI review, RC1).
describe('formatIssueSizeCrores', () => {
  it('converts rupee-stored values to en-IN crores (Knack Packaging real row)', () => {
    expect(formatIssueSizeCrores(4395000000)).toBe('₹439.50 Crores');
    expect(formatIssueSizeCrores('4395000000.00')).toBe('₹439.50 Crores');
  });

  it('groups large values with the Indian numbering system', () => {
    expect(formatIssueSizeCrores(60000000000)).toBe('₹6,000.00 Crores');
  });

  it('returns N/A for null/zero/negative/non-finite', () => {
    expect(formatIssueSizeCrores(null)).toBe('N/A');
    expect(formatIssueSizeCrores(undefined)).toBe('N/A');
    expect(formatIssueSizeCrores(0)).toBe('N/A');
    expect(formatIssueSizeCrores(-5)).toBe('N/A');
    expect(formatIssueSizeCrores('not-a-number')).toBe('N/A');
  });

  it('rejects domain-implausible values instead of rendering absurd crores', () => {
    // below ₹0.01 Cr — e.g. a value mistakenly stored in crores/lakhs (34 such prod rows)
    expect(formatIssueSizeCrores(500)).toBe('N/A');
    // above ₹1,00,000 Cr — larger than any Indian IPO ever (LIC ≈ ₹21,000 Cr)
    expect(formatIssueSizeCrores(2e15)).toBe('N/A');
  });
});
