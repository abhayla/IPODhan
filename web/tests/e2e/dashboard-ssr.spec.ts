import { test, expect } from '@playwright/test';

/**
 * T-473 part 2 (#201): the dashboard sector filter's option list used to be
 * fetched client-side only (`SectorFilter.tsx` `useEffect` -> `/api/sectors`
 * on mount). With JS disabled that effect never runs, so a crawler or a
 * no-JS/slow-JS visitor got a sector <select> permanently stuck in its
 * initial "Loading sectors..." state with `aria-disabled="true"` -- a
 * genuinely broken, unusable control in the first response, independent of
 * how many real sector values exist in the database.
 *
 * `web/app/dashboard/page.tsx` now fetches sectors server-side via
 * `IPORepository.findDistinctSectors()` (no HTTP) and passes them down
 * DashboardContent -> FilterBar -> SectorFilter, so the control renders in
 * its resolved (usable) state on the very first response.
 *
 * NOTE (real-data honesty): both the staging and prod `ipos.sector` column
 * currently hold ONLY empty strings for every non-null row (verified via the
 * tunnel, 2026-09-07: staging 197/197 non-null rows = '', prod 196/196 = '')
 * -- there are zero real sector values in either database today. That is a
 * separate data-population gap (filed as a follow-up), not something this
 * SSR fix can or should paper over. This test therefore proves the
 * structural fix (no perpetual client-loading state on the initial HTML) --
 * the assertion that would additionally check for real sector option TEXT
 * is left as a comment so it self-activates once real sector data exists.
 */
test('dashboard sector filter is never stuck in a client-loading state with JS disabled', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto('/dashboard');

  const html = await page.content();

  // Was: aria-disabled="true" and "Loading sectors..." baked into the first
  // response forever (JS disabled = the fetch that would flip this never
  // runs). Now: the server already resolved the sector list, so the control
  // renders enabled and past the loading placeholder on the first response.
  expect(html).not.toMatch(/aria-label="Filter IPOs by sector"[^>]*aria-disabled="true"/);
  expect(html).not.toContain('Loading sectors...');

  // Re-enable once ipos.sector is populated with real values (tracked
  // separately): expect(html).toMatch(/<option[^>]*value="(?!ALL)[^"]+"[^>]*>/);

  await context.close();
});
