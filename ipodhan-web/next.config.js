/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  images: {
    domains: ['api.ipodhan.com', 'cdn.ipodhan.com'],
  },
}

module.exports = nextConfig