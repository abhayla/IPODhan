/**
 * #97 class B4: web/scripts/seed-broker-affiliates.ts refuses to APPLY
 * against the production database without --allow-prod. This pins the pure
 * decision (`decideProdWriteRefusal`, web/scripts/lib/prod-write-guard.ts)
 * ported from scraper/scripts/lib/repair-tool.ts's own guard — same shape,
 * same four cases.
 */
import { describe, expect, it } from 'vitest';
import { decideProdWriteRefusal, PRODUCTION_DATABASE_NAME } from '../../../scripts/lib/prod-write-guard';

describe('decideProdWriteRefusal', () => {
  it('refuses prod + apply + no --allow-prod', () => {
    const result = decideProdWriteRefusal({
      apply: true,
      dbName: PRODUCTION_DATABASE_NAME,
      allowProd: false,
      toolName: 'seed-broker-affiliates',
    });
    expect(result.refuse).toBe(true);
    expect(result.reason).toContain('refusing to APPLY');
    expect(result.reason).toContain(PRODUCTION_DATABASE_NAME);
  });

  it('allows prod + apply + --allow-prod', () => {
    const result = decideProdWriteRefusal({
      apply: true,
      dbName: PRODUCTION_DATABASE_NAME,
      allowProd: true,
    });
    expect(result.refuse).toBe(false);
    expect(result.reason).toBeUndefined();
  });

  it('allows staging + apply (no --allow-prod needed)', () => {
    const result = decideProdWriteRefusal({
      apply: true,
      dbName: 'ipodhan_staging',
      allowProd: false,
    });
    expect(result.refuse).toBe(false);
  });

  it('allows any db + dry run (no --apply)', () => {
    const result = decideProdWriteRefusal({
      apply: false,
      dbName: PRODUCTION_DATABASE_NAME,
      allowProd: false,
    });
    expect(result.refuse).toBe(false);
  });

  it('is case-insensitive on the db name', () => {
    const result = decideProdWriteRefusal({
      apply: true,
      dbName: PRODUCTION_DATABASE_NAME.toUpperCase(),
      allowProd: false,
    });
    expect(result.refuse).toBe(true);
  });
});
