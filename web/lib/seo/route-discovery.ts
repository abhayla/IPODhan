import fs from 'fs';
import path from 'path';

const EXCLUDED_TOP_LEVEL_SEGMENTS = new Set(['admin', 'components-test', 'api']);

/**
 * Discover every STATIC (non-dynamic-segment) public page route by walking
 * the Next.js `app/` directory for `page.tsx`/`page.ts` files.
 *
 * This is the mechanism side of the sitemap (P2-4, round-2 review): a
 * hand-maintained array silently fell out of sync with the real route table —
 * `/mainboard-ipos`, `/sme-ipos`, `/ncd`, `/ofs` were all live 200s missing
 * from `sitemap.ts`. Walking the filesystem means a new static page
 * automatically appears here with zero list maintenance.
 *
 * Dynamic-segment routes (`[slug]`, `[reviewId]`, ...) are intentionally
 * excluded — those need a data source to enumerate real values (IPO detail
 * pages are appended separately from the DB in `sitemap.ts`).
 */
export function discoverStaticRoutes(appDir: string): string[] {
  const routes: string[] = [];

  function walk(dir: string, segments: string[]): void {
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    const hasPageFile = entries.some(
      (e) => e.isFile() && (e.name === 'page.tsx' || e.name === 'page.ts')
    );
    if (hasPageFile) {
      const hasDynamicSegment = segments.some((s) => s.startsWith('[') && s.endsWith(']'));
      if (!hasDynamicSegment) {
        routes.push('/' + segments.join('/'));
      }
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const name = entry.name;
      if (name.startsWith('_') || name.startsWith('.')) continue;
      if (segments.length === 0 && EXCLUDED_TOP_LEVEL_SEGMENTS.has(name)) continue;
      // Route groups `(group)` organize files without adding a URL segment.
      const nextSegments = name.startsWith('(') && name.endsWith(')') ? segments : [...segments, name];
      walk(path.join(dir, name), nextSegments);
    }
  }

  walk(appDir, []);
  return routes.sort();
}
