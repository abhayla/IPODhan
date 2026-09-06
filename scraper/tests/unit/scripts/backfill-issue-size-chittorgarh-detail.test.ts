import { describe, it, expect, vi } from 'vitest';
import {
  decideIssueSizeRepair,
  resolveDatabaseName,
  PRODUCTION_DATABASE_NAME,
  dropIpoCacheKeys,
  validateOverwriteAboveFloorRequiresSlug,
} from '../../../scripts/backfill-issue-size-chittorgarh-detail.js';

describe('validateOverwriteAboveFloorRequiresSlug (round-4: refuse a whole-table overwrite)', () => {
  it('refuses --overwrite-above-floor with no --slug', () => {
    const v = validateOverwriteAboveFloorRequiresSlug(true, null);
    expect(v.ok).toBe(false);
    expect(v.message).toMatch(/requires --slug/);
  });

  it('refuses --overwrite-above-floor with an empty --slug list', () => {
    const v = validateOverwriteAboveFloorRequiresSlug(true, []);
    expect(v.ok).toBe(false);
  });

  it('allows --overwrite-above-floor when --slug names at least one row', () => {
    const v = validateOverwriteAboveFloorRequiresSlug(true, ['windlas-biotech-ipo']);
    expect(v.ok).toBe(true);
  });

  it('allows no --overwrite-above-floor regardless of --slug (FLAG-only recheck run)', () => {
    expect(validateOverwriteAboveFloorRequiresSlug(false, null).ok).toBe(true);
  });
});

describe('dropIpoCacheKeys (round-N residue: cache must be dropped by the tool, not by hand)', () => {
  it('deletes both the slug and id detail-cache keys after an applied write', async () => {
    const del = vi.fn().mockResolvedValue(1);
    await dropIpoCacheKeys({ del }, 'ather-energy', 'ipo-123');
    expect(del).toHaveBeenCalledTimes(1);
    expect(del).toHaveBeenCalledWith('ipo:slug:ather-energy', 'ipo:id:ipo-123');
  });

  it('source-level proof: the only call site of dropIpoCacheKeys() sits AFTER the `if (!APPLY) continue;` dry-run gate (round-4: renamed from a no-op instanceof-Function check)', async () => {
    // main() itself isn't unit-tested (network/DB side effects — see file
    // header), so this asserts the REAL thing statically: dropIpoCacheKeys's
    // one call site in the source text appears textually AFTER the dry-run
    // gate that `continue`s past it, which is what makes it unreachable
    // without --apply. A future edit that moves the call before the gate
    // (or removes the gate) turns this red.
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const path = fileURLToPath(new URL('../../../scripts/backfill-issue-size-chittorgarh-detail.ts', import.meta.url));
    const source = readFileSync(path, 'utf8');
    const applyGateIdx = source.indexOf('if (!APPLY) continue;');
    const callSiteIdx = source.indexOf('await dropIpoCacheKeys(');
    expect(applyGateIdx).toBeGreaterThan(-1);
    expect(callSiteIdx).toBeGreaterThan(applyGateIdx);
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

describe('decideIssueSizeRepair — above-floor recheck mode (round-N: Windlas/AAA/Induss/Banganga/Sanmitra class)', () => {
  it('OK: source figure within 40% of the stored value — never touched', () => {
    const d = decideIssueSizeRepair({
      current: 400_000_000,
      segment: 'MAINBOARD',
      sourced: 470_000_000, // 17.5% divergence
      mode: 'above-floor',
    });
    expect(d.status).toBe('OK');
    expect(d.write).toBe(false);
  });

  it('FLAG: source figure diverges >40% but --overwrite-above-floor was not given', () => {
    // Windlas-shaped: stored 47 Cr, source 401 Cr (~8.5x)
    const d = decideIssueSizeRepair({
      current: 470_000_000,
      segment: 'MAINBOARD',
      sourced: 4_010_000_000,
      mode: 'above-floor',
    });
    expect(d.status).toBe('FLAG');
    expect(d.write).toBe(false);
    expect(d.reason).toMatch(/overwrite-above-floor/);
  });

  it('WRITE: source figure diverges >40% AND --overwrite-above-floor is given', () => {
    const d = decideIssueSizeRepair({
      current: 470_000_000,
      segment: 'MAINBOARD',
      sourced: 4_010_000_000,
      mode: 'above-floor',
      overwriteAboveFloor: true,
    });
    expect(d.status).toBe('WRITE');
    expect(d.write).toBe(true);
  });

  it('SKIP: the write-time guard rejects the sourced value even in overwrite mode (cross-check failing)', () => {
    const d = decideIssueSizeRepair({
      current: 470_000_000,
      segment: 'SME',
      sourced: 500_000, // below the SME floor itself — fails the write-time guard
      mode: 'above-floor',
      overwriteAboveFloor: true,
    });
    expect(d.status).toBe('SKIP');
    expect(d.write).toBe(false);
    expect(d.reason).toMatch(/failed the write-time guard/);
  });

  it('SKIP: no sourced figure at all', () => {
    const d = decideIssueSizeRepair({ current: 470_000_000, segment: 'MAINBOARD', sourced: null, mode: 'above-floor' });
    expect(d.status).toBe('SKIP');
    expect(d.write).toBe(false);
  });

  it('below-floor mode (no mode given) is unchanged — still WRITEs a below-floor row', () => {
    const d = decideIssueSizeRepair({ current: 17_647_058, segment: 'MAINBOARD', sourced: 7_570_600_000 });
    expect(d.status).toBe('WRITE');
    expect(d.write).toBe(true);
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
