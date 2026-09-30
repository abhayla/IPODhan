/**
 * Next.js Middleware - Security Headers
 *
 * Applies security headers to all responses to protect against common web vulnerabilities.
 * Implements defense-in-depth with multiple security controls.
 *
 * Security Headers Implemented:
 * - X-Content-Type-Options: Prevents MIME type sniffing
 * - X-Frame-Options: Prevents clickjacking attacks
 * - X-XSS-Protection: Enables browser XSS filter (legacy support)
 * - Referrer-Policy: Controls referrer information leakage
 * - Content-Security-Policy: Restricts resource loading sources
 * - Strict-Transport-Security: Enforces HTTPS (production only)
 *
 * @see https://nextjs.org/docs/app/building-your-application/routing/middleware
 * @see https://owasp.org/www-project-secure-headers/
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { ADMIN_SESSION_COOKIE } from '@/lib/admin-accounts/session-cookie-name';
import { applyPrivateResponseHeaders } from '@/lib/security/private-response-headers';
import { isHiddenIpoSlug } from '@/lib/ipo-visibility/hidden-ipo-slugs';

/**
 * Admin gate, the FIRST layer (runs before any admin page or admin API route renders).
 *
 * Why here: measured 2026-09-30 on a production build, a redirect in the admin layout does not
 * stop a child page from running, and that page's output reached the response body. Middleware
 * runs before the route renders at all.
 *
 * It checks cookie PRESENCE only (no session lookup here, even on the Node runtime), so it
 * cannot tell a valid session from a forged or expired one. Validity is decided by the later
 * layers, which all stay: the server layout app/admin/(protected)/layout.tsx, each page's own
 * check, and withAdminAuth / requireAdminAuth on every admin API route.
 *
 * Exceptions: the login page and the login API (a signed-out admin must reach them), and an
 * /api/admin request carrying an Authorization header (machine callers use a Bearer token that
 * the route's own guard verifies). An Authorization header does NOT open an admin page.
 */
const ADMIN_LOGIN_PAGE = '/admin/login';
const ADMIN_PUBLIC_PATHS = new Set([ADMIN_LOGIN_PAGE, '/api/admin/auth/login']);

function stripTrailingSlash(p: string): string {
  return p.length > 1 && p.endsWith('/') ? p.slice(0, -1) : p;
}

export function adminGate(request: NextRequest): NextResponse | null {
  const pathname = stripTrailingSlash(request.nextUrl.pathname);
  const isAdminPage = pathname === '/admin' || pathname.startsWith('/admin/');
  const isAdminApi = pathname === '/api/admin' || pathname.startsWith('/api/admin/');
  if (!isAdminPage && !isAdminApi) return null;
  if (ADMIN_PUBLIC_PATHS.has(pathname)) return null;
  if (request.cookies.get(ADMIN_SESSION_COOKIE)?.value) return null;
  if (isAdminApi) {
    if (request.headers.get('authorization')) return null;
    return NextResponse.json(
      { error: 'Unauthorized', message: 'Admin authentication required.' },
      { status: 401 }
    );
  }
  return NextResponse.redirect(new URL(ADMIN_LOGIN_PAGE, request.url));
}

export function isAdminPath(pathname: string): boolean {
  const p = stripTrailingSlash(pathname);
  return p === '/admin' || p.startsWith('/admin/') || p === '/api/admin' || p.startsWith('/api/admin/');
}

/** An IPO detail address: /ipos/<slug> (no deeper segment). */
// The page AND every slug-keyed API under it (/api/ipos/<slug>/gmp/latest, /documents, ...): the
// API's findBySlugWithFallback would otherwise answer a hidden address with a neighbour's data.
export const IPO_DETAIL_PATH = /^\/(?:api\/)?ipos\/([^/]+)(?:\/.*)?$/;

/**
 * §9.2 item 23 (OD-116/OD-118): a hidden IPO's address answers 410 Gone. Decided here because an
 * App Router page cannot set a 410 status, and because the page's fuzzy slug fallback must never
 * get the chance to send a hidden address to a neighbouring IPO.
 */
function goneResponse(): NextResponse {
  const response = new NextResponse(
    '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Page removed | IPODhan</title>' +
      '<meta name="robots" content="noindex"></head><body><h1>This IPO page has been removed</h1>' +
      '<p><a href="/">Go to the IPODhan home page</a></p></body></html>',
    { status: 410, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
  );
  response.headers.set('Cache-Control', 'no-store');
  response.headers.set('X-Robots-Tag', 'noindex');
  return response;
}

export async function middleware(request: NextRequest) {
  const match = IPO_DETAIL_PATH.exec(request.nextUrl.pathname);
  if (match) {
    let slug = match[1];
    try {
      slug = decodeURIComponent(slug);
    } catch {
      // a malformed escape is simply not a hidden slug
    }
    if (await isHiddenIpoSlug(slug)) {
      return applySecurityHeaders(goneResponse());
    }
  }
  const response = adminGate(request) ?? NextResponse.next();

  // #1346: an admin page/API response, and ANY response to a request carrying an admin session
  // cookie (e.g. /ipos/<slug> rendering the editor controls), is never stored by the CDN.
  if (isAdminPath(request.nextUrl.pathname) || request.cookies.get(ADMIN_SESSION_COOKIE)?.value) {
    applyPrivateResponseHeaders(response.headers);
  }
  return applySecurityHeaders(response);
}

function applySecurityHeaders(response: NextResponse): NextResponse {
  // Prevent MIME type sniffing
  // Ensures browsers respect Content-Type header
  response.headers.set('X-Content-Type-Options', 'nosniff');

  // Prevent clickjacking by disabling iframe embedding
  response.headers.set('X-Frame-Options', 'DENY');

  // Enable XSS filter in legacy browsers (Chrome, IE, Safari)
  // Modern browsers have this enabled by default
  response.headers.set('X-XSS-Protection', '1; mode=block');

  // Control referrer information sent to external sites
  // Sends origin only on cross-origin requests
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');

  // Content Security Policy
  // Restricts resources to trusted sources only
  // Note: 'unsafe-eval' and 'unsafe-inline' required for Next.js development
  // TODO: Tighten CSP in production with nonces for inline scripts
  const cspDirectives = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-eval' 'unsafe-inline' https://www.googletagmanager.com https://www.google-analytics.com https://static.cloudflareinsights.com",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https:",
    "font-src 'self' data:",
    // Sentry ingest + GA4 beacons must be allow-listed here or the browser
    // silently blocks them: default-src 'self' does not cover connect-src, so a
    // missing origin means zero client-side events with only a console CSP
    // violation to show for it (T-178 — both subsystems re-enabled).
    // GA4 uses region-sharded *.google-analytics.com and analytics.google.com
    // in addition to the www host already listed.
    "connect-src 'self' https://www.google-analytics.com https://*.google-analytics.com https://analytics.google.com https://cloudflareinsights.com https://*.ingest.sentry.io https://*.ingest.us.sentry.io https://*.ingest.de.sentry.io",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ];
  response.headers.set('Content-Security-Policy', cspDirectives.join('; '));

  // HTTP Strict Transport Security (HSTS)
  // Force HTTPS for 1 year, including subdomains
  // Only enabled in production to avoid HTTPS requirement in development
  if (process.env.NODE_ENV === 'production') {
    response.headers.set(
      'Strict-Transport-Security',
      'max-age=31536000; includeSubDomains; preload'
    );
  }

  // Permissions Policy (formerly Feature Policy)
  // Disable potentially dangerous browser features
  response.headers.set(
    'Permissions-Policy',
    'geolocation=(), microphone=(), camera=(), payment=()'
  );

  return response;
}

// Apply middleware to all routes except static files. /admin/* and /api/admin/* paths are matched,
// EXCEPT those whose last segment ends in a static-file extension (.png, .svg, ...): the matcher's
// static-asset exclusion skips the middleware for them. Those are still stopped by the per-page
// checks, the (protected) layout and withAdminAuth.
// Excludes: Next.js internals, static assets, and favicon
export const config = {
  // §9.2 item 23: Node.js runtime (stable in Next 15.5) so the hidden-slug check can read the database.
  runtime: 'nodejs',
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public files (svg, jpg, png, etc.)
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff|woff2|ttf|eot)$).*)',
  ],
};
