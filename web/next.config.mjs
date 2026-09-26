import { withSentryConfig } from '@sentry/nextjs';
import bundleAnalyzer from '@next/bundle-analyzer';

// Bundle analyzer configuration
const withBundleAnalyzer = bundleAnalyzer({
  enabled: process.env.ANALYZE === 'true',
});

const nextConfig = {
  // Dev-only: the floating "N" dev-tools indicator overlaps page content in
  // screenshot-based UI verification (blind reviewers docked polish scores for
  // it in every capture, 2026-07-02). No production effect.
  devIndicators: false,

  // ESLint runs as its own gate (`npm run lint` in CI + deploy). `next build`'s
  // bundled ESLint pass errors with "Invalid Options: useEslintrc, extensions"
  // (a flat-config/version incompatibility) and was blocking production builds,
  // so disable the redundant in-build lint — linting is NOT skipped, just moved
  // out of `next build`.
  eslint: {
    ignoreDuringBuilds: true,
  },

  // D3.js Code Splitting Strategy (Phase 2 - Data Intelligence Surface)
  // - Use next/dynamic for all D3.js visualization components
  // - D3.js automatically code-splits via dynamic imports (~200KB)
  // - No custom webpack splitChunks needed (avoids module loading errors)
  // - Components: ScoreBreakdown, SectorHeatMap, CorrelationMatrix, PredictiveMeter, TimeSeriesPlayback

  // Package transpilation (Session 5 Fix)
  // ESM packages require transpilation for Next.js 15 webpack compatibility
  // See: docs/08-troubleshooting/RECHARTS_WEBPACK_FIX.md
  // 'react-icons' removed (T-178): the package was uninstalled in 182ccf6c when
  // it was identified as the actual Session-5 root cause and replaced by
  // lucide-react. See docs/monitoring/webpack-session5-root-cause.md
  transpilePackages: ['recharts', 'date-fns'],

  // Performance: Browser caching headers for static assets
  // Security: CORS configuration for API endpoints
  async headers() {
    return [
      // Static asset caching
      {
        source: '/:all*(svg|jpg|jpeg|png|webp|gif|ico|woff|woff2|ttf|eot)',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=31536000, immutable',
          },
        ],
      },
      {
        source: '/_next/static/:path*',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=31536000, immutable',
          },
        ],
      },
      // #568: `/api/version` MUST stay `force-static` (it is the mechanism
      // that lets `curl .../api/version` prove a deploy flip actually
      // happened — see the route's own docstring), but `force-static`
      // attaches Next's own `s-maxage=31536000` header, which Cloudflare
      // then caches at the edge for a year. A public read of the served sha
      // can silently return an old release's sha. Every cache in the path
      // is told not to store: `Cache-Control: no-store` for the browser,
      // `CDN-Cache-Control: no-store` for the generic CDN override many
      // shared caches honour, and `Cloudflare-CDN-Cache-Control: no-store`
      // because Cloudflare prefers ITS OWN header above the other two when
      // deciding what to cache at the edge — so this is the one that
      // actually stops the year-long edge cache, not a belt-and-braces
      // extra. `/api/health` already sets `Cache-Control: no-store` in its
      // own route response and is force-dynamic, so it needs no entry here.
      {
        source: '/api/version',
        headers: [
          { key: 'Cache-Control', value: 'no-store, no-cache, must-revalidate' },
          { key: 'CDN-Cache-Control', value: 'no-store' },
          { key: 'Cloudflare-CDN-Cache-Control', value: 'no-store' },
        ],
      },
      // CORS for API endpoints
      {
        source: '/api/:path*',
        headers: [
          {
            key: 'Access-Control-Allow-Origin',
            value: process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
          },
          {
            key: 'Access-Control-Allow-Methods',
            value: 'GET, POST, PUT, DELETE, OPTIONS',
          },
          {
            key: 'Access-Control-Allow-Headers',
            value: 'Content-Type, Authorization',
          },
          {
            key: 'Access-Control-Max-Age',
            value: '86400', // 24 hours
          },
        ],
      },
    ];
  },

  // Performance: Webpack optimizations
  // NOTE: Removed custom splitChunks configuration as it caused module loading errors
  webpack: (config, { isServer }) => {
    // packages/shared/src uses NodeNext-style `.js`-suffixed relative imports
    // (tsc/tsx resolve .js -> .ts at compile time). Webpack does not do that
    // remapping on its own, so any web import that pulls shared SOURCE files
    // (not the compiled dist/ package) fails with "Module not found: Can't
    // resolve './foo.js'" the moment such an import is reachable from web —
    // first hit: 2026-09-24, staging run 36024250816, PR #989 chain
    // (duplicate-ipo-merge.ts -> company-identity-fold.js).
    config.resolve = config.resolve || {};
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      '.js': ['.ts', '.tsx', '.js'],
    };

    if (!isServer) {
      // Exclude Node.js built-ins from browser bundle (fixes pg module issues)
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        net: false,
        tls: false,
        dns: false,
        child_process: false,
        'utf-8-validate': false,
        'bufferutil': false,
      };
    }
    return config;
  },
};

// Apply bundle analyzer only when explicitly enabled
// This prevents Turbopack warnings about webpack-specific configurations
const configWithAnalyzer = process.env.ANALYZE === 'true'
  ? withBundleAnalyzer(nextConfig)
  : nextConfig;

export default withSentryConfig(configWithAnalyzer, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  silent: !process.env.CI,
  widenClientFileUpload: true,
  disableLogger: true,
  automaticVercelMonitors: false,
});
