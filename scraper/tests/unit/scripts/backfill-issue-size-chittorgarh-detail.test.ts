import { describe, it, expect, vi } from 'vitest';
import {
  decideIssueSizeRepair,
  resolveDatabaseName,
  PRODUCTION_DATABASE_NAME,
  dropIpoCacheKeys,
  validateOverwriteAboveFloorRequiresSlug,
  parseSlugArg,
  upsertIssueSizeProvenance,
  stampExactMatchProvenance,
  BACKFILL_UPDATED_BY,
} from '../../../scripts/backfill-issue-size-chittorgarh-detail.js';

/** Builds a mocked db/tx exposing the exact chain the provenance helpers call. */
function mockSelectReturning(rows: unknown[]) {
  const limit = vi.fn().mockResolvedValue(rows);
  const where = vi.fn().mockReturnValue({ limit });
  const from = vi.fn().mockReturnValue({ where });
  return { select: vi.fn().mockReturnValue({ from }), from, where, limit };
}

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
  it('drops the canonical set (ipo:detail/ipo:slug via invalidateIPOCaches, plus ipo:id which that helper does not cover) — round 5', async () => {
    const del = vi.fn().mockResolvedValue(1);
    const scan = vi.fn().mockResolvedValue(['0', []]); // invalidateIPOCaches's list/search/history SCAN, no matches
    await dropIpoCacheKeys({ del, scan }, 'ather-energy', 'ipo-123');
    // invalidateIPOCaches(redis, 'ather-energy') deletes ipo:detail + ipo:slug in one call...
    expect(del).toHaveBeenCalledWith('ipo:detail:ather-energy', 'ipo:slug:ather-energy');
    // ...then dropIpoCacheKeys itself deletes ipo:id, which invalidateIPOCaches never touches.
    expect(del).toHaveBeenCalledWith('ipo:id:ipo-123');
    expect(del).toHaveBeenCalledTimes(2);
  });

  it('still drops ipo:id even if invalidateIPOCaches itself fails (fail-open, non-fatal)', async () => {
    // invalidateIPOCaches catches its own errors and never throws (T-264 fail-open
    // convention), but this proves dropIpoCacheKeys does not depend on its success.
    const del = vi.fn().mockResolvedValue(1);
    const scan = vi.fn().mockRejectedValue(new Error('redis down'));
    await dropIpoCacheKeys({ del, scan }, 'ather-energy', 'ipo-123');
    expect(del).toHaveBeenCalledWith('ipo:id:ipo-123');
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

describe('parseSlugArg (T-452: --slug as the LAST argv token used to crash)', () => {
  it('returns null slugs when --slug is absent', () => {
    expect(parseSlugArg(['node', 'script.js', '--apply'])).toEqual({ slugs: null });
  });

  it('parses a comma-separated slug list', () => {
    expect(parseSlugArg(['node', 'script.js', '--slug', 'a,b,c'])).toEqual({ slugs: ['a', 'b', 'c'] });
  });

  it('trims whitespace and drops empty entries', () => {
    expect(parseSlugArg(['node', 'script.js', '--slug', ' a , b ,,c '])).toEqual({ slugs: ['a', 'b', 'c'] });
  });

  it('reports a usage error instead of crashing when --slug is the LAST argv token', () => {
    const result = parseSlugArg(['node', 'script.js', '--apply', '--slug']);
    expect(result.slugs).toBe(null);
    expect(result.error).toMatch(/--slug requires a comma-separated value/);
  });

  it('reports a usage error when --slug is immediately followed by another flag', () => {
    const result = parseSlugArg(['node', 'script.js', '--slug', '--apply']);
    expect(result.slugs).toBe(null);
    expect(result.error).toMatch(/--slug requires a comma-separated value/);
  });
});

describe('upsertIssueSizeProvenance (T-452: RCA — every WRITE now upserts field_sources in the same transaction)', () => {
  it('inserts with previousSource=null when no field_sources row exists yet (never fabricated), source ADMIN, lineage set', async () => {
    const sel = mockSelectReturning([]); // no existing row
    const onConflictDoUpdate = vi.fn().mockResolvedValue(undefined);
    const values = vi.fn().mockReturnValue({ onConflictDoUpdate });
    const insert = vi.fn().mockReturnValue({ values });
    const txLike = { select: sel.select, insert } as any;

    await upsertIssueSizeProvenance(txLike, {
      ipoId: 'ipo-1',
      previousValue: 17_683_000,
      updatedBy: BACKFILL_UPDATED_BY,
    });

    expect(insert).toHaveBeenCalledTimes(1);
    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        ipoId: 'ipo-1',
        tableName: 'ipos',
        fieldName: 'issueSize',
        source: 'ADMIN',
        previousValue: '17683000',
        previousSource: null,
        dataLineage: expect.objectContaining({ note: expect.stringMatching(/repair:/) }),
        updatedBy: BACKFILL_UPDATED_BY,
      })
    );
    expect(onConflictDoUpdate).toHaveBeenCalledTimes(1);
  });

  it('carries the EXISTING row source as previousSource, never overwriting it with a guess (still writes ADMIN)', async () => {
    const sel = mockSelectReturning([{ source: 'NSE' }]);
    const onConflictDoUpdate = vi.fn().mockResolvedValue(undefined);
    const values = vi.fn().mockReturnValue({ onConflictDoUpdate });
    const insert = vi.fn().mockReturnValue({ values });
    const txLike = { select: sel.select, insert } as any;

    await upsertIssueSizeProvenance(txLike, {
      ipoId: 'ipo-2',
      previousValue: null,
      updatedBy: BACKFILL_UPDATED_BY,
    });

    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'ADMIN', previousValue: null, previousSource: 'NSE' })
    );
  });

  it('(round 2, item 2) labels BOTH write paths ADMIN — the write-transaction call site no longer branches on RECHECK_ABOVE_FLOOR', async () => {
    // Asserted at the source-text level, since main() itself is not
    // unit-tested (network/DB side effects — file header).
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const path = fileURLToPath(new URL('../../../scripts/backfill-issue-size-chittorgarh-detail.ts', import.meta.url));
    const source = readFileSync(path, 'utf8');
    expect(source).not.toMatch(/source: RECHECK_ABOVE_FLOOR \? 'ADMIN' : 'CHITTORGARH'/);
    expect(source).not.toMatch(/'CHITTORGARH'/); // no CHITTORGARH-labelled write path remains
  });
});

describe('stampExactMatchProvenance (T-452 round 2, item 1: exact-match ADMIN stamp regardless of existing provenance)', () => {
  it('(a) upgrades an existing CHITTORGARH row to ADMIN when the stored value is exactly the source figure', async () => {
    const sel = mockSelectReturning([{ source: 'CHITTORGARH' }]);
    const onConflictDoUpdate = vi.fn().mockResolvedValue(undefined);
    const values = vi.fn().mockReturnValue({ onConflictDoUpdate });
    const insert = vi.fn().mockReturnValue({ values });
    const txLike = { select: sel.select, insert } as any;

    const result = await stampExactMatchProvenance(txLike, {
      ipoId: 'ipo-5',
      storedValue: 54_210_000_000,
      updatedBy: BACKFILL_UPDATED_BY,
    });

    expect(result).toEqual({ stamped: true, previousSource: 'CHITTORGARH' });
    expect(insert).toHaveBeenCalledTimes(1);
    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        ipoId: 'ipo-5',
        source: 'ADMIN',
        previousValue: '54210000000',
        previousSource: 'CHITTORGARH',
        dataLineage: expect.objectContaining({ note: expect.stringMatching(/total-incl-OFS 2026-09-07/) }),
        updatedBy: BACKFILL_UPDATED_BY,
      })
    );
  });

  it('(a) upgrades an existing BSE row (Phychem-shaped, live) to ADMIN', async () => {
    const sel = mockSelectReturning([{ source: 'BSE' }]);
    const onConflictDoUpdate = vi.fn().mockResolvedValue(undefined);
    const values = vi.fn().mockReturnValue({ onConflictDoUpdate });
    const insert = vi.fn().mockReturnValue({ values });
    const txLike = { select: sel.select, insert } as any;

    const result = await stampExactMatchProvenance(txLike, {
      ipoId: 'ipo-phychem',
      storedValue: 9_220_000_000,
      updatedBy: BACKFILL_UPDATED_BY,
    });

    expect(result).toEqual({ stamped: true, previousSource: 'BSE' });
    expect(values).toHaveBeenCalledWith(expect.objectContaining({ source: 'ADMIN', previousSource: 'BSE' }));
  });

  it('(d) is idempotent: a second stamp of an already-ADMIN row stamps 0 (no insert)', async () => {
    const sel = mockSelectReturning([{ source: 'ADMIN' }]); // already stamped by a prior run
    const insert = vi.fn();
    const txLike = { select: sel.select, insert } as any;

    const result = await stampExactMatchProvenance(txLike, {
      ipoId: 'ipo-5',
      storedValue: 54_210_000_000,
      updatedBy: BACKFILL_UPDATED_BY,
    });

    expect(result).toEqual({ stamped: false, previousSource: 'ADMIN' });
    expect(insert).not.toHaveBeenCalled();
  });

  it('(b)/(c) the caller only invokes the stamp on an EXACT match with --apply --overwrite-above-floor --slug (source-text proof, since main() is not unit-tested)', async () => {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const path = fileURLToPath(new URL('../../../scripts/backfill-issue-size-chittorgarh-detail.ts', import.meta.url));
    const source = readFileSync(path, 'utf8');
    // (b) never the 40%-band OK case — gated on exact numeric equality, not decision.status alone
    expect(source).toMatch(/const exactMatch = current !== null && value !== null && current === value;/);
    // (c)/never-without-slug — gated on APPLY, OVERWRITE_ABOVE_FLOOR, and SLUGS together
    expect(source).toMatch(/if \(APPLY && OVERWRITE_ABOVE_FLOOR && SLUGS && SLUGS\.length > 0 && exactMatch\)/);
  });
});

describe('(e) below-floor write path also writes ADMIN (round 2, item 2)', () => {
  it('the ipos-update transaction upserts provenance without a source override — upsertIssueSizeProvenance itself always writes ADMIN', async () => {
    const sel = mockSelectReturning([]);
    const onConflictDoUpdate = vi.fn().mockResolvedValue(undefined);
    const values = vi.fn().mockReturnValue({ onConflictDoUpdate });
    const insert = vi.fn().mockReturnValue({ values });
    const txLike = { select: sel.select, insert } as any;

    // Below-floor repair: e.g. Annu Projects, current=17,683,000 (share count stored as rupees).
    await upsertIssueSizeProvenance(txLike, { ipoId: 'ipo-annu', previousValue: 17_683_000, updatedBy: BACKFILL_UPDATED_BY });

    expect(values).toHaveBeenCalledWith(expect.objectContaining({ source: 'ADMIN' }));
  });
});
