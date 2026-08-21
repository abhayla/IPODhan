/**
 * GitHub #139 — the swallowed-cause regression guard.
 *
 * The 243/243 listing-performance failure was invisible for seven weeks because
 * `DatabaseError` carried the real pg error only as `cause` and every caller
 * logged `error.message` (the wrapper's own generic string). These tests pin the
 * behaviour that makes the real cause reach a log line.
 */
import { describe, it, expect } from 'vitest';
import { describeDbCause, formatDbCause } from '@ipodhan/shared/errors/db-cause';
import { DatabaseError } from '../../../../packages/shared/src/errors/repository-errors.js';

/** A faithful stand-in for the pg error the prod DB actually raised (SQLSTATE 23502). */
function pgNotNullViolation(): Error {
  const err = new Error(
    'null value in column "listing_price" of relation "listing_performance" violates not-null constraint'
  );
  Object.assign(err, {
    code: '23502',
    detail: 'Failing row contains (…, null, null, null, …).',
    column: 'listing_price',
    table: 'listing_performance',
    severity: 'ERROR',
  });
  return err;
}

describe('describeDbCause (#139)', () => {
  it('pulls the SQLSTATE and column out of a wrapped pg error', () => {
    const wrapped = new DatabaseError('Failed to upsert listing performance', undefined, pgNotNullViolation());

    const d = describeDbCause(wrapped);

    expect(d.code).toBe('23502');
    expect(d.column).toBe('listing_price');
    expect(d.table).toBe('listing_performance');
    expect(d.detail).toContain('Failing row contains');
  });

  it('keeps the full message chain, outermost first', () => {
    const wrapped = new DatabaseError('Failed to upsert listing performance', undefined, pgNotNullViolation());

    const d = describeDbCause(wrapped);

    expect(d.chain[0]).toBe('Failed to upsert listing performance');
    expect(d.chain[1]).toContain('violates not-null constraint');
  });

  it('renders a one-line diagnosable summary (the thing the logs were missing)', () => {
    const wrapped = new DatabaseError('Failed to upsert listing performance', undefined, pgNotNullViolation());

    const line = formatDbCause(wrapped);

    expect(line).toContain('23502');
    expect(line).toContain('listing_price');
    expect(line).not.toBe('Failed to upsert listing performance');
  });

  it('survives a cyclic cause chain instead of hanging the logger', () => {
    const a: any = new Error('a');
    const b: any = new Error('b');
    a.cause = b;
    b.cause = a;

    const d = describeDbCause(a);

    expect(d.chain).toEqual(['a', 'b']);
  });

  it('degrades gracefully on a non-Error cause', () => {
    expect(describeDbCause('plain string').chain).toEqual(['plain string']);
    expect(describeDbCause(null).chain).toEqual([]);
  });
});
