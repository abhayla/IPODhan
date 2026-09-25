import { describe, it, expect } from 'vitest';
import { checkUpdateApplied } from '../../../scripts/repair-segment-hygiene-t287';
import { openRepairDb } from '../../../scripts/lib/repair-tool.js';

/**
 * T-287C checker finding (BLOCKING): the original apply loop assigned the
 * UPDATE result and never read it, so `written++` and `'segment corrected'`
 * fired unconditionally even when rowCount=0 — a silent failure that
 * reported 8/8 written while only 5 rows actually landed. This locks in the
 * rowCount-checked guard so the class cannot regress silently again.
 */
describe('checkUpdateApplied', () => {
  const context = { id: 'ipo-1', companyName: 'Cube Highways Trust', field: 'segment' };

  it('returns null (no error) when the UPDATE matched exactly one row', () => {
    expect(checkUpdateApplied({ rowCount: 1 }, context)).toBeNull();
  });

  it('returns null when the UPDATE matched more than one row', () => {
    expect(checkUpdateApplied({ rowCount: 2 }, context)).toBeNull();
  });

  it('returns an error string when rowCount is 0 — the exact silent-failure case from T-287C', () => {
    const error = checkUpdateApplied({ rowCount: 0 }, context);
    expect(error).not.toBeNull();
    expect(error).toContain('matched 0 rows');
    expect(error).toContain(context.companyName);
    expect(error).toContain(context.id);
  });

  it('treats a null rowCount (driver did not report one) as a failure, not a silent pass', () => {
    const error = checkUpdateApplied({ rowCount: null }, context);
    expect(error).not.toBeNull();
  });

  it('treats an undefined rowCount as a failure, not a silent pass', () => {
    const error = checkUpdateApplied({ rowCount: undefined }, context);
    expect(error).not.toBeNull();
  });
});

/**
 * T-493 (#386 batch 2): repair-segment-hygiene-t287.ts previously had no
 * shared prod guard — it now opens the DB through scripts/lib/repair-tool.ts
 * before any read/write. Per the defect-fix-contract this is the required
 * minimal test: the module's decision function, driven through
 * openRepairDb() (the exact entry point this tool's main() calls), refuses
 * an --apply run against a database whose current_database() looks like
 * prod, unless --allow-prod is explicitly passed; a dry run never refuses.
 */
function mockProdPool() {
  return { execute: async () => ({ rows: [{ name: 'ipodhan' }] }) };
}

describe('repair-segment-hygiene-t287.ts — prod-write refusal via openRepairDb()', () => {
  it('refuses --apply against current_database()="ipodhan" without --allow-prod', async () => {
    let refusedReason: string | undefined;
    const result = await openRepairDb(mockProdPool(), {
      apply: true,
      allowProd: false,
      toolName: 'repair-segment-hygiene-t287',
      log: () => {},
      error: () => {},
      onRefuse: (reason) => {
        refusedReason = reason;
      },
    });
    expect(refusedReason).toMatch(/refusing to APPLY/);
    expect(refusedReason).toMatch(/repair-segment-hygiene-t287/);
    expect(result.isProd).toBe(true);
  });

  it('proceeds when --allow-prod is passed', async () => {
    let refused = false;
    await openRepairDb(mockProdPool(), {
      apply: true,
      allowProd: true,
      toolName: 'repair-segment-hygiene-t287',
      log: () => {},
      error: () => {},
      onRefuse: () => {
        refused = true;
      },
    });
    expect(refused).toBe(false);
  });

  it('never refuses a dry run, even against prod', async () => {
    let refused = false;
    await openRepairDb(mockProdPool(), {
      apply: false,
      allowProd: false,
      toolName: 'repair-segment-hygiene-t287',
      log: () => {},
      error: () => {},
      onRefuse: () => {
        refused = true;
      },
    });
    expect(refused).toBe(false);
  });
});
