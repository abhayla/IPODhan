/**
 * Oracle DATE cross-check matrix (read-only). For EVERY genuine IPO in prod, compare
 * our open/close/allotment/listing dates against chittorgarh's bulk timetable report 118
 * (reachable when detail pages are WAF-blocked). Emits a per-IPO×per-field verdict
 * CORRECT | WRONG | SOURCE-UNAVAILABLE and a summary. NO writes.
 *
 * Env: DATABASE_HOST=127.0.0.1 DATABASE_PORT=<tunnel> DATABASE_USER/PASSWORD/NAME.
 * Run: npx tsx scripts/audit/oracle-date-matrix.ts [--out <path>]
 */
import { Client } from 'pg';
import { normalizeCompanyNameForMatching } from '@ipodhan/shared/utils/company-name-normalizer';
import { isDateSequenceCoherent } from '../../src/services/ipo-date-plausibility.js';
import { writeFileSync } from 'fs';

const FYS = [
  { year: 2026, range: '2026-27' }, { year: 2025, range: '2025-26' },
  { year: 2024, range: '2024-25' }, { year: 2023, range: '2023-24' },
  { year: 2022, range: '2022-23' }, { year: 2021, range: '2021-22' },
  { year: 2020, range: '2020-21' },
];

const isoDay = (v: unknown): string | null => {
  if (!v) return null;
  const m = String(v).match(/^\d{4}-\d{2}-\d{2}/);
  return m ? m[0] : null;
};

async function fetchReport118(year: number, range: string): Promise<any[]> {
  const u = `https://webnodejs.chittorgarh.com/cloud/report/data-read/118/1/10/${year}/${range}/0/all/0?search=&v=15-11`;
  const r = await fetch(u, {
    headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://www.chittorgarh.com/', Accept: 'application/json' },
    signal: AbortSignal.timeout(25000),
  });
  if (!r.ok) throw new Error(`report118 HTTP ${r.status}`);
  return (await r.json())?.reportTableData ?? [];
}

type OracleRow = { open: string | null; close: string | null; allot: string | null; listing: string | null };

async function main() {
  const outArg = process.argv.indexOf('--out');
  const outPath = outArg > -1 ? process.argv[outArg + 1] : null;

  // Oracle: normalized-name -> dates (first non-empty wins across FYs).
  const oracle = new Map<string, OracleRow>();
  for (const fy of FYS) {
    try {
      const rows = await fetchReport118(fy.year, fy.range);
      for (const row of rows) {
        const name = row?.Company ? String(row.Company) : '';
        const key = normalizeCompanyNameForMatching(name);
        if (!key) continue;
        const rec: OracleRow = {
          open: isoDay(row['~Issue_Open_Date']),
          close: isoDay(row['~Issue_Close_Date']),
          allot: isoDay(row['~Timetable_BOA_dt']),
          listing: isoDay(row['~IPO_Listing_date']),
        };
        if (!oracle.has(key)) oracle.set(key, rec);
      }
      await new Promise((r) => setTimeout(r, 400));
    } catch (e) {
      console.log(`report118 ${fy.range} fetch failed: ${(e as Error).message}`);
    }
  }
  console.log(`oracle (report-118) distinct companies: ${oracle.size}`);

  // Ours: every genuine IPO.
  const c = new Client({
    host: process.env.DATABASE_HOST, port: parseInt(process.env.DATABASE_PORT || '5432'),
    user: process.env.DATABASE_USER, password: process.env.DATABASE_PASSWORD, database: process.env.DATABASE_NAME,
    ssl: false, connectionTimeoutMillis: 12000,
  });
  await c.connect();
  const { rows: ipos } = await c.query(
    `select company_name, status,
            to_char(open_date,'YYYY-MM-DD') open, to_char(close_date,'YYYY-MM-DD') close,
            to_char(allotment_date,'YYYY-MM-DD') allot, to_char(listing_date,'YYYY-MM-DD') listing
     from ipos where offering_type='IPO'`);
  await c.end();

  const FIELDS = ['open', 'close', 'allot', 'listing'] as const;
  const tally: Record<string, { CORRECT: number; WRONG: number; 'SOURCE-UNAVAILABLE': number }> = {};
  for (const f of FIELDS) tally[f] = { CORRECT: 0, WRONG: 0, 'SOURCE-UNAVAILABLE': 0 };
  const wrongs: any[] = [];
  let matched = 0, unmatched = 0;

  const lines: string[] = ['company\tstatus\tfield\tours\toracle\tverdict'];
  for (const ipo of ipos) {
    const key = normalizeCompanyNameForMatching(ipo.company_name);
    const o = key ? oracle.get(key) : undefined;
    if (!o) { unmatched++; continue; }
    matched++;
    for (const f of FIELDS) {
      const ours = ipo[f] ?? null;
      const orc = (o as any)[f] ?? null;
      let verdict: 'CORRECT' | 'WRONG' | 'SOURCE-UNAVAILABLE';
      if (orc === null) verdict = 'SOURCE-UNAVAILABLE';
      else if (ours === null) verdict = 'WRONG'; // oracle has it, we don't
      else verdict = ours === orc ? 'CORRECT' : 'WRONG';
      tally[f][verdict]++;
      if (verdict === 'WRONG') wrongs.push({ company: ipo.company_name, status: ipo.status, field: f, ours, oracle: orc });
      lines.push(`${ipo.company_name}\t${ipo.status}\t${f}\t${ours ?? ''}\t${orc ?? ''}\t${verdict}`);
    }
  }

  console.log(`\nours genuine IPOs: ${ipos.length} | matched to oracle: ${matched} | unmatched (SOURCE-UNAVAILABLE all fields): ${unmatched}`);
  console.log('\nper-field verdict (matched IPOs only):');
  for (const f of FIELDS) console.log(`  ${f.padEnd(8)} CORRECT=${tally[f].CORRECT}  WRONG=${tally[f].WRONG}  SRC-UNAVAIL=${tally[f]['SOURCE-UNAVAILABLE']}`);
  console.log(`\nWRONG date values (ours != chittorgarh): ${wrongs.length}`);
  for (const w of wrongs.slice(0, 40)) console.log(`  [${w.status}] ${w.company} ${w.field}: ours=${w.ours} oracle=${w.oracle}`);
  if (wrongs.length > 40) console.log(`  ... +${wrongs.length - 40} more`);

  if (outPath) { writeFileSync(outPath, lines.join('\n')); console.log(`\nmatrix written: ${outPath} (${lines.length - 1} rows)`); }

  // --fix: correct stored dates to the oracle value for confirmed present-vs-present
  // mismatches (the -1-day class). Only writes when the RESULTING full date sequence is
  // coherent (isDateSequenceCoherent), never blindly. dry-run unless --apply.
  if (process.argv.includes('--fix')) {
    const apply = process.argv.includes('--apply');
    console.log(`\n=== DATE CORRECTION (${apply ? 'APPLY' : 'DRY-RUN'}) — oracle-authoritative, coherence-guarded ===`);
    const c2 = new Client({
      host: process.env.DATABASE_HOST, port: parseInt(process.env.DATABASE_PORT || '5432'),
      user: process.env.DATABASE_USER, password: process.env.DATABASE_PASSWORD, database: process.env.DATABASE_NAME,
      ssl: false, connectionTimeoutMillis: 12000,
    });
    await c2.connect();
    let fixed = 0, skipped = 0;
    const COL = { open: 'open_date', close: 'close_date', allot: 'allotment_date', listing: 'listing_date' } as const;
    for (const ipo of ipos) {
      const key = normalizeCompanyNameForMatching(ipo.company_name);
      const o = key ? oracle.get(key) : undefined;
      if (!o) continue;
      // Build the corrected row: oracle value where present + differs from ours.
      const corrected: any = { open: ipo.open, close: ipo.close, allot: ipo.allot, listing: ipo.listing };
      const changes: string[] = [];
      const fillNulls = process.argv.includes('--fill-nulls');
      for (const f of FIELDS) {
        const orc = (o as any)[f]; const ours = ipo[f] ?? null;
        // Correct a present-but-wrong value, OR (with --fill-nulls) fill a NULL from the oracle.
        if (orc !== null && ours !== null && ours !== orc) { corrected[f] = orc; changes.push(f); }
        else if (orc !== null && ours === null && fillNulls) { corrected[f] = orc; changes.push(f); }
      }
      if (changes.length === 0) continue;
      const coh = isDateSequenceCoherent({ openDate: corrected.open, closeDate: corrected.close, allotmentDate: corrected.allot, listingDate: corrected.listing });
      if (!coh.ok) { skipped++; console.log(`  SKIP (incoherent result: ${coh.reason}) ${ipo.company_name}`); continue; }
      if (apply) {
        const sets = changes.map((f, i) => `${(COL as any)[f]} = $${i + 2}`).join(', ');
        await c2.query(`update ipos set ${sets}, updated_at = now() where company_name = $1`, [ipo.company_name, ...changes.map((f) => corrected[f])]);
      }
      fixed++;
      if (fixed <= 30) console.log(`  ${apply ? 'FIXED' : 'would fix'} ${ipo.company_name}: ${changes.map((f) => `${f} ${ipo[f]}→${corrected[f]}`).join(', ')}`);
    }
    console.log(`\n${apply ? 'corrected' : 'would correct'}: ${fixed} IPOs | skipped (incoherent): ${skipped}`);
    await c2.end();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
