// #1045: pure parseArgs coverage for repair-reopen-stale-doc-nay.ts, including
// the new --ipo scope flag (test-isolation class, issue #1045). Red before the
// fix: --ipo did not exist on this Cli shape, so a test passing it would have
// had the value silently discarded (parsed nowhere), never scoping the run.
import { describe, it, expect } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseArgs,
  buildStaleRowsQuery,
  buildSettledByLowerRankQuery,
} from '../../../scripts/repair-reopen-stale-doc-nay.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));

describe('repair-reopen-stale-doc-nay parseArgs', () => {
  it('parses --expect-db, --apply, --allow-prod, --undo and --settled-by-lower-rank', () => {
    const cli = parseArgs([
      '--expect-db', 'ipodhan_test',
      '--apply',
      '--allow-prod',
      '--undo', 'ledger.json',
      '--settled-by-lower-rank',
    ]);
    expect(cli).toEqual({
      apply: true,
      allowProd: true,
      expectDb: 'ipodhan_test',
      undo: 'ledger.json',
      settledByLowerRank: true,
      ipoIds: [],
      invalidIpo: [],
      unusableIpo: false,
    });
  });

  it('defaults to unscoped, non-apply, non-settled when only --expect-db is given', () => {
    const cli = parseArgs(['--expect-db', 'ipodhan_test']);
    expect(cli).toEqual({
      apply: false,
      allowProd: false,
      expectDb: 'ipodhan_test',
      undo: null,
      settledByLowerRank: false,
      ipoIds: [],
      invalidIpo: [],
      unusableIpo: false,
    });
  });

  it('MUTATION: an unrecognized/ignored --ipo turns this red — parses a single --ipo value', () => {
    const cli = parseArgs(['--expect-db', 'ipodhan_test', '--ipo', '00000000-0000-4000-9161-000000000001']);
    expect(cli.ipoIds).toEqual(['00000000-0000-4000-9161-000000000001']);
    expect(cli.invalidIpo).toEqual([]);
  });

  it('parses repeated --ipo flags and comma-separated values together, deduped', () => {
    const cli = parseArgs([
      '--expect-db', 'ipodhan_test',
      '--ipo', '00000000-0000-4000-9161-000000000001,00000000-0000-4000-9161-000000000002',
      '--ipo', '00000000-0000-4000-9161-000000000001',
    ]);
    expect(cli.ipoIds).toEqual([
      '00000000-0000-4000-9161-000000000001',
      '00000000-0000-4000-9161-000000000002',
    ]);
  });

  it('reports a non-uuid --ipo value as invalid rather than silently accepting or dropping it', () => {
    const cli = parseArgs(['--expect-db', 'ipodhan_test', '--ipo', 'not-a-uuid']);
    expect(cli.invalidIpo).toEqual(['not-a-uuid']);
    expect(cli.ipoIds).toEqual([]);
  });

  // #1053 review round 2 MAJOR-1: a present-but-unusable --ipo must never
  // read the same as "no --ipo given" — each of these fell back to unscoped
  // (ipoIds: []) before the fix, which for --apply means every row DB-wide.
  it.each([
    ['--ipo followed by another flag', ['--expect-db', 'ipodhan_test', '--ipo', '--apply']],
    ['a trailing --ipo with no value', ['--expect-db', 'ipodhan_test', '--ipo']],
    ['--ipo given an empty string', ['--expect-db', 'ipodhan_test', '--ipo', '']],
    ['--ipo given a bare comma', ['--expect-db', 'ipodhan_test', '--ipo', ',']],
  ])('MUTATION: unusableIpo is true for %s', (_label, argv) => {
    const cli = parseArgs(argv);
    expect(cli.unusableIpo).toBe(true);
    expect(cli.ipoIds).toEqual([]);
    expect(cli.invalidIpo).toEqual([]);
  });

  it('MUTATION: parses the --ipo=<uuid> single-token form instead of treating it as absent', () => {
    const cli = parseArgs(['--expect-db', 'ipodhan_test', '--ipo=00000000-0000-4000-9161-000000000001']);
    expect(cli.ipoIds).toEqual(['00000000-0000-4000-9161-000000000001']);
    expect(cli.unusableIpo).toBe(false);
  });
});

/**
 * #1053 review round 2, MAJOR-2: the compiled SQL of both reads must carry
 * `ipo_id = ANY(...)` — bound as ONE array param — when scoped, and carry no
 * such clause at all when unscoped. Rendered via `PgDialect().sqlToQuery`
 * (the same text node-postgres receives), not executed against a database.
 *
 * MUTATION VERIFIED (2026-09-25, manually): commenting out the `scopeClause`
 * interpolation in `buildStaleRowsQuery`/`buildSettledByLowerRankQuery` (so
 * the query is always built unscoped) turns both "scoped" cases below red —
 * `.sql` no longer contains `ipo_id = ANY(` and `.params` no longer carries
 * the id array — while the "unscoped" cases stay green, confirming the
 * assertion is actually exercising the scope clause and not passing vacuously.
 */
describe('#1053 MAJOR-2: readStaleRows / readSettledByLowerRankRows scope condition is present in the compiled SQL', () => {
  const UUID = '00000000-0000-4000-9161-000000000009';

  it('buildStaleRowsQuery: scoped — carries ipo_id = ANY($n::uuid[]) with the ids as one param', () => {
    const rendered = new PgDialect().sqlToQuery(buildStaleRowsQuery([UUID]));
    expect(rendered.sql).toMatch(/p\.ipo_id = ANY\(\$\d+::uuid\[\]\)/);
    expect(rendered.params).toContainEqual([UUID]);
  });

  it('buildStaleRowsQuery: unscoped — carries no ANY(...) scope clause at all', () => {
    const rendered = new PgDialect().sqlToQuery(buildStaleRowsQuery([]));
    expect(rendered.sql).not.toMatch(/ipo_id = ANY\(/);
  });

  it('buildSettledByLowerRankQuery: scoped — carries ipo_id = ANY($n::uuid[]) with the ids as one param', () => {
    const rendered = new PgDialect().sqlToQuery(buildSettledByLowerRankQuery([UUID]));
    expect(rendered.sql).toMatch(/p\.ipo_id = ANY\(\$\d+::uuid\[\]\)/);
    expect(rendered.params).toContainEqual([UUID]);
  });

  it('buildSettledByLowerRankQuery: unscoped — carries no ANY(...) scope clause at all', () => {
    const rendered = new PgDialect().sqlToQuery(buildSettledByLowerRankQuery([]));
    expect(rendered.sql).not.toMatch(/ipo_id = ANY\(/);
  });
});

/**
 * #1059 round 2 (MAJOR-1/MINOR-2): same reasoning as the sibling spawn tests
 * in repair-issue-size-chittorgarh-once-od74.test.ts and
 * repair-retire-manifest-removed-fields.test.ts — spawn the REAL CLI entry
 * with an unusable `--ipo` form, or `--ipo` alongside `--undo`, and assert
 * exit 2 with no database reached (`current_database()` is printed only
 * after these refusal checks pass).
 */
describe('#1059 round 2 MAJOR-1/MINOR-2: main() actually refuses before touching the database', () => {
  const SCRAPER = path.resolve(HERE, '..', '..', '..');

  function spawnTool(args: string[]) {
    const r = spawnSync('npx', ['tsx', 'scripts/repair-reopen-stale-doc-nay.ts', ...args], {
      cwd: SCRAPER,
      env: { ...process.env, DATABASE_URL: '', REDIS_URL: '' },
      encoding: 'utf8',
      shell: process.platform === 'win32',
      timeout: 60_000,
    });
    return { code: r.status, out: `${r.stdout}\n${r.stderr}` };
  }

  it.each([
    ['--ipo followed by another flag', ['--expect-db', 'ipodhan_test', '--ipo', '--apply']],
    ['a trailing --ipo with no value', ['--expect-db', 'ipodhan_test', '--apply', '--ipo']],
  ])('MUTATION: %s exits 2 and never reaches the database', (_label, args) => {
    const r = spawnTool(args);
    expect(r.code, r.out).toBe(2);
    expect(r.out).toMatch(/no usable uuid could be parsed/);
    expect(r.out).not.toMatch(/current_database/);
  }, 60_000);

  it('MUTATION: --ipo alongside --undo is refused, exit 2, before touching the database', () => {
    const r = spawnTool(['--expect-db', 'ipodhan_test', '--undo', 'does-not-need-to-exist.json', '--ipo', '00000000-0000-4000-9074-000000000009']);
    expect(r.code, r.out).toBe(2);
    expect(r.out).toMatch(/--ipo does not apply to --undo/);
    expect(r.out).not.toMatch(/current_database/);
  }, 60_000);
});
