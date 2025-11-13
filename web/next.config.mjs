// TEMPORARILY DISABLED: Sentry causing webpack errors
// import { withSentryConfig } from '@sentry/nextjs';
import bundleAnalyzer from '@next/bundle-analyzer';

// Bundle analyzer configuration
const withBundleAnalyzer = bundleAnalyzer({
  enabled: process.env.ANALYZE === 'true',
});

const nextConfig = {
  // D3.js Code Splitting Strategy (Phase 2 - Data Intelligence Surface)
  // - Use next/dynamic for all D3.js visualization components
  // - D3.js automatically code-splits via dynamic imports (~200KB)
  // - No custom webpack splitChunks needed (avoids module loading errors)
  // - Components: ScoreBreakdown, SectorHeatMap, CorrelationMatrix, PredictiveMeter, TimeSeriesPlayback

  // Package transpilation (Session 5 Fix)
  // ESM packages require transpilation for Next.js 15 webpack compatibility
  // See: docs/08-troubleshooting/RECHARTS_WEBPACK_FIX.md
  transpilePackages: ['recharts', 'react-icons', 'date-fns'],

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
    if (!isServer) {
      // Exclude Node.js built-ins from browser bundle (fixes pg module issues)
      config.resolve = config.resolve || {};
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

// Apply bundle analyzer
const configWithAnalyzer = withBundleAnalyzer(nextConfig);

// TEMPORARILY DISABLED: Sentry configuration causing webpack module loading errors
// TODO: Migrate to instrumentation-based Sentry setup per Next.js 15 recommendations
// export default withSentryConfig(configWithAnalyzer, {...});

export default configWithAnalyzer;
