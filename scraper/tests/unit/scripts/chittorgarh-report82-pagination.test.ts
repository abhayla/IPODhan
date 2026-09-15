import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchReport82CurrentYear } from '../../../scripts/lib/chittorgarh-report82-discovery';

/**
 * #686: the old reader looped `page <= 20` and stopped there even when data
 * continued past it — a FY+category with more than 200 rows (100 offers at
 * the real 5-rows/page size) went silently invisible past that point, and
 * the read still reported success. This test fakes 22 pages of data (page 1
 * repeats as a duplicate to exercise the dedupe path) and asserts the reader
 * reaches page 22 — something the old `page <= 20` cap could never do.
 *
 * Mutation check: restoring the old `for (let page = 1; page <= 20; page++)`
 * cap turns this red (page-22 row absent) — see PR body for the paste.
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
        // page 1 repeats company-1 (id 1001) AND introduces company-2 —
        // exercises the "duplicate rows on repeat page" dedupe path.
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

  it('throws instead of looping forever if 200 pages pass with no empty page', async () => {
    global.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ reportTableData: [rowFor(1)] }),
    })) as unknown as typeof fetch;

    const promise = fetchReport82CurrentYear('mainboard', 2025);
    const expectation = expect(promise).rejects.toThrow(/200-page hard ceiling/);
    for (let i = 0; i < 205; i++) {
      await vi.advanceTimersByTimeAsync(300);
    }
    await expectation;
  });
});
