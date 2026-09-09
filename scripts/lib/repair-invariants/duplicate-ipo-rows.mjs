// Invariant for scripts/assert-repair-held.mjs: no live IPO appears twice.
//
// WHY. On 2026-09-09 production carried two rows for Asset Reconstruction Company (India) Limited
// — one as "Asset Reconstruction Co.(India) Ltd." — so the site listed one mainboard IPO twice
// with two different issue sizes. The shipped name normaliser folds "Limited"/"Ltd"/"Pvt Ltd" but
// NOT "Company" against "Co.", so the two names never collided and no identity tier fired.
//
// This is the check that says whether MERGING them held. It is the one that matters here, because
// the scraper is what minted the duplicate: assert-repair-held.mjs's own header records that
// T-277C's merged duplicates "were re-minted next cycle". A clean read straight after the merge
// proves only that the DELETE worked, never that discovery has stopped creating the row.
//
// A violation is two or more live rows whose names fold to the same string AND that share an open
// date — the pair shape a duplicate actually takes. Two genuinely different companies with similar
// names almost never open the same day; requiring both keeps this from firing on, say, two
// unrelated "Ltd" SMEs.
//
// SCOPE. By default this reports EVERY duplicate group, which makes it a detection check but a
// useless proof for one repair: on 2026-09-09 staging carried 12 unrelated duplicate groups (a
// different defect — slug-suffix rows like `-o` / `-lt` / `-ct` minted on collision), so a
// whole-table count would have reported the ARCIL merge as failed. Set
// DUPLICATE_INVARIANT_FOLDS to a comma-separated list of folded names to narrow it to the rows a
// given repair touched, exactly as the shipped issue-size-t451 example pins its nine slugs.
//
//   DUPLICATE_INVARIANT_FOLDS=assetreconstruction node scripts/assert-repair-held.mjs \
//     scripts/lib/repair-invariants/duplicate-ipo-rows.mjs --cycles 2
//
// Two call shapes, matching the invariant contract:
//   1. Module form (preferred, in-process): `export default async function(pool)`.
//   2. CLI form: prints the violation count as the LAST line of stdout.
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { createUtcPool, installUtcTimestampParsing } from '../pg-utc.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Statuses whose rows are visible to a reader. A withdrawn or historical row is not a duplicate
// the site shows twice, so it is out of scope for this invariant.
const LIVE_STATUSES = ['UPCOMING', 'OPEN', 'CLOSED', 'LISTED'];

/**
 * Fold a company name to its identity. Corporate-form words and the country carry no identity;
 * "Asset Reconstruction Co.(India) Ltd." and "ASSET RECONSTRUCTION COMPANY (INDIA) LIMITED" are
 * the same company and must fold to the same string.
 */
export function foldName(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[.,()&'"-]/g, ' ')
    .replace(/\b(private|pvt|limited|ltd|company|co|corporation|corp|incorporated|inc|and|the|of|india|indian)\b/g, ' ')
    .replace(/\s+/g, '');
}

/**
 * @param {import('pg').Pool} pool
 * @returns {Promise<{count: number, details: Array<{fold: string, openDate: string, slugs: string[]}>}>}
 */
export default async function duplicateIpoRowsInvariant(pool) {
  const { rows } = await pool.query(
    `SELECT id, slug, company_name, open_date, status, issue_size
       FROM ipos
      WHERE status = ANY($1::text[])`,
    [LIVE_STATUSES],
  );

  const groups = new Map();
  for (const r of rows) {
    const fold = foldName(r.company_name);
    if (!fold) continue;                       // a nameless row is a different defect
    const day = r.open_date ? String(r.open_date).slice(0, 10) : 'no-open-date';
    const key = `${fold}|${day}`;
    if (!groups.has(key)) groups.set(key, { fold, openDate: day, rows: [] });
    groups.get(key).rows.push(r);
  }

  const scope = (process.env.DUPLICATE_INVARIANT_FOLDS || '')
    .split(',').map((s) => s.trim()).filter(Boolean);

  const details = [...groups.values()]
    .filter((g) => g.rows.length > 1)
    .filter((g) => !scope.length || scope.includes(g.fold))
    .map((g) => ({
      fold: g.fold,
      openDate: g.openDate,
      slugs: g.rows.map((r) => r.slug),
      issueSizes: g.rows.map((r) => (r.issue_size === null ? null : Number(r.issue_size))),
    }));

  return { count: details.length, details };
}

const isMainModule = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMainModule) {
  const envPath = join(__dirname, '..', '..', '..', 'web', '.env.local');
  if (existsSync(envPath)) {
    for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
  installUtcTimestampParsing();
  const pool = createUtcPool(
    process.env.DATABASE_HOST && process.env.DATABASE_PASSWORD
      ? {
          host: process.env.DATABASE_HOST,
          port: parseInt(process.env.DATABASE_PORT || '5432'),
          database: process.env.DATABASE_NAME || 'ipodhan',
          user: process.env.DATABASE_USER || 'postgres',
          password: process.env.DATABASE_PASSWORD,
          ssl: false,
          max: 2,
        }
      : { connectionString: process.env.DATABASE_URL, ssl: false, max: 2 },
  );
  try {
    const { count, details } = await duplicateIpoRowsInvariant(pool);
    for (const d of details) {
      console.error(`  VIOLATION: "${d.fold}" opening ${d.openDate} has ${d.slugs.length} rows: ` +
        `${d.slugs.join(', ')} (issue sizes ${d.issueSizes.join(' / ')})`);
    }
    if (!count) console.error(`  ok: no duplicate${process.env.DUPLICATE_INVARIANT_FOLDS ? ` for [${process.env.DUPLICATE_INVARIANT_FOLDS}]` : ""} — no live IPO name folds to two rows on the same open date`);
    console.log(String(count));
    process.exit(0);
  } catch (err) {
    console.error(`FATAL: duplicate-ipo-rows invariant crashed: ${err.message}`);
    process.exit(2);
  } finally {
    await pool.end();
  }
}
