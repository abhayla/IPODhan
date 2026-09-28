import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * §9.4: there is one place an admin value is written — the IPO-page editor (OD-102).
 * These two legacy screens must never write a value: they read data and show a
 * notice pointing at the IPO-page editor instead.
 */
const LEGACY_PAGES = [
  join(__dirname, '../../../../app/admin/edit/[slug]/page.tsx'),
  join(__dirname, '../../../../app/admin/dynamic/ipos/[id]/objectives/page.tsx'),
];

// adminPost/adminPatch/adminDelete are the write-capable admin API client calls; a legacy page
// that imports/calls none of them cannot reach update-field, update-field-record or the
// protection/fields write routes (single or bulk). adminGet (read-only) stays allowed.
const FORBIDDEN_WRITE_CALLS = [
  '/api/admin/update-field',
  '/api/admin/update-field-record',
  'adminPost(',
  'adminPatch(',
  'adminDelete(',
];

describe('legacy admin editors are read-only (§9.4)', () => {
  for (const path of LEGACY_PAGES) {
    const source = readFileSync(path, 'utf-8');

    it(`${path} makes no value-write call`, () => {
      for (const forbidden of FORBIDDEN_WRITE_CALLS) {
        expect(source.includes(forbidden)).toBe(false);
      }
    });

    it(`${path} shows the read-only notice`, () => {
      expect(source.toLowerCase()).toContain('read-only');
    });
  }
});
