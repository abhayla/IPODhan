/**
 * Shared API Error Response Helper (T-330 P2-5)
 *
 * Every API route error path MUST return a generic public body and log the
 * real error detail server-side, through this single helper - never inline
 * per-route. A raw driver/repository error message can contain SQL text and
 * bound parameter values (e.g. Postgres unique-violation errors embed the
 * offending row: `Key (slug)=(some-company) already exists`), so echoing
 * `error.message` into a public response body is a data leak regardless of
 * NODE_ENV - unlike some pre-existing per-route helpers, this does NOT
 * special-case development mode.
 */

import { NextResponse } from 'next/server';
import { logger } from '../logger';
import { EntityNotFoundError } from './repository-errors';

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    requestId?: string;
    timestamp: string;
  };
}

const GENERIC_MESSAGES: Record<number, string> = {
  400: 'Invalid request',
  404: 'Resource not found',
  409: 'Conflict with existing data',
  500: 'An unexpected error occurred',
};

/**
 * Build and log a generic API error response.
 *
 * @param error - the caught error (or unknown)
 * @param route - route identifier for the log line, e.g. '/api/ipos/[slug]/score'
 * @param opts.status - HTTP status to return (default 500)
 * @param opts.code - machine-readable error code for the response body
 * @param opts.requestId - request-scoped id to echo back for tracing
 * @param opts.publicMessage - override the generic message for this status
 *   (still MUST NOT include any error/exception detail)
 */
export function apiErrorResponse(
  error: unknown,
  route: string,
  opts: {
    status?: number;
    code?: string;
    requestId?: string;
    publicMessage?: string;
  } = {}
): NextResponse<ApiErrorBody> {
  const status = opts.status ?? (error instanceof EntityNotFoundError ? 404 : 500);
  const code = opts.code ?? (status === 404 ? 'NOT_FOUND' : status === 400 ? 'VALIDATION_ERROR' : 'INTERNAL_ERROR');
  const publicMessage =
    opts.publicMessage ?? GENERIC_MESSAGES[status] ?? GENERIC_MESSAGES[500];

  // Real detail (message, stack, and for DB errors the underlying query/cause,
  // which can include SQL text and bound parameter values) is logged
  // server-side only - it never reaches the response body.
  logger.error(
    {
      route,
      status,
      code,
      requestId: opts.requestId,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    },
    `API error in ${route}`
  );

  return NextResponse.json(
    {
      error: {
        code,
        message: publicMessage,
        ...(opts.requestId ? { requestId: opts.requestId } : {}),
        timestamp: new Date().toISOString(),
      },
    },
    { status }
  );
}
