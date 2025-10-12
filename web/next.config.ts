import type { NextConfig } from "next";

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
  serverExternalPackages: ['pg', 'pg-pool', 'pgpass'],

  // Performance: Optimize package imports
  experimental: {
    optimizePackageImports: ['lucide-react', '@radix-ui/react-icons'],
    // Turbopack configuration
    // Note: Turbopack resolveAlias doesn't support boolean values like webpack's resolve.fallback
    // The webpack fallback configuration below handles these for production builds
  },

  // Performance: Browser caching headers for static assets
  async headers() {
    return [
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

export default withBundleAnalyzer(nextConfig);
