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
 * How far two rows' open dates may sit apart and still be the same IPO.
 *
 * WHY A TOLERANCE AT ALL. Grouping on fold + EXACT open date splits a twin pair whose two
 * sources disagree about the open day, which is exactly what happened: on ipodhan_staging
 * "H R Hygiene Products" sits at 2026-07-26 against its three twins at 2026-07-29, and
 * "Shree Balaji Mala Textiles" at 2026-07-19 against its three at 2026-07-22 — both a 3-day
 * spread, both invisible to an exact-date group.
 *
 * WHY 3, MEASURED not guessed (read-only sweep of both slots, 2026-09-16). Live rows under
 * the widened fold, violation groups by window: staging 0d/1d/2d -> 9, 3d -> 10, 4d/5d/7d ->
 * 10 (no further growth); ipodhan -> 0 at EVERY window. 3 is the smallest window that unifies
 * the real twins, and widening past it to a week adds nothing, so there is no evidence for a
 * looser value. The single group 3d adds over 2d is `cubehighwaystrust` — two LISTED MAINBOARD
 * rows with the identical name "Cube Highways Trust" (slugs cube-highways-trust @2026-07-19 and
 * cube-highways-trust-cube-highways-trust-invit @2026-07-22), a genuine duplicate, not a false
 * merge. Re-measure before changing this number.
 */
const OPEN_DATE_TOLERANCE_DAYS = 3;

/**
 * Fold a company name to its identity. Corporate-form words and the country carry no identity;
 * "Asset Reconstruction Co.(India) Ltd." and "ASSET RECONSTRUCTION COMPANY (INDIA) LIMITED" are
 * the same company and must fold to the same string. Item 12 slice F also strips the trailing
 * "(<Company> IPO)" tail (with an optional 1-2 letter status token after it) that listing-page
 * discovery appends to a twin row.
 */
// Hand copy of BRACKETED_IPO_TAIL in the TypeScript SSOT. Kept in parity by
// scripts/tests/company-identity-fold-parity.test.mjs.
const BRACKETED_IPO_TAIL = /\s*\([^()]*\bipo\s*\)(?:\s+[A-Za-z]{1,2})?\s*$/i;

export function foldName(s) {
  return String(s || '')
    .replace(BRACKETED_IPO_TAIL, '')
    .toLowerCase()
    .replace(/[.,()&'"-]/g, ' ')
    .replace(/\b(private|pvt|limited|ltd|company|co|corporation|corp|incorporated|inc|and|the|of|india|indian)\b/g, ' ')
    .replace(/\s+/g, '');
}

/**
 * `open_date` reaches this module as EITHER a 'YYYY-MM-DD' string or a Date, and BOTH shapes
 * were mishandled before item 12 slice F:
 *
 *  1. `String(aDate).slice(0, 10)` on a Date yields "Sun Jul 26" — a useless label, and a
 *     truncated string for the day-difference maths to parse.
 *  2. `aDate.toISOString().slice(0, 10)` is ALSO wrong here (F-104, the class the header of
 *     `scripts/audit/fold-collision-report.mjs` records): node-pg parses a bare `date` into a
 *     Date at LOCAL midnight, so on this IST machine the UTC day is the day BEFORE the one the
 *     server sent — a run on 2026-09-16 printed 2026-07-30 for a row whose open_date is
 *     2026-07-31.
 *
 * A bare `date` carries no time zone; the calendar day the server sent is the LOCAL day of that
 * Date. Read the local Y/M/D components, never a UTC projection of them.
 */
function isoDay(value) {
  if (!value) return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, '0');
    const d = String(value.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  const m = String(value).match(/^\d{4}-\d{2}-\d{2}/);
  return m ? m[0] : null;
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

  // Group by fold, then split each fold's rows into date CLUSTERS: consecutive rows whose
  // open dates are no more than OPEN_DATE_TOLERANCE_DAYS apart belong to one cluster. A row
  // with no open date clusters only with other dateless rows of the same fold.
  const byFold = new Map();
  for (const r of rows) {
    const fold = foldName(r.company_name);
    if (!fold) continue;                       // a nameless row is a different defect
    if (!byFold.has(fold)) byFold.set(fold, []);
    byFold.get(fold).push(r);
  }

  const groups = new Map();
  for (const [fold, members] of byFold) {
    const sorted = [...members].sort((a, b) =>
      String(isoDay(a.open_date) ?? '').localeCompare(String(isoDay(b.open_date) ?? '')));
    let cluster = [];
    let seq = 0;
    const flush = () => {
      if (!cluster.length) return;
      const days = cluster.map((r) => isoDay(r.open_date) ?? 'no-open-date');
      const label = days[0] === days[days.length - 1] ? days[0] : `${days[0]}..${days[days.length - 1]}`;
      groups.set(`${fold}|${seq++}`, { fold, openDate: label, rows: cluster });
      cluster = [];
    };
    for (const r of sorted) {
      if (!cluster.length) { cluster = [r]; continue; }
      const prev = isoDay(cluster[cluster.length - 1].open_date);
      const day = isoDay(r.open_date);
      const near = prev && day
        ? Math.abs((new Date(`${day}T00:00:00Z`) - new Date(`${prev}T00:00:00Z`)) / 86400000)
            <= OPEN_DATE_TOLERANCE_DAYS
        : (!prev && !day);
      if (near) cluster.push(r);
      else { flush(); cluster = [r]; }
    }
    flush();
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
