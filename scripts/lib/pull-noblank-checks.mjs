// PULL-NOBLANK (item 10, OD-42, design §2.6/§4): pure helpers for "fields that went from a
// value to absent this slot" -- the guard on §2.6 ("A value we could not re-source is kept
// and marked stale, never blanked").
//
// Column resolution is GENERIC OVER COLUMNS, same shape as
// scripts/lib/repair-invariants/provenance-parent-not-null.mjs's #654 fix: read
// information_schema rather than hand-keep a field -> column map, because the first version
// of that map undercounted a real class by 90% (counted one field, found 61 of a real 650).

/** camelCase -> snake_case, the field_sources.field_name convention. */
export function toSnake(name) {
  return name.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`);
}

/**
 * Resolve a field_sources.field_name to a real column in `columns` (a Set of column_name
 * strings from information_schema.columns), trying the name as given then its snake_case
 * form. Returns null when neither matches -- an UNRESOLVABLE field, which the caller must
 * count and name, never silently drop.
 * @param {Set<string>} columns
 * @param {string} fieldName
 */
export function resolveColumn(columns, fieldName) {
  if (columns.has(fieldName)) return fieldName;
  const snake = toSnake(fieldName);
  if (columns.has(snake)) return snake;
  return null;
}

/** The current value on the parent row counts as blank: NULL, undefined, or empty string.
 * (0 and false are real values a source can supply and are never blank.) */
export function isBlankCurrentValue(v) {
  return v === null || v === undefined || v === '';
}

/** previous_value (text column) counts as "had a value" only when non-null and, after
 * trimming, non-empty -- an empty-string previous_value is not a value that was blanked. */
export function hadPreviousValue(previousValue) {
  if (previousValue === null || previousValue === undefined) return false;
  return String(previousValue).trim().length > 0;
}

/** A table name safe to interpolate into `FROM ${table}` / `information_schema` lookups --
 * field_sources.table_name is writer-controlled, not user input, but this check still never
 * trusts a string into SQL without validating its shape first. */
export function isSafeTableName(table) {
  return typeof table === 'string' && /^[a-z_][a-z0-9_]*$/.test(table);
}
