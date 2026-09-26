import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchReport82CurrentYear } from '../../../scripts/lib/chittorgarh-report82-discovery';

/**
 * #686: the old reader looped `page <= 20` and stopped there even when data
 * continued past it — a FY+category with more than 200 rows (100 offers at
 * the real 5-rows/page size) went silently invisible past that point, and
 * the read still reported success. This test fakes 22 pages of data and
 * asserts the reader reaches page 22 — something the old `page <= 20` cap
 * could never do.
 *
 * Mutation check: restoring the old `for (let page = 1; page <= 20; page++)`
 * cap turns this red (page-22 row absent) — see PR body for the paste.
 *
 * Review round 1 (#688 Tier B): the pagination test above never exercised
 * the ACROSS-PAGE dedupe (`~URLRewrite_Folder_Name` in `seenSlugs`, discovery
 * ~lines 72-76) — no fixture page repeated a slug from an earlier page, so
 * deleting the dedupe block left both tests green. Nor was the missing-key
 * guard (`slug && seenSlugs.has(slug)`) covered — a row with no
 * `~URLRewrite_Folder_Name` is unconditionally kept, unverified. The two
 * tests below close both gaps; each states its mutation and the expected
 * red.
 */
describe('fetchReport82CurrentYear pagination', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.useRealTimers();
  });

  function rowFor(n: number) {
    return {
      Company: `<a href="https://www.chittorgarh.com/ipo/company-${n}-ipo/${1000 + n}/" title="x">Company ${n} Ltd.</a> `,
      '~URLRewrite_Folder_Name': `company-${n}-ipo`,
    };
  }

  it('paginates past the old 20-page cap and reaches page 22, deduping repeated rows', async () => {
    const TOTAL_PAGES = 22;
    let callCount = 0;
    global.fetch = vi.fn(async (url: string) => {
      callCount++;
      const m = String(url).match(/data-read\/82\/(\d+)\//);
      const page = m ? Number(m[1]) : 0;
      let pageRows: unknown[];
      if (page === 1) {
        // page 1 returns company-1 (id 1001) and company-2 — plain, no
        // repeats within the page itself (that path is covered separately
        // below by the "repeated slug across pages" test).
        pageRows = [rowFor(1), rowFor(2)];
      } else if (page >= 2 && page <= TOTAL_PAGES) {
        pageRows = [rowFor(page), rowFor(page + 100)];
      } else {
        pageRows = [];
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ reportTableData: pageRows }),
      } as Response;
    });

    const promise = fetchReport82CurrentYear('sme', 2025);
    // Drain the 300ms inter-page delay for each of the (TOTAL_PAGES + 1) fetches.
    for (let i = 0; i < TOTAL_PAGES + 1; i++) {
      await vi.advanceTimersByTimeAsync(300);
    }
    const rows = await promise;

    const slugs = rows.map((r) => (r as Record<string, unknown>)['~URLRewrite_Folder_Name']);
    // Page 22's rows must be present — the old page<=20 cap would stop before this.
    expect(slugs).toContain('company-22-ipo');
    expect(slugs).toContain('company-122-ipo');
    // company-1-ipo appears once despite being returned on page 1 twice via
    // the duplicate-row shape (same slug repeated) — dedupe collapsed it.
    expect(slugs.filter((s) => s === 'company-1-ipo')).toHaveLength(1);
    // Fetch stopped at the first empty page (23), not the 200-page ceiling.
    expect(callCount).toBe(TOTAL_PAGES + 1);
  });

  it('throws instead of looping forever if 200 pages pass with no empty page and no no-new-rows page (last-resort ceiling)', async () => {
    // Every page returns a genuinely NEW row (unique slug), so neither the
    // empty-page nor the no-new-rows-after-dedupe stop condition can ever
    // fire — this is the shape the 200-page hard ceiling exists to catch.
    global.fetch = vi.fn(async (url: string) => {
      const m = String(url).match(/data-read\/82\/(\d+)\//);
      const page = m ? Number(m[1]) : 0;
      return {
        ok: true,
        status: 200,
        json: async () => ({ reportTableData: [rowFor(page)] }),
      } as Response;
    });

    const promise = fetchReport82CurrentYear('mainboard', 2025);
    const expectation = expect(promise).rejects.toThrow(/200-page hard ceiling/);
    for (let i = 0; i < 205; i++) {
      await vi.advanceTimersByTimeAsync(300);
    }
    await expectation;
  });

  it('collapses a slug that reappears on a later page, including a whole repeated page (FY2026-27 shape)', async () => {
    // Page 1: company-1, company-2. Page 2: company-2 again (cross-page
    // repeat) plus company-3. Page 3: an entire repeat of page 1's rows
    // (the shape chittorgarh serves when a fiscal-year boundary page is
    // re-sent). Page 4: empty (stop).
    const pagesData: Record<number, unknown[]> = {
      1: [rowFor(1), rowFor(2)],
      2: [rowFor(2), rowFor(3)],
      3: [rowFor(1), rowFor(2)],
    };
    global.fetch = vi.fn(async (url: string) => {
      const m = String(url).match(/data-read\/82\/(\d+)\//);
      const page = m ? Number(m[1]) : 0;
      const pageRows = pagesData[page] ?? [];
      return {
        ok: true,
        status: 200,
        json: async () => ({ reportTableData: pageRows }),
      } as Response;
    });

    const promise = fetchReport82CurrentYear('sme', 2025);
    for (let i = 0; i < 4; i++) {
      await vi.advanceTimersByTimeAsync(300);
    }
    const rows = await promise;
    const slugs = rows.map((r) => (r as Record<string, unknown>)['~URLRewrite_Folder_Name']);

    // Mutation: deleting the `if (slug && seenSlugs.has(slug)) { dupes++;
    // continue; }` block (discovery ~lines 72-76) makes company-2 appear
    // twice (page 1 + page 2) and the whole page-3 repeat land again —
    // turning each of these three assertions red.
    expect(slugs.filter((s) => s === 'company-1-ipo')).toHaveLength(1);
    expect(slugs.filter((s) => s === 'company-2-ipo')).toHaveLength(1);
    expect(slugs.filter((s) => s === 'company-3-ipo')).toHaveLength(1);
    expect(rows).toHaveLength(3);
  });

  it('stops after page 2 when the endpoint serves the SAME full dataset on every page number (#695, FY2026-27 shape)', async () => {
    // FY2026-27 live shape: report 82 ignores the page number entirely and
    // serves the identical full page every time, so no page is ever empty
    // and the old "stop on empty page" condition can never fire. The walk
    // must instead stop as soon as a page adds ZERO new rows after dedupe —
    // here that is page 2, whose two rows are both already-seen from page 1.
    const SAME_PAGE = [rowFor(1), rowFor(2)];
    let callCount = 0;
    global.fetch = vi.fn(async () => {
      callCount++;
      return {
        ok: true,
        status: 200,
        json: async () => ({ reportTableData: SAME_PAGE }),
      } as Response;
    });

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const promise = fetchReport82CurrentYear('sme', 2026);
    // Only 2 fetches needed: page 1 (2 new rows), page 2 (0 new rows -> stop).
    for (let i = 0; i < 2; i++) {
      await vi.advanceTimersByTimeAsync(300);
    }
    const rows = await promise;
    const slugs = rows.map((r) => (r as Record<string, unknown>)['~URLRewrite_Folder_Name']);

    // Mutation: reverting to "stop only on an empty page" makes this walk
    // never stop within 2 calls (it would keep fetching the same non-empty
    // page until the 200-page ceiling), turning callCount and the stop-log
    // assertions red.
    expect(callCount).toBe(2);
    expect(slugs).toEqual(['company-1-ipo', 'company-2-ipo']);
    expect(rows).toHaveLength(2);
    const logged = logSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(logged).toMatch(/no new rows after dedupe/);
    logSpy.mockRestore();
  });

  it('keeps every row missing ~URLRewrite_Folder_Name instead of collapsing them into one', async () => {
    // Two rows with no slug key at all, on the same page.
    const noKeyRows = [
      { Company: rowFor(1).Company },
      { Company: rowFor(2).Company },
    ];
    global.fetch = vi.fn(async (url: string) => {
      const m = String(url).match(/data-read\/82\/(\d+)\//);
      const page = m ? Number(m[1]) : 0;
      const pageRows = page === 1 ? noKeyRows : [];
      return {
        ok: true,
        status: 200,
        json: async () => ({ reportTableData: pageRows }),
      } as Response;
    });

    const promise = fetchReport82CurrentYear('mainboard', 2025);
    for (let i = 0; i < 2; i++) {
      await vi.advanceTimersByTimeAsync(300);
    }
    const rows = await promise;

    // Mutation: changing the guard to treat a missing key as the empty-string
    // key (e.g. `seenSlugs.has(slug ?? '')` unconditionally, dropping the
    // `slug &&` truthiness check) makes the second no-key row look like a
    // repeat of the first and collapses 2 rows to 1 — this assertion goes red.
    expect(rows).toHaveLength(2);
  });
});
