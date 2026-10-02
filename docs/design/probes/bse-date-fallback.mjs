// docs/design/probes/bse-date-fallback.mjs -- read-only staging measurement for #1467 / F-223 / #1453.
//
// Question: did the BSE date parser (scraper/src/scrapers/bse-scraper.ts parseBSEDate) write a made-up
// or one-day-early date? Two fingerprints, both read from `ipodhan_staging` via the read-only pool:
//   A. TODAY-FALLBACK: a BSE-sourced date field whose stored value equals the IST day the row was
//      written, while another source's witness for the same field disagrees. (A BSE value equal to the
//      write day is also legitimate on opening day, so A is only counted as a suspect when a second
//      source disagrees; the unqualified count is printed beside it.)
//   B. ONE-DAY-EARLY: a BSE answer exactly one day before another source's answer for the same field.
// Population: field_sources rows, table 'ipos', field_name camelCase, every status/segment.
import { openReadOnlyPool } from './_lib.mjs';

const FIELDS = ['openDate', 'closeDate', 'listingDate', 'allotmentDate', 'refundDate', 'creditDate'];
const COL = { openDate: 'open_date', closeDate: 'close_date', listingDate: 'listing_date',
  allotmentDate: 'allotment_date', refundDate: 'refund_date', creditDate: 'credit_date' };
const pool = await openReadOnlyPool('ipodhan_staging');
const out = { database: 'ipodhan_staging', measuredAt: new Date().toISOString(), fields: {} };

const dayIst = (d) => new Date(new Date(d).getTime() + 330 * 60000).toISOString().slice(0, 10);
const addDay = (s, n) => new Date(Date.parse(s + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);

try {
  const cols = (await pool.query(
    `select column_name from information_schema.columns where table_name='ipos' and column_name = any($1)`,
    [Object.values(COL)])).rows.map((r) => r.column_name);
  out.iposDateColumnsPresent = cols;
  for (const f of FIELDS) {
    if (!cols.includes(COL[f])) { out.fields[f] = { skipped: 'column ' + COL[f] + ' not on ipos' }; continue; }
    const { rows } = await pool.query(
      `select i.slug, i.status, i.segment, i.${COL[f]}::text as stored, fs.source, fs.updated_at, fs.witnesses
         from field_sources fs join ipos i on i.id = fs.ipo_id
        where fs.table_name = 'ipos' and fs.field_name = $1`, [f]);
    const r = { fieldSourceRows: rows.length, bseWinning: 0, bseWinningEqualsWriteDay: 0,
      todayFallbackSuspects: [], bseOneDayEarly: [], bseEqualsWriteDayAll: [], bseDisagreesAny: [] };
    for (const row of rows) {
      const wit = Array.isArray(row.witnesses) ? row.witnesses : [];
      const bseVals = [];
      if (row.source === 'BSE' && row.stored) {
        r.bseWinning++;
        bseVals.push(row.stored.slice(0, 10));
        if (row.stored.slice(0, 10) === dayIst(row.updated_at)) {
          r.bseWinningEqualsWriteDay++;
          r.bseEqualsWriteDayAll.push({ slug: row.slug, status: row.status, stored: row.stored.slice(0, 10), writtenIst: dayIst(row.updated_at), witnesses: wit.map((w) => w && (w.source + ':' + w.value + ':' + w.outcome)) });
          const other = wit.filter((w) => w && w.source && w.source !== 'BSE' && w.value != null)
            .map((w) => String(w.value).slice(0, 10));
          const others = other.length ? other : [];
          if (others.some((v) => v !== row.stored.slice(0, 10))) {
            r.todayFallbackSuspects.push({ slug: row.slug, status: row.status, stored: row.stored.slice(0, 10), writtenIst: dayIst(row.updated_at), otherSources: others });
          }
        }
      }
      for (const w of wit) if (w && w.source === 'BSE' && w.value != null) bseVals.push(String(w.value).slice(0, 10));
      const othersAll = [];
      if (row.source !== 'BSE' && row.stored) othersAll.push({ source: row.source, v: row.stored.slice(0, 10) });
      for (const w of wit) if (w && w.source && w.source !== 'BSE' && w.value != null) othersAll.push({ source: w.source, v: String(w.value).slice(0, 10) });
      for (const b of new Set(bseVals)) for (const o of othersAll) {
        if (b !== o.v) r.bseDisagreesAny.push({ slug: row.slug, status: row.status, bse: b, other: o.source, otherValue: o.v });
        if (/^\d{4}-\d{2}-\d{2}$/.test(b) && /^\d{4}-\d{2}-\d{2}$/.test(o.v) && addDay(b, 1) === o.v) {
          r.bseOneDayEarly.push({ slug: row.slug, status: row.status, bse: b, other: o.source, otherValue: o.v });
        }
      }
    }
    r.todayFallbackSuspectCount = r.todayFallbackSuspects.length;
    r.bseOneDayEarlyCount = r.bseOneDayEarly.length;
    out.fields[f] = r;
  }
  // witness shape sample, so the reader can see what was compared
  const s = await pool.query(`select field_name, source, witnesses from field_sources where table_name='ipos' and field_name='openDate' and witnesses is not null limit 2`);
  out.witnessShapeSample = s.rows;
} finally {
  await pool.end();
}
console.log(JSON.stringify(out, null, 1));
