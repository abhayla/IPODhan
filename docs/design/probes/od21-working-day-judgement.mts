// OD-21 working-day judgement probe (READ-ONLY, Tier C). Runs the REAL validateFieldValue +
// REAL TradingCalendar (createTradingCalendar -> MarketHolidayRepository.findAllUncached) over real
// staging rows. Run: tsx od21-working-day-judgement.mts  (code is imported from the main checkout,
// same commit as this worktree's origin/main, because a worktree carries no node_modules).
import fs from 'node:fs';
import { drizzle } from 'file:///D:/Abhay/Ventures/IPODhan/node_modules/drizzle-orm/node-postgres/index.js';
import { openReadOnlyPool } from './_lib.mjs';
import { validateFieldValue, workingDaysBetween, toIsoDate } from 'file:///D:/Abhay/Ventures/IPODhan/scraper/src/services/field-extraction-validation.js';
import { loadValidationRules } from 'file:///D:/Abhay/Ventures/IPODhan/scraper/src/config/validation-rules-loader.js';
import { createTradingCalendar } from 'file:///D:/Abhay/Ventures/IPODhan/scraper/src/services/trading-calendar.js';

const pool = await openReadOnlyPool('ipodhan_staging');
const db = drizzle(pool);
const rules = loadValidationRules();
const cal = await createTradingCalendar(db, null).resolve();
if (!cal) throw new Error('calendar failed to load');

const { rows } = await pool.query(
  `select slug, status::text, segment::text, offering_type::text, close_date::text as close_date, listing_date::text as listing_date
   from ipos where close_date is not null and listing_date is not null and offering_type='IPO'
   and status in ('LISTED','CLOSED')
   and (extract(year from listing_date) in (2025,2026) or extract(year from close_date) in (2025,2026))
   order by listing_date`);

const counts: Record<string, number> = {};
const fails: any[] = [];
const details: any[] = [];
for (const r of rows) {
  const out: any = validateFieldValue({
    table: 'ipos', column: 'listing_date', value: r.listing_date, offeringType: r.offering_type,
    segment: r.segment, asOfDate: new Date(r.listing_date), rules,
    row: { close_date: r.close_date, listing_date: r.listing_date },
    holidays: cal.holidays, holidayYears: cal.years,
  });
  const key = `${out.status}|${out.ruleId ?? (out.reason?.match(/rule (\w+)/)?.[1] ?? 'none')}${out.status === 'NO_RULE_APPLIES' ? '|' + String(out.reason).slice(0, 70) : ''}`;
  counts[key] = (counts[key] ?? 0) + 1;
  const wd = workingDaysBetween(new Date(r.close_date), new Date(r.listing_date), cal.holidays);
  const skipped: string[] = [];
  for (let d = new Date(r.close_date + 'T00:00:00Z'); d < new Date(r.listing_date + 'T00:00:00Z');) {
    d = new Date(d.getTime() + 86400000);
    const iso = toIsoDate(d)!;
    if (d.getUTCDay() % 6 !== 0 && cal.holidays.has(iso)) skipped.push(iso);
  }
  const rec = { ...r, outcome: out, workingDays: wd, holidaysSkipped: skipped };
  details.push(rec);
  if (out.status === 'FAIL') fails.push(rec);
}
const summary = {
  probedAt: new Date().toISOString(), database: 'ipodhan_staging', rowCount: rows.length,
  calendar: { holidayCount: cal.holidays.size, years: [...cal.years].sort() },
  rules: rules.filter((r: any) => r.appliesTo.column === 'listing_date').map((r: any) => ({ id: r.id, validFrom: r.validFrom, validTo: r.validTo, assertion: r.assertion })),
  verdictByRule: counts, fails, details,
};
fs.writeFileSync(new URL('./od21-working-day-judgement.out.json', import.meta.url), JSON.stringify(summary, null, 2));
console.log(JSON.stringify({ rowCount: rows.length, calendar: summary.calendar, verdictByRule: counts, failCount: fails.length }));
await pool.end();
