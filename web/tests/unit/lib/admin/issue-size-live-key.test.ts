// F-156 round 2 (Tier A review MAJOR 1): round 1's tests drove the fictitious `{issueSize}` shape.
// The real dynamic admin page never sends that shape — GET /api/admin/dynamic/ipos/[id]
// snake_cases every key (route.ts), and DynamicFormGenerator's `column.name` is the Drizzle
// column's real DB name (schema-introspector.ts), also snake_case. So the key that actually
// reaches getFieldLabel()/validateCustomField() on this page is `issue_size`. These tests drive
// that real shape end to end, and prove the fix is load-bearing by showing what the OLD
// (camelCase, crore-scale, never-reached) validator would have wrongly said about the same value.
import { describe, it, expect } from 'vitest';
import { getFieldLabel } from '@/lib/admin/field-labels';
import { customValidationRules, validateCustomField } from '@/lib/admin/dynamic-validation-rules';

// Real staging values for ipos.issue_size, measured 2026-09-24 (F-156): the current max and min.
const REAL_MAX_RUPEES = 265796400000.0; // ~Rs26,579.64 Cr
const REAL_LOW_RUPEES = 50000.0; // ~Rs0.005 Cr — well under the Rs10 Cr floor

describe('ipos.issue_size — the real key the live admin page reads, saves and validates', () => {
  it('the label is truthful: rupees, not crores', () => {
    const cfg = getFieldLabel('ipos', 'issue_size');
    expect(cfg.unit).toMatch(/rupee/i);
    expect(cfg.unit).not.toMatch(/crore/i);
  });

  it('a real, large admin rupee value does not trip the high-value warning', () => {
    const result = validateCustomField({ tableName: 'ipos', fieldName: 'issue_size', value: REAL_MAX_RUPEES });
    expect(result.valid).toBe(true);
    expect(result.warning ?? '').not.toMatch(/exceeds/i);
  });

  it('a real, small admin rupee value DOES trip the low-value warning', () => {
    const result = validateCustomField({ tableName: 'ipos', fieldName: 'issue_size', value: REAL_LOW_RUPEES });
    expect(result.valid).toBe(true);
    expect(result.warning).toMatch(/below/i);
  });

  it('accepts the string shape a text input actually submits', () => {
    const result = validateCustomField({ tableName: 'ipos', fieldName: 'issue_size', value: '7329740494.00' });
    expect(result.valid).toBe(true);
    expect(result.warning).toBeUndefined();
  });

  it('rejects zero/negative and passes null through (nullable field)', () => {
    expect(validateCustomField({ tableName: 'ipos', fieldName: 'issue_size', value: 0 }).valid).toBe(false);
    expect(validateCustomField({ tableName: 'ipos', fieldName: 'issue_size', value: null }).valid).toBe(true);
  });

  it('the round-1 defect, reproduced: the dead camelCase validator gives the WRONG verdict on the same real value', () => {
    // customValidationRules.ipos.issueSize is crore-scale and is never reached by
    // DynamicFormGenerator (it looks up by column.name, which is `issue_size`) — this proves why
    // keying the fix to `issueSize` (round 1) left the real page unguarded: fed the same real low
    // rupee number, the dead validator reads it as "50000 crore" and stays silent.
    const deadValidator = customValidationRules.ipos.issueSize;
    const result = deadValidator(REAL_LOW_RUPEES as unknown as number);
    expect(result.warning ?? '').not.toMatch(/below/i);
  });
});
