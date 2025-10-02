/**
 * Environment Configuration
 * Centralized environment variable access per coding standards
 * Never access process.env directly - always use this config
 */

export const config = {
  api: {
    baseUrl: process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000/api',
    scoreBaseUrl: process.env.NEXT_PUBLIC_SCORE_API_URL || 'http://localhost:8001/api',
    timeout: 10000, // 10 seconds
  },
  app: {
    environment: process.env.NODE_ENV || 'development',
    isDevelopment: process.env.NODE_ENV === 'development',
    isProduction: process.env.NODE_ENV === 'production',
  },
  analytics: {
    googleAnalyticsId: process.env.NEXT_PUBLIC_GA_ID || '',
  },
  features: {
    enableWebSockets: process.env.NEXT_PUBLIC_ENABLE_WEBSOCKETS === 'true',
    enableAnalytics: process.env.NEXT_PUBLIC_ENABLE_ANALYTICS === 'true',
  },
} as const;

// Type-safe config access
export type Config = typeof config;
