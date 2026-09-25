/**
 * T-492 batch 1 (#386): backfill-price-bands.ts previously had NO prod guard at all
 * (an unexempted read of the module never existed for it before this
 * migration) — it now opens the DB through the shared
 * scripts/lib/repair-tool.ts module. This tool has no other unit test, so
 * per the defect-fix-contract this is the required minimal test: the
 * module's decision function (driven through openRepairDb(), the exact
 * entry point backfill-price-bands.ts's main() calls before any read/write) refuses
 * an --apply run against a database whose current_database() looks like
 * prod, unless --allow-prod is explicitly passed.
 */
import { describe, it, expect } from 'vitest';
import { openRepairDb } from '../../../scripts/lib/repair-tool.js';
import { resolveApplyMode } from '../../../scripts/backfill-price-bands.js';

function mockProdPool() {
  return { execute: async () => ({ rows: [{ name: 'ipodhan' }] }) };
}

// T-492 round 2 (#390 review): this tool used to default to APPLY
// (`DRY_RUN = includes('--dry-run')`) — the one repair tool in the batch that
// broke the "dry-run unless told otherwise" convention every other tool in
// scripts/lib/repair-tool.ts follows. Flipped to `APPLY = includes('--apply')`;
// `--dry-run` still parses (as a no-op) so an old invocation that passed it
// explicitly keeps working.
describe('backfill-price-bands.ts — dry-run by default', () => {
  it('reports dry-run (no --apply) when invoked with no flags', () => {
    expect(resolveApplyMode(['node', 'backfill-price-bands.ts'])).toEqual({
      apply: false,
      dryRun: true,
    });
  });

  it('reports dry-run when the old --dry-run flag is passed explicitly (no-op, not required)', () => {
    expect(resolveApplyMode(['node', 'backfill-price-bands.ts', '--dry-run'])).toEqual({
      apply: false,
      dryRun: true,
    });
  });

  it('reports apply mode only when --apply is passed', () => {
    expect(resolveApplyMode(['node', 'backfill-price-bands.ts', '--apply'])).toEqual({
      apply: true,
      dryRun: false,
    });
  });
});

describe('backfill-price-bands.ts — prod-write refusal via openRepairDb()', () => {
  it('refuses --apply against current_database()="ipodhan" without --allow-prod', async () => {
    let refusedReason: string | undefined;
    const result = await openRepairDb(mockProdPool(), {
      apply: true,
      allowProd: false,
      toolName: 'backfill-price-bands',
      log: () => {},
      error: () => {},
      onRefuse: (reason) => {
        refusedReason = reason;
      },
    });
    expect(refusedReason).toMatch(/refusing to APPLY/);
    expect(refusedReason).toMatch(/backfill-price-bands/);
    expect(result.isProd).toBe(true);
  });

  it('proceeds when --allow-prod is passed', async () => {
    let refused = false;
    await openRepairDb(mockProdPool(), {
      apply: true,
      allowProd: true,
      toolName: 'backfill-price-bands',
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
      toolName: 'backfill-price-bands',
      log: () => {},
      error: () => {},
      onRefuse: () => {
        refused = true;
      },
    });
    expect(refused).toBe(false);
  });
});
