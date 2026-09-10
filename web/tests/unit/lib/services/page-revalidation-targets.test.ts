/**
 * Item 21 slice 2 — the list of pages a cycle refreshes must not be able to go
 * stale silently.
 *
 * §2.11 says the endpoint "revalidates those IPO pages and the list pages" and
 * names four: `/`, `/mainboard-ipos`, `/sme-ipos`, the sitemap. This repository
 * has 29 page routes, of which far more than four are driven by IPO rows —
 * `/mainboard-ipo-calendar`, `/sme-ipo-listings`, `/ofs`, `/ncd`,
 * `/rights-issues` and others. Shipping the four named would leave a corrected
 * IPO fixed on its own page and stale on the calendar that links to it.
 *
 * Guessing a longer list has the same failure one release later, when somebody
 * adds a page. So the list is not a guess and not a wildcard: EVERY page route
 * is classified, either as refreshed or as explicitly excluded WITH A REASON,
 * and this test fails when a route is neither. A new page cannot be added
 * without someone deciding which it is.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, statSync } from 'fs';
import { join, sep } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { REVALIDATED_PATHS, NOT_REVALIDATED } from '@/lib/services/page-revalidation-targets';

const here = dirname(fileURLToPath(import.meta.url));
const APP_DIR = join(here, '../../../../app');

/** Every static page route under app/, as the path a visitor types. */
function pageRoutes(dir: string, prefix = ''): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === 'api' || entry === 'admin') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      // Dynamic segments ([slug]) are revalidated per slug, not as a fixed path.
      if (entry.startsWith('[')) continue;
      out.push(...pageRoutes(full, `${prefix}/${entry}`));
    } else if (entry === 'page.tsx') {
      out.push(prefix === '' ? '/' : prefix);
    }
  }
  return out.map((p) => p.split(sep).join('/'));
}

describe('every page route is classified', () => {
  const routes = pageRoutes(APP_DIR);

  it('found a realistic number of routes - a zero-route scan cannot fail', () => {
    // The hollow-observable floor. If the walk breaks, this test would pass by
    // classifying nothing, which is the exact defect it is written to prevent.
    expect(routes.length).toBeGreaterThan(20);
  });

  it('no route is left unclassified', () => {
    const classified = new Set([...REVALIDATED_PATHS, ...Object.keys(NOT_REVALIDATED)]);
    const missing = routes.filter((r) => !classified.has(r));
    expect(missing).toEqual([]);
  });

  it('nothing is classified twice - a path cannot be both refreshed and excluded', () => {
    const both = REVALIDATED_PATHS.filter((p) => p in NOT_REVALIDATED);
    expect(both).toEqual([]);
  });

  it('every exclusion carries a real reason, not an empty string', () => {
    const thin = Object.entries(NOT_REVALIDATED).filter(([, why]) => !why || why.trim().length < 20);
    expect(thin).toEqual([]);
  });

  it('nothing is classified that does not exist - a deleted page leaves no ghost', () => {
    const live = new Set(routes);
    const ghosts = [...REVALIDATED_PATHS, ...Object.keys(NOT_REVALIDATED)].filter(
      (p) => !live.has(p) && p !== '/sitemap.xml'
    );
    expect(ghosts).toEqual([]);
  });

  it('the four the design names are all in the refreshed list', () => {
    for (const p of ['/', '/mainboard-ipos', '/sme-ipos', '/sitemap.xml']) {
      expect(REVALIDATED_PATHS).toContain(p);
    }
  });

  it('the pages the design did NOT name but that IPO rows drive are refreshed too', () => {
    // The concrete miss: a corrected IPO fixed on its own page and stale on the
    // calendar and the listings page that link to it.
    for (const p of [
      '/mainboard-ipo-calendar',
      '/sme-ipo-calendar',
      '/mainboard-ipo-listings',
      '/sme-ipo-listings',
    ]) {
      expect(REVALIDATED_PATHS).toContain(p);
    }
  });

  it('static legal pages are excluded - refreshing them is pure waste', () => {
    for (const p of ['/privacy', '/terms', '/disclaimer', '/about']) {
      expect(Object.keys(NOT_REVALIDATED)).toContain(p);
    }
  });
});
