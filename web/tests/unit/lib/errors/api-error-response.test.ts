import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), child: vi.fn(() => ({ error: vi.fn() })) },
}));

import { logger } from '@/lib/logger';
import { apiErrorResponse } from '@/lib/errors/api-error-response';
import { EntityNotFoundError, DatabaseError } from '@/lib/errors/repository-errors';

describe('apiErrorResponse (T-330 P2-5)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('never leaks a raw SQL error message into the public response body', async () => {
    const sqlError = new Error(
      'duplicate key value violates unique constraint "ipos_slug_key" DETAIL: Key (slug)=(some-company-ltd) already exists.'
    );

    const res = apiErrorResponse(sqlError, '/api/test-route');
    const body = await res.json();

    expect(res.status).toBe(500);
    const bodyText = JSON.stringify(body);
    expect(bodyText).not.toMatch(/duplicate key/i);
    expect(bodyText).not.toMatch(/ipos_slug_key/);
    expect(bodyText).not.toMatch(/some-company-ltd/);
    expect(body.error.message).toBe('An unexpected error occurred');
  });

  it('logs the real error detail server-side', () => {
    const sqlError = new Error('INSERT INTO ipos ... duplicate key');
    apiErrorResponse(sqlError, '/api/test-route', { requestId: 'req_123' });

    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        route: '/api/test-route',
        requestId: 'req_123',
        error: 'INSERT INTO ipos ... duplicate key',
      }),
      expect.stringContaining('/api/test-route')
    );
  });

  it('maps EntityNotFoundError to a generic 404 without echoing the identifier', async () => {
    const notFound = new EntityNotFoundError('IPO', 'secret-internal-id-999');

    const res = apiErrorResponse(notFound, '/api/test-route');
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error.code).toBe('NOT_FOUND');
    expect(JSON.stringify(body)).not.toMatch(/secret-internal-id-999/);
  });

  it('never echoes a DatabaseError query/cause into the response body', async () => {
    const dbError = new DatabaseError(
      'Query failed',
      'SELECT * FROM ipos WHERE api_secret = $1',
      new Error('connection reset')
    );

    const res = apiErrorResponse(dbError, '/api/test-route');
    const body = await res.json();

    expect(JSON.stringify(body)).not.toMatch(/api_secret/);
    expect(JSON.stringify(body)).not.toMatch(/connection reset/);
  });

  it('supports overriding status/code/publicMessage for validation-style errors', async () => {
    const res = apiErrorResponse(new Error('bad input'), '/api/test-route', {
      status: 400,
      code: 'VALIDATION_ERROR',
      publicMessage: 'Invalid or missing slug parameter',
    });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.message).toBe('Invalid or missing slug parameter');
  });

  it('includes requestId in the response body when provided, for client-side tracing', async () => {
    const res = apiErrorResponse(new Error('x'), '/api/test-route', { requestId: 'req_abc' });
    const body = await res.json();

    expect(body.error.requestId).toBe('req_abc');
  });
});
