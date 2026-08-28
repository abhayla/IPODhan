// Mutation-proof self-test + live gate for the migration NAME-COLLISION class
// (T-403 round 2). Run: node --test scripts/tests/migration-name-collision.test.mjs
//
// Two halves:
//   1. Fixture tests over the pure predicates — deleting or weakening the check
//      turns them red.
//   2. A LIVE gate over every journaled migration in this repo, so a future
//      migration that reintroduces the collision fails here rather than at a
//      production deploy's migrate step.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  findTypeTableCollisions,
  createdTypeNames,
  createdTableNames,
} from '../lib/migration-name-collision.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const MIGRATIONS_DIR = join(ROOT, 'web', 'drizzle', 'migrations');

test('detects the EXACT shape that broke 0035', () => {
  // Verbatim shape: an enum and a table sharing a name in one migration. Applying
  // this to an empty database fails with 42710 type ... already exists.
  const sql = `
    CREATE TYPE "document_fetch_state" AS ENUM ('WANTED','FOUND');
    CREATE TABLE IF NOT EXISTS "document_fetch_state" (
      "id" uuid PRIMARY KEY,
      "state" "document_fetch_state" NOT NULL
    );`;
  const violations = findTypeTableCollisions([{ tag: '0035_x', sql }]);
  assert.equal(violations.length, 1);
  assert.match(violations[0], /document_fetch_state/);
  assert.match(violations[0], /42710/);
});

test('detects a collision SPLIT ACROSS two migrations', () => {
  // The harder version to spot by eye: the enum lands in one release and the
  // table in a later one. Postgres does not care that they are months apart.
  const violations = findTypeTableCollisions([
    { tag: '0010_enum', sql: `CREATE TYPE "thing" AS ENUM ('A');` },
    { tag: '0020_table', sql: `CREATE TABLE IF NOT EXISTS "thing" ("id" uuid);` },
  ]);
  assert.equal(violations.length, 1);
  assert.match(violations[0], /0010_enum/);
  assert.match(violations[0], /0020_table/);
});

test('PASSES the corrected shape (enum renamed, table kept)', () => {
  const sql = `
    CREATE TYPE "document_fetch_status" AS ENUM ('WANTED','FOUND');
    CREATE TABLE IF NOT EXISTS "document_fetch_state" (
      "state" "document_fetch_status" NOT NULL
    );`;
  assert.deepEqual(findTypeTableCollisions([{ tag: '0035_x', sql }]), []);
});

test('matches quoted, bare and schema-qualified names alike', () => {
  assert.ok(createdTypeNames(`CREATE TYPE "public"."x" AS ENUM ('A')`).has('x'));
  assert.ok(createdTypeNames(`CREATE TYPE x AS ENUM ('A')`).has('x'));
  assert.ok(createdTableNames(`CREATE TABLE IF NOT EXISTS "public"."x" ()`).has('x'));
  assert.ok(createdTableNames(`CREATE TABLE x ()`).has('x'));
  // Case-insensitively, because Postgres folds unquoted identifiers.
  assert.deepEqual(findTypeTableCollisions([{ tag: 't', sql: 'CREATE TYPE "X" AS ENUM (\'A\'); CREATE TABLE x ();' }]).length, 1);
});

test('is quiet when there is nothing to say', () => {
  assert.deepEqual(findTypeTableCollisions([]), []);
  assert.deepEqual(findTypeTableCollisions([{ tag: 't', sql: 'SELECT 1;' }]), []);
});

test('LIVE GATE: no journaled migration in this repo has a type/table collision', () => {
  const journal = JSON.parse(readFileSync(join(MIGRATIONS_DIR, 'meta', '_journal.json'), 'utf8'));
  assert.ok(journal.entries.length > 0, 'journal is empty — the gate would be vacuous');

  const migrations = journal.entries.map((entry) => ({
    tag: entry.tag,
    sql: readFileSync(join(MIGRATIONS_DIR, `${entry.tag}.sql`), 'utf8'),
  }));

  const violations = findTypeTableCollisions(migrations);
  assert.deepEqual(
    violations,
    [],
    `Migration name collision(s) found:\n  ${violations.join('\n  ')}`
  );
});
