/**
 * Repair: subscription rows corrupted by the T-266 in-run-memory guard gap
 * (T-296 P1-1, T-299 fix). The old guard had no memory of what was already
 * persisted, so the FIRST partial/no-payload write of a cycle always landed
 * unopposed. T-299 replaces it with a persisted-row comparison so this class
 * cannot recur going forward - this script cleans up the rows the old bug
 * already wrote.
 *
 * Deliberately ORDER-based, not date-literal-based: this box's local system
 * timezone (IST) makes any hardcoded date-cutoff comparison against the
 * `timestamp` (naive) column fragile — node-postgres's default OID 1114
 * parser interprets the naive value in the CLIENT's local timezone, so a
 * printed/typed-in "13:30" cutoff can silently mean something else server-
 * side. Every row-selection rule here compares VALUES in `ORDER BY
 * "timestamp"` sequence, never a literal date/time string.
 *
 * Backup-first: every row this script would touch is dumped to a per-row
 * JSON ledger (evidence/2026-08-23-T-299/subscription-repair-ledger.json)
 * BEFORE any DELETE, with the surrounding context that proves it was the
 * transient-partial-write artifact (source proof), not a real drop.
 *
 * Two corroborated cases (dry-run by default; --apply deletes). Scope is
 * deliberately conservative: this DOES NOT bulk-clean every historical dip
 * that already self-healed by the next cycle (a broad scan found 100+ such
 * blips, several of them an oscillating pair of legitimate-looking values on
 * leapfrog-engineering-services-ltd that are NOT confidently the same bug
 * class — repairing those needs its own investigation, not a wholesale
 * delete under this contract). This script fixes exactly what the DoD named
 * plus what independently queries as CURRENTLY wrong on the live site:
 *
 * 1. NAMED: tempsens-instruments-india-ltd / augmont-enterprises-ltd — the
 *    single row each at the 2026-08-22/23 boundary where the total dropped
 *    >60% and the very next row (30 min later) returned to the prior value.
 *    The display already self-healed by the next cycle; only the persisted
 *    row (and the "Subscription Trend Over Time" chart it feeds) still
 *    carries the fake dip.
 *
 * 2. QUERIED VICTIMS: any IPO since 2026-06-01 whose CURRENT (latest) row is
 *    still below its own historical max by >=5%, with no total_shares_bid on
 *    the latest row and no later legitimate reduction — i.e. the site is
 *    STILL displaying the wrong number today. Only h-r-hygiene-products-ltd
 *    (LISTED) matches: it reached 6.26x, then every subsequent row through
 *    the last one ever recorded is stuck at 1.36x with no total_shares_bid.
 *
 * Run from scraper/ with tunnel env exported (DATABASE_HOST=127.0.0.1
 * DATABASE_PORT=15432 + creds), dry-run by default, --apply writes.
 */
import { Pool } from 'pg';
import { writeFileSync, mkdirSync } from 'node:fs';

const APPLY = process.argv.includes('--apply');
const LEDGER_DIR = 'D:/Abhay/GetWorkDone/evidence/2026-08-23-T-299';
const LEDGER_PATH = `${LEDGER_DIR}/subscription-repair-ledger.json`;
const SINCE = '2026-06-01 00:00:00'; // naive literal, compared to naive column only (no tz cast)
const NAMED_SELF_HEALED_SLUGS = ['tempsens-instruments-india-ltd', 'augmont-enterprises-ltd'];

const pool = new Pool({
  host: process.env.DATABASE_HOST,
  port: parseInt(process.env.DATABASE_PORT || '5432'),
  database: process.env.DATABASE_NAME || 'ipodhan',
  user: process.env.DATABASE_USER || 'postgres',
  password: process.env.DATABASE_PASSWORD,
});

async function main() {
  console.log('='.repeat(80));
  console.log(`SUBSCRIPTION REGRESSION REPAIR (T-299 P1-1) - ${APPLY ? 'APPLY' : 'DRY-RUN'}`);
  console.log('='.repeat(80));

  mkdirSync(LEDGER_DIR, { recursive: true });

  const ledger: any[] = [];
  const idsToDelete: string[] = [];

  const ipoRes = await pool.query(
    `select distinct s.ipo_id, i.slug, i.status
     from subscriptions s join ipos i on i.id = s.ipo_id
     where s."timestamp" >= $1::timestamp`,
    [SINCE]
  );

  for (const ipo of ipoRes.rows) {
    const rowsRes = await pool.query(
      'select * from subscriptions where ipo_id = $1 order by "timestamp" asc',
      [ipo.ipo_id]
    );
    const rows = rowsRes.rows;
    if (rows.length < 3) continue;

    // --- Case 1: self-healed single-row dips, NAMED IPOs only ---
    if (NAMED_SELF_HEALED_SLUGS.includes(ipo.slug)) {
      for (let i = 1; i < rows.length - 1; i++) {
        const prev = parseFloat(rows[i - 1].total_subscription ?? '0');
        const cur = parseFloat(rows[i].total_subscription ?? '0');
        const next = parseFloat(rows[i + 1].total_subscription ?? '0');
        const isDip = prev > 0 && cur < prev * 0.95 && next >= prev * 0.99 && rows[i].total_shares_bid == null;
        if (!isDip) continue;

        ledger.push({
          case: 'self-healed-dip',
          slug: ipo.slug,
          id: rows[i].id,
          timestamp: rows[i].timestamp,
          deletedRow: rows[i],
          sourceProof: {
            prevRowId: rows[i - 1].id,
            prevTotal: prev,
            nextRowId: rows[i + 1].id,
            nextTotal: next,
            reason:
              'next cycle returned to >=99% of the prior total with no total_shares_bid on the dip row - transient partial-write artifact (T-296 P1-1)',
          },
        });
        idsToDelete.push(rows[i].id);
        console.log(`  ${APPLY ? 'DELETE' : 'would delete'}: ${ipo.slug} (self-healed dip, row ${rows[i].id}) ${prev} -> ${cur} -> ${next}`);
      }
    }

    // --- Case 2: stuck trailing regression (LISTED IPOs only - no more legit updates coming) ---
    if (ipo.status === 'LISTED') {
      const totals = rows.map((r) => parseFloat(r.total_subscription ?? '0'));
      const maxSoFar = Math.max(...totals);
      // LAST index reaching the max (not the first) - the max is often held
      // across several consecutive rows before the regression begins, and
      // everything from the final held-max row onward is the trailing window.
      const maxIdx = totals.lastIndexOf(maxSoFar);

      if (maxIdx >= 0 && maxIdx < rows.length - 1 && maxSoFar > 0) {
        const trailing = rows.slice(maxIdx + 1);
        const allStuckBelowMax = trailing.every(
          (r) => parseFloat(r.total_subscription ?? '0') < maxSoFar * 0.95 && r.total_shares_bid == null
        );
        if (allStuckBelowMax && trailing.length > 0) {
          for (const row of trailing) {
            ledger.push({
              case: 'stuck-trailing-regression',
              slug: ipo.slug,
              id: row.id,
              timestamp: row.timestamp,
              deletedRow: row,
              sourceProof: {
                lastKnownGoodValue: maxSoFar,
                lastKnownGoodRowId: rows[maxIdx].id,
                lastKnownGoodTimestamp: rows[maxIdx].timestamp,
                trailingRunLength: trailing.length,
                reason:
                  'this IPO is LISTED (no further legitimate updates possible) and every row from the historical-max row through the last recorded row sits >=5% below that max with no total_shares_bid - the scraper never received another consolidated payload before the data went static, so the corrupted figure is still the CURRENT displayed value (T-296 P1-1)',
              },
            });
            idsToDelete.push(row.id);
          }
          console.log(
            `  ${APPLY ? 'DELETE' : 'would delete'}: ${ipo.slug} (stuck trailing regression, ${trailing.length} rows) - restores ${maxSoFar}x as latest`
          );
        }
      }
    }
  }

  writeFileSync(LEDGER_PATH, JSON.stringify(ledger, null, 2));
  console.log(`\nledger written: ${LEDGER_PATH} (${ledger.length} rows)`);

  if (APPLY && idsToDelete.length > 0) {
    const result = await pool.query('delete from subscriptions where id = any($1::uuid[]) returning id', [
      idsToDelete,
    ]);
    console.log(`\nDELETED ${result.rowCount} rows (requested ${idsToDelete.length}).`);
  } else if (!APPLY) {
    console.log(`\nDRY-RUN: ${idsToDelete.length} rows would be deleted. Re-run with --apply to write.`);
  }

  console.log('='.repeat(80));
  await pool.end();
  process.exit(0);
}

main().catch((e) => {
  console.error('subscription regression repair crashed:', e);
  process.exit(1);
});
