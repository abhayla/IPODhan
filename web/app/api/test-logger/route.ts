import { NextResponse } from 'next/server';
import { logger, createLogger } from '@/lib/logger';

/**
 * Test Logger API Route
 *
 * Tests Pino logger functionality with different log levels
 * GET /api/test-logger
 */
export async function GET() {
  try {
    // Test basic logger
    logger.info('Testing basic logger');
    logger.debug('Debug message (may not show in production)');
    logger.warn('Warning message');

    // Test child logger with context
    const requestLogger = createLogger({ requestId: '123', endpoint: '/api/test-logger' });
    requestLogger.info('Testing child logger with context');

    return NextResponse.json({
      success: true,
      message: 'Logger test successful',
      logs: [
        'Check console for log output',
        'In development: colored output',
        'In production: JSON output',
      ],
    });
  } catch (error) {
    logger.error({ error }, 'Logger test failed');
    return NextResponse.json(
      {
        success: false,
        error: 'Logger test failed',
      },
      { status: 500 }
    );
  }
}
