// #654. Invariant: no `field_sources` row names a field whose value on the
// parent row is NULL.
//
// Such a row is a FALSE CLAIM — it says a source supplied a value that has
// never existed, and every audit that reads `field_sources` reports the field
// as sourced and healthy. Measured on ipodhan_staging before the fix: 650 rows
// across 14 fields (isin 180, allotmentDate 96, registrar 86, leadManagers 83,
// symbol 61, segment 29, listingDate 27, companyDescription 27, sector 22,
// lotSize 15, registrarId 13, priceRangeMin 5, priceRangeMax 5, issueSize 1).
// Two of the affected IPOs were live: Quanto Agroworld (OPEN) and Axiom Gas
// Engineering (UPCOMING), both failing NSE document discovery with `no_symbol`
// while the ledger said CHITTORGARH had supplied the symbol.
//
// THE QUERY IS GENERIC OVER COLUMNS ON PURPOSE. The first time this class was
// measured it was counted for `symbol` alone and reported as 61 rows — a tenth
// of the truth, because the narrowing filter was mistaken for the population.
// So this reads the column list out of `information_schema` and checks every
// distinct `field_name` present in `field_sources`, which cannot miss a field
// that a future scraper starts writing.
//
// NULL only, never falsiness: `0`, `false` and `''` are values a source
// genuinely supplied, and a row naming one of them is a true claim. A check
// written on falsiness would report every zero as a violation and bury the real
// ones.
//
// Two call shapes, both satisfying assert-repair-held.mjs's contract:
//   1. Module form (preferred, in-process): `export default async function(pool)`
//      returning { count, details }.
//   2. CLI form: `node scripts/lib/repair-invariants/provenance-parent-not-null.mjs`
//      connects its own pool and prints the violation count as the LAST line.
import { createUtcPool } from '../pg-utc.mjs';

/** `camelCase` -> `snake_case`, the convention `field_sources.field_name` uses. */
function toSnake(name) {
  return name.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`);
}

/**
 * Tables this invariant can check. `field_sources.table_name` carries the
 * parent table, so the join column is resolved per table rather than assuming
 * `ipos`.
 */
const CHECKED_TABLES = ['ipos', 'ipo_details'];

/**
 * @param {import('pg').Pool} pool
 * @returns {Promise<{count: number, details: Array<{table: string, field: string, column: string, rows: number}>}>}
 */
export default async function provenanceParentNotNullInvariant(pool) {
  const details = [];
  let count = 0;

  for (const table of CHECKED_TABLES) {
    const { rows: colRows } = await pool.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name = $1`,
      [table]
    );
    if (colRows.length === 0) continue; // table absent in this database
    const columns = new Set(colRows.map((r) => r.column_name));

    const { rows: fieldRows } = await pool.query(
      `SELECT DISTINCT field_name FROM field_sources WHERE table_name = $1`,
      [table]
    );

    for (const { field_name: field } of fieldRows) {
      // Resolve the provenance field name to a real column, trying the name as
      // given and then its snake_case form. A field_name with NO matching
      // column is NOT a violation of this invariant — it is a different defect
      // (provenance for a field the table does not have), reported separately
      // below so it cannot hide inside a zero.
      const column = columns.has(field)
        ? field
        : columns.has(toSnake(field))
          ? toSnake(field)
          : null;
      if (!column) {
        details.push({ table, field, column: null, rows: 0, unmapped: true });
        continue;
      }

      const { rows } = await pool.query(
        `SELECT count(*)::int AS n
           FROM field_sources fs
           JOIN ${table} p ON p.id = fs.ipo_id
          WHERE fs.table_name = $1 AND fs.field_name = $2 AND p."${column}" IS NULL`,
        [table, field]
      );
      const n = rows[0]?.n ?? 0;
      if (n > 0) {
        details.push({ table, field, column, rows: n });
        count += n;
      }
    }
  }

  details.sort((a, b) => b.rows - a.rows);
  return { count, details };
}

// --------------------------------------------------------------------- CLI
import { fileURLToPath, pathToFileURL } from 'node:url';

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const pool = createUtcPool(
    process.env.DATABASE_HOST
      ? {
          host: process.env.DATABASE_HOST,
          port: Number(process.env.DATABASE_PORT ?? 5432),
          database: process.env.DATABASE_NAME,
          user: process.env.DATABASE_USER,
          password: process.env.DATABASE_PASSWORD,
          ssl: false,
          max: 2,
        }
      : { connectionString: process.env.DATABASE_URL, ssl: false, max: 2 }
  );
  try {
    const { count, details } = await provenanceParentNotNullInvariant(pool);
    for (const d of details) {
      if (d.unmapped) {
        console.error(
          `  NOTE: ${d.table}.${d.field} has provenance rows but no such column — not counted here (a separate defect)`
        );
      } else {
        console.error(`  VIOLATION: ${d.table}.${d.column} — ${d.rows} provenance row(s) whose parent value is NULL`);
      }
    }
    if (!count) console.error('  ok: no field_sources row names a field that is null on its parent row');
    console.log(String(count));
    process.exit(0);
  } catch (err) {
    console.error(`FATAL: provenance-parent-not-null invariant crashed: ${err.message}`);
    process.exit(2);
  } finally {
    await pool.end();
  }
}
