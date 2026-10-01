// #1380 / F-220: the ONE rule that decides whether an exchange-specific market_holidays row is a
// one-day-early copy of another exchange's row. Used by the repair tool
// (scraper/src/services/shifted-market-holidays.ts -> scraper/scripts/repair-shifted-market-holidays.ts)
// and by the nightly check `h_market_holiday_shifted_copy` (scripts/audit-detection-floor.mjs), so the
// repair and the detection can never disagree about which rows are shifted.
//
// NSE and BSE trading holidays are ONE set (spec §4.6, F-220). A row stored for a single exchange
// (NSE or BSE), TRADING, whose date + 1 day carries a TRADING row of the other exchange (or BOTH) with
// the same description, and whose own date is not carried by the other exchange, is a copy whose
// writer shifted an IST midnight through UTC (class: calendar-date-stored-one-day-early). A genuine
// exchange-only holiday has no later twin and is never selected; a real double holiday (two different
// descriptions on one date, e.g. 2025-10-02) has no description match on the next day and is never
// selected. Date arithmetic is on calendar parts only, never through a Date -> ISO string round trip
// (that round trip is the F-220 bug).

/** SQL the nightly check and any real-DB test run: `date` is read as text so no driver shifts it. */
export const MARKET_HOLIDAY_ROWS_SQL = `SELECT id::text AS id, date::text AS date, description, exchange::text AS exchange, type::text AS type, year
       FROM market_holidays
      ORDER BY date, exchange, description`;

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** `YYYY-MM-DD` plus `n` calendar days, by calendar parts in UTC (no zone conversion, no ISO string of a Date). */
export function addCalendarDays(iso, n) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso));
  if (!m) throw new Error(`addCalendarDays: "${iso}" is not a YYYY-MM-DD date`);
  const t = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + n));
  const p = (v, w) => String(v).padStart(w, '0');
  return `${p(t.getUTCFullYear(), 4)}-${p(t.getUTCMonth() + 1, 2)}-${p(t.getUTCDate(), 2)}`;
}

export function weekdayName(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso));
  if (!m) throw new Error(`weekdayName: "${iso}" is not a YYYY-MM-DD date`);
  return WEEKDAYS[new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).getUTCDay()];
}

export function normalizeHolidayDescription(text) {
  return String(text ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * @param {Array<{id:string,date:string,description:string,exchange:string,type:string}>} rows
 * @returns {Array<{row:object, copyOf:object, weekday:string}>} every selected row with the row it copies
 */
export function selectShiftedHolidayCopies(rows) {
  const trading = rows.filter((r) => r.type === 'TRADING');
  const selected = [];
  for (const r of trading) {
    if (r.exchange !== 'NSE' && r.exchange !== 'BSE') continue;
    const other = (o) => o.exchange !== r.exchange && o.id !== r.id;
    // the other exchange (or BOTH) already carries this very date: a genuine shared date, not a shifted one
    if (trading.some((o) => other(o) && o.date === r.date)) continue;
    const next = addCalendarDays(r.date, 1);
    const desc = normalizeHolidayDescription(r.description);
    const copyOf = trading.find(
      (o) => other(o) && o.date === next && normalizeHolidayDescription(o.description) === desc
    );
    if (copyOf) selected.push({ row: r, copyOf, weekday: weekdayName(r.date) });
  }
  return selected;
}

/** Nightly verdict: reads through `q(sql)` (returns rows). FAIL lists every row by identity, never a bare count. */
export async function evaluateShiftedHolidayCopies(q) {
  const rows = await q(MARKET_HOLIDAY_ROWS_SQL);
  const selected = selectShiftedHolidayCopies(rows);
  const lines = selected.map(
    (s) =>
      `${s.row.exchange} ${s.row.date} ${s.weekday} "${s.row.description}" (id ${s.row.id}) is one day before ` +
      `${s.copyOf.exchange} ${s.copyOf.date} (id ${s.copyOf.id})`
  );
  return { status: selected.length === 0 ? 'PASS' : 'FAIL', rows: selected, lines, scanned: rows.length };
}
