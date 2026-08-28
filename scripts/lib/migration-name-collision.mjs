// Pure predicates for the migration NAME-COLLISION gate (T-403 round 2).
//
// THE DEFECT THIS EXISTS FOR. Migration 0035 created an ENUM named
// `document_fetch_state` and a TABLE named `document_fetch_state`. Postgres
// creates an implicit composite type for every table, so the two names collide
// and the CREATE TABLE fails with:
//
//     error: type "document_fetch_state" already exists   (SQLSTATE 42710)
//
// It was invisible in review, invisible in every unit test, and invisible until
// the migration was actually applied to an empty database — which, in
// production, is the deploy's migrate step. `assert-migrations-applied.sh` would
// then have blocked the deploy, i.e. the first symptom would have been a failed
// release.
//
// PURE: takes SQL text, returns violations. No filesystem, no DB — same
// convention as scripts/lib/detection-floor-checks.mjs.

/** `CREATE TYPE "x"` / `CREATE TYPE x AS ENUM` — quoted or bare, any schema. */
const CREATE_TYPE_RE = /CREATE\s+TYPE\s+(?:"?public"?\.)?"?([A-Za-z_][A-Za-z0-9_]*)"?/gi;

/** `CREATE TABLE [IF NOT EXISTS] "x"` — quoted or bare, any schema. */
const CREATE_TABLE_RE =
  /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:"?public"?\.)?"?([A-Za-z_][A-Za-z0-9_]*)"?/gi;

function collect(sql, regex) {
  const names = new Set();
  for (const m of String(sql ?? '').matchAll(regex)) names.add(m[1].toLowerCase());
  return names;
}

export function createdTypeNames(sql) {
  return collect(sql, CREATE_TYPE_RE);
}

export function createdTableNames(sql) {
  return collect(sql, CREATE_TABLE_RE);
}

/**
 * Names created BOTH as a type and as a table across the given migrations.
 *
 * Checked across the whole journal, not per file: an enum added in one migration
 * and a table of the same name added in a later one collide just as hard, and
 * that is the harder version to spot by eye.
 *
 * @param {{tag: string, sql: string}[]} migrations
 * @returns {string[]} human-readable violations (empty === pass)
 */
export function findTypeTableCollisions(migrations) {
  const typesByName = new Map();
  const tablesByName = new Map();

  for (const { tag, sql } of migrations) {
    for (const name of createdTypeNames(sql)) {
      if (!typesByName.has(name)) typesByName.set(name, tag);
    }
    for (const name of createdTableNames(sql)) {
      if (!tablesByName.has(name)) tablesByName.set(name, tag);
    }
  }

  const violations = [];
  for (const [name, typeTag] of typesByName) {
    const tableTag = tablesByName.get(name);
    if (!tableTag) continue;
    violations.push(
      `"${name}" is created as a TYPE (${typeTag}) and as a TABLE (${tableTag}) — ` +
        'Postgres gives every table an implicit composite type of the same name, so ' +
        'the second CREATE fails with 42710. Rename one of them.'
    );
  }
  return violations;
}
