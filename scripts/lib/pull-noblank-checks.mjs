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

/**
 * Drives the real query path so it is testable against a fake `q`, not just the pure helpers
 * above (Tier B reviewer finding 1, MAJOR: the per-table information_schema lookup, id-column
 * choice and current-value read all used to live inline in checkS_pullNoblank, so nothing
 * planted a blanked row through them).
 *
 * @param {Array<{ipoId:string, slug:string, tableName:string, fieldName:string, previousValue:string|null}>} rows
 *   raw field_sources rows for the window (row_key = ''), unfiltered.
 * @param {(sql: string, params?: any[]) => Promise<any[]>} q async query function, same shape
 *   as the pool query wrapper the audit script uses.
 * @returns {Promise<{checked: Array, offenders: Array<{slug:string, table:string, field:string, previousValue:string|null}>, unresolvable: string[]}>}
 */
export async function evaluatePullNoblank(rows, q) {
  const checked = rows.filter((r) => hadPreviousValue(r.previousValue));

  const byTable = new Map();
  for (const r of checked) {
    if (!byTable.has(r.tableName)) byTable.set(r.tableName, []);
    byTable.get(r.tableName).push(r);
  }

  const offenders = [];
  const unresolvable = [];
  for (const [table, tableRows] of byTable) {
    if (!isSafeTableName(table)) { unresolvable.push(`${table} (unsafe table name)`); continue; }
    let colRows;
    try {
      colRows = await q(
        `SELECT column_name FROM information_schema.columns WHERE table_name = $1 AND table_schema = 'public'`,
        [table]
      );
    } catch (e) {
      unresolvable.push(`${table} (schema unreadable: ${e.message})`);
      continue;
    }
    if (colRows.length === 0) { unresolvable.push(`${table} (no such table)`); continue; }
    const columns = new Set(colRows.map((c) => c.column_name));
    const idCol = table === 'ipos' ? 'id' : 'ipo_id';
    for (const r of tableRows) {
      const column = resolveColumn(columns, r.fieldName);
      if (!column) { unresolvable.push(`${table}.${r.fieldName}`); continue; }
      let currentRows;
      try {
        currentRows = await q(`SELECT "${column}" AS v FROM ${table} WHERE ${idCol} = $1 LIMIT 2`, [r.ipoId]);
      } catch (e) {
        unresolvable.push(`${table}.${column} (${e.message})`);
        continue;
      }
      if (currentRows.length > 1) {
        // anchor_investors and any other table without a unique ipo_id: picking one row would
        // silently guess. Flag it as unresolvable instead (Tier B reviewer MINOR 2).
        unresolvable.push(`${table}.${r.fieldName} (ambiguous: more than one row for ipo)`);
        continue;
      }
      const current = currentRows[0];
      if (isBlankCurrentValue(current?.v)) {
        offenders.push({ slug: r.slug, table, field: r.fieldName, previousValue: r.previousValue });
      }
    }
  }

  return { checked, offenders, unresolvable };
}
