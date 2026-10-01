#!/usr/bin/env node
// docs/design/probes/market-holidays.mjs — what the holiday calendar holds, per year and exchange (#1380).
//
// READ-ONLY (openReadOnlyPool). The OD-21 working-day rules (listing_t3, listing_t6) need the exchange
// holiday calendar (spec "working_days_inclusive, defined once"). Before wiring it, this answers:
// which years are covered, which exchanges, and whether NSE and BSE trading holidays differ.
//
// Usage: node docs/design/probes/market-holidays.mjs <database>   (e.g. ipodhan_staging)
import { openReadOnlyPool, saveOutput, nowStamp, causeOf } from './_lib.mjs';

const database = process.argv[2];
if (!database) {
  console.error('usage: market-holidays.mjs <database>');
  process.exit(2);
}

let pool;
try {
  pool = await openReadOnlyPool(database);
  const db = (await pool.query('select current_database() as d')).rows[0].d;
  const byYear = (await pool.query(
    `select year, exchange::text as exchange, type::text as type, count(*)::int as n
       from market_holidays group by 1, 2, 3 order by 1, 2, 3`
  )).rows;
  // Trading dates per exchange; BOTH counts for both. A date in one set and not the other is a difference.
  const diff = (await pool.query(
    `with t as (
       select date::text as d, exchange::text as ex from market_holidays
        where type::text in ('TRADING', 'BOTH')
     ), nse as (select d from t where ex in ('NSE', 'BOTH')),
        bse as (select d from t where ex in ('BSE', 'BOTH'))
     select d, 'NSE_ONLY' as side from nse except select d, 'NSE_ONLY' from bse
     union all
     select d, 'BSE_ONLY' from bse except select d, 'BSE_ONLY' from nse
     order by 1`
  )).rows;
  const out = { measuredAt: nowStamp(), database: db, byYear, nseBseDifferences: diff };
  saveOutput('market-holidays', out);
  console.log(JSON.stringify(out, null, 2));
} catch (err) {
  console.error(`market-holidays: ${causeOf(err)}`);
  process.exitCode = 1;
} finally {
  await pool?.end();
}
