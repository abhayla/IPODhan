import { describe, it, expect } from 'vitest';
import { decideStaleCorrectionSkip, openRepairDb } from '../../../scripts/lib/repair-tool.js';
import { mapSqlToPgQuery } from '../../../scripts/repair-dates-and-leadmanagers-t299.js';

/**
 * T-493 (#386 batch 2): repair-dates-and-leadmanagers-t299.ts previously had NO shared prod guard — it
 * now opens the DB through scripts/lib/repair-tool.ts before any
 * read/write. This tool has no other unit test, so per the
 * defect-fix-contract this is the required minimal test: the module's
 * decision function, driven through openRepairDb() (the exact entry point
 * this tool's main() calls before any read/write), refuses an --apply run
 * against a database whose current_database() looks like prod, unless
 * --allow-prod is explicitly passed; a dry run never refuses.
 */
function mockProdPool() {
  return { execute: async () => ({ rows: [{ name: 'ipodhan' }] }) };
}

describe('repair-dates-and-leadmanagers-t299.ts — prod-write refusal via openRepairDb()', () => {
  it('refuses --apply against current_database()="ipodhan" without --allow-prod', async () => {
    let refusedReason: string | undefined;
    const result = await openRepairDb(mockProdPool(), {
      apply: true,
      allowProd: false,
      toolName: 'repair-dates-and-leadmanagers-t299',
      log: () => {},
      error: () => {},
      onRefuse: (reason) => {
        refusedReason = reason;
      },
    });
    expect(refusedReason).toMatch(/refusing to APPLY/);
    expect(refusedReason).toMatch(/repair-dates-and-leadmanagers-t299/);
    expect(result.isProd).toBe(true);
  });

  it('proceeds when --allow-prod is passed', async () => {
    let refused = false;
    await openRepairDb(mockProdPool(), {
      apply: true,
      allowProd: true,
      toolName: 'repair-dates-and-leadmanagers-t299',
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
      toolName: 'repair-dates-and-leadmanagers-t299',
      log: () => {},
      error: () => {},
      onRefuse: () => {
        refused = true;
      },
    });
    expect(refused).toBe(false);
  });
});

describe('repair-dates-and-leadmanagers-t299.ts — mapSqlToPgQuery() forwards the real SQL', () => {
  it('rejects a query it cannot map instead of silently substituting a different one', () => {
    expect(() => mapSqlToPgQuery({ notADrizzleSqlObject: true })).toThrow(/cannot forward/);
  });

  it('rejects a chunk shape it does not recognize', () => {
    expect(() => mapSqlToPgQuery({ queryChunks: [42] })).toThrow(/unsupported SQL chunk/);
  });

  it('forwards a literal string query as text with no params', () => {
    expect(mapSqlToPgQuery({ queryChunks: ['SELECT current_database() AS name'] })).toEqual({
      text: 'SELECT current_database() AS name',
      params: [],
    });
  });

  it('turns a Param chunk into a $n placeholder and collects its value', () => {
    expect(
      mapSqlToPgQuery({ queryChunks: ['select id from ipos where slug = ', { value: 'abc-ipo' }] })
    ).toEqual({ text: 'select id from ipos where slug = $1', params: ['abc-ipo'] });
  });
});

describe('repair-dates-and-leadmanagers-t299.ts — stale-correction guard wiring (#422)', () => {
  it("kwality-walls-india-ltd's listing_date correction is skipped once the row is LISTED (same class as issue #422's Priority Jewels row)", () => {
    // The header comment records assumedFrom='2026-02-16' (the value cited on
    // 2026-08-23) for this row; once the row goes LISTED — like Priority
    // Jewels did between the T-292 citation and the 2026-09-08 prod dry run —
    // the shared guard refuses regardless of what the current column reads.
    const decision = decideStaleCorrectionSkip({
      status: 'LISTED',
      citationDate: '2026-08-23',
      latestSourceDate: null,
      assumedFromValue: '2026-02-16',
      currentValue: '2026-02-16',
    });
    expect(decision.skip).toBe(true);
    expect(decision.reason).toMatch(/status is LISTED/);
  });

  it('still proceeds for a non-terminal row whose current value matches the citation-time value', () => {
    const decision = decideStaleCorrectionSkip({
      status: 'UPCOMING',
      citationDate: '2026-08-23',
      latestSourceDate: null,
      assumedFromValue: '2025-08-06',
      currentValue: '2025-08-06',
    });
    expect(decision.skip).toBe(false);
  });
});
