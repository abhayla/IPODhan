/**
 * Unit tests for the shared TZ-invariant date-string parsers (T-327,
 * round-7 P1-1 class sweep).
 */

import { describe, it, expect, afterEach } from 'vitest';
import { parseDdMmmYyyy, parseDdMmmYy } from '../../../src/utils/date-string-parsing.js';

const ORIGINAL_TZ = process.env.TZ;

function withTZ(tz: string, fn: () => void) {
  process.env.TZ = tz;
  try {
    fn();
  } finally {
    process.env.TZ = ORIGINAL_TZ;
  }
}

describe('parseDdMmmYyyy', () => {
  afterEach(() => {
    process.env.TZ = ORIGINAL_TZ;
  });

  it('parses dash-separated DD-MMM-YYYY', () => {
    expect(parseDdMmmYyyy('27-Aug-2026')).toBe('2026-08-27');
  });

  it('parses slash-separated DD/MMM/YYYY (BSE format)', () => {
    expect(parseDdMmmYyyy('06/Oct/2025')).toBe('2025-10-06');
  });

  it('parses space-separated DD MMM YYYY (BSE issue-period format)', () => {
    expect(parseDdMmmYyyy('15 Oct 2025')).toBe('2025-10-15');
  });

  it('returns null for an unrecognized month abbreviation', () => {
    expect(parseDdMmmYyyy('27-Xxx-2026')).toBeNull();
  });

  it('returns null for a non-matching shape', () => {
    expect(parseDdMmmYyyy('2026-08-27')).toBeNull();
  });

  it('is TZ-invariant under Asia/Kolkata, UTC, and America/Los_Angeles', () => {
    for (const tz of ['Asia/Kolkata', 'UTC', 'America/Los_Angeles']) {
      withTZ(tz, () => {
        expect(parseDdMmmYyyy('27-Aug-2026')).toBe('2026-08-27');
      });
    }
  });
});

describe('parseDdMmmYy', () => {
  afterEach(() => {
    process.env.TZ = ORIGINAL_TZ;
  });

  it('parses "17 Oct 25" (Moneycontrol format) to 2025-10-17', () => {
    expect(parseDdMmmYy('17 Oct 25')).toBe('2025-10-17');
  });

  it('is TZ-invariant under Asia/Kolkata, UTC, and America/Los_Angeles', () => {
    for (const tz of ['Asia/Kolkata', 'UTC', 'America/Los_Angeles']) {
      withTZ(tz, () => {
        expect(parseDdMmmYy('27 Aug 26')).toBe('2026-08-27');
      });
    }
  });

  it('returns null for an unrecognized month abbreviation', () => {
    expect(parseDdMmmYy('27 Xxx 26')).toBeNull();
  });
});
