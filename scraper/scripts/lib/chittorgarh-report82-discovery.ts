/**
 * Report-82 discovery fallback (P3-7, round-4 review, T-293), shared by the
 * per-field Chittorgarh-detail-page backfill scripts (`backfill-lot-size-
 * chittorgarh-detail.ts`, `backfill-registrar-chittorgarh-detail.ts`).
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
 */

export interface DiscoveryEntry {
  slug: string;
  id: string;
}

/** Fetch report 82 (mainboard or SME) for the current Indian fiscal year, paginated. */
export async function fetchReport82CurrentYear(category: 'mainboard' | 'sme'): Promise<unknown[]> {
  const now = new Date();
  const year = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  const range = `${year}-${String((year + 1) % 100).padStart(2, '0')}`;
  const rows: unknown[] = [];
  for (let page = 1; page <= 20; page++) {
    const u = `https://webnodejs.chittorgarh.com/cloud/report/data-read/82/${page}/10/${year}/${range}/0/${category}/0?search=&v=15-11`;
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
    if (!pageRows.length) break;
    rows.push(...pageRows);
    await new Promise((res) => setTimeout(res, 300));
  }
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
