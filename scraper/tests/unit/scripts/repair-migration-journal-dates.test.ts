import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openRepairDb } from '../../../scripts/lib/repair-tool.js';
import {
  hashMigrationFile,
  findJournalMismatches,
  hashContentVariants,
  matchTargetsToRows,
  decideRepairOutcome,
} from '../../../scripts/repair-migration-journal-dates.js';

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

/**
 * GitHub #449: the tool must match a `drizzle.__drizzle_migrations` row
 * whose stored hash was computed on a platform whose line endings differ
 * from the reader's (Linux LF writer, Windows CRLF checkout, or vice
 * versa). It matches on EITHER encoding of the same logical file content,
 * never normalizes only one direction, and never double-counts a file
 * that is already LF (raw === normalized).
 */
describe('repair-migration-journal-dates.ts — matches a row regardless of which platform wrote its hash', () => {
  it('a row written by a Linux/LF runner matches a target read from a CRLF (Windows) checkout, via the normalized hash', () => {
    const lfContent = 'CREATE TABLE foo (id int);\nALTER TABLE foo ADD COLUMN bar int;\n';
    const crlfContent = lfContent.replace(/\n/g, '\r\n');
    const { raw: lfHash } = hashContentVariants(lfContent);
    // Target as this checkout actually reads it: CRLF (the Windows case #449 is about).
    const targets = [{ tag: 'x', correctedWhen: 111, ...hashContentVariants(crlfContent) }];
    const rows = [{ id: 1, hash: lfHash, created_at: '999' }];
    const { matched, unmatched } = matchTargetsToRows(targets, rows);
    expect(unmatched).toHaveLength(0);
    expect(matched).toHaveLength(1);
    expect(matched[0].row.id).toBe(1);
    expect(matched[0].matchedVia).toBe('normalized');
  });

  it('a row written by a CRLF-applying runner matches a target read from the same CRLF checkout, via the raw hash', () => {
    const lfContent = 'CREATE TABLE foo (id int);\nALTER TABLE foo ADD COLUMN bar int;\n';
    const crlfContent = lfContent.replace(/\n/g, '\r\n');
    const { raw: crlfHash } = hashContentVariants(crlfContent);
    const targets = [{ tag: 'x', correctedWhen: 111, ...hashContentVariants(crlfContent) }];
    const rows = [{ id: 1, hash: crlfHash, created_at: '999' }];
    const { matched, unmatched } = matchTargetsToRows(targets, rows);
    expect(unmatched).toHaveLength(0);
    expect(matched).toHaveLength(1);
    expect(matched[0].row.id).toBe(1);
    expect(matched[0].matchedVia).toBe('raw');
  });

  it('a row written by a CRLF (Windows) checkout matches a target read from a Linux/LF checkout, via the crlf variant', () => {
    // The reverse of the first case above: this checkout already holds LF
    // content (a Linux checkout), but the stored row's hash was computed
    // from the SAME logical file's CRLF form (written by a Windows
    // checkout). Without a third variant that re-expands LF -> CRLF, raw
    // === normalized on an LF checkout and the CRLF hash is never tried —
    // this is the half of #449 the first round left open.
    const lfContent = 'CREATE TABLE foo (id int);\nALTER TABLE foo ADD COLUMN bar int;\n';
    const crlfContent = lfContent.replace(/\n/g, '\r\n');
    const { raw: crlfHash } = hashContentVariants(crlfContent);
    // Target as a Linux checkout actually reads it: pure LF.
    const targets = [{ tag: 'x', correctedWhen: 111, ...hashContentVariants(lfContent) }];
    const rows = [{ id: 1, hash: crlfHash, created_at: '999' }];
    const { matched, unmatched } = matchTargetsToRows(targets, rows);
    expect(unmatched).toHaveLength(0);
    expect(matched).toHaveLength(1);
    expect(matched[0].row.id).toBe(1);
    expect(matched[0].matchedVia).toBe('crlf');
  });

  it('converting LF to CRLF never double-converts an already-CRLF file into CRCRLF', () => {
    const crlfContent = 'CREATE TABLE foo (id int);\r\nALTER TABLE foo ADD COLUMN bar int;\r\n';
    const variants = hashContentVariants(crlfContent);
    // raw (as-read CRLF) and crlf (LF normalized then re-expanded to CRLF)
    // must be the SAME hash — if the conversion double-applied, they'd
    // differ (CRCRLF would hash differently from CRLF).
    expect(variants.crlf).toBe(variants.raw);
  });


  it('a file already in LF is matched once via raw, never counted twice', () => {
    const lfContent = 'CREATE TABLE only_lf (id int);\n';
    const variants = hashContentVariants(lfContent);
    expect(variants.raw).toBe(variants.normalized);
    const targets = [{ tag: 'x', correctedWhen: 111, ...variants }];
    const rows = [{ id: 1, hash: variants.raw, created_at: '999' }];
    const { matched, unmatched } = matchTargetsToRows(targets, rows);
    expect(matched).toHaveLength(1);
    expect(unmatched).toHaveLength(0);
    expect(matched[0].matchedVia).toBe('raw');
  });

  it('asking for three tags while only two rows match reports the third as unmatched, naming both hashes tried', () => {
    const a = hashContentVariants('AAA\n');
    const b = hashContentVariants('BBB\n');
    const c = hashContentVariants('CCC\n');
    const targets = [
      { tag: 'tag-a', correctedWhen: 1, ...a },
      { tag: 'tag-b', correctedWhen: 2, ...b },
      { tag: 'tag-c', correctedWhen: 3, ...c },
    ];
    const rows = [
      { id: 1, hash: a.raw, created_at: '10' },
      { id: 2, hash: b.raw, created_at: '20' },
    ];
    const { matched, unmatched } = matchTargetsToRows(targets, rows);
    expect(matched).toHaveLength(2);
    expect(unmatched).toHaveLength(1);
    expect(unmatched[0].tag).toBe('tag-c');
    expect(unmatched[0].raw).toBe(c.raw);
    expect(unmatched[0].normalized).toBe(c.normalized);
  });
});

/**
 * The exit-code decision (#449's actual gap): a target that could not be
 * matched to a row is exit 1, always — no matter how many other targets
 * DID match. Every path where every target resolved to a row is exit 0.
 * This is the function the reviewer's mutation (flipping the unmatched
 * path's process.exit(1) to process.exit(0)) must turn RED — see the fix
 * round's proof: mutating the unmatched branch's exitCode literal from 1 to
 * 0 in this module turns this describe block's first test RED; reverting
 * turns it GREEN.
 */
describe('repair-migration-journal-dates.ts — decideRepairOutcome() exit-code contract', () => {
  it('exits 1 when any target is unmatched — even with other targets matched', () => {
    const unmatched = [{ tag: 'missing-tag', raw: 'r', normalized: 'n', crlf: 'c' }];
    const matched = [
      {
        tag: 'found-tag',
        correctedWhen: 100,
        row: { id: 1, hash: 'h', created_at: '999' },
        matchedVia: 'raw' as const,
      },
    ];
    const decision = decideRepairOutcome(matched, unmatched, false);
    expect(decision.outcome).toBe('unmatched');
    expect(decision.exitCode).toBe(1);
    if (decision.outcome === 'unmatched') {
      expect(decision.unmatched).toEqual(unmatched);
    }
  });

  it('exits 0 when every target resolved to a row and every row is already at the corrected value', () => {
    const matched = [
      {
        tag: 'a',
        correctedWhen: 100,
        row: { id: 1, hash: 'h', created_at: '100' }, // already correct
        matchedVia: 'raw' as const,
      },
      {
        tag: 'b',
        correctedWhen: 200,
        row: { id: 2, hash: 'h2', created_at: '200' }, // already correct
        matchedVia: 'normalized' as const,
      },
    ];
    const decision = decideRepairOutcome(matched, [], false);
    expect(decision.outcome).toBe('already-correct');
    expect(decision.exitCode).toBe(0);
  });

  it('exits 0 with a non-empty plan on a dry run when every target matched but needs correction', () => {
    const matched = [
      {
        tag: 'a',
        correctedWhen: 100,
        row: { id: 1, hash: 'h', created_at: '999' }, // needs correction
        matchedVia: 'raw' as const,
      },
    ];
    const decision = decideRepairOutcome(matched, [], false);
    expect(decision.outcome).toBe('dry-run');
    expect(decision.exitCode).toBe(0);
    if (decision.outcome === 'dry-run') {
      expect(decision.plan).toHaveLength(1);
      expect(decision.plan[0].tag).toBe('a');
    }
  });

  it('exits 0 for the same matched plan when apply=true, tagged as an apply outcome', () => {
    const matched = [
      {
        tag: 'a',
        correctedWhen: 100,
        row: { id: 1, hash: 'h', created_at: '999' },
        matchedVia: 'raw' as const,
      },
    ];
    const decision = decideRepairOutcome(matched, [], true);
    expect(decision.outcome).toBe('apply');
    expect(decision.exitCode).toBe(0);
  });
});

/**
 * Cheap coverage the review also asked for (item 1): mixed line endings
 * within a single file produce three DISTINCT hashes (raw, normalized,
 * crlf), all computed, none double-counted — the case a file that is
 * consistently all-LF or all-CRLF does not exercise.
 */
describe('repair-migration-journal-dates.ts — mixed line endings within one file', () => {
  it('produces three distinct hashes for content mixing \r\n and bare \n', () => {
    const mixedContent = 'CREATE TABLE foo (id int);\r\nALTER TABLE foo ADD COLUMN bar int;\nALTER TABLE foo ADD COLUMN baz int;\r\n';
    const variants = hashContentVariants(mixedContent);

    expect(variants.raw).not.toBe(variants.normalized);
    expect(variants.raw).not.toBe(variants.crlf);
    expect(variants.normalized).not.toBe(variants.crlf);

    // normalized must equal the hash of the fully-LF form, and crlf must
    // equal the hash of the fully-CRLF form of that SAME normalized content.
    const fullyLf = mixedContent.replace(/\r\n/g, '\n');
    const fullyCrlf = fullyLf.replace(/\n/g, '\r\n');
    expect(variants.normalized).toBe(hashContentVariants(fullyLf).raw);
    expect(variants.crlf).toBe(hashContentVariants(fullyCrlf).raw);
  });

  it('matches a row on whichever of the three variants the row was stored under, for mixed-ending content', () => {
    const mixedContent = 'A\r\nB\nC\r\n';
    const variants = hashContentVariants(mixedContent);
    const targets = [{ tag: 'mixed', correctedWhen: 1, ...variants }];
    const rows = [{ id: 1, hash: variants.normalized, created_at: '999' }];
    const { matched, unmatched } = matchTargetsToRows(targets, rows);
    expect(unmatched).toHaveLength(0);
    expect(matched).toHaveLength(1);
    expect(matched[0].matchedVia).toBe('normalized');
  });
});

/**
 * Cheap coverage the review also asked for (item 2): removing the dedup
 * guards in matchTargetsToRows() is behaviourally inert against a real DB
 * (.find returns the first hit either way) but a collapsed variant set
 * MUST still produce exactly one lookup candidate, so the guards are never
 * mistaken for dead code and deleted later.
 */
describe('repair-migration-journal-dates.ts — variant de-duplication before lookup', () => {
  it('a file whose raw, normalized, and crlf hashes all collapse to the same value is still matched exactly once, not three times', () => {
    // A file with no line-ending-sensitive bytes at all: raw === normalized === crlf.
    const content = 'SELECT 1;';
    const variants = hashContentVariants(content);
    expect(variants.raw).toBe(variants.normalized);
    expect(variants.normalized).toBe(variants.crlf);

    const targets = [{ tag: 'no-newlines', correctedWhen: 1, ...variants }];
    const rows = [{ id: 1, hash: variants.raw, created_at: '999' }];
    const { matched, unmatched } = matchTargetsToRows(targets, rows);

    expect(matched).toHaveLength(1);
    expect(unmatched).toHaveLength(0);
    expect(matched[0].matchedVia).toBe('raw');
  });
});
