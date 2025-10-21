import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

// Custom metrics
const errorRate = new Rate('errors');
const degradationPoint = new Trend('degradation_point');

// Stress test configuration - find breaking point
export const options = {
  stages: [
    { duration: '2m', target: 100 },   // Warm up
    { duration: '2m', target: 500 },   // Normal load
    { duration: '2m', target: 1000 },  // High load
    { duration: '2m', target: 1500 },  // Very high load
    { duration: '1m', target: 2000 },  // Peak stress
    { duration: '2m', target: 0 },     // Ramp down
  ],
  thresholds: {
    'http_req_duration': ['p95<1000'],  // More lenient for stress test
    'http_req_failed': ['rate<0.05'],   // Allow 5% error rate
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';

const CRITICAL_ENDPOINTS = [
  '/api/ipos',
  '/api/ipos?status=OPEN',
  '/api/subscription/latest',
  '/api/gmp/latest',
];

export default function () {
  const endpoint = CRITICAL_ENDPOINTS[Math.floor(Math.random() * CRITICAL_ENDPOINTS.length)];
  const url = `${BASE_URL}${endpoint}`;

  const res = http.get(url, { timeout: '15s' });

  const success = check(res, {
    'status is 200': (r) => r.status === 200,
    'response time < 1000ms': (r) => r.timings.duration < 1000,
    'response time < 2000ms': (r) => r.timings.duration < 2000,
  });

  if (!success) {
    errorRate.add(1);
  }

  // Track when degradation starts (p95 > 500ms)
  if (res.timings.duration > 500) {
    degradationPoint.add(__VU); // Record VU count when degradation occurs
  }

  sleep(1);
}

export function handleSummary(data) {
  return {
    'test-results/phase-5/k6-stress-test-summary.json': JSON.stringify(data, null, 2),
  };
}
