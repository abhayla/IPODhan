import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  eslint: {
    // Disable ESLint during build since we have a separate lint command
    // This prevents ESLint configuration incompatibilities with ESLint v8
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
