#!/usr/bin/env node
// docs/design/probes/duplicate-scan.mjs — F-74's evidence.
//
// WHY. Item 1's Schema section adds brand-new UNIQUE constraints to three tables that have never
// had one — promoters (ipo_id, normalized_name), ipo_intermediaries (ipo_id, role, normalized_name),
// peer_companies (ipo_id, normalized_name) — with no pre-migration duplicate-scan query and no repair
// step. Running ADD CONSTRAINT UNIQUE against a table with even one existing duplicate pair fails
// outright and blocks the whole migration.
//
// FIRST CHECK, before any query runs: does `normalized_name` exist at all? Read against
// packages/shared/src/db/schema.ts (checked 2026-09-09) — it does not. promoters, peer_companies and
// ipo_intermediaries carry only `name` (varchar), no `normalized_name` column, on any of the three
// tables. That absence IS the answer item 1's migration plan needs: the constraint cannot be added
// today because its own key column has never been written. This probe computes a STAND-IN
// normalization (lower + collapsed whitespace + trim) purely to measure what a duplicate scan would
// find once such a column exists — it is NOT the production normalization function (which does not
// exist yet either) and is labelled as an approximation in the output.
//
// Read-only against production. Nothing runs on the VPS.

import { openReadOnlyPool, saveOutput, nowStamp , causeOf } from './_lib.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = path.resolve(HERE, '../../../packages/shared/src/db/schema.ts');

function columnExists(schemaSrc, table, column) {
  const re = new RegExp(`export const \\w+ = pgTable\\(\\s*'${table}'[\\s\\S]*?\\n\\}\\s*\\)|export const \\w+ = pgTable\\(\\s*'${table}'[\\s\\S]*?\\n\\},`);
  const m = re.exec(schemaSrc);
  if (!m) return { tableFound: false, columnFound: false };
  const columnRe = new RegExp(`\\b${column}\\s*:\\s*\\w+\\(\\s*'${column}'`);
  return { tableFound: true, columnFound: columnRe.test(m[0]) };
}

async function connectWithRetry(attempts = 3, spacingMs = 10_000) {
  let lastErr;
  for (let i = 1; i <= attempts; i++) {
    try { return await openReadOnlyPool('ipodhan'); }
    catch (err) { lastErr = err; if (i < attempts) await new Promise((r) => setTimeout(r, spacingMs)); }
  }
  throw lastErr;
}

let pool;
try {
  pool = await connectWithRetry();
} catch (err) {
  saveOutput('duplicate-scan', {
    probe: 'duplicate-scan', generated_at: nowStamp(), finding: 'F-74',
    unreachable: `unreachable on 2026-09-09 — ${causeOf(err)}`,
  });
  console.error('duplicate-scan: tunnel unreachable after retries —', causeOf(err));
  process.exit(2);
}

try {
  const schemaSrc = fs.readFileSync(SCHEMA_PATH, 'utf8');
  const normalizedNameCheck = {
    promoters: columnExists(schemaSrc, 'promoters', 'normalized_name'),
    peer_companies: columnExists(schemaSrc, 'peer_companies', 'normalized_name'),
    ipo_intermediaries: columnExists(schemaSrc, 'ipo_intermediaries', 'normalized_name'),
  };
  const missingColumn = Object.entries(normalizedNameCheck)
    .filter(([, v]) => !v.columnFound).map(([t]) => t);

  // Stand-in normalization: lower-case, collapse internal whitespace, trim. Approximates what a
  // real normalizer would do (strip legal suffixes, punctuation) without inventing one here.
  // The name column differs per table: promoters.name, ipo_intermediaries.name, but
  // peer_companies.company_name (schema.ts:851) — checked, not assumed.
  const normExpr = (col) => `lower(regexp_replace(trim(${col}), '\\s+', ' ', 'g'))`;

  async function scanTwoKey(table, nameCol) {
    const NORM = normExpr(nameCol);
    const total = Number((await pool.query(`select count(*) as n from ${table}`)).rows[0].n);
    const groups = (await pool.query(`
      select ipo_id, ${NORM} as norm_name, count(*) as n, array_agg(${nameCol}) as names, array_agg(id::text) as ids
        from ${table}
       group by ipo_id, ${NORM}
      having count(*) > 1
       order by count(*) desc`)).rows;
    return { table, total, groups };
  }

  async function scanThreeKey(table, nameCol) {
    const NORM = normExpr(nameCol);
    const total = Number((await pool.query(`select count(*) as n from ${table}`)).rows[0].n);
    const groups = (await pool.query(`
      select ipo_id, role::text as role, ${NORM} as norm_name, count(*) as n, array_agg(${nameCol}) as names, array_agg(id::text) as ids
        from ${table}
       group by ipo_id, role, ${NORM}
      having count(*) > 1
       order by count(*) desc`)).rows;
    return { table, total, groups };
  }

  const promoters = await scanTwoKey('promoters', 'name');
  const peerCompanies = await scanTwoKey('peer_companies', 'company_name');
  const intermediaries = await scanThreeKey('ipo_intermediaries', 'name');

  async function withSlugs(scan) {
    const groups = scan.groups;
    if (!groups.length) return { table: scan.table, total_rows: scan.total, offending_group_count: 0, offending_row_count: 0, examples: [] };
    const ipoIds = [...new Set(groups.map((g) => g.ipo_id))];
    const slugRows = (await pool.query(`select id, slug from ipos where id = any($1::uuid[])`, [ipoIds])).rows;
    const slugMap = new Map(slugRows.map((r) => [r.id, r.slug]));
    const offendingRowCount = groups.reduce((a, g) => a + Number(g.n), 0);
    const examples = groups.slice(0, 10).map((g) => ({
      ipo_slug: slugMap.get(g.ipo_id) || g.ipo_id,
      ...(g.role ? { role: g.role } : {}),
      normalized_name: g.norm_name,
      duplicate_count: Number(g.n),
      original_names: g.names,
    }));
    return {
      table: scan.table,
      total_rows: scan.total,
      offending_group_count: groups.length,
      offending_row_count: offendingRowCount,
      examples,
    };
  }

  const promotersOut = await withSlugs(promoters);
  const peerCompaniesOut = await withSlugs(peerCompanies);
  const intermediariesOut = await withSlugs(intermediaries);

  const anyBlocking = [promotersOut, peerCompaniesOut, intermediariesOut].some((t) => t.offending_group_count > 0);

  const verdict = missingColumn.length === 3
    ? `The \`normalized_name\` column does not exist on ANY of the three tables (promoters, peer_companies, ipo_intermediaries) ` +
      `today — item 1's Schema section names a constraint on a column that has never been written. The migration cannot add ` +
      `\`ADD CONSTRAINT UNIQUE (ipo_id, normalized_name)\` until that column is added and backfilled first; this IS the ` +
      `pre-flight the card is missing, and it is a bigger gap than a duplicate check. ` +
      (anyBlocking
        ? `SEPARATELY, using a stand-in normalization (lower+trim+collapsed whitespace) on the existing \`name\` column, ` +
          `duplicates already exist that would ALSO block a UNIQUE constraint once the real column lands: ` +
          [promotersOut, peerCompaniesOut, intermediariesOut].filter((t) => t.offending_group_count > 0)
            .map((t) => `${t.table} has ${t.offending_group_count} colliding group(s) / ${t.offending_row_count} affected rows`)
            .join('; ') + '.'
        : `Using the same stand-in normalization, NO duplicate groups were found on any of the three tables today — a repair ` +
          `step may not be needed once the column exists, but the pre-flight scan still needs to run against the REAL ` +
          `normalizer once it is written, since a real normalizer (stripping legal suffixes/punctuation) can find collisions a ` +
          `bare lower+trim does not.`)
    : `normalized_name is missing on: ${missingColumn.join(', ') || 'none'}.` +
      (anyBlocking
        ? ` Duplicates found that would block the UNIQUE constraint: ` +
          [promotersOut, peerCompaniesOut, intermediariesOut].filter((t) => t.offending_group_count > 0)
            .map((t) => `${t.table} ${t.offending_group_count} group(s)`).join('; ') + '.'
        : ` No duplicate groups found under the stand-in normalization.`);

  const out = {
    probe: 'duplicate-scan',
    generated_at: nowStamp(),
    source: 'production, promoters / peer_companies / ipo_intermediaries (read-only tunnel); schema check against packages/shared/src/db/schema.ts',
    finding: 'F-74',
    normalized_name_column_check: {
      note: 'checked packages/shared/src/db/schema.ts for a normalized_name column on each table',
      results: normalizedNameCheck,
      missing_on: missingColumn,
    },
    normalization_used: {
      is_the_real_normalizer: false,
      formula: "lower(regexp_replace(trim(<name_col>), '\\s+', ' ', 'g')) — name_col = name for promoters/ipo_intermediaries, company_name for peer_companies",
      caveat: 'Stand-in only (lower + collapsed whitespace + trim). The production normalizer referenced by item 1 does not exist ' +
        'yet either — this is what a duplicate scan finds on today\'s raw `name` values, not a prediction of what the eventual ' +
        'real normalizer will collapse.',
    },
    tables: {
      promoters: promotersOut,
      peer_companies: peerCompaniesOut,
      ipo_intermediaries: intermediariesOut,
    },
    verdict,
  };
  saveOutput('duplicate-scan', out);

  console.log('normalized_name column present? ' + JSON.stringify(normalizedNameCheck));
  console.log(`promoters: ${promotersOut.total_rows} rows, ${promotersOut.offending_group_count} offending group(s), ${promotersOut.offending_row_count} offending row(s)`);
  console.log(`peer_companies: ${peerCompaniesOut.total_rows} rows, ${peerCompaniesOut.offending_group_count} offending group(s), ${peerCompaniesOut.offending_row_count} offending row(s)`);
  console.log(`ipo_intermediaries: ${intermediariesOut.total_rows} rows, ${intermediariesOut.offending_group_count} offending group(s), ${intermediariesOut.offending_row_count} offending row(s)`);
  console.log('VERDICT: ' + verdict);
  console.log('written: duplicate-scan.out.json');
} catch (err) {
  console.error('duplicate-scan: the probe itself failed —', causeOf(err));
  process.exitCode = 2;
} finally {
  await pool.end();
}
