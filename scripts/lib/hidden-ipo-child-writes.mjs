// §9.2 item 23 (OD-116, OD-118, OD-150), detection check `d_hidden_ipo_child_writes`:
// no child row of a HIDDEN IPO was written after the row was hidden.
//
// The table list is NOT typed here. It is read at run time from the database's own FK catalog
// (every column that references ipos.id), and each table's write-time columns are read from
// information_schema. A table added tomorrow is covered tomorrow. That is the point of this check:
// the failure class it guards (`hand-listed-coverage-drifts`) is a coverage list nothing verified.

/** Every (table, column) that references ipos.id, from pg_constraint. */
export const IPO_FK_CATALOG_SQL = `
  SELECT DISTINCT c.conrelid::regclass::text AS table_name, a.attname AS column_name
    FROM pg_constraint c
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
   WHERE c.contype = 'f' AND c.confrelid = 'ipos'::regclass
   ORDER BY 1, 2`;

export const TIMESTAMP_COLUMNS_SQL = `
  SELECT table_name, column_name
    FROM information_schema.columns
   WHERE table_schema = 'public' AND data_type IN ('timestamp without time zone', 'timestamp with time zone')`;

/**
 * Tables whose rows are not scraper writes, each with the reason. A row an admin or a reader
 * writes about a hidden IPO is expected. Every name must exist in the FK catalog, or the check
 * reports the entry as stale (so this list cannot silently drift either).
 */
export const NON_SCRAPER_TABLES = Object.freeze({
  audit_logs: 'admin audit trail: the hide itself writes a row',
  field_protection_metadata: 'admin holds',
  field_source_overrides: 'admin rank overrides',
  ipo_merge_log: 'admin merge tool (OD-38)',
  ipo_slug_redirects: 'admin merge tool redirect (OD-118)',
  ipo_identifier_aliases: 'admin identifier edits (item 26)',
  affiliate_clicks: 'reader clicks',
  ipo_reviews: 'reader reviews',
  user_watchlist: 'reader watchlists',
});

/** A column that records when the row was written (not an event date the row describes). */
export function isWriteTimeColumn(name) {
  if (/^(next_|due_)|_due_at$|^expires_at$/.test(name)) return false;
  return /_at$/.test(name) || name === 'last_updated' || name === 'timestamp';
}

/**
 * Pure: from the catalog rows, the per-table plan: which column links to ipos and which
 * write-time columns to compare. Returns { plans, unmeasured, staleExemptions }.
 */
export function planHiddenChildWriteCheck(fkRows, tsRows) {
  const tsByTable = new Map();
  for (const r of tsRows) {
    if (!isWriteTimeColumn(r.column_name)) continue;
    if (!tsByTable.has(r.table_name)) tsByTable.set(r.table_name, []);
    tsByTable.get(r.table_name).push(r.column_name);
  }
  const fkTables = new Set(fkRows.map((r) => r.table_name));
  const plans = [];
  const unmeasured = [];
  for (const r of fkRows) {
    if (Object.hasOwn(NON_SCRAPER_TABLES, r.table_name)) continue;
    const cols = (tsByTable.get(r.table_name) ?? []).sort();
    if (cols.length === 0) unmeasured.push(`${r.table_name}.${r.column_name}`);
    else plans.push({ table: r.table_name, link: r.column_name, writeCols: cols });
  }
  const staleExemptions = Object.keys(NON_SCRAPER_TABLES).filter((t) => !fkTables.has(t));
  return { plans, unmeasured, staleExemptions };
}

const IDENT = /^[a-z_][a-z0-9_]*$/;

/** SQL for one table: hidden IPOs with a child row written after hidden_at. Identifiers come from the catalog, validated. */
export function childWritesAfterHideSql(plan) {
  for (const n of [plan.table, plan.link, ...plan.writeCols]) {
    if (!IDENT.test(n)) throw new Error(`hidden-ipo-child-writes: unexpected identifier ${n}`);
  }
  const newest = plan.writeCols.length === 1 ? `c.${plan.writeCols[0]}` : `GREATEST(${plan.writeCols.map((c) => `c.${c}`).join(', ')})`;
  return `
    SELECT i.id, i.slug, i.hidden_at::text AS "hiddenAt", count(*)::int AS n, max(${newest})::text AS "newestWrite"
      FROM ${plan.table} c
      JOIN ipos i ON i.id = c.${plan.link}
     WHERE i.hidden_at IS NOT NULL AND ${newest} > i.hidden_at
     GROUP BY i.id, i.slug, i.hidden_at`;
}

/** Pure: the verdict line from the per-table offenders. */
export function summariseHiddenChildWrites({ hiddenCount, plans, unmeasured, staleExemptions, offenders }) {
  const parts = [`${hiddenCount} hidden IPO(s); ${plans.length} child table(s) measured from the FK catalog`];
  if (unmeasured.length) parts.push(`unmeasured (no write-time column): ${unmeasured.join(', ')}`);
  if (staleExemptions.length) parts.push(`stale exemptions (not in the FK catalog): ${staleExemptions.join(', ')}`);
  if (offenders.length) {
    parts.push(
      `${offenders.length} write(s) after hide: ` +
        offenders.map((o) => `${o.table} ${o.n} row(s) for ${o.slug} (hidden ${o.hiddenAt}, newest ${o.newestWrite})`).join('; ')
    );
  }
  const status = plans.length === 0 ? 'UNVERIFIABLE' : offenders.length || staleExemptions.length ? 'FAIL' : 'PASS';
  return { status, detail: parts.join(' | ') };
}
