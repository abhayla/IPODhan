/**
 * Item 18 fix regression: `field_source_overrides.expires_at` reaches this module from a raw
 * `tx.execute(sql\`...\`)` read, so it can arrive as a naive wall-clock TEXT value or an already-
 * parsed `Date`. `expiresAtToIso` MUST read a naive TEXT value as UTC regardless of the process's
 * local timezone (`.claude/rules/ist-timezone.md`, `.claude/rules/utc-naive-timestamp-normalization.md`)
 * — never via a bare `new Date(<string>)`, which parses at the process's local offset.
 */
import { describe, expect, it } from 'vitest';
import { expiresAtToIso } from './plan-invalidating-rebuild';

describe('expiresAtToIso', () => {
  it('parses a naive text timestamp as UTC regardless of process TZ', () => {
    expect(expiresAtToIso('2026-10-01 00:00:00')).toBe('2026-10-01T00:00:00.000Z');
  });

  it('re-serialises an already-parsed Date value directly', () => {
    const d = new Date('2026-10-01T00:00:00.000Z');
    expect(expiresAtToIso(d)).toBe('2026-10-01T00:00:00.000Z');
  });
});
