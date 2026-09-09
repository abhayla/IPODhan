import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openRepairDb } from '../../../scripts/lib/repair-tool.js';
import { hashMigrationFile, findJournalMismatches } from '../../../scripts/repair-migration-journal-dates.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
// scraper/tests/unit/scripts -> repo root is four levels up.
const REPO_ROOT = path.join(HERE, '..', '..', '..', '..');
const MIGRATIONS_DIR = path.join(REPO_ROOT, 'web', 'drizzle', 'migrations');

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
 * it decides what to apply. This test drives the tool's REAL
 * `hashMigrationFile()` against a real fixture (an actual migration file
 * shipped in this repo) and compares its output to an independently computed
 * sha256 of that file's raw content, so a future change to the tool's
 * hashing (e.g. a stray newline normalization) turns this test red instead
 * of silently matching the wrong row. See the repair round's proof: mutating
 * hashMigrationFile() to prepend a character before hashing turns this RED;
 * reverting turns it GREEN.
 */
describe('repair-migration-journal-dates.ts — hash identity matches drizzle-orm exactly', () => {
  it('hashMigrationFile() equals an independently-computed sha256 of the real migration file', () => {
    const tag = '0049_ipo_details_ad_fields';
    const sqlPath = path.join(MIGRATIONS_DIR, `${tag}.sql`);
    const content = fs.readFileSync(sqlPath, 'utf8');
    const independentlyComputed = crypto.createHash('sha256').update(content).digest('hex');

    const actual = hashMigrationFile(tag);

    expect(actual).toBe(independentlyComputed);
    expect(actual).toHaveLength(64);
  });
});

/**
 * Finding 1: the repair tool must refuse to run when the on-disk journal it
 * is running from does NOT yet carry the corrected `when` values it is about
 * to write into the database — otherwise a checkout that hasn't shipped the
 * journal fix would drive the database's created_at lower than the deployed
 * journal, and the next db:migrate would re-insert duplicate rows for idx
 * 32-34. Drives the tool's real `findJournalMismatches()`.
 */
describe('repair-migration-journal-dates.ts — refuses when the on-disk journal lacks the corrected when', () => {
  const targets = [
    { tag: 'a', correctedWhen: 100 },
    { tag: 'b', correctedWhen: 200 },
  ];

  it('returns no mismatches when the journal already carries every corrected when', () => {
    const journalEntries = [
      { tag: 'a', when: 100 },
      { tag: 'b', when: 200 },
    ];
    expect(findJournalMismatches(journalEntries, targets)).toEqual([]);
  });

  it('reports a mismatch when the journal still carries the old (uncorrected) when', () => {
    const journalEntries = [
      { tag: 'a', when: 999 }, // journal fix not shipped to this checkout yet
      { tag: 'b', when: 200 },
    ];
    const mismatches = findJournalMismatches(journalEntries, targets);
    expect(mismatches).toHaveLength(1);
    expect(mismatches[0]).toContain('a');
    expect(mismatches[0]).toContain('999');
  });

  it('reports a mismatch when a target tag is missing from the journal entirely', () => {
    const journalEntries = [{ tag: 'a', when: 100 }];
    const mismatches = findJournalMismatches(journalEntries, targets);
    expect(mismatches).toHaveLength(1);
    expect(mismatches[0]).toContain('b');
    expect(mismatches[0]).toContain('not present');
  });
});
