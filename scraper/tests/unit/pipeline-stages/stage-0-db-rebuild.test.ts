/**
 * Stage 0 of the IPO pipeline test ladder (docs/reviews/ipo-pipeline-stage-gap-analysis.md
 * section 6): "DB rebuild from journal - empty Postgres - drizzle-kit migrate - column set
 * matches schema.ts". Stage 0 is first because every later stage's fixtures are meaningless
 * against a database that does not replay from the journal.
 *
 * FIXTURE IN / EXPECTED-OUTPUT-FILE OUT.
 *   fixture in  : the REAL migration journal, web/drizzle/migrations/meta/_journal.json
 *                 plus the .sql files it names (no synthetic copy - the journal IS stage 0's
 *                 input, and a copy would drift).
 *   expected out: fixtures/stage-0/expected-schema.json - written from that journal's SQL
 *                 BEFORE any rebuild was run (T-403 round-2 lesson: no after-the-fact
 *                 acceptance tests).
 *
 * TWO ARMS
 *   1. Journal arm (always runs, incl. CI): replays the journal's DDL statically and asserts
 *      the surviving table/enum set equals the expected file. This is the arm that catches a
 *      migration added or dropped without the expectation being updated.
 *   2. Live arm (opt-in): with STAGE0_DATABASE_URL set to the sanctioned throwaway
 *      `ipodhan_test` over the SSH tunnel, drops schemas public+drizzle, runs the real
 *      `drizzle-kit migrate`, then asserts the live table set and that every table has zero
 *      rows. Skipped (not failed) when the var is unset, so CI and offline runs stay green.
 *
 * Issue #251: a journal-rebuilt DB is NOT schema.ts-complete (ipos 32/55 cols, documents
 * 8/19). Stage 0 therefore asserts TABLE PRESENCE and EMPTINESS, never column sets - column
 * drift is `npm run audit:schema-drift`'s job, against a real deployed DB.
 *
 * NEVER creates a database (owner standing rule, 2026-08-28). The live arm refuses any
 * target that is not a *_test database on localhost.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const REPO_ROOT = resolve(__dirname, '..', '..', '..', '..');
const MIGRATIONS_DIR = join(REPO_ROOT, 'web', 'drizzle', 'migrations');
const JOURNAL = join(MIGRATIONS_DIR, 'meta', '_journal.json');

const expected = JSON.parse(
  readFileSync(join(__dirname, 'fixtures', 'stage-0', 'expected-schema.json'), 'utf8')
) as {
  journalEntries: number;
  publicTables: string[];
  enums: string[];
  everyTableRowCount: number;
};

/** Strips SQL comments so a table name mentioned in prose is never mistaken for DDL. */
function stripComments(sql: string): string {
  return sql.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
}

/**
 * Replays the journal's DDL statically: applies CREATE TABLE / DROP TABLE / CREATE TYPE in
 * journal order so a table created in 0003 and dropped in 0021 does not appear in the result.
 */
function replayJournal(): { entries: number; tables: string[]; enums: string[] } {
  const journal = JSON.parse(readFileSync(JOURNAL, 'utf8')) as {
    entries: { tag: string }[];
  };
  const tables = new Set<string>();
  const enums = new Set<string>();
  for (const entry of journal.entries) {
    const file = join(MIGRATIONS_DIR, `${entry.tag}.sql`);
    if (!existsSync(file)) {
      throw new Error(`journal entry "${entry.tag}" has no .sql file at ${file}`);
    }
    const sql = stripComments(readFileSync(file, 'utf8'));
    for (const m of sql.matchAll(/CREATE TABLE(?:\s+IF NOT EXISTS)?\s+"?([a-z0-9_]+)"?\s*\(/gi)) {
      tables.add(m[1]);
    }
    for (const m of sql.matchAll(/DROP TABLE(?:\s+IF EXISTS)?\s+"?([a-z0-9_]+)"?/gi)) {
      tables.delete(m[1]);
    }
    for (const m of sql.matchAll(/CREATE TYPE\s+"?(?:public\.)?"?([a-z0-9_]+)"?\s+AS ENUM/gi)) {
      enums.add(m[1]);
    }
  }
  return {
    entries: journal.entries.length,
    tables: [...tables].sort(),
    enums: [...enums].sort(),
  };
}

describe('pipeline stage 0 - DB rebuild from the migration journal (journal arm)', () => {
  it('replays the real journal to exactly the expected table set', () => {
    const actual = replayJournal();
    expect(actual.tables).toEqual(expected.publicTables);
  });

  it('replays the real journal to exactly the expected enum set', () => {
    expect(replayJournal().enums).toEqual(expected.enums);
  });

  it('has the expected number of journal entries (a new migration must update the expectation)', () => {
    expect(replayJournal().entries).toBe(expected.journalEntries);
  });
});

const liveUrl = process.env.STAGE0_DATABASE_URL;

describe.skipIf(!liveUrl)('pipeline stage 0 - DB rebuild from the migration journal (live arm)', () => {
  it('rebuilds ipodhan_test from the journal: expected tables present, every table empty', async () => {
    const url = liveUrl as string;
    // Hard guard - never a real database, never a new one (owner rule 2026-08-28).
    const parsed = new URL(url);
    const dbName = parsed.pathname.replace(/^\//, '');
    expect(dbName.endsWith('_test'), `refusing non-test database "${dbName}"`).toBe(true);
    expect(
      ['localhost', '127.0.0.1'].includes(parsed.hostname),
      `refusing non-local host "${parsed.hostname}" - stage 0 runs only against the tunnelled test DB`
    ).toBe(true);

    const { Client } = await import('pg');
    const client = new Client({ connectionString: url });
    await client.connect();
    try {
      // The exact reset recipe: dropping only `public` leaves drizzle's ledger behind and the
      // replay restarts mid-journal ("relation ipos does not exist").
      await client.query('DROP SCHEMA IF EXISTS drizzle CASCADE');
      await client.query('DROP SCHEMA IF EXISTS public CASCADE');
      await client.query('CREATE SCHEMA public');

      const migrate = spawnSync('npx', ['drizzle-kit', 'migrate'], {
        cwd: join(REPO_ROOT, 'web'),
        env: { ...process.env, DATABASE_URL: url },
        encoding: 'utf8',
        shell: process.platform === 'win32',
        timeout: 300_000,
      });
      expect(migrate.status, `drizzle-kit migrate failed:\n${migrate.stdout}\n${migrate.stderr}`).toBe(0);

      const { rows: tableRows } = await client.query<{ table_name: string }>(
        `SELECT table_name FROM information_schema.tables
          WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
          ORDER BY table_name`
      );
      const tables = tableRows.map((r) => r.table_name);
      expect(tables).toEqual(expected.publicTables);

      const counts = await Promise.all(
        tables.map(async (t) => {
          const { rows } = await client.query<{ n: string }>(`SELECT COUNT(*)::text AS n FROM "${t}"`);
          return [t, Number(rows[0].n)] as const;
        })
      );
      const nonEmpty = counts.filter(([, n]) => n !== expected.everyTableRowCount);
      expect(nonEmpty, `tables not empty after a journal rebuild: ${JSON.stringify(nonEmpty)}`).toEqual([]);
    } finally {
      await client.end();
    }
  }, 360_000);
});
