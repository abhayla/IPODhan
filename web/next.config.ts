import type { NextConfig } from "next";
import { withSentryConfig } from '@sentry/nextjs';

// Bundle analyzer configuration
const withBundleAnalyzer = require('@next/bundle-analyzer')({
  enabled: process.env.ANALYZE === 'true',
});

const nextConfig: NextConfig = {
  eslint: {
    // Disable ESLint during build since we have a separate lint command
    // This prevents ESLint configuration incompatibilities with ESLint v8
    ignoreDuringBuilds: true,
  },

  // Exclude server-only packages from browser bundle
  serverExternalPackages: ['pg', 'pg-pool', 'pgpass', 'drizzle-orm'],

  // Performance: Optimize package imports
  experimental: {
    optimizePackageImports: ['lucide-react', '@radix-ui/react-icons'],
  },

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

  // Performance: Webpack optimizations for code splitting
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

      config.optimization = {
        ...config.optimization,
        splitChunks: {
          chunks: 'all',
          cacheGroups: {
            default: false,
            vendors: false,
            // Framework chunk (react, react-dom, next)
            framework: {
              name: 'framework',
              test: /[\\/]node_modules[\\/](react|react-dom|next)[\\/]/,
              priority: 40,
              enforce: true,
            },
            // Common components used across routes
            commons: {
              name: 'commons',
              minChunks: 2,
              priority: 20,
            },
            // Large libraries (charts, etc.)
            lib: {
              test: /[\\/]node_modules[\\/]/,
              name(module: any) {
                const packageName = module.context.match(
                  /[\\/]node_modules[\\/](.*?)([\\/]|$)/
                )?.[1];
                return `npm.${packageName?.replace('@', '')}`;
              },
              priority: 10,
            },
          },
        },
      };
    }
    return config;
  },
};

// Apply bundle analyzer
const configWithAnalyzer = withBundleAnalyzer(nextConfig);

// Apply Sentry configuration
export default withSentryConfig(
  configWithAnalyzer,
  {
    // Sentry webpack plugin options
    silent: true, // Suppresses source map upload logs during build
    org: process.env.SENTRY_ORG || 'ipodhan',
    project: process.env.SENTRY_PROJECT || 'ipodhan-web',

    // Auth token for uploading source maps (optional in development)
    authToken: process.env.SENTRY_AUTH_TOKEN,

    // Only upload source maps in production builds
    dryRun: process.env.NODE_ENV !== 'production',
  },
  {
    // Sentry SDK configuration options

    // Upload source maps for error tracking
    widenClientFileUpload: true,

    // Transpile SDK for better compatibility
    transpileClientSDK: true,

    // Route for Sentry requests (bypasses ad blockers)
    tunnelRoute: '/monitoring',

    // Hide source maps from public (security)
    hideSourceMaps: true,

    // Disable Sentry logger to reduce console noise
    disableLogger: true,

    // Automatically tree-shake Sentry code in production
    automaticVercelMonitors: true,
  }
);
