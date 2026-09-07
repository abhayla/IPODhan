/**
 * External-calendar oracle for the reverse sweep (#187, T-461).
 *
 * WHY chittorgarh.com/ipo/ipo_dashboard.asp, not ipowatch.in: the issue
 * text names "ipowatch.in and/or chittorgarh" and requires "a source the
 * scraper does NOT ingest as its primary". ipowatch.in returned no
 * response at all when fetched during this task (curl -m 25 -> exit 28,
 * timeout, both direct and with a browser UA) — DNS/network path issue
 * from this environment, not proven reachable, so it cannot be the sole
 * source without the audit being permanently UNVERIFIABLE. chittorgarh.com
 * IS reachable, but this script deliberately does NOT reuse the JSON API
 * our own chittorgarh-scraper.ts ingests (webnodejs.chittorgarh.com/cloud/
 * report/data-read/...) — it parses the public server-rendered HTML
 * sidebar block on /ipo/ipo_dashboard.asp (and ?a=sme), a page nothing in
 * scraper/src/scrapers fetches. That keeps it an independent oracle: a
 * pipeline bug that corrupts our own DB row (the Mopshop offering_type
 * class) cannot also corrupt this page, because this script never reads
 * our DB or our scraper's API to build the expected set.
 *
 * HONEST LIMIT (round 2, T-461): this is still the same publisher
 * (chittorgarh.com) as the scraper's JSON API, just a different endpoint on
 * it — a presence check (does chittorgarh know about this IPO at all,
 * independent of what our DB says), weaker than a true second source. If
 * chittorgarh itself never lists an IPO, this check cannot find it either.
 *

 * KNOWN GAP (declared, not silently dropped — rule 20): this page lists
 * CURRENT (effectively OPEN) + UPCOMING IPOs only. chittorgarh's "recently
 * listed / closed" report (`/report/ipo-listing-date-check-.../25/mainboard/`)
 * renders its table client-side (empty of /ipo/ links in the raw HTML this
 * task fetched), so the recently-CLOSED (30 day) leg of the issue's scope
 * is NOT covered by this parser today. `fetchOracleCalendar` returns
 * `closedWindowCoverage: 'none'` so callers/reports say so honestly instead
 * of claiming CLOSED coverage they do not have.
 */

const DASHBOARD_URLS = {
  MAINBOARD: 'https://www.chittorgarh.com/ipo/ipo_dashboard.asp',
  SME: 'https://www.chittorgarh.com/ipo/ipo_dashboard.asp?a=sme',
};

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

// Minimal HTML-entity decode for the handful of entities the sidebar block
// actually emits (company names carrying "&", curly quotes, non-breaking
// spaces) — not a general HTML decoder.
function decodeEntities(s) {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&#8217;/g, '’')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"');
}

// Matches one sidebar row: <a ... title="Company Name " href="/ipo/company-slug-ipo/2020/">Company Name ...</a><span ...>date range</span>
const ROW_RE =
  /<a[^>]*\btitle="([^"]+?)\s*"[^>]*\bhref="(\/ipo\/[a-z0-9-]+-ipo\/(\d+)\/)"[^>]*>[\s\S]*?<\/a>(?:<span[^>]*>([^<]*)<\/span>)?/gi;

/**
 * Pure parse: raw dashboard HTML -> external IPO list. No network, no I/O —
 * exercised directly by the self-test fixture (T-461 failing-test-first).
 * @param {string} html
 * @param {'MAINBOARD'|'SME'} segment
 * @returns {Array<{name:string, slug:string, sourceUrl:string, chittorgarhId:string, segment:string, dateRange:string|null}>}
 */
export function parseChittorgarhDashboard(html, segment) {
  if (typeof html !== 'string' || html.length === 0) return [];
  const out = [];
  const seen = new Set();
  let m;
  ROW_RE.lastIndex = 0;
  while ((m = ROW_RE.exec(html)) !== null) {
    const name = decodeEntities(m[1]).replace(/\s+/g, ' ').trim();
    const relHref = m[2];
    const chittorgarhId = m[3];
    const dateRange = m[4] ? m[4].replace(/\s+/g, ' ').trim() : null;
    if (!name || seen.has(relHref)) continue;
    seen.add(relHref);
    out.push({
      name,
      slug: relHref.replace(/^\/ipo\//, '').replace(/\/\d+\/?$/, '').replace(/-ipo$/, ''),
      sourceUrl: `https://www.chittorgarh.com${relHref}`,
      chittorgarhId,
      segment,
      dateRange,
    });
  }
  return out;
}

/**
 * Fetch + parse both dashboard pages (mainboard + SME). Never throws — a
 * fetch failure produces an entry with `ok:false` per segment so the caller
 * can report UNVERIFIABLE rather than crash or silently return an empty,
 * falsely-passing set (issue #187's "FAIL LOUD/unverifiable, never silent
 * pass" requirement).
 * @param {{ fetchImpl?: typeof fetch, timeoutMs?: number }} [opts]
 */
export async function fetchOracleCalendar(opts = {}) {
  const fetchImpl = opts.fetchImpl || fetch;
  const timeoutMs = opts.timeoutMs ?? 25000;
  const segments = {};
  const errors = [];

  for (const [segment, url] of Object.entries(DASHBOARD_URLS)) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetchImpl(url, {
        headers: { 'User-Agent': UA },
        signal: controller.signal,
      });
      if (!res.ok) {
        errors.push(`${segment}: HTTP ${res.status} from ${url}`);
        segments[segment] = { ok: false, entries: [] };
        continue;
      }
      const html = await res.text();
      const entries = parseChittorgarhDashboard(html, segment);
      segments[segment] = { ok: true, entries };
    } catch (e) {
      errors.push(`${segment}: fetch ${url} failed: ${e.message}`);
      segments[segment] = { ok: false, entries: [] };
    } finally {
      clearTimeout(timer);
    }
  }

  const allEntries = [...segments.MAINBOARD.entries, ...segments.SME.entries];
  return {
    entries: allEntries,
    segments,
    errors,
    // true only when BOTH dashboards were fetched successfully — a partial
    // fetch (e.g. SME page down) still returns rows but is not "clean".
    ok: segments.MAINBOARD.ok && segments.SME.ok,
    closedWindowCoverage: 'none',
  };
}
