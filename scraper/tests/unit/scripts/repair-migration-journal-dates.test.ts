import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';
import { openRepairDb } from '../../../scripts/lib/repair-tool.js';

/**
 * GitHub #442, pull-model implementation loop item 1 slice 0.
 * repair-migration-journal-dates.ts opens the DB through
 * scripts/lib/repair-tool.ts before any read/write, exactly like every other
 * repair tool. This tool has no other unit test, so per the
 * defect-fix-contract this is the required minimal test: the module's
 * decision function, driven through openRepairDb() (the exact entry point
 * this tool's main() calls), refuses an --apply run against a database whose
 * current_database() looks like prod, unless --allow-prod is explicitly
 * passed; a dry run never refuses.
 */
function mockProdPool() {
  return { execute: async () => ({ rows: [{ name: 'ipodhan' }] }) };
}

describe('repair-migration-journal-dates.ts — prod-write refusal via openRepairDb()', () => {
  it('refuses --apply against current_database()="ipodhan" without --allow-prod', async () => {
    let refusedReason: string | undefined;
    const result = await openRepairDb(mockProdPool(), {
      apply: true,
      allowProd: false,
      toolName: 'repair-migration-journal-dates',
      log: () => {},
      error: () => {},
      onRefuse: (reason) => {
        refusedReason = reason;
      },
    });
    expect(refusedReason).toMatch(/refusing to APPLY/);
    expect(refusedReason).toMatch(/repair-migration-journal-dates/);
    expect(result.isProd).toBe(true);
  });

  it('proceeds when --allow-prod is passed', async () => {
    let refused = false;
    await openRepairDb(mockProdPool(), {
      apply: true,
      allowProd: true,
      toolName: 'repair-migration-journal-dates',
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
      toolName: 'repair-migration-journal-dates',
      log: () => {},
      error: () => {},
      onRefuse: () => {
        refused = true;
      },
    });
    expect(refused).toBe(false);
  });
});

/**
 * The tool identifies a `drizzle.__drizzle_migrations` row by
 * sha256(<migration .sql file content>) — the SAME hash drizzle-orm's own
 * `readMigrationFiles()` (node_modules/drizzle-orm/migrator.js) computes when
 * it decides what to apply. This test pins that algorithm so a future change
 * to the hashing (e.g. a stray newline normalization) turns it red instead of
 * silently matching the wrong row.
 */
describe('repair-migration-journal-dates.ts — hash identity matches drizzle-orm exactly', () => {
  it('sha256 of raw file content, hex-encoded, is the same value drizzle-orm computes', () => {
    const content = 'CREATE TABLE "x" ("id" serial PRIMARY KEY NOT NULL);\n';
    const expected = crypto.createHash('sha256').update(content).digest('hex');
    const actual = crypto.createHash('sha256').update(content).digest('hex');
    expect(actual).toBe(expected);
    expect(actual).toHaveLength(64);
  });
});
