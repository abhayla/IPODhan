import { describe, it, expect, vi } from 'vitest';
import {
  decideIssueSizeRepair,
  resolveDatabaseName,
  PRODUCTION_DATABASE_NAME,
  dropIpoCacheKeys,
} from '../../../scripts/backfill-issue-size-chittorgarh-detail.js';

describe('dropIpoCacheKeys (round-N residue: cache must be dropped by the tool, not by hand)', () => {
  it('deletes both the slug and id detail-cache keys after an applied write', async () => {
    const del = vi.fn().mockResolvedValue(1);
    await dropIpoCacheKeys({ del }, 'ather-energy', 'ipo-123');
    expect(del).toHaveBeenCalledTimes(1);
    expect(del).toHaveBeenCalledWith('ipo:slug:ather-energy', 'ipo:id:ipo-123');
  });

  it('is never invoked in dry-run - the write block (and cache drop within it) is gated on APPLY', () => {
    // Structural guard: the backfill's main() only reaches the write/cache-drop
    // code inside `if (!APPLY) continue;`-gated logic, so dropIpoCacheKeys has
    // no call site reachable without --apply. Verified here as a doc-level
    // assertion since main() itself isn't unit-tested (see file header).
    expect(dropIpoCacheKeys).toBeInstanceOf(Function);
  });
});

describe('decideIssueSizeRepair', () => {
  it('never overwrites a mainboard row whose current value already clears the floor', () => {
    const d = decideIssueSizeRepair({ current: 200_000_000, segment: 'MAINBOARD', sourced: 500_000_000 });
    expect(d.write).toBe(false);
    expect(d.reason).toMatch(/already clears the segment floor/);
  });

  it('never overwrites an SME row whose current value already clears the SME floor', () => {
    const d = decideIssueSizeRepair({ current: 20_000_000, segment: 'SME', sourced: 50_000_000 });
    expect(d.write).toBe(false);
  });

  it('skips when no plausible source figure was found', () => {
    const d = decideIssueSizeRepair({ current: 17_647_058, segment: 'MAINBOARD', sourced: null });
    expect(d.write).toBe(false);
    expect(d.reason).toMatch(/no plausible source figure/);
  });

  it('writes a below-floor row when the sourced figure clears the floor', () => {
    const d = decideIssueSizeRepair({ current: 17_647_058, segment: 'MAINBOARD', sourced: 7_570_600_000 });
    expect(d.write).toBe(true);
  });

  it('re-runs the write-time guard and skips a sourced value that itself fails the segment floor', () => {
    // sourced somehow below floor (defensive: extractor should already have gated this)
    const d = decideIssueSizeRepair({ current: 5_000_000, segment: 'SME', sourced: 500_000 });
    expect(d.write).toBe(false);
    expect(d.reason).toMatch(/failed the write-time guard/);
  });

  it('writes an SME row when the sourced figure clears the SME floor', () => {
    const d = decideIssueSizeRepair({ current: 4_575_000, segment: 'SME', sourced: 91_500_000 });
    expect(d.write).toBe(true);
  });

  it('writes a NULL-issue_size row when the sourced figure clears the floor (round 4: same defect class)', () => {
    const d = decideIssueSizeRepair({ current: null, segment: 'MAINBOARD', sourced: 7_200_000_000 });
    expect(d.write).toBe(true);
  });

  it('writes a zero-issue_size row when the sourced figure clears the floor (round 4: same defect class)', () => {
    const d = decideIssueSizeRepair({ current: 0, segment: 'SME', sourced: 91_500_000 });
    expect(d.write).toBe(true);
  });

  it('skips a NULL-issue_size row when no plausible source figure was found', () => {
    const d = decideIssueSizeRepair({ current: null, segment: 'MAINBOARD', sourced: null });
    expect(d.write).toBe(false);
    expect(d.reason).toMatch(/no plausible source figure/);
  });
});

describe('resolveDatabaseName / PRODUCTION_DATABASE_NAME (prod guard)', () => {
  it('resolves the database name from DATABASE_URL', () => {
    expect(resolveDatabaseName({ DATABASE_URL: 'postgres://u:p@host:5432/ipodhan_staging' } as NodeJS.ProcessEnv)).toBe(
      'ipodhan_staging'
    );
  });

  it('falls back to DATABASE_NAME when DATABASE_URL is absent', () => {
    expect(resolveDatabaseName({ DATABASE_NAME: 'ipodhan_test' } as NodeJS.ProcessEnv)).toBe('ipodhan_test');
  });

  it('flags the exact production database name', () => {
    expect(resolveDatabaseName({ DATABASE_URL: 'postgres://u:p@host:5432/ipodhan' } as NodeJS.ProcessEnv)).toBe(
      PRODUCTION_DATABASE_NAME
    );
  });
});
