/**
 * Headers that make a session-dependent response uncacheable by every cache in the path (#1346).
 *
 * Measured 2026-09-30 on staging: authenticated GETs under /api/admin returned
 * `cf-cache-status: HIT` although the app sent `Cache-Control: private, no-store`. Cloudflare
 * decides edge caching from its own header first (Cloudflare-CDN-Cache-Control), then
 * CDN-Cache-Control, so all three are sent. Applied in one place, middleware.ts, so a new admin
 * route or page is covered by construction.
 */
export const PRIVATE_RESPONSE_HEADERS: Readonly<Record<string, string>> = {
  'Cache-Control': 'private, no-store, max-age=0',
  'CDN-Cache-Control': 'no-store',
  'Cloudflare-CDN-Cache-Control': 'no-store',
};

export function applyPrivateResponseHeaders(headers: Headers): void {
  for (const [key, value] of Object.entries(PRIVATE_RESPONSE_HEADERS)) headers.set(key, value);
  const vary = (headers.get('Vary') ?? '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
  if (!vary.some((v) => v === '*' || v.toLowerCase() === 'cookie')) vary.push('Cookie');
  headers.set('Vary', vary.join(', '));
}
