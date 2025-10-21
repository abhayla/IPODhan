import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend, Counter } from 'k6/metrics';

// Custom metrics
const errorRate = new Rate('errors');
const apiResponseTime = new Trend('api_response_time');
const successCounter = new Counter('successful_requests');
const failureCounter = new Counter('failed_requests');

// Load test configuration
export const options = {
  stages: [
    { duration: '1m', target: 50 },   // Ramp up to 50 users
    { duration: '3m', target: 100 },  // Stay at 100 users
    { duration: '2m', target: 200 },  // Ramp to 200 users
    { duration: '2m', target: 500 },  // Peak load 500 users
    { duration: '2m', target: 100 },  // Ramp down
    { duration: '1m', target: 0 },    // Cool down
  ],
  thresholds: {
    'http_req_duration': ['p50<200', 'p95<500', 'p99<1000'],
    'http_req_failed': ['rate<0.01'],  // Error rate < 1%
    'errors': ['rate<0.05'],           // Custom error rate < 5%
    'api_response_time': ['p95<500', 'p99<1000'],
  },
  summaryTrendStats: ['min', 'avg', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';

// API endpoints with realistic traffic weights
const API_ENDPOINTS = [
  { url: '/api/ipos', weight: 30, name: 'IPO List' },
  { url: '/api/ipos?category=MAINBOARD', weight: 15, name: 'Mainboard IPOs' },
  { url: '/api/ipos?category=SME', weight: 10, name: 'SME IPOs' },
  { url: '/api/ipos?status=UPCOMING', weight: 15, name: 'Upcoming IPOs' },
  { url: '/api/ipos?status=OPEN', weight: 20, name: 'Open IPOs' },
  { url: '/api/subscription/latest', weight: 15, name: 'Latest Subscription' },
  { url: '/api/gmp/latest', weight: 10, name: 'Latest GMP' },
  { url: '/api/calendar', weight: 10, name: 'Calendar' },
  { url: '/api/calendar/upcoming', weight: 5, name: 'Upcoming Calendar' },
];

// Helper to select weighted random endpoint
function selectWeightedEndpoint() {
  const totalWeight = API_ENDPOINTS.reduce((sum, ep) => sum + ep.weight, 0);
  let random = Math.random() * totalWeight;

  for (const endpoint of API_ENDPOINTS) {
    random -= endpoint.weight;
    if (random <= 0) {
      return endpoint;
    }
  }

  return API_ENDPOINTS[0];
}

export default function () {
  const endpoint = selectWeightedEndpoint();
  const url = `${BASE_URL}${endpoint.url}`;

  const startTime = Date.now();
  const res = http.get(url, {
    tags: { name: endpoint.name },
    timeout: '10s',
  });
  const duration = Date.now() - startTime;

  // Record metrics
  apiResponseTime.add(duration, { endpoint: endpoint.name });

  // Validate response
  const success = check(res, {
    'status is 200': (r) => r.status === 200,
    'response time < 500ms': (r) => r.timings.duration < 500,
    'response time < 1000ms': (r) => r.timings.duration < 1000,
    'has valid JSON': (r) => {
      try {
        const body = JSON.parse(r.body);
        return body !== null && typeof body === 'object';
      } catch {
        return false;
      }
    },
    'response has data': (r) => {
      try {
        const body = JSON.parse(r.body);
        return body.data !== undefined || body.error !== undefined;
      } catch {
        return false;
      }
    },
    'content-type is JSON': (r) => r.headers['Content-Type']?.includes('application/json'),
  });

  if (success) {
    successCounter.add(1);
  } else {
    failureCounter.add(1);
    errorRate.add(1);
    console.error(`Failed request to ${endpoint.name}: Status ${res.status}, Duration: ${duration}ms`);
  }

  // Think time between requests (1-3 seconds)
  sleep(Math.random() * 2 + 1);
}

export function handleSummary(data) {
  return {
    'test-results/phase-5/k6-api-load-test-summary.json': JSON.stringify(data, null, 2),
    'stdout': textSummary(data, { indent: ' ', enableColors: true }),
  };
}

function textSummary(data, options) {
  const { indent = '', enableColors = false } = options;
  let summary = '\n';

  summary += `${indent}Load Test Summary\n`;
  summary += `${indent}================\n\n`;

  // Request stats
  summary += `${indent}Total Requests: ${data.metrics.http_reqs.values.count}\n`;
  summary += `${indent}Failed Requests: ${data.metrics.http_req_failed.values.passes || 0}\n`;
  summary += `${indent}Request Rate: ${data.metrics.http_reqs.values.rate.toFixed(2)} req/s\n\n`;

  // Response time stats
  summary += `${indent}Response Times:\n`;
  summary += `${indent}  Min: ${data.metrics.http_req_duration.values.min.toFixed(2)}ms\n`;
  summary += `${indent}  Avg: ${data.metrics.http_req_duration.values.avg.toFixed(2)}ms\n`;
  summary += `${indent}  Med: ${data.metrics.http_req_duration.values.med.toFixed(2)}ms\n`;
  summary += `${indent}  p90: ${data.metrics.http_req_duration.values['p(90)'].toFixed(2)}ms\n`;
  summary += `${indent}  p95: ${data.metrics.http_req_duration.values['p(95)'].toFixed(2)}ms\n`;
  summary += `${indent}  p99: ${data.metrics.http_req_duration.values['p(99)'].toFixed(2)}ms\n`;
  summary += `${indent}  Max: ${data.metrics.http_req_duration.values.max.toFixed(2)}ms\n\n`;

  // Thresholds
  summary += `${indent}Thresholds:\n`;
  Object.entries(data.metrics).forEach(([name, metric]) => {
    if (metric.thresholds) {
      Object.entries(metric.thresholds).forEach(([threshold, result]) => {
        const status = result.ok ? '✓ PASS' : '✗ FAIL';
        summary += `${indent}  ${status}: ${name} ${threshold}\n`;
      });
    }
  });

  return summary;
}
