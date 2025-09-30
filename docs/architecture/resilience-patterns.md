# Resilience Patterns

## Circuit Breaker Implementation

**Purpose:** Prevent cascade failures when external services are unavailable

### Circuit Breaker Configuration
```typescript
// utils/circuitBreaker.ts
import CircuitBreaker from 'opossum';

interface CircuitBreakerConfig {
  timeout: number;
  errorThresholdPercentage: number;
  resetTimeout: number;
  rollingCountTimeout: number;
  rollingCountBuckets: number;
}

const defaultConfig: CircuitBreakerConfig = {
  timeout: 3000, // 3 seconds
  errorThresholdPercentage: 50, // Open circuit if 50% of requests fail
  resetTimeout: 30000, // Try again after 30 seconds
  rollingCountTimeout: 10000, // Count errors over 10 seconds
  rollingCountBuckets: 10, // Number of buckets for rolling window
};

// NSE/BSE API Circuit Breaker
export const nseApiBreaker = new CircuitBreaker(
  async (endpoint: string) => {
    return await fetchNSEData(endpoint);
  },
  {
    ...defaultConfig,
    fallback: async (endpoint: string) => {
      // Return cached data if available
      return await getCachedData(`nse:${endpoint}`);
    },
  }
);

// WhatsApp API Circuit Breaker
export const whatsappBreaker = new CircuitBreaker(
  async (message: any) => {
    return await twilioClient.messages.create(message);
  },
  {
    ...defaultConfig,
    timeout: 5000, // WhatsApp needs more time
    fallback: async (message: any) => {
      // Queue for retry
      await queueService.addToRetryQueue('whatsapp', message);
      return { status: 'queued', id: generateQueueId() };
    },
  }
);

// GMP Source Circuit Breaker with multiple fallbacks
export const gmpBreaker = new CircuitBreaker(
  async (ipoId: string) => {
    return await fetchGMPData(ipoId);
  },
  {
    ...defaultConfig,
    fallback: async (ipoId: string) => {
      // Try alternative sources in order
      const sources = ['ipowatch', 'investorgain', 'chittorgarh'];
      for (const source of sources) {
        try {
          return await fetchGMPFromSource(source, ipoId);
        } catch (error) {
          continue;
        }
      }
      // Return last known value
      return await getLastKnownGMP(ipoId);
    },
  }
);
```

### Circuit Breaker States
```typescript
// Monitor circuit breaker states
nseApiBreaker.on('open', () => {
  logger.warn('NSE API circuit breaker is OPEN');
  alertService.send('NSE API is down', 'critical');
});

nseApiBreaker.on('halfOpen', () => {
  logger.info('NSE API circuit breaker is HALF-OPEN, testing...');
});

nseApiBreaker.on('close', () => {
  logger.info('NSE API circuit breaker is CLOSED, service recovered');
});
```

## Retry Policies

**Purpose:** Implement intelligent retry strategies with exponential backoff

### Retry Configuration
```typescript
// utils/retryPolicy.ts
import pRetry from 'p-retry';
import { AbortError } from 'p-retry';

interface RetryConfig {
  retries: number;
  factor: number;
  minTimeout: number;
  maxTimeout: number;
  randomize: boolean;
}

const retryConfigs: Record<string, RetryConfig> = {
  critical: {
    retries: 5,
    factor: 2, // Exponential backoff factor
    minTimeout: 1000, // 1 second
    maxTimeout: 30000, // 30 seconds
    randomize: true, // Add jitter
  },
  standard: {
    retries: 3,
    factor: 2,
    minTimeout: 500,
    maxTimeout: 5000,
    randomize: true,
  },
  quick: {
    retries: 2,
    factor: 1.5,
    minTimeout: 200,
    maxTimeout: 1000,
    randomize: false,
  },
};

// Retry wrapper for external API calls
export async function withRetry<T>(
  fn: () => Promise<T>,
  configType: 'critical' | 'standard' | 'quick' = 'standard',
  shouldRetry?: (error: any) => boolean
): Promise<T> {
  const config = retryConfigs[configType];

  return pRetry(fn, {
    retries: config.retries,
    factor: config.factor,
    minTimeout: config.minTimeout,
    maxTimeout: config.maxTimeout,
    randomize: config.randomize,
    onFailedAttempt: (error) => {
      logger.warn(`Attempt ${error.attemptNumber} failed: ${error.message}`);

      // Don't retry on specific errors
      if (error.response?.status === 404 || error.response?.status === 401) {
        throw new AbortError(error.message);
      }

      // Custom retry logic
      if (shouldRetry && !shouldRetry(error)) {
        throw new AbortError('Retry condition not met');
      }
    },
  });
}

// Example usage in services
export class IPODataService {
  async fetchIPOData(ipoId: string) {
    return withRetry(
      async () => {
        const data = await nseApiBreaker.fire(`/ipo/${ipoId}`);
        if (!data) throw new Error('No data received');
        return data;
      },
      'critical',
      (error) => !error.message.includes('IPO not found')
    );
  }

  async updateGMP(ipoId: string) {
    return withRetry(
      async () => {
        const gmp = await gmpBreaker.fire(ipoId);
        await this.saveGMP(gmp);
        return gmp;
      },
      'standard'
    );
  }
}
```

## Bulkhead Pattern

**Purpose:** Isolate resources to prevent total system failure

```typescript
// utils/bulkhead.ts
import Bottleneck from 'bottleneck';

// Create separate resource pools for different operations
export const scraperPool = new Bottleneck({
  maxConcurrent: 5, // Max 5 concurrent scrapers
  minTime: 2000, // Min 2 seconds between operations
  reservoir: 100, // 100 requests per interval
  reservoirRefreshAmount: 100,
  reservoirRefreshInterval: 60 * 1000, // Refill every minute
});

export const apiPool = new Bottleneck({
  maxConcurrent: 20,
  minTime: 50,
});

export const databasePool = new Bottleneck({
  maxConcurrent: 10,
  minTime: 10,
});

// Usage example
export async function bulkheadFetch(url: string, pool: Bottleneck) {
  return pool.schedule(async () => {
    return await fetch(url);
  });
}
```
