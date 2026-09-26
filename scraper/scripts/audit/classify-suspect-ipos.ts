/**
 * Suspect-IPO classifier (read-only). The corp-action pollution class (#23 recurrence):
 * rows with offering_type='IPO', status='CLOSED', listing_date NULL are either
 * (a) corporate actions (buyback/tender/rights/NCD) mis-ingested by the legacy BSE
 * HTML scraper (its type-mapper never knew BSE's short codes OTB/DPI/RI), or
 * (b) genuine recent IPOs awaiting listing / stuck CLOSED.
 *
 * Evidence per row (deterministic, no fabrication):
 *   1. BSE current public-issues API IR_flag (authoritative, live issues only)
 *   2. NSE equity masters (mainboard EQUITY_L.csv + SME_EQUITY_L.csv): a listing
 *      date well BEFORE our open_date proves the company was already listed
 *   3. Chittorgarh IPO universe (report-118 timetable across FYs + report-25
 *      listing rows): membership proves a genuine IPO exists under that name
 *
 * Verdicts: CORP_ACTION_<TYPE> (BSE IR_flag) | ALREADY_LISTED (NSE master) |
 *           ALREADY_LISTED_BSE | DEBT_ISSUER_BSE | GENUINE_IPO (CG universe or
 *           fresh NSE listing) | NO_EVIDENCE.
 *
 * The script is READ-ONLY, always (#1051). `--depollute delete|reclass` prints the
 * rows each mode WOULD act on (proven-not-IPO verdicts: ALREADY_LISTED /
 * ALREADY_LISTED_BSE / CORP_ACTION_BSE_* / DEBT_ISSUER_BSE; reclass only where a
 * type is derivable) and writes nothing; `--apply` is refused. Why: spec OD-116
 * says an `ipos` row is never deleted (a wrong row is HIDDEN with a reason
 * through the OD-8/OD-53 freeze, keeping its identifiers so the scraper does
 * not recreate it), and the only sanctioned way to remove a row is the gated,
 * logged, undoable merge `IPORepository.mergeDuplicateInto` (section 2.3.3.3,
 * OD-38, OD-92). The raw `delete` and `update` this script used to run bypassed
 * both. NO_EVIDENCE and GENUINE_IPO* rows are never listed.
 *
 * Env: DATABASE_HOST/PORT/USER/PASSWORD/NAME (tunnel). Run:
 *   npx tsx scripts/audit/classify-suspect-ipos.ts [--out suspects.tsv]
 *   npx tsx scripts/audit/classify-suspect-ipos.ts --depollute delete|reclass   # report only
 */
import { Client } from 'pg';
import { writeFileSync } from 'fs';
import { normalizeCompanyNameForMatching } from '@ipodhan/shared/utils/company-name-normalizer';
import { detectOfferingTypeFromBSEIRFlag } from '../../src/utils/detect-offering-type.js';
import { fetchChittorgarhListingRows } from '../../src/scrapers/chittorgarh-listing-scraper.js';
import { fetchNseEquityMasters } from '../../src/scrapers/nse-equity-master.js';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)';
const FYS = [
  { year: 2026, range: '2026-27' }, { year: 2025, range: '2025-26' },
  { year: 2024, range: '2024-25' }, { year: 2023, range: '2023-24' },
  { year: 2022, range: '2022-23' }, { year: 2021, range: '2021-22' },
  { year: 2020, range: '2020-21' },
];

async function fetchReport118Names(): Promise<Set<string>> {
  const names = new Set<string>();
  for (const fy of FYS) {
    try {
      const u = `https://webnodejs.chittorgarh.com/cloud/report/data-read/118/1/10/${fy.year}/${fy.range}/0/all/0?search=&v=15-11`;
      const r = await fetch(u, {
        headers: { 'User-Agent': UA, Referer: 'https://www.chittorgarh.com/', Accept: 'application/json' },
        signal: AbortSignal.timeout(25000),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      for (const row of (await r.json())?.reportTableData ?? []) {
        const key = normalizeCompanyNameForMatching(String(row?.Company ?? ''));
        if (key) names.add(key);
      }
      await new Promise((res) => setTimeout(res, 400));
    } catch (e) {
      console.log(`report118 ${fy.range} fetch failed: ${(e as Error).message}`);
    }
  }
  return names;
}

type BSECurrent = { irFlag: string; irFlagFull: string };
async function fetchBSECurrent(): Promise<Map<string, BSECurrent>> {
  const out = new Map<string, BSECurrent>();
  try {
    const r = await fetch('https://api.bseindia.com/BseIndiaAPI/api/IPO_HomePageDetail/w?Type=P', {
      headers: { 'User-Agent': UA, Referer: 'https://www.bseindia.com/', Accept: 'application/json' },
      signal: AbortSignal.timeout(25000),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    for (const row of (await r.json())?.Table ?? []) {
      const key = normalizeCompanyNameForMatching(String(row?.Scrip_name ?? ''));
      if (key) out.set(key, { irFlag: String(row?.IR_flag ?? ''), irFlagFull: String(row?.IR_FLAG_FULL ?? '') });
    }
  } catch (e) {
    console.log(`BSE current API fetch failed: ${(e as Error).message}`);
  }
  return out;
}

/** BSE scrip master (a segment, ALL statuses — suspended/delisted included: takeover and
 *  rights targets are often suspended scrips). Name + scrip_id membership; used jointly
 *  with CG-universe absence to prove "already listed / debt issuer, not an equity IPO". */
async function fetchBseMaster(segment: 'Equity' | 'Debt'): Promise<{ byName: Set<string>; byScripId: Set<string> }> {
  const byName = new Set<string>();
  const byScripId = new Set<string>();
  try {
    const r = await fetch(
      `https://api.bseindia.com/BseIndiaAPI/api/ListofScripData/w?Group=&Scripcode=&industry=&segment=${segment}&status=`,
      { headers: { 'User-Agent': UA, Referer: 'https://www.bseindia.com/', Accept: 'application/json' }, signal: AbortSignal.timeout(60000) }
    );
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    for (const row of (await r.json()) ?? []) {
      for (const n of [row?.Scrip_Name, row?.Issuer_Name]) {
        const key = normalizeCompanyNameForMatching(String(n ?? ''));
        if (key) byName.add(key);
      }
      const sid = String(row?.scrip_id ?? '').toUpperCase();
      if (sid) byScripId.add(sid);
    }
    console.log(`BSE ${segment} master: ${byName.size} names`);
  } catch (e) {
    console.log(`BSE ${segment} master fetch failed: ${(e as Error).message}`);
  }
  return { byName, byScripId };
}

const daysBetween = (aIso: string, bIso: string) =>
  Math.round((Date.parse(bIso) - Date.parse(aIso)) / 86_400_000);

async function main() {
  const outArg = process.argv.indexOf('--out');
  const outPath = outArg > -1 ? process.argv[outArg + 1] : null;

  // Fail fast on missing DB env — falling through to pg defaults silently targets localhost.
  for (const k of ['DATABASE_HOST', 'DATABASE_USER', 'DATABASE_PASSWORD', 'DATABASE_NAME']) {
    if (!process.env[k]) throw new Error(`Missing required env var: ${k}`);
  }

  const [cg118, cg25Rows, bseCurrent, nse, bseMaster, bseDebt] = await Promise.all([
    fetchReport118Names(),
    fetchChittorgarhListingRows(FYS),
    fetchBSECurrent(),
    fetchNseEquityMasters(),
    fetchBseMaster('Equity'),
    fetchBseMaster('Debt'),
  ]);
  const cg25 = new Set<string>();
  for (const r of cg25Rows) {
    const key = normalizeCompanyNameForMatching(r.companyName);
    if (key) cg25.add(key);
  }
  console.log(`evidence: cg118=${cg118.size} cg25=${cg25.size} bseCurrent=${bseCurrent.size} nseMaster=${nse.bySymbol.size}`);

  const c = new Client({
    host: process.env.DATABASE_HOST, port: parseInt(process.env.DATABASE_PORT || '5432'),
    user: process.env.DATABASE_USER, password: process.env.DATABASE_PASSWORD, database: process.env.DATABASE_NAME,
    ssl: false, connectionTimeoutMillis: 12000,
  });
  await c.connect();
  const { rows: suspects } = await c.query(
    `select id, company_name, symbol, segment,
            to_char(open_date,'YYYY-MM-DD') open, to_char(created_at,'YYYY-MM-DD') created
     from ipos
     where offering_type='IPO' and status='CLOSED' and listing_date is null
     order by created_at`);
  await c.end();
  console.log(`suspects (IPO + CLOSED + listing_date null): ${suspects.length}\n`);

  const lines = ['company\tsymbol\topen\tcreated\tcg118\tcg25\tbse_ir_flag\tnse_listing\tnse_board\tbse_listed\tverdict\treclass_to'];
  const tally: Record<string, number> = {};
  const verdictRows: Array<{ id: string; name: string; verdict: string; reclassTo: string }> = [];
  for (const s of suspects) {
    const key = normalizeCompanyNameForMatching(s.company_name);
    const inCg118 = cg118.has(key);
    const inCg25 = cg25.has(key);
    const bse = bseCurrent.get(key);
    const nseHit = (s.symbol && nse.bySymbol.get(String(s.symbol).toUpperCase())) || nse.byName.get(key) || null;
    const listedDaysBeforeOpen = nseHit?.listingIso && s.open ? daysBetween(nseHit.listingIso, s.open) : null;
    const onBseMaster = bseMaster.byName.has(key) || (s.symbol ? bseMaster.byScripId.has(String(s.symbol).toUpperCase()) : false);

    let verdict = 'NO_EVIDENCE';
    let reclassTo = '';
    const bseNonIpoFlag = bse && bse.irFlag && bse.irFlag !== 'IPO';
    const bseMapped = bseNonIpoFlag ? detectOfferingTypeFromBSEIRFlag(bse!.irFlag, bse!.irFlagFull) : null;
    if (bseNonIpoFlag && (inCg118 || inCg25)) {
      // A live corp-action flag only proves what the company is doing NOW; CG-universe
      // membership proves a genuine IPO existed. Conflicting evidence -> never touch.
      verdict = 'EVIDENCE_CONFLICT';
    } else if (bseNonIpoFlag && bseMapped === null) {
      // Unknown flag (e.g. CMN): the mapper refuses to classify — so do we (never a delete target).
      verdict = 'BSE_FLAG_UNKNOWN';
    } else if (bseNonIpoFlag) {
      verdict = `CORP_ACTION_BSE_${bse!.irFlag}`;
      reclassTo = bseMapped!;
    } else if (listedDaysBeforeOpen !== null && listedDaysBeforeOpen > 90) {
      // company listed on NSE >90d before this "IPO" opened -> provably not a new listing
      verdict = 'ALREADY_LISTED';
    } else if (inCg118 || inCg25 || (bse && bse.irFlag === 'IPO')) {
      verdict = 'GENUINE_IPO';
    } else if (nseHit?.listingIso && listedDaysBeforeOpen !== null && listedDaysBeforeOpen <= 90) {
      // freshly listed on NSE around/after our open date -> genuine IPO whose listing we missed
      verdict = 'GENUINE_IPO_LISTED_RECENTLY';
    } else if (onBseMaster) {
      // BSE-equity-listed AND absent from the CG IPO universe across 7 FYs -> corp action
      // of an already-listed BSE company (the takeover/rights class the HTML scraper ingested)
      verdict = 'ALREADY_LISTED_BSE';
    } else if (bseDebt.byName.has(key) || (s.symbol ? bseDebt.byScripId.has(String(s.symbol).toUpperCase()) : false)) {
      // issuer has BSE-listed debt AND no CG IPO across 7 FYs -> this "IPO" is a public NCD issue (DPI)
      verdict = 'DEBT_ISSUER_BSE';
      reclassTo = 'NCD';
    }
    tally[verdict] = (tally[verdict] ?? 0) + 1;
    verdictRows.push({ id: s.id, name: s.company_name, verdict, reclassTo });
    lines.push([
      s.company_name, s.symbol ?? '', s.open ?? '', s.created,
      inCg118 ? 'Y' : '', inCg25 ? 'Y' : '',
      bse ? `${bse.irFlag}(${bse.irFlagFull})` : '',
      nseHit?.listingIso ?? '', nseHit?.board ?? '', onBseMaster ? 'Y' : '',
      verdict, reclassTo,
    ].join('\t'));
  }

  console.log('verdict tally:');
  for (const [v, n] of Object.entries(tally).sort((a, b) => b[1] - a[1])) console.log(`  ${v.padEnd(30)} ${n}`);
  if (outPath) { writeFileSync(outPath, lines.join('\n')); console.log(`\nTSV written: ${outPath}`); }

  // ---- De-pollution REPORT (read-only; #1051, OD-116) ----
  const depArg = process.argv.indexOf('--depollute');
  if (depArg === -1) return;
  const mode = process.argv[depArg + 1];
  if (mode !== 'delete' && mode !== 'reclass') throw new Error(`--depollute needs delete|reclass, got: ${mode}`);
  if (process.argv.includes('--apply')) {
    throw new Error(
      '--apply is refused: this audit script never writes ipos (#1051). OD-116: an ipos row is never deleted; ' +
        'hide a wrong row through the OD-8/OD-53 freeze, and merge a true duplicate with ' +
        'scraper/scripts/repair-merge-duplicate-ipo.ts (the gated, logged, undoable merge).'
    );
  }

  // Minimum-evidence gate: the CG fetchers swallow per-FY failures, so a CG outage would strip
  // every genuine IPO of its GENUINE_IPO evidence and flip it to ALREADY_LISTED_BSE. A report built
  // on degraded evidence would name genuine IPOs as not-IPO, so refuse it.
  const degraded: string[] = [];
  if (cg118.size < 500) degraded.push(`cg118=${cg118.size} (<500)`);
  if (cg25.size < 500) degraded.push(`cg25=${cg25.size} (<500)`);
  if (nse.bySymbol.size < 1500) degraded.push(`nseMaster=${nse.bySymbol.size} (<1500)`);
  if (bseMaster.byName.size < 4000) degraded.push(`bseEquityMaster=${bseMaster.byName.size} (<4000)`);
  if (bseDebt.byName.size < 1000) degraded.push(`bseDebtMaster=${bseDebt.byName.size} (<1000)`);
  if (degraded.length > 0) {
    throw new Error(`DEPOLLUTE REPORT REFUSED — evidence degraded/incomplete: ${degraded.join(', ')}. Fix the source fetches and re-run.`);
  }

  const provenNotIpo = (v: string) =>
    v === 'ALREADY_LISTED' || v === 'ALREADY_LISTED_BSE' || v === 'DEBT_ISSUER_BSE' || v.startsWith('CORP_ACTION_BSE_');
  const targets = verdictRows.filter((r) =>
    mode === 'delete' ? provenNotIpo(r.verdict) : provenNotIpo(r.verdict) && r.reclassTo
  );
  console.log(`
=== DEPOLLUTE ${mode.toUpperCase()} — REPORT ONLY (nothing is written) — ${targets.length} rows ===`);
  for (const t of targets) console.log(`  ${mode === 'delete' ? 'NOT-IPO' : `RECLASS -> ${t.reclassTo}`}  [${t.verdict}] ${t.name} (${t.id})`);
}

main().catch((e) => { console.error(e); process.exit(1); });
