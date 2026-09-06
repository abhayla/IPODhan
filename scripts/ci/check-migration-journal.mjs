#!/usr/bin/env node
// Live gate for the migration journal (T-403 round 3, blocker 1). Fails the
// build when web/drizzle/migrations/meta/_journal.json is inconsistent in a
// way that would make drizzle's migrator silently skip an entry (non-
// monotonic or hand-typed future `when`), or when a journaled entry is
// missing its .sql / snapshot artifacts. Predicates live in
// ../lib/migration-journal-lint.mjs so the self-test
// (scripts/tests/check-migration-journal.test.mjs) exercises the exact same
// logic.
//
// Run: node scripts/ci/check-migration-journal.mjs

import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lintJournal } from '../lib/migration-journal-lint.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const MIGRATIONS_DIR = join(ROOT, 'web', 'drizzle', 'migrations');
const META_DIR = join(MIGRATIONS_DIR, 'meta');
const JOURNAL_PATH = join(META_DIR, '_journal.json');

function main() {
  const journal = JSON.parse(readFileSync(JOURNAL_PATH, 'utf8'));
  const entries = journal.entries ?? [];

  const sqlTags = new Set(
    readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith('.sql'))
      .map((f) => f.replace(/\.sql$/, ''))
  );
  const snapshotKeys = new Set(
    readdirSync(META_DIR)
      .filter((f) => f.endsWith('_snapshot.json'))
      .map((f) => f.replace(/_snapshot\.json$/, ''))
  );

  const violations = lintJournal(entries, { nowMs: Date.now(), sqlTags, snapshotKeys });

  if (violations.length > 0) {
    console.error(`Migration journal lint FAILED (${violations.length} violation(s)):\n`);
    for (const v of violations) console.error(`  - ${v}`);
    console.error(
      '\nSee scripts/lib/migration-journal-lint.mjs for why each rule exists (T-403 round 3, blocker 1).'
    );
    process.exit(1);
  }

  console.log(`Migration journal lint OK (${entries.length} entries checked).`);
}

main();
