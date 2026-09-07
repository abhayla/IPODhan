/**
 * #180 Tier-A round 5 (same class as #379 round 1): repair-source-trust-batch-t292.ts's
 * prod guard used to trust an env var (DATABASE_NAME/DATABASE_URL) to describe
 * which DB the pool is actually connected to. `decideProdWriteRefusal` is the
 * extracted PURE decision — the caller queries `SELECT current_database()` on
 * the SAME writing pool and passes the real answer in, so a stale/wrong env
 * var can no longer bypass the guard.
 */
import { describe, it, expect } from 'vitest';
import { decideProdWriteRefusal } from '../../../scripts/repair-source-trust-batch-t292.js';

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
