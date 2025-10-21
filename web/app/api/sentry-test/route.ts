import { NextRequest, NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import {
  captureAPIError,
  trackPerformance,
  addBreadcrumb,
  reportMetric,
  isSentryInitialized,
} from '@/lib/monitoring/sentry-utils';

/**
 * Sentry Integration Test Endpoint
 *
 * Tests various Sentry features:
 * - Error capture
 * - Performance tracking
 * - Breadcrumbs
 * - Custom metrics
 * - Transactions
 *
 * Usage: GET /api/sentry-test?test=all
 */
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const testType = searchParams.get('test') || 'all';

  // Check if Sentry is initialized
  if (!isSentryInitialized()) {
    return NextResponse.json({
      success: false,
      error: 'Sentry is not initialized',
      message: 'Please set NEXT_PUBLIC_SENTRY_DSN in .env.local',
    }, { status: 500 });
  }

  const results: Record<string, any> = {
    sentryInitialized: true,
    testsRun: [],
    eventIds: [],
  };

  try {
    // Test 1: Simple message capture
    if (testType === 'all' || testType === 'message') {
      addBreadcrumb('Starting Sentry integration test', {
        testType,
        timestamp: new Date().toISOString(),
      });

      const messageEventId = Sentry.captureMessage(
        'Sentry integration test - Message capture',
        'info'
      );
      results.testsRun.push('message_capture');
      results.eventIds.push(messageEventId);
    }

    // Test 2: Error capture with context
    if (testType === 'all' || testType === 'error') {
      try {
        throw new Error('Sentry integration test - Error capture');
      } catch (error) {
        const errorEventId = captureAPIError(error as Error, {
          endpoint: '/api/sentry-test',
          method: 'GET',
          statusCode: 500,
          requestId: 'test-request-123',
          queryParams: { test: testType },
        });
        results.testsRun.push('error_capture');
        results.eventIds.push(errorEventId);
      }
    }

    // Test 3: Performance tracking
    if (testType === 'all' || testType === 'performance') {
      const perfResult = await trackPerformance(
        'sentry-test-operation',
        async () => {
          // Simulate some work
          await new Promise(resolve => setTimeout(resolve, 100));
          return { data: 'test' };
        },
        {
          category: 'test',
          operation: 'integration_test',
        }
      );
      results.testsRun.push('performance_tracking');
      results.performanceResult = perfResult;
    }

    // Test 4: Transaction
    if (testType === 'all' || testType === 'transaction') {
      const transaction = Sentry.startInactiveSpan({
        op: 'test',
        name: 'Sentry Integration Test Transaction',
        attributes: {
          test_type: testType,
        },
      });

      // Simulate child spans
      const childSpan1 = Sentry.startInactiveSpan({
        op: 'db.query',
        name: 'Simulated Database Query',
      });
      await new Promise(resolve => setTimeout(resolve, 50));
      childSpan1?.end();

      const childSpan2 = Sentry.startInactiveSpan({
        op: 'cache.get',
        name: 'Simulated Cache Lookup',
      });
      await new Promise(resolve => setTimeout(resolve, 30));
      childSpan2?.end();

      transaction?.end();
      results.testsRun.push('transaction_tracking');
    }

    // Test 5: Breadcrumbs
    if (testType === 'all' || testType === 'breadcrumbs') {
      addBreadcrumb('User action simulated', {
        action: 'view_ipo',
        ipoSlug: 'test-ipo',
      });

      addBreadcrumb('Database query simulated', {
        table: 'ipos',
        operation: 'select',
        duration: 42,
      }, 'debug');

      addBreadcrumb('Cache hit', {
        key: 'ipo:slug:test-ipo',
        ttl: 900,
      }, 'info');

      results.testsRun.push('breadcrumbs');
    }

    // Test 6: Custom metrics
    if (testType === 'all' || testType === 'metrics') {
      reportMetric('test.response_time', 123, 'millisecond', {
        endpoint: '/api/sentry-test',
      });

      reportMetric('test.cache_hit_rate', 85.5, 'none', {
        cache: 'redis',
      });

      results.testsRun.push('custom_metrics');
    }

    // Test 7: User context
    if (testType === 'all' || testType === 'user') {
      Sentry.setUser({
        id: 'test-user-123',
        email: 'test@ipodhan.com',
        username: 'test_user',
      });

      Sentry.captureMessage('Test event with user context', 'info');
      results.testsRun.push('user_context');

      // Clear user context
      Sentry.setUser(null);
    }

    // Test 8: Tags and context
    if (testType === 'all' || testType === 'tags') {
      Sentry.setTag('test_type', testType);
      Sentry.setTag('environment', 'test');
      Sentry.setContext('test_metadata', {
        timestamp: new Date().toISOString(),
        version: '1.0.0',
        testRun: Math.random().toString(36).substring(7),
      });

      Sentry.captureMessage('Test event with tags and context', 'info');
      results.testsRun.push('tags_and_context');
    }

    return NextResponse.json({
      success: true,
      message: 'Sentry integration test completed successfully',
      results,
      instructions: {
        checkDashboard: 'Visit your Sentry dashboard to see the captured events',
        url: 'https://sentry.io/organizations/[your-org]/issues/',
        note: 'Events may take a few seconds to appear in the dashboard',
      },
      availableTests: {
        all: 'Run all tests',
        message: 'Test message capture',
        error: 'Test error capture',
        performance: 'Test performance tracking',
        transaction: 'Test transaction tracking',
        breadcrumbs: 'Test breadcrumbs',
        metrics: 'Test custom metrics',
        user: 'Test user context',
        tags: 'Test tags and context',
      },
      exampleUsage: {
        all: '/api/sentry-test?test=all',
        error: '/api/sentry-test?test=error',
        performance: '/api/sentry-test?test=performance',
      },
    });
  } catch (error) {
    const errorEventId = Sentry.captureException(error);

    return NextResponse.json({
      success: false,
      error: 'Test failed',
      message: error instanceof Error ? error.message : 'Unknown error',
      eventId: errorEventId,
      results,
    }, { status: 500 });
  }
}

/**
 * Test error handling in POST request
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // Simulate validation error
    if (!body.testData) {
      throw new Error('Missing testData in request body');
    }

    // Simulate processing
    addBreadcrumb('Processing POST request', body);

    await trackPerformance(
      'process-test-data',
      async () => {
        await new Promise(resolve => setTimeout(resolve, 50));
        return body;
      },
      { method: 'POST' }
    );

    return NextResponse.json({
      success: true,
      message: 'POST request processed successfully',
      data: body,
    });
  } catch (error) {
    const errorEventId = captureAPIError(error as Error, {
      endpoint: '/api/sentry-test',
      method: 'POST',
      statusCode: 400,
    });

    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      eventId: errorEventId,
    }, { status: 400 });
  }
}
