import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Rate, Trend, Counter } from 'k6/metrics';

// Custom metrics
const errorRate = new Rate('errors');
const journeyDuration = new Trend('journey_duration');
const journeySuccess = new Counter('journey_success');
const journeyFailure = new Counter('journey_failure');

// User journey configuration
export const options = {
  stages: [
    { duration: '2m', target: 50 },   // Ramp up
    { duration: '5m', target: 100 },  // Sustained load
    { duration: '2m', target: 200 },  // Peak
    { duration: '2m', target: 50 },   // Ramp down
    { duration: '1m', target: 0 },    // Cool down
  ],
  thresholds: {
    'http_req_duration': ['p95<500', 'p99<1000'],
    'journey_duration': ['p95<30000'],  // Complete journey in < 30s
    'errors': ['rate<0.02'],            // < 2% error rate
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';

export default function () {
  const journeyStart = Date.now();
  let journeySuccessful = true;

  // Journey 1: Investor researching upcoming IPOs
  group('Journey: Research Upcoming IPO', function () {
    // Step 1: Land on homepage
    group('Step 1: Homepage', function () {
      const res = http.get(`${BASE_URL}/`);
      if (!check(res, { 'homepage loads': (r) => r.status === 200 })) {
        journeySuccessful = false;
      }
      sleep(2); // User reads homepage
    });

    // Step 2: Navigate to upcoming IPOs
    group('Step 2: Upcoming IPOs List', function () {
      const res = http.get(`${BASE_URL}/api/ipos?status=UPCOMING`);
      if (!check(res, {
        'upcoming list loads': (r) => r.status === 200,
        'has IPO data': (r) => {
          try {
            const body = JSON.parse(r.body);
            return Array.isArray(body.data) && body.data.length > 0;
          } catch {
            return false;
          }
        }
      })) {
        journeySuccessful = false;
        return; // Can't continue without IPO list
      }

      const ipos = JSON.parse(res.body).data;
      sleep(3); // User browses list

      // Step 3: Click on first upcoming IPO
      if (ipos.length > 0) {
        const randomIPO = ipos[Math.floor(Math.random() * Math.min(3, ipos.length))];

        group('Step 3: IPO Detail Page', function () {
          const detailRes = http.get(`${BASE_URL}/api/ipos/${randomIPO.slug}`);
          if (!check(detailRes, {
            'detail page loads': (r) => r.status === 200,
            'has company data': (r) => {
              try {
                const body = JSON.parse(r.body);
                return body.data?.companyName !== undefined;
              } catch {
                return false;
              }
            }
          })) {
            journeySuccessful = false;
          }
          sleep(5); // User reads IPO details
        });

        // Step 4: Check subscription status (if IPO is open)
        if (randomIPO.status === 'OPEN' || Math.random() > 0.5) {
          group('Step 4: Subscription Data', function () {
            const subRes = http.get(`${BASE_URL}/api/subscription/latest/${randomIPO.id}`);
            check(subRes, {
              'subscription data loads': (r) => r.status === 200 || r.status === 404  // 404 is OK if no data
            });
            sleep(2);
          });
        }

        // Step 5: Check GMP
        group('Step 5: GMP Data', function () {
          const gmpRes = http.get(`${BASE_URL}/api/gmp/latest/${randomIPO.id}`);
          check(gmpRes, {
            'GMP data loads': (r) => r.status === 200 || r.status === 404  // 404 is OK if no data
          });
          sleep(2);
        });

        // Step 6: View calendar for listing date
        group('Step 6: Calendar', function () {
          const calRes = http.get(`${BASE_URL}/api/calendar`);
          check(calRes, { 'calendar loads': (r) => r.status === 200 });
          sleep(2);
        });
      }
    });
  });

  const journeyEnd = Date.now();
  const duration = journeyEnd - journeyStart;
  journeyDuration.add(duration);

  if (journeySuccessful) {
    journeySuccess.add(1);
  } else {
    journeyFailure.add(1);
    errorRate.add(1);
  }

  // Think time before next journey
  sleep(Math.random() * 5 + 5); // 5-10 seconds
}

export function handleSummary(data) {
  return {
    'test-results/phase-5/k6-user-journey-summary.json': JSON.stringify(data, null, 2),
  };
}
