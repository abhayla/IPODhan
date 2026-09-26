/**
 * Spec field 13 `ipos.sector` from a Chittorgarh IPO detail page (#394, #343, #73).
 *
 * The page carries the IPO's industry as a numeric code in its embedded data
 * (`"ipo_industry":"66"`), and, only when CG has same-industry peers to list,
 * a heading "Recently Listed IPOs in <industry name>". Measured 2026-09-26 on
 * live pages: Runwal Enterprises (code 78) has no heading at all, so the code
 * is the value that is always there, and `scraper/config/sector-list.json`
 * (the fixed sector list of check F1: CG's own code -> name index) names it.
 *
 * Never a guess: no code, a code missing from the fixed list, or a heading that
 * names a DIFFERENT industry than the code maps to all return null — absent
 * stays NULL, never '' (class absence-written-as-a-sentinel-value).
 */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
export const SECTOR_LIST_PATH = join(MODULE_DIR, '..', '..', '..', 'scraper', 'config', 'sector-list.json');

let cachedSectors: ReadonlyMap<string, string> | null = null;

/** The fixed sector list (field 13, check F1): CG industry code -> industry name. */
export function loadSectorList(path: string = SECTOR_LIST_PATH): ReadonlyMap<string, string> {
  if (path === SECTOR_LIST_PATH && cachedSectors) return cachedSectors;
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as { sectors?: Record<string, unknown> };
  const map = new Map<string, string>();
  for (const [code, name] of Object.entries(parsed.sectors ?? {})) {
    if (/^\d+$/.test(code) && typeof name === 'string' && name.trim() !== '') map.set(code, name.trim());
  }
  if (map.size === 0) throw new Error(`sector list ${path} has no sectors`);
  if (path === SECTOR_LIST_PATH) cachedSectors = map;
  return map;
}

function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The detail page is a Next.js page: most markup sits inside JS string
 * literals with `<`/`>` written as < / > and quotes as \". Both the
 * plain and the escaped spellings are matched.
 */
export function extractSectorFromDetailHtml(
  html: string,
  sectors: ReadonlyMap<string, string> = loadSectorList()
): string | null {
  if (!html) return null;

  const codes = new Set<string>();
  for (const m of html.matchAll(/ipo_industry\\?"\s*:\s*\\?"(\d+)\\?"/g)) codes.add(m[1]);
  if (codes.size !== 1) return null;
  const name = sectors.get([...codes][0]);
  if (!name) return null;

  const headings = new Set<string>();
  for (const m of html.matchAll(/Recently Listed IPOs in ([^<\\]+?)\s*(?:<|\\u003c)\/h2/g)) {
    headings.add(decodeEntities(m[1]));
  }
  for (const heading of headings) {
    if (heading.toLowerCase() !== name.toLowerCase()) return null;
  }
  return name;
}

/** One GET of a CG IPO detail page; throws on HTTP failure (the fetcher answers CHECK_FAILED transient with the cause). */
export async function fetchChittorgarhDetailHtml(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
      Referer: 'https://www.chittorgarh.com/',
      Accept: 'text/html,application/xhtml+xml',
    },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`Chittorgarh detail ${url} HTTP ${res.status}`);
  return res.text();
}
