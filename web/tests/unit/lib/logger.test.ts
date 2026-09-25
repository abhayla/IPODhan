/**
 * Unit test for #1073: web/lib/logger.ts (pino) had no field-name redaction,
 * so any field named password/secret/token/authorization/cookie reached the
 * log verbatim — including nested under a wrapped error (#954 made a
 * DatabaseError's enumerable fields, which can legitimately carry a
 * connectionString or password, serialize into the log via
 * pino.stdSerializers.err).
 *
 * Builds a real pino instance from the SAME `pinoOptions` the app logger
 * uses, pointed at an in-memory destination (pino's documented pattern for
 * testing a logger's actual output — capturing the pino destination, not
 * re-implementing redaction logic).
 */
import { describe, it, expect } from 'vitest';
import pino from 'pino';
import { Writable } from 'node:stream';
import { pinoOptions } from '@/lib/logger';

function captureLogger() {
  const lines: string[] = [];
  const dest = new Writable({
    write(chunk, _enc, cb) {
      lines.push(chunk.toString());
      cb();
    },
  });
  const testLogger = pino(pinoOptions, dest);
  return { testLogger, lines };
}

function lastLog(lines: string[]): Record<string, unknown> {
  return JSON.parse(lines[lines.length - 1]);
}

describe('logger redaction (#1073)', () => {
  it('redacts a top-level password field', () => {
    const { testLogger, lines } = captureLogger();
    testLogger.info({ password: 'hunter2' }, 'login attempt'); // secret-scan:allow
    expect(lastLog(lines).password).toBe('[Redacted]');
  });

  it('redacts top-level secret, token, authorization and cookie fields', () => {
    const { testLogger, lines } = captureLogger();
    testLogger.info(
      { secret: 's', token: 't', authorization: 'Bearer x', cookie: 'sid=1' },
      'creds'
    );
    const entry = lastLog(lines);
    expect(entry.secret).toBe('[Redacted]');
    expect(entry.token).toBe('[Redacted]');
    expect(entry.authorization).toBe('[Redacted]');
    expect(entry.cookie).toBe('[Redacted]');
  });

  it('redacts a nested req.headers.authorization field', () => {
    const { testLogger, lines } = captureLogger();
    testLogger.info({ req: { headers: { authorization: 'Bearer abc', cookie: 'sid=2' } } }, 'req');
    const entry = lastLog(lines) as { req: { headers: { authorization: string; cookie: string } } };
    expect(entry.req.headers.authorization).toBe('[Redacted]');
    expect(entry.req.headers.cookie).toBe('[Redacted]');
  });

  it('#954/#1073: a wrapped DatabaseError-shaped err carrying a password/connectionString is redacted, message/cause still readable', () => {
    const { testLogger, lines } = captureLogger();

    class DatabaseError extends Error {
      cause?: Error;
      password?: string;
      connectionString?: string;
      constructor(message: string, cause: Error) {
        super(message);
        this.name = 'DatabaseError';
        this.cause = cause;
        this.password = 'super-secret-db-pw'; // secret-scan:allow
        this.connectionString = 'postgres://app:super-secret-db-pw@host:5432/db'; // secret-scan:allow
      }
    }

    const wrapped = new DatabaseError('connect failed', new TypeError('ECONNREFUSED'));
    testLogger.error({ err: wrapped }, 'db connect failed');

    const entry = lastLog(lines) as {
      err: { message: string; password: string; connectionString: string; cause?: unknown };
    };
    // the class this fix must not regress (#954): message/cause still flow through
    expect(entry.err.message).toContain('connect failed');
    // the class this fix adds (#1073): sensitive enumerable fields are redacted
    expect(entry.err.password).toBe('[Redacted]');
    expect(entry.err.connectionString).toBe('[Redacted]');
  });

  it('does not redact or drop unrelated fields', () => {
    const { testLogger, lines } = captureLogger();
    testLogger.info({ userId: 'abc123', action: 'login' }, 'ok');
    const entry = lastLog(lines);
    expect(entry.userId).toBe('abc123');
    expect(entry.action).toBe('login');
  });
});
