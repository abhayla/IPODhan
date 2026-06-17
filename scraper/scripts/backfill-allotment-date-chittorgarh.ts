/**
 * Backfill: allotment_date for genuine IPOs from Chittorgarh report 118 (B7)
 *
 * WHY: allotment_date is ~1% — it was missing from FIELD_PRIORITY_MATRIX (now fixed) and never
 * sourced. Chittorgarh report 118 (ipo-list-by-time-table-and-lot-size) is a FULL list (371 rows)
 * exposing `~Timetable_BOA_dt` (basis-of-allotment date, ISO) per IPO.
 *
 * CORRECTIVE backfill (A4 precedent): matches report rows to EXISTING genuine IPOs by the canonical
 * normalizer and fills allotment_date ONLY where currently NULL — never overwrites (so an admin edit
 * is never clobbered) and never creates a row (no pollution risk). Real data only.
 *
 * dry-run by default; --apply writes. Run from scraper/ with tunnel env exported.
 */
import { db } from '@ipodhan/shared';
import * as schema from '@ipodhan/shared/db/schema';
import { and, eq, isNull } from 'drizzle-orm';
import { normalizeCompanyNameForMatching } from '@ipodhan/shared/utils/company-name-normalizer';
import logger from '../src/utils/logger.js';

const APPLY = process.argv.includes('--apply');
const FISCAL_YEARS = [
  { year: 2026, range: '2026-27' },
  { year: 2025, range: '2025-26' },
  { year: 2024, range: '2024-25' },
  { year: 2023, range: '2023-24' },
  { year: 2022, range: '2022-23' },
  { year: 2021, range: '2021-22' },
  { year: 2020, range: '2020-21' },
];

function isoDate(v: unknown): string | null {
  if (!v) return null;
  const s = String(v);
  const m = s.match(/^\d{4}-\d{2}-\d{2}/);
  return m ? m[0] : null;
}

async function fetchReport118(year: number, range: string): Promise<any[]> {
  const u = `https://webnodejs.chittorgarh.com/cloud/report/data-read/118/1/10/${year}/${range}/0/all/0?search=&v=15-11`;
  const r = await fetch(u, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      Referer: 'https://www.chittorgarh.com/',
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(20000),
  });
  if (!r.ok) throw new Error(`report 118 HTTP ${r.status}`);
  const d: any = await r.json();
  return d?.reportTableData ?? [];
}

async function main() {
  console.log('='.repeat(80));
  console.log(`ALLOTMENT-DATE BACKFILL (Chittorgarh report 118) — ${APPLY ? 'APPLY' : 'DRY-RUN'}`);
  console.log('='.repeat(80));

  // Build normalizedName -> allotmentDate from the report (first non-null wins)
  const allotByName = new Map<string, string>();
  for (const fy of FISCAL_YEARS) {
    try {
      const rows = await fetchReport118(fy.year, fy.range);
      let added = 0;
      for (const row of rows) {
        const name = row?.Company ? String(row.Company) : '';
        const date = isoDate(row?.['~Timetable_BOA_dt']) ?? isoDate(row?.['Allotment Date']);
        if (!name || !date) continue;
        const key = normalizeCompanyNameForMatching(name);
        if (key && !allotByName.has(key)) { allotByName.set(key, date); added++; }
      }
      logger.info({ fy: fy.range, rows: rows.length, added }, 'report 118 page fetched');
      await new Promise((r) => setTimeout(r, 400));
    } catch (err) {
      logger.warn({ fy: fy.range, error: err instanceof Error ? err.message : String(err) }, 'report 118 fetch failed (continuing)');
    }
  }
  console.log(`distinct allotment dates from report 118: ${allotByName.size}`);

  // Genuine IPOs missing allotment_date
  const ipos = await db
    .select({ id: schema.ipos.id, companyName: schema.ipos.companyName })
    .from(schema.ipos)
    .where(and(eq(schema.ipos.offeringType, 'IPO'), isNull(schema.ipos.allotmentDate)));

  console.log(`genuine IPOs with NULL allotment_date: ${ipos.length}`);

  const plans: Array<{ id: string; name: string; date: string }> = [];
  for (const ipo of ipos) {
    const key = normalizeCompanyNameForMatching(ipo.companyName);
    const date = key ? allotByName.get(key) : undefined;
    if (date) plans.push({ id: ipo.id, name: ipo.companyName, date });
  }
  console.log(`\nmatched (would fill): ${plans.length}`);
  for (const p of plans.slice(0, 10)) console.log(`  - ${p.name} -> ${p.date}`);

  if (!APPLY) {
    console.log(`\nDRY-RUN: ${plans.length} allotment_date values WOULD be filled. Re-run with --apply.`);
    console.log('='.repeat(80));
    process.exit(0);
  }

  let written = 0, failed = 0;
  for (const p of plans) {
    try {
      // fill only where still NULL (guard against a concurrent write / admin edit)
      await db
        .update(schema.ipos)
        .set({ allotmentDate: p.date })
        .where(and(eq(schema.ipos.id, p.id), isNull(schema.ipos.allotmentDate)));
      written++;
    } catch (err) {
      failed++;
      logger.error({ company: p.name, error: err instanceof Error ? err.message : String(err) }, 'allotment_date update failed');
    }
  }
  console.log(`\nAPPLY complete: written=${written} failed=${failed}`);
  console.log('='.repeat(80));
  process.exit(failed > written ? 1 : 0);
}

main().catch((e) => {
  logger.error({ error: e instanceof Error ? e.message : String(e) }, 'allotment-date backfill crashed');
  console.error(e);
  process.exit(1);
});
