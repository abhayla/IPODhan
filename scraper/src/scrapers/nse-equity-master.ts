/**
 * NSE listed-equity masters (mainboard EQUITY_L.csv + SME_EQUITY_L.csv).
 *
 * Deterministic public source for: symbol -> {isin, listing date, name}, used by
 * (a) the identifier backfill (isin/symbol for genuine IPOs the CG reports miss),
 * (b) the suspect-IPO classifier (a listing date well before an "IPO"'s open date
 *     proves the company was already listed — corp-action pollution evidence).
 */
import { normalizeCompanyNameForMatching } from '@ipodhan/shared/utils/company-name-normalizer';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)';

export interface NseMasterRow {
  symbol: string;
  name: string;
  /** ISO day (YYYY-MM-DD) or '' when unparseable */
  listingIso: string;
  isin: string;
  board: 'MAIN' | 'SME';
}

const MONTHS: Record<string, string> = {
  JAN: '01', FEB: '02', MAR: '03', APR: '04', MAY: '05', JUN: '06',
  JUL: '07', AUG: '08', SEP: '09', OCT: '10', NOV: '11', DEC: '12',
};

/** "06-OCT-2008" | "01-Jul-26" -> ISO day (2-digit years are 20xx). */
export function parseNseListingDate(v: string): string {
  const m = v.trim().match(/^(\d{1,2})-([A-Za-z]{3})-(\d{2,4})$/);
  if (!m) return '';
  const yr = m[3].length === 2 ? `20${m[3]}` : m[3];
  const mo = MONTHS[m[2].toUpperCase()];
  return mo ? `${yr}-${mo}-${m[1].padStart(2, '0')}` : '';
}

export async function fetchNseEquityMasters(): Promise<{
  bySymbol: Map<string, NseMasterRow>;
  byName: Map<string, NseMasterRow>;
}> {
  const bySymbol = new Map<string, NseMasterRow>();
  const byName = new Map<string, NseMasterRow>();
  const sources: Array<{ url: string; board: 'MAIN' | 'SME' }> = [
    { url: 'https://nsearchives.nseindia.com/content/equities/EQUITY_L.csv', board: 'MAIN' },
    { url: 'https://nsearchives.nseindia.com/emerge/corporates/content/SME_EQUITY_L.csv', board: 'SME' },
  ];
  for (const s of sources) {
    try {
      const r = await fetch(s.url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(30000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const rows = (await r.text()).split(/\r?\n/).filter(Boolean).map((line) => line.split(',').map((c) => c.trim()));
      const header = rows[0].map((h) => h.replace(/\s+/g, '_').toUpperCase());
      const idx = (n: string) => header.findIndex((h) => h.includes(n));
      const iSym = idx('SYMBOL'), iName = idx('NAME'), iDate = idx('DATE_OF_LISTING'), iIsin = idx('ISIN');
      for (const row of rows.slice(1)) {
        const rec: NseMasterRow = {
          symbol: (row[iSym] ?? '').toUpperCase(),
          name: row[iName] ?? '',
          listingIso: parseNseListingDate(row[iDate] ?? ''),
          isin: (row[iIsin] ?? '').toUpperCase(),
          board: s.board,
        };
        if (!rec.symbol) continue;
        if (!bySymbol.has(rec.symbol)) bySymbol.set(rec.symbol, rec);
        const key = normalizeCompanyNameForMatching(rec.name);
        if (key && !byName.has(key)) byName.set(key, rec);
      }
    } catch (e) {
      console.log(`NSE master ${s.board} fetch failed: ${(e as Error).message}`);
    }
  }
  return { bySymbol, byName };
}
