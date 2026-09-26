/**
 * #568 — `GET /api/version` MUST stay `force-static` (it is how a deploy proves
 * a flip actually happened: `NEXT_PUBLIC_BUILD_SHA` is baked at build time),
 * but that means Next.js attaches its own year-long `s-maxage` header, and
 * Cloudflare happily caches the route at the edge for a year. A public read
 * of the served sha can then be silently stale.
 *
 * The fix is a `next.config.mjs` `headers()` rule for `/api/version` (and
 * `/api/health` while we're here — same class of "public URL used to decide
 * whether a deploy proof is real") that tells every cache in the path
 * (browser, Cloudflare's shared cache, and Cloudflare's CDN-specific
 * override) not to store the response.
 *
 * This test reads the REAL next.config.mjs headers() function — it does not
 * re-implement the config, per the issue's instruction not to duplicate the
 * source of truth.
 */
import { describe, it, expect } from 'vitest';
import nextConfig from '../../../next.config.mjs';

type HeaderRule = { source: string; headers: { key: string; value: string }[] };

async function getHeaderRules(): Promise<HeaderRule[]> {
  const config = await Promise.resolve(nextConfig);
  if (typeof config.headers !== 'function') {
    throw new Error('next.config.mjs no longer exports a headers() function');
  }
  return config.headers();
}

function findHeader(rules: HeaderRule[], source: string, key: string): string | undefined {
  const rule = rules.find((r) => r.source === source);
  return rule?.headers.find((h) => h.key.toLowerCase() === key.toLowerCase())?.value;
}

describe('next.config.mjs headers() — /api/version must not be edge-cached (#568)', () => {
  it('has a headers rule whose source matches /api/version exactly', async () => {
    const rules = await getHeaderRules();
    const rule = rules.find((r) => r.source === '/api/version');
    expect(rule, 'expected a headers() rule with source "/api/version"').toBeDefined();
  });

  it('sets a browser Cache-Control that does not allow a long-lived cache', async () => {
    const rules = await getHeaderRules();
    const value = findHeader(rules, '/api/version', 'Cache-Control');
    expect(value, 'Cache-Control header missing for /api/version').toBeDefined();
    expect(value).toMatch(/no-store|no-cache/);
    // The whole defect is a 1-year s-maxage; make sure nothing resembling
    // that survives in the browser-facing header either.
    expect(value).not.toMatch(/max-age=3153600|s-maxage=3153600/);
  });

  it('sets CDN-Cache-Control: no-store — the generic CDN override many shared caches honour', async () => {
    const rules = await getHeaderRules();
    const value = findHeader(rules, '/api/version', 'CDN-Cache-Control');
    expect(value).toBe('no-store');
  });

  it('sets Cloudflare-CDN-Cache-Control: no-store — Cloudflare honours this ABOVE Cache-Control/CDN-Cache-Control', async () => {
    const rules = await getHeaderRules();
    const value = findHeader(rules, '/api/version', 'Cloudflare-CDN-Cache-Control');
    expect(value).toBe('no-store');
  });

  it('also covers /api/health with the same no-store discipline (same class: a public URL used to decide if a deploy proof is real)', async () => {
    const rules = await getHeaderRules();
    const rule = rules.find((r) => r.source === '/api/health');
    expect(rule, 'expected a headers() rule with source "/api/health"').toBeDefined();
    expect(findHeader(rules, '/api/health', 'Cloudflare-CDN-Cache-Control')).toBe('no-store');
  });
});
