/**
 * Request-origin decisions for the admin session cookie (spec §9.2 item 6; Tier A review m4, M2).
 *
 * CSRF (m4): the session cookie is SameSite=Lax, which still lets a same-SITE page (any subdomain) or
 * an old browser send it on a cross-origin POST. So a cookie-authenticated mutation must come from
 * the site's own origin. "Own origin" is decided BY CONSTRUCTION: the Origin header's host equals the
 * host this request was addressed to (the Host header, or the X-Forwarded-Host nginx passes on).
 * No env var is needed; staging and prod set neither NEXT_PUBLIC_BASE_URL nor ADMIN_ALLOWED_ORIGINS,
 * and an env-only allow-list refused every browser mutation there. A cross-origin page cannot forge
 * either header: Host is a forbidden request header, and a custom X-Forwarded-Host forces a CORS
 * preflight that this app never answers. ADMIN_ALLOWED_ORIGINS (and the public-URL env vars) can
 * still add origins. Bearer-token (machine) calls carry no cookie and are exempt.
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

/** The hosts (host[:port], lower-case) this request was addressed to: Host and X-Forwarded-Host. */
export function requestOwnHosts(headers: OriginHeaders): Set<string> {
  const hosts = new Set<string>();
  const host = headers.get('host')?.trim().toLowerCase();
  if (host) hosts.add(host);
  const forwarded = headers.get('x-forwarded-host')?.split(',')[0]?.trim().toLowerCase();
  if (forwarded) hosts.add(forwarded);
  return hosts;
}

function originHost(origin: string): string | null {
  try {
    const url = new URL(origin.trim());
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    return url.host.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * May a request authenticated by the session COOKIE proceed?
 *
 * - A known safe method (GET/HEAD/OPTIONS) proceeds: reads never mutate.
 * - With an Origin header: allowed when its host equals the request's own host (Host or
 *   X-Forwarded-Host), or when the origin is listed in allowedAdminOrigins(). Anything else,
 *   including Origin "null", is refused.
 * - With no Origin header: allowed only when the browser's own Sec-Fetch-Site says same-origin
 *   (or "none", a typed URL, when the method is unknown). Anything else is refused.
 * - method === null (a caller that cannot see the method, e.g. requireAdminAuth() with no request)
 *   is treated as a possible mutation.
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
    const host = originHost(origin);
    if (host === null) return false;
    if (requestOwnHosts(headers).has(host)) return true;
    const normalized = toOrigin(origin);
    return normalized !== null && allowedAdminOrigins(env).has(normalized);
  }
  const fetchSite = headers.get('sec-fetch-site');
  if (fetchSite === 'same-origin') return true;
  return upper === null && fetchSite === 'none';
}

/** The client IP for rate limiting. Never the first X-Forwarded-For entry (caller-controlled). */
export function trustedClientIp(headers: OriginHeaders): string {
  const cf = headers.get('cf-connecting-ip')?.trim();
  if (cf) return cf;
  const real = headers.get('x-real-ip')?.trim();
  if (real) return real;
  return 'unknown';
}
