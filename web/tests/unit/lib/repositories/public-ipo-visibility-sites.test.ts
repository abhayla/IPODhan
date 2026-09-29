/**
 * §9.2 item 23 (OD-116/OD-118) detection, per QUERY not per file: every non-admin `.from(ipos)` /
 * `FROM ipos` call site under web/app, web/lib and the packages/shared code web readers import
 * must apply the reader-visibility predicate inside its OWN statement (`publicIpoVisible`,
 * `includeHidden`, a `hidden_at` / `hiddenAt` filter, or a `visibility:` comment naming why that
 * one query is not a reader read), or its whole file must be listed below as not a reader surface.
 * A file with one guarded query and one unguarded query fails here and names the line.
 *
 * Every public API route keyed by an IPO id (`[ipoId]` / `[id]`) must also check the id is visible
 * (`isPublicIpoId`) before answering: those routes read child tables and never touch `ipos`, so the
 * query scan alone cannot see them.
 *
 * The integration proof is tests/integration/ipo-hide-row.integration.test.ts.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const WEB_ROOT = path.resolve(__dirname, '../../../..');
const REPO_ROOT = path.resolve(WEB_ROOT, '..');
const QUERY_OF_IPOS = /\.from\(\s*(schema\.)?ipos\s*\)|\bFROM\s+ipos\b/g;
const APPLIES_PREDICATE = /publicIpoVisible|includeHidden|hidden_at|hiddenAt|visibility:/;
const BUILDER_REF = /\b(whereClause|whereConditions|conditions)\b|\$dynamic\(/;
const FUNCTION_START =
  /\n[ \t]*(?:export\s+)?(?:async\s+)?function\s+\w+|\n[ \t]+(?:private\s+|public\s+|protected\s+)?(?:static\s+)?async\s+\w+\s*\(|\nexport\s+const\s+\w+\s*=/g;

/** Files that read `ipos` but are not a reader list/search/page — each with its reason. */
const NOT_A_READER_SURFACE: Record<string, string> = {
  'web/lib/db/connection-retry.ts': 'health probe, no row reaches a reader',
  'web/lib/ipo-visibility/hidden-ipo-slugs.ts': 'reads the HIDDEN set itself (410 decision)',
  'web/lib/services/ipo-visibility-service.ts': 'the admin hide/unhide writer',
  'web/lib/repositories/admin-queue-repository.ts': 'admin data-quality queue; hidden rows stay visible to admins',
  'web/lib/repositories/ipo-score-realtime-repository.ts': 'reads one row by id after the caller resolved a visible slug',
  'web/lib/services/ipo-scoring-realtime.ts': 'reads one row by id after the caller resolved a visible slug',
  'web/lib/services/conflict-resolution.ts': 'admin conflict tooling',
  'web/lib/services/status-updater-service.ts': 'status job (writes lifecycle status, not a reader surface)',
  'web/lib/services/metrics-service.ts': 'operational metrics counts, not a reader list',
  'web/lib/services/audit-log-service.ts': 'admin audit log',
  'web/lib/scripts/calculate-ratings.ts': 'batch script, not a reader surface',
  'web/lib/scrapers/sources/gmp-api-scraper.ts': 'scraper write path',
  'web/lib/scrapers/sources/historical-ipo-scraper.ts': 'scraper write path',
  'web/lib/scrapers/sources/prospectus-scraper.ts': 'scraper write path',
  'packages/shared/src/services/admin-field-write.ts': 'the admin field writer; admins edit hidden rows too',
  'packages/shared/src/services/corrigendum-suggestions.ts': 'writes admin conflict-queue suggestions, never a reader read',
};

function walk(dir: string, out: string[]): void {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === 'admin' || name === 'node_modules' || name === 'dist') continue;
      walk(full, out);
    } else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) {
      out.push(full);
    }
  }
}

const rel = (f: string) => path.relative(REPO_ROOT, f).split(path.sep).join('/');

/** packages/shared files that web reader code imports; the scraper-only rest is a write side. */
function sharedFilesWebReadersImport(): string[] {
  const webFiles: string[] = [];
  for (const root of ['app', 'lib']) walk(path.join(WEB_ROOT, root), webFiles);
  const imported = new Set<string>();
  for (const f of webFiles) {
    for (const m of readFileSync(f, 'utf8').matchAll(/from '@ipodhan\/shared\/([\w/-]+)'/g)) {
      const candidate = path.join(REPO_ROOT, 'packages/shared/src', `${m[1]}.ts`);
      try {
        statSync(candidate);
        imported.add(candidate);
      } catch {
        // a directory index or a type-only path: not a query site
      }
    }
  }
  return [...imported];
}

function sitesQueryingIpos(): string[] {
  const files: string[] = [];
  for (const root of ['app', 'lib']) walk(path.join(WEB_ROOT, root), files);
  files.push(...sharedFilesWebReadersImport());
  return [...new Set(files)]
    .filter((f) => new RegExp(QUERY_OF_IPOS.source).test(readFileSync(f, 'utf8')))
    .map(rel)
    .sort();
}

/**
 * Line numbers of `from(ipos)` hits whose own statement carries no visibility predicate. The
 * statement runs back to the previous `;` or blank line and forward to the next `;`, so a guard on
 * a different query in the same file does not count for this one.
 */
export function unguardedQueries(src: string): number[] {
  const lines: number[] = [];
  for (const m of src.matchAll(QUERY_OF_IPOS)) {
    const at = m.index ?? 0;
    const before = src.slice(0, at);
    const start = Math.max(before.lastIndexOf(';'), before.lastIndexOf('\n\n'), 0);
    const endSemi = src.indexOf(';', at);
    const statement = src.slice(start, endSemi === -1 ? src.length : endSemi);
    if (APPLIES_PREDICATE.test(statement)) continue;
    // A query whose WHERE is a builder variable (`whereClause`, `and(...conditions)`, a `$dynamic()`
    // query extended later) is guarded when its own enclosing function puts the predicate in it.
    if (BUILDER_REF.test(statement)) {
      const fnStart = Math.max(0, ...[...before.matchAll(FUNCTION_START)].map((f) => f.index ?? 0));
      const nextFn = src.slice(at).search(new RegExp(FUNCTION_START.source));
      const fnBody = src.slice(fnStart, nextFn === -1 ? src.length : at + nextFn);
      if (APPLIES_PREDICATE.test(fnBody)) continue;
    }
    lines.push(before.split('\n').length);
  }
  return lines;
}

describe('§9.2 item 23: every public ipos query applies the visibility predicate', () => {
  const sites = sitesQueryingIpos();

  it('finds the known reader sites (the scan itself works)', () => {
    expect(sites).toContain('web/lib/repositories/ipo-repository.ts');
    expect(sites).toContain('web/app/api/ipos/listings/route.ts');
    expect(sites.length).toBeGreaterThanOrEqual(10);
  });

  it('no non-admin ipos query omits the predicate without a stated reason (per query, not per file)', () => {
    const missing = sites
      .filter((f) => !NOT_A_READER_SURFACE[f])
      .flatMap((f) => unguardedQueries(readFileSync(path.join(REPO_ROOT, f), 'utf8')).map((l) => `${f}:${l}`));
    expect(missing).toEqual([]);
  });

  it('the per-query scan flags a second, unguarded query in a file that guards another', () => {
    const src = [
      'const a = await db.select().from(ipos).where(and(eq(ipos.id, x), publicIpoVisible()));',
      '',
      'const b = await db.select().from(ipos).where(eq(ipos.slug, y));',
    ].join('\n');
    expect(unguardedQueries(src)).toEqual([3]);
  });

  it('every allow-listed file still exists and still queries ipos (no stale exemptions)', () => {
    const stale = Object.keys(NOT_A_READER_SURFACE).filter((f) => !sites.includes(f));
    expect(stale).toEqual([]);
  });

  it('every public API route keyed by an IPO id checks visibility before answering', () => {
    const routes: string[] = [];
    walk(path.join(WEB_ROOT, 'app', 'api'), routes);
    const idRoutes = routes.filter((f) => /[\\/]\[(ipoId|id)\][\\/]/.test(f) && /route\.ts$/.test(f));
    expect(idRoutes.map(rel)).toEqual(
      expect.arrayContaining(['web/app/api/gmp/history/[ipoId]/route.ts', 'web/app/api/subscription/history/[ipoId]/route.ts'])
    );
    const unchecked = idRoutes.filter((f) => !/isPublicIpoId/.test(readFileSync(f, 'utf8'))).map(rel);
    expect(unchecked).toEqual([]);
  });
});
