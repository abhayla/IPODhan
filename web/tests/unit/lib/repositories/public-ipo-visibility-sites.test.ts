/**
 * §9.2 item 23 (OD-116/OD-118) detection: every non-admin file under web/app and web/lib that
 * queries `ipos` directly must apply the reader-visibility predicate (`publicIpoVisible`, or an
 * `includeHidden` opt-in), or be listed below with the reason it is not a reader surface.
 *
 * A new public query that forgets the predicate would show a hidden row to readers; this test
 * fails and names the file instead. The integration proof is
 * tests/integration/ipo-hide-row.integration.test.ts.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const WEB_ROOT = path.resolve(__dirname, '../../../..');
const ROOTS = ['app', 'lib'];
const QUERY_OF_IPOS = /\.from\(\s*(schema\.)?ipos\s*\)|\bFROM\s+ipos\b/;
const APPLIES_PREDICATE = /publicIpoVisible|includeHidden/;

/** Files that read `ipos` but are not a reader list/search/page — each with its reason. */
const NOT_A_READER_SURFACE: Record<string, string> = {
  'lib/db/connection-retry.ts': 'health probe, no row reaches a reader',
  'lib/ipo-visibility/hidden-ipo-slugs.ts': 'reads the HIDDEN set itself (410 decision)',
  'lib/services/ipo-visibility-service.ts': 'the admin hide/unhide writer',
  'lib/repositories/admin-queue-repository.ts': 'admin data-quality queue; hidden rows stay visible to admins',
  'lib/repositories/ipo-score-realtime-repository.ts': 'reads one row by id after the caller resolved a visible slug',
  'lib/services/ipo-scoring-realtime.ts': 'reads one row by id after the caller resolved a visible slug',
  'lib/services/conflict-resolution.ts': 'admin conflict tooling',
  'lib/services/status-updater-service.ts': 'status job (writes lifecycle status, not a reader surface)',
  'lib/services/metrics-service.ts': 'operational metrics counts, not a reader list',
  'lib/services/audit-log-service.ts': 'admin audit log',
  'lib/scripts/calculate-ratings.ts': 'batch script, not a reader surface',
  'lib/scrapers/sources/gmp-api-scraper.ts': 'scraper write path',
  'lib/scrapers/sources/historical-ipo-scraper.ts': 'scraper write path',
  'lib/scrapers/sources/prospectus-scraper.ts': 'scraper write path',
};

function walk(dir: string, out: string[]): void {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === 'admin' || name === 'node_modules') continue;
      walk(full, out);
    } else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) {
      out.push(full);
    }
  }
}

function sitesQueryingIpos(): string[] {
  const files: string[] = [];
  for (const root of ROOTS) walk(path.join(WEB_ROOT, root), files);
  return files
    .filter((f) => QUERY_OF_IPOS.test(readFileSync(f, 'utf8')))
    .map((f) => path.relative(WEB_ROOT, f).split(path.sep).join('/'))
    .sort();
}

describe('§9.2 item 23: every public ipos query applies the visibility predicate', () => {
  const sites = sitesQueryingIpos();

  it('finds the known reader sites (the scan itself works)', () => {
    expect(sites).toContain('lib/repositories/ipo-repository.ts');
    expect(sites).toContain('app/api/ipos/listings/route.ts');
    expect(sites.length).toBeGreaterThanOrEqual(10);
  });

  it('no non-admin ipos query omits publicIpoVisible without a stated reason', () => {
    const missing = sites.filter(
      (f) => !NOT_A_READER_SURFACE[f] && !APPLIES_PREDICATE.test(readFileSync(path.join(WEB_ROOT, f), 'utf8'))
    );
    expect(missing).toEqual([]);
  });

  it('every allow-listed file still exists and still queries ipos (no stale exemptions)', () => {
    const stale = Object.keys(NOT_A_READER_SURFACE).filter((f) => !sites.includes(f));
    expect(stale).toEqual([]);
  });
});
