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

export function middleware(request: NextRequest) {
  const response = NextResponse.next();

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

// Apply middleware to all routes except static files
// Excludes: Next.js internals, static assets, and favicon
export const config = {
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
