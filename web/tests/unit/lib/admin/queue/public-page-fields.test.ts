/**
 * Drift guard for OD-136 group 1: every field listed as "shown by the public IPO page" must still be
 * read by web/app/ipos/[slug]/page.tsx or a component it imports. A field the page stops rendering
 * turns this red instead of silently ranking as group 1.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { PUBLIC_PAGE_FIELDS, isPublicPageField } from '@/lib/admin/queue/public-page-fields';

const WEB = path.resolve(__dirname, '../../../../..');
const PAGE = path.join(WEB, 'app/ipos/[slug]/page.tsx');

function pageSources(): string {
  const page = readFileSync(PAGE, 'utf8');
  const imports = [...page.matchAll(/@\/(components\/[A-Za-z/-]+)/g)].map((m) => m[1]);
  const files = new Set<string>();
  for (const imp of imports) {
    for (const f of [`${imp}.tsx`, `${imp}/index.tsx`]) {
      const abs = path.join(WEB, f);
      if (existsSync(abs)) files.add(abs);
    }
  }
  expect(files.size).toBeGreaterThan(20);
  return [page, ...[...files].map((f) => readFileSync(f, 'utf8'))].join('\n');
}

describe('PUBLIC_PAGE_FIELDS', () => {
  const src = pageSources();

  it('lists only fields the public IPO page still reads', () => {
    const missing: string[] = [];
    for (const [table, fields] of Object.entries(PUBLIC_PAGE_FIELDS)) {
      for (const f of fields) {
        const re = new RegExp(`\\.${f}\\b|\\b${f}\\??:|'${f}'|"${f}"`);
        if (!re.test(src)) missing.push(`${table}.${f}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('answers per table and handles a row-table hold key', () => {
    expect(isPublicPageField('ipos', 'priceRangeMax')).toBe(true);
    expect(isPublicPageField('ipos', 'companyWebsite')).toBe(false);
    expect(isPublicPageField('peer_companies:abc', 'peRatio')).toBe(true);
    expect(isPublicPageField('no_such_table', 'x')).toBe(false);
  });
});
