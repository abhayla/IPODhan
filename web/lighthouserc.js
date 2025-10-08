/**
 * Lighthouse CI Configuration
 *
 * Story: 8.3 - Performance Optimization
 * Purpose: Automated performance testing in CI/CD pipeline
 *
 * Thresholds:
 * - Performance: >90 (AC#1)
 * - LCP: <2.5s (AC#2)
 * - FID: <100ms (AC#3)
 * - CLS: <0.1 (AC#4)
 *
 * Run locally: npm run perf:test
 * Run in CI: npm run perf:ci
 */

module.exports = {
  ci: {
    collect: {
      // Number of runs to average (reduces variance)
      numberOfRuns: 3,

      // URLs to test
      url: [
        'http://localhost:3000/', // Homepage
        'http://localhost:3000/ipos', // IPO listing (if route exists)
        'http://localhost:3000/dashboard', // Dashboard
        'http://localhost:3000/tools/lot-calculator', // Calculator tool
        'http://localhost:3000/tools/compare', // Comparison tool
      ],

      // Start local server for testing
      startServerCommand: 'npm run start',
      startServerReadyPattern: 'Ready',
      startServerReadyTimeout: 30000, // 30 seconds

      // Chrome settings
      settings: {
        // Emulate slow 3G connection for realistic testing
        throttling: {
          rttMs: 150,
          throughputKbps: 1638.4,
          cpuSlowdownMultiplier: 4,
        },
        // Desktop viewport
        formFactor: 'desktop',
        screenEmulation: {
          mobile: false,
          width: 1350,
          height: 940,
          deviceScaleFactor: 1,
        },
      },
    },

    assert: {
      preset: 'lighthouse:recommended',

      // Story 8.3 Acceptance Criteria Assertions
      assertions: {
        // AC#1: Performance Score >90
        'categories:performance': ['error', { minScore: 0.9 }],
        'categories:accessibility': ['warn', { minScore: 0.9 }],
        'categories:best-practices': ['warn', { minScore: 0.9 }],
        'categories:seo': ['warn', { minScore: 0.9 }],

        // AC#2: LCP <2.5s on 3G connection
        'largest-contentful-paint': ['error', { maxNumericValue: 2500 }],

        // AC#3: FID <100ms
        'max-potential-fid': ['error', { maxNumericValue: 100 }],

        // AC#4: CLS <0.1
        'cumulative-layout-shift': ['error', { maxNumericValue: 0.1 }],

        // Additional performance metrics
        'first-contentful-paint': ['warn', { maxNumericValue: 1800 }],
        'speed-index': ['warn', { maxNumericValue: 3400 }],
        'total-blocking-time': ['warn', { maxNumericValue: 300 }],
        'interactive': ['warn', { maxNumericValue: 3800 }],

        // Resource hints
        'uses-rel-preconnect': 'off',
        'uses-rel-preload': 'off',

        // Disable some assertions that may be too strict
        'unsized-images': 'warn',
        'unused-javascript': 'warn',
        'unused-css-rules': 'warn',

        // Enable critical assertions
        'bootup-time': ['warn', { maxNumericValue: 3500 }],
        'mainthread-work-breakdown': ['warn', { maxNumericValue: 4000 }],
        'dom-size': ['warn', { maxNumericValue: 1500 }],
      },
    },

    upload: {
      // Upload results to temporary public storage (free)
      target: 'temporary-public-storage',

      // Alternative: Upload to local filesystem
      // target: 'filesystem',
      // outputDir: './lighthouse-reports',
    },
  },
};
