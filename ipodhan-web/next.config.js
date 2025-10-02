/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  eslint: {
    // Disable ESLint during build (linting done separately)
    ignoreDuringBuilds: true,
  },
  images: {
    domains: ['api.ipodhan.com', 'cdn.ipodhan.com'],
    formats: ['image/avif', 'image/webp'],
    deviceSizes: [640, 750, 828, 1080, 1200, 1920, 2048, 3840],
    imageSizes: [16, 32, 48, 64, 96, 128, 256, 384],
  },
  // Code splitting and optimization
  experimental: {
    // optimizeCss: true, // Disabled - requires critters module
  },
  // Compression
  compress: true,
  // Production source maps (disabled for smaller bundle)
  productionBrowserSourceMaps: false,
}

module.exports = nextConfig