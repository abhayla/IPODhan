/**
 * T-492 batch 1 (#386): backfill-allotment-date-chittorgarh.ts previously had NO prod guard at all
 * (an unexempted read of the module never existed for it before this
 * migration) — it now opens the DB through the shared
 * scripts/lib/repair-tool.ts module. This tool has no other unit test, so
 * per the defect-fix-contract this is the required minimal test: the
 * module's decision function (driven through openRepairDb(), the exact
 * entry point backfill-allotment-date-chittorgarh.ts's main() calls before any read/write) refuses
 * an --apply run against a database whose current_database() looks like
 * prod, unless --allow-prod is explicitly passed.
 */
import { describe, it, expect } from 'vitest';
import { openRepairDb } from '../../../scripts/lib/repair-tool.js';

function mockProdPool() {
  return { execute: async () => ({ rows: [{ name: 'ipodhan' }] }) };
}

describe('backfill-allotment-date-chittorgarh.ts — prod-write refusal via openRepairDb()', () => {
  it('refuses --apply against current_database()="ipodhan" without --allow-prod', async () => {
    let refusedReason: string | undefined;
    const result = await openRepairDb(mockProdPool(), {
      apply: true,
      allowProd: false,
      toolName: 'backfill-allotment-date-chittorgarh',
      log: () => {},
      error: () => {},
      onRefuse: (reason) => {
        refusedReason = reason;
      },
    });
    expect(refusedReason).toMatch(/refusing to APPLY/);
    expect(refusedReason).toMatch(/backfill-allotment-date-chittorgarh/);
    expect(result.isProd).toBe(true);
  });

  it('proceeds when --allow-prod is passed', async () => {
    let refused = false;
    await openRepairDb(mockProdPool(), {
      apply: true,
      allowProd: true,
      toolName: 'backfill-allotment-date-chittorgarh',
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
      toolName: 'backfill-allotment-date-chittorgarh',
      log: () => {},
      error: () => {},
      onRefuse: () => {
        refused = true;
      },
    });
    expect(refused).toBe(false);
  });
});
