/**
 * OpenTelemetry Instrumentation
 *
 * Provides APM (Application Performance Monitoring) with automatic instrumentation
 * for HTTP, database, and Redis operations.
 */

import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { PrometheusExporter } from '@opentelemetry/exporter-prometheus';
import { logger } from '../logging/logger';

// Configure Prometheus exporter for metrics
const prometheusExporter = new PrometheusExporter(
  {
    port: parseInt(process.env.PROMETHEUS_PORT || '9464'),
    endpoint: '/metrics',
  },
  () => {
    const port = process.env.PROMETHEUS_PORT || '9464';
    logger.info('Prometheus metrics endpoint ready', {
      url: `http://localhost:${port}/metrics`,
    });
  }
);

// Configure OpenTelemetry SDK
export const sdk = new NodeSDK({
  metricReader: prometheusExporter, // PrometheusExporter is a MetricReader itself
  instrumentations: [
    getNodeAutoInstrumentations({
      // Disable file system instrumentation (too noisy)
      '@opentelemetry/instrumentation-fs': { enabled: false },
      // Enable HTTP instrumentation
      '@opentelemetry/instrumentation-http': {
        enabled: true,
        ignoreIncomingRequestHook: (request) => {
          // Ignore health check requests
          return request.url?.includes('/api/health') || false;
        },
      },
      // Enable PostgreSQL instrumentation
      '@opentelemetry/instrumentation-pg': { enabled: true },
      // Enable Redis instrumentation
      '@opentelemetry/instrumentation-ioredis': { enabled: true },
    }),
  ],
});

/**
 * Start OpenTelemetry SDK
 */
export function startInstrumentation() {
  try {
    sdk.start();
    logger.info('OpenTelemetry instrumentation started');
  } catch (error) {
    logger.error('Failed to start OpenTelemetry', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Shutdown OpenTelemetry SDK gracefully
 */
export async function shutdownInstrumentation() {
  try {
    await sdk.shutdown();
    logger.info('OpenTelemetry instrumentation stopped');
  } catch (error) {
    logger.error('Error stopping OpenTelemetry', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

// Handle graceful shutdown
process.on('SIGTERM', async () => {
  await shutdownInstrumentation();
  process.exit(0);
});

process.on('SIGINT', async () => {
  await shutdownInstrumentation();
  process.exit(0);
});
