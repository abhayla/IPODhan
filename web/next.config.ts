import type { NextConfig } from "next";
// TEMPORARILY DISABLED: Sentry causing webpack errors
// import { withSentryConfig } from '@sentry/nextjs';

// Bundle analyzer configuration
const withBundleAnalyzer = require('@next/bundle-analyzer')({
  enabled: process.env.ANALYZE === 'true',
});

const nextConfig: NextConfig = {
  // Turbopack is default in Next.js 16 - empty config to silence build warning
  turbopack: {},

  // Exclude server-only packages from browser bundle
  serverExternalPackages: ['pg', 'pg-pool', 'pgpass', 'drizzle-orm'],

  // Performance: Optimize package imports
  // DISABLED: Causes text replacement bugs in Next.js 15.5.4 (addEventListener → addEventHiListBulletener)
  // experimental: {
  //   optimizePackageImports: ['@radix-ui/react-icons'],
  // },

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
