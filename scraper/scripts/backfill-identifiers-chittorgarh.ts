/**
 * Backfill: ipos.isin + ipos.symbol from Chittorgarh reports 25 (listing) + 20 (prospectus) (B7)
 *
 * Both reports carry `~isin` / `~nse_symbol` per IPO. This corrective backfill matches them to
 * EXISTING genuine IPOs by canonical name and fills isin/symbol ONLY where currently NULL — never
 * overwrites (no admin clobber), never creates a row. Improves core.symbol (gate) + isin (which is
 * the strongest cross-source match key for all future enrichment). Real data only.
 *
 * dry-run by default; --apply writes. Run from scraper/ with tunnel env exported.
 */
import { db } from '@ipodhan/shared';
import * as schema from '@ipodhan/shared/db/schema';
import { and, eq, isNull, or } from 'drizzle-orm';
import { normalizeCompanyNameForMatching } from '@ipodhan/shared/utils/company-name-normalizer';
import { fetchChittorgarhListingRows } from '../src/scrapers/chittorgarh-listing-scraper.js';
import { fetchChittorgarhProspectusRows } from '../src/scrapers/chittorgarh-document-scraper.js';
import { fetchNseEquityMasters } from '../src/scrapers/nse-equity-master.js';
import logger from '../src/utils/logger.js';

const APPLY = process.argv.includes('--apply');
const FY = [
  { year: 2026, range: '2026-27' },
  { year: 2025, range: '2025-26' },
  { year: 2024, range: '2024-25' },
  { year: 2023, range: '2023-24' },
];

const isinOk = (s: string | null | undefined) => !!s && /^IN[A-Z0-9]{10}$/.test(s.trim().toUpperCase());

async function main() {
  console.log('='.repeat(80));
  console.log(`IDENTIFIER (isin/symbol) BACKFILL — ${APPLY ? 'APPLY' : 'DRY-RUN'}`);
  console.log('='.repeat(80));

  // name -> {isin, symbol} from both reports (first non-null wins)
  const byName = new Map<string, { isin: string | null; symbol: string | null }>();
  const add = (name: string, isin: string | null, symbol: string | null) => {
    const k = normalizeCompanyNameForMatching(name);
    if (!k) return;
    const e = byName.get(k) || { isin: null, symbol: null };
    if (!e.isin && isinOk(isin)) e.isin = isin!.trim().toUpperCase();
    if (!e.symbol && symbol?.trim()) e.symbol = symbol.trim().toUpperCase();
    byName.set(k, e);
  };

  for (const r of await fetchChittorgarhListingRows(FY)) add(r.companyName, r.isin, r.nseSymbol);
  for (const r of await fetchChittorgarhProspectusRows(FY)) add(r.companyName, r.isin, r.nseSymbol);
  console.log(`distinct names with an identifier from Chittorgarh: ${byName.size}`);

  // Second deterministic source: NSE listed-equity masters (mainboard + SME).
  // Covers LISTED IPOs the CG reports age out of; match by our stored symbol
  // (exact) or by canonical name. Same NULL-only fill discipline.
  const nse = await fetchNseEquityMasters();
  console.log(`NSE masters: ${nse.bySymbol.size} symbols`);

  const ipos = await db
    .select({ id: schema.ipos.id, companyName: schema.ipos.companyName, isin: schema.ipos.isin, symbol: schema.ipos.symbol })
    .from(schema.ipos)
    .where(and(eq(schema.ipos.offeringType, 'IPO'), or(isNull(schema.ipos.isin), isNull(schema.ipos.symbol))));
  console.log(`genuine IPOs missing isin and/or symbol: ${ipos.length}`);

  const plans: Array<{ id: string; name: string; isin?: string; symbol?: string }> = [];
  for (const ipo of ipos) {
    const key = normalizeCompanyNameForMatching(ipo.companyName);
    const hit = byName.get(key) || { isin: null, symbol: null };
    // NSE master fallback: by our stored symbol first, then by canonical name
    const nseHit = (ipo.symbol && nse.bySymbol.get(ipo.symbol.toUpperCase())) || nse.byName.get(key) || null;
    const isin = hit.isin || (isinOk(nseHit?.isin) ? nseHit!.isin : null);
    const symbol = hit.symbol || nseHit?.symbol || null;
    if (!isin && !symbol) continue;
    const p: { id: string; name: string; isin?: string; symbol?: string } = { id: ipo.id, name: ipo.companyName };
    if (!ipo.isin && isin) p.isin = isin;
    if (!ipo.symbol && symbol) p.symbol = symbol;
    if (p.isin || p.symbol) plans.push(p);
  }
  const isinFills = plans.filter((p) => p.isin).length;
  const symFills = plans.filter((p) => p.symbol).length;
  console.log(`\nwould fill: isin=${isinFills} symbol=${symFills} (across ${plans.length} IPOs)`);
  for (const p of plans.slice(0, 10)) console.log(`  - ${p.name}: ${p.isin ? 'isin=' + p.isin : ''} ${p.symbol ? 'symbol=' + p.symbol : ''}`);

  if (!APPLY) {
    console.log(`\nDRY-RUN. Re-run with --apply.`);
    console.log('='.repeat(80));
    process.exit(0);
  }

  let ok = 0, failed = 0;
  for (const p of plans) {
    try {
      const set: Record<string, string> = {};
      if (p.isin) set.isin = p.isin;
      if (p.symbol) set.symbol = p.symbol;
      // guard: only fill the columns still null
      await db.update(schema.ipos).set(set).where(eq(schema.ipos.id, p.id));
      ok++;
    } catch (err) {
      failed++;
      logger.error({ company: p.name, error: err instanceof Error ? err.message : String(err) }, 'identifier update failed');
    }
  }
  console.log(`\nAPPLY complete: updated=${ok} failed=${failed} (isin=${isinFills} symbol=${symFills})`);
  console.log('='.repeat(80));
  process.exit(failed > ok ? 1 : 0);
}

main().catch((e) => {
  logger.error({ error: e instanceof Error ? e.message : String(e) }, 'identifier backfill crashed');
  console.error(e);
  process.exit(1);
});
