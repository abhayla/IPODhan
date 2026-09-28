/**
 * Request-origin decisions for the admin session cookie (spec §9.2 item 6; Tier A review m4, M2).
 *
 * CSRF (m4): the session cookie is SameSite=Lax, which still lets a same-SITE page (any subdomain) or
 * an old browser send it on a cross-origin POST. So a cookie-authenticated mutation must also carry
 * an Origin header naming one of the site's own origins. Bearer-token (machine) calls carry no
 * cookie and are exempt.
 *
 * Client IP (M2): the first X-Forwarded-For entry is whatever the caller wrote, so it is never used.
 * CF-Connecting-IP is set by Cloudflare, and X-Real-IP by nginx from the socket address.
 */

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

const ORIGIN_ENV_KEYS = ['NEXT_PUBLIC_BASE_URL', 'NEXT_PUBLIC_APP_URL', 'NEXT_PUBLIC_SITE_URL'] as const;

function toOrigin(value: string): string | null {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    return url.origin;
  } catch {
    return null;
  }
}

/** The site's own origins: the public URL env vars plus ADMIN_ALLOWED_ORIGINS (comma-separated). */
export function allowedAdminOrigins(env: NodeJS.ProcessEnv = process.env): Set<string> {
  const origins = new Set<string>();
  for (const key of ORIGIN_ENV_KEYS) {
    const origin = env[key] ? toOrigin(env[key] as string) : null;
    if (origin) origins.add(origin);
  }
  for (const part of (env.ADMIN_ALLOWED_ORIGINS ?? '').split(',')) {
    if (!part.trim()) continue;
    const origin = toOrigin(part);
    if (origin) origins.add(origin);
  }
  return origins;
}

export interface OriginHeaders {
  get(name: string): string | null;
}

/**
 * May a request authenticated by the session COOKIE proceed?
 *
 * - A known safe method (GET/HEAD/OPTIONS) proceeds: reads never mutate.
 * - Otherwise the Origin header must be present and in allowedAdminOrigins(). A missing Origin on a
 *   known mutation is refused: every current browser sends Origin on POST/PUT/PATCH/DELETE.
 * - method === null (a caller that cannot see the method, e.g. requireAdminAuth() with no request):
 *   an Origin, if sent, must match; with no Origin the browser's own Sec-Fetch-Site must say
 *   same-origin or none (a typed URL). Anything else is refused.
 * - No configured origin at all fails closed for mutations.
 */
export function cookieRequestOriginAllowed(
  headers: OriginHeaders,
  method: string | null,
  env: NodeJS.ProcessEnv = process.env
): boolean {
  const upper = method ? method.toUpperCase() : null;
  if (upper && SAFE_METHODS.has(upper)) return true;

  const origin = headers.get('origin');
  if (origin) {
    const normalized = toOrigin(origin);
    return normalized !== null && allowedAdminOrigins(env).has(normalized);
  }
  if (upper) return false;
  const fetchSite = headers.get('sec-fetch-site');
  return fetchSite === 'same-origin' || fetchSite === 'none';
}

/** The client IP for rate limiting. Never the first X-Forwarded-For entry (caller-controlled). */
export function trustedClientIp(headers: OriginHeaders): string {
  const cf = headers.get('cf-connecting-ip')?.trim();
  if (cf) return cf;
  const real = headers.get('x-real-ip')?.trim();
  if (real) return real;
  return 'unknown';
}
