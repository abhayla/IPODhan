/**
 * Report-82 discovery fallback (P3-7, round-4 review, T-293), shared by the
 * per-field Chittorgarh-detail-page backfill scripts (`backfill-lot-size-
 * chittorgarh-detail.ts`, `backfill-registrar-chittorgarh-detail.ts`,
 * `backfill-issue-size-chittorgarh-detail.ts`).
 *
 * Root cause: those scripts discover a genuine IPO's detail-page slug+id
 * ONLY from report 118 (full historical) — but report 118 carries an IPO
 * only once it has actually opened/listed. A not-yet-open issue (e.g. Kwick
 * Forensic Solutions, Lumino Industries — both open 2026-08-27 at the time
 * of this fix) is invisible to it, even though Chittorgarh already publishes
 * its detail page (lot size, registrar) days ahead of the open date. Report
 * 82 — the SAME report `chittorgarh-scraper.ts` uses to discover IPOs at
 * all — covers the current fiscal year INCLUDING upcoming issues, so it
 * closes the discovery gap without touching either field's (already-correct)
 * extractor.
 *
 * Fix (#686, 2026-09-16): the reader looped `page <= 20` at an assumed
 * page size of 10, i.e. a 200-row ceiling — but the live endpoint returns 5
 * rows/page regardless of the `/10/` path segment, so the REAL ceiling was
 * 100 rows/offers, and it silently stopped there instead of reaching the end
 * of the fiscal year. Measured against the live endpoint on 2026-09-16:
 * FY2025-26 SME alone runs to page 54 (267 rows), FY2025-26 mainboard to
 * page 21 (103 rows), FY2024-25 SME past page 45 — all three already over
 * the old cap. The reader paginates until the first empty page, dedupes rows
 * by `~URLRewrite_Folder_Name` (the slug — the only stable per-company key
 * report 82 exposes; there is no separate numeric id field on the row
 * itself, only the one embedded in the `Company` anchor href, which is a
 * per-company constant, not a page artifact), and stops (hard ceiling 200
 * pages, to fail loud instead of looping forever if the upstream shape
 * changes again).
 *
 * Fix (#695, 2026-09-26): FY2026-27 broke a different assumption — the
 * endpoint serves the SAME full dataset on every page number (82 mainboard
 * / 149 SME rows), so no page is EVER empty and the "stop on empty page"
 * condition can never fire; the reader made 200 requests per category and
 * threw at the ceiling. The real end-of-data signal is a page that adds
 * ZERO NEW rows after dedupe — that covers both shapes (an empty page has
 * zero new rows trivially; a repeated full page has zero new rows because
 * every row was already seen) — so the walk now stops there, names which
 * stop condition ended it (empty page / no-new-rows dedupe / hard ceiling),
 * and the ceiling stays as the last-resort guard against a shape neither
 * condition catches.
 */

export interface DiscoveryEntry {
  slug: string;
  id: string;
}

const MAX_REPORT82_PAGES = 200;

/** Fetch report 82 (mainboard or SME) for a given Indian fiscal year, paginated to the end. */
export async function fetchReport82CurrentYear(
  category: 'mainboard' | 'sme',
  year?: number
): Promise<unknown[]> {
  const resolvedYear = year ?? (() => {
    const now = new Date();
    return now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  })();
  const range = `${resolvedYear}-${String((resolvedYear + 1) % 100).padStart(2, '0')}`;
  const rows: unknown[] = [];
  const seenSlugs = new Set<string>();
  let dupes = 0;
  let page = 1;
  let stopCondition: 'empty page' | 'no new rows after dedupe' | null = null;
  for (; page <= MAX_REPORT82_PAGES; page++) {
    const u = `https://webnodejs.chittorgarh.com/cloud/report/data-read/82/${page}/10/${resolvedYear}/${range}/0/${category}/0?search=&v=15-11`;
    const r = await fetch(u, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        Referer: 'https://www.chittorgarh.com/',
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(20000),
    });
    if (!r.ok) throw new Error(`report 82 HTTP ${r.status}`);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const d: any = await r.json();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pageRows: any[] = d?.reportTableData ?? [];
    if (!pageRows.length) {
      stopCondition = 'empty page';
      break;
    }
    let newRowsThisPage = 0;
    for (const row of pageRows) {
      const slug = row?.['~URLRewrite_Folder_Name'] ? String(row['~URLRewrite_Folder_Name']) : '';
      if (slug && seenSlugs.has(slug)) {
        dupes++;
        continue;
      }
      if (slug) seenSlugs.add(slug);
      rows.push(row);
      newRowsThisPage++;
    }
    // FY2026-27 shape (#695): the endpoint can serve the SAME non-empty page
    // forever, so an empty page is never guaranteed. A page whose rows are
    // ALL already-seen (zero new after dedupe) is the same "no more data"
    // signal as an empty page — stop here instead of walking to the ceiling.
    if (newRowsThisPage === 0) {
      stopCondition = 'no new rows after dedupe';
      break;
    }
    await new Promise((res) => setTimeout(res, 300));
  }
  if (page > MAX_REPORT82_PAGES) {
    throw new Error(
      `report 82 ${range} ${category}: hit the ${MAX_REPORT82_PAGES}-page hard ceiling without an empty page or a no-new-rows page — refusing to loop forever`
    );
  }
  // eslint-disable-next-line no-console
  console.log(
    `report82 ${range} ${category}: ${page} pages, ${rows.length} rows (${dupes} duplicate rows collapsed), stopped on: ${stopCondition}`
  );
  return rows;
}

/** Extract {name,slug,id} from a report-82 row's `Company` anchor href + `~URLRewrite_Folder_Name`. */
export function parseReport82DiscoveryEntry(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  row: any
): { name: string; slug: string; id: string } | null {
  const name = row?.Company ? String(row.Company) : '';
  const slug = row?.['~URLRewrite_Folder_Name'] ? String(row['~URLRewrite_Folder_Name']) : '';
  if (!name || !slug) return null;
  const m = name.match(/\/ipo\/[^/"]+\/(\d+)\/["']/);
  if (!m) return null;
  return { name, slug, id: m[1] };
}

/**
 * Fill gaps in an existing report-118 discovery map using report 82
 * (mainboard + SME, current fiscal year). Only adds a name the discovery map
 * does not already have — report 118 stays authoritative where both agree.
 */
export async function fillDiscoveryGapsFromReport82(
  discovery: Map<string, DiscoveryEntry>,
  normalizeCompanyNameForMatching: (name: string) => string,
  onWarn: (category: string, error: unknown) => void
): Promise<number> {
  let added = 0;
  for (const cat of ['mainboard', 'sme'] as const) {
    try {
      const rows = await fetchReport82CurrentYear(cat);
      for (const row of rows) {
        const parsed = parseReport82DiscoveryEntry(row);
        if (!parsed) continue;
        const key = normalizeCompanyNameForMatching(parsed.name);
        if (key && !discovery.has(key)) {
          discovery.set(key, { slug: parsed.slug, id: parsed.id });
          added++;
        }
      }
    } catch (err) {
      onWarn(cat, err);
    }
  }
  return added;
}
