/**
 * #180 Tier-A round 5 (same class as #379 round 1): repair-source-trust-batch-t292.ts's
 * prod guard used to trust an env var (DATABASE_NAME/DATABASE_URL) to describe
 * which DB the pool is actually connected to. `decideProdWriteRefusal` is the
 * extracted PURE decision — the caller queries `SELECT current_database()` on
 * the SAME writing pool and passes the real answer in, so a stale/wrong env
 * var can no longer bypass the guard.
 */
import { describe, it, expect } from 'vitest';
import { types as pgTypes } from 'pg';
import { decideProdWriteRefusal, dateFieldChanged } from '../../../scripts/repair-source-trust-batch-t292.js';

describe('decideProdWriteRefusal', () => {
  it('refuses --apply against the real prod database name without --allow-prod', () => {
    const d = decideProdWriteRefusal('ipodhan', true, false);
    expect(d.refuse).toBe(true);
    expect(d.reason).toMatch(/ipodhan/);
  });

  it('allows --apply against prod when --allow-prod is passed', () => {
    expect(decideProdWriteRefusal('ipodhan', true, true).refuse).toBe(false);
  });

  it('allows --apply against staging/test databases without --allow-prod', () => {
    expect(decideProdWriteRefusal('ipodhan_staging', true, false).refuse).toBe(false);
    expect(decideProdWriteRefusal('ipodhan_test', true, false).refuse).toBe(false);
  });

  it('a dry run (apply=false) is never refused, even against prod', () => {
    expect(decideProdWriteRefusal('ipodhan', false, false).refuse).toBe(false);
  });

  it('is case-insensitive on the database name', () => {
    expect(decideProdWriteRefusal('IPODHAN', true, false).refuse).toBe(true);
  });
});

// #422 round 4 (MAJOR 1): `row.openDate !== 'YYYY-MM-DD'` is always true when
// the live column arrives as the `Date` object pg's own OID-1082 (DATE)
// parser hands back -- unaffected by configureUtcTimestampParsing, which only
// patches OID 1114/1184 timestamps. dateFieldChanged must compare via
// calendar text, not raw `!==`, or every date field is proposed as "changed"
// on every run regardless of its real value.
describe('dateFieldChanged', () => {
  // The exact parser node-postgres registers for DATE (OID 1082) -- this is
  // what a real column value looks like at runtime, not a hand-typed Date.
  const parseDate = pgTypes.getTypeParser(1082) as (value: string) => Date;

  it('is false when the live Date equals the target string (no real change)', () => {
    const liveValue = parseDate('2026-08-19');
    expect(dateFieldChanged(liveValue, '2026-08-19')).toBe(false);
  });

  it('is true when the live Date genuinely differs from the target string', () => {
    const liveValue = parseDate('2026-08-16');
    expect(dateFieldChanged(liveValue, '2026-08-19')).toBe(true);
  });

  it('is false for a plain string value equal to the target (raw pool.query shape)', () => {
    expect(dateFieldChanged('2026-08-19', '2026-08-19')).toBe(false);
  });

  it('is true when current is null and target is a real date', () => {
    expect(dateFieldChanged(null, '2026-08-19')).toBe(true);
  });
});
