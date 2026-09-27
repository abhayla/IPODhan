/**
 * #975 / OD-8, spec §2.9: "Existing values are kept as a record, because
 * someone who applied wants to see what they applied to." Only POLLING stops
 * for a WITHDRAWN/DELISTED row — the page must still render its existing
 * GMP history and subscription figures, with the existing LiveFigureAsAt
 * "as at" stamp telling the reader the numbers are old.
 *
 * A full render of app/ipos/[slug]/page.tsx (a server component with heavy
 * DB/repository wiring) is not exercised anywhere in this suite — the
 * sibling page.test.tsx notes the same limitation and tests page-derived
 * logic instead of a live render. This is a structural regression guard on
 * the source: it fails if a future change re-introduces a status-conditional
 * gate around the GMP or Subscription sections.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const pageSource = readFileSync(
  join(__dirname, '../../../../../app/ipos/[slug]/page.tsx'),
  'utf-8'
);

describe('IPO detail page: frozen rows still render their figures (#975)', () => {
  it('does not gate hasGmpHistory on the row status', () => {
    const line = pageSource
      .split('\n')
      .find((l) => l.includes('const hasGmpHistory ='));
    expect(line).toBeDefined();
    expect(line).not.toMatch(/isFrozen|status/i);
  });

  it('renders the Subscription Dashboard section unconditionally on status', () => {
    const idx = pageSource.indexOf('id="subscription"');
    expect(idx).toBeGreaterThan(-1);
    // The 200 chars immediately before the section must not contain a
    // status/isFrozen-based conditional wrapping it.
    const before = pageSource.slice(Math.max(0, idx - 200), idx);
    expect(before).not.toMatch(/isFrozen/);
  });

  it('still renders TerminalIpoNotice for a frozen row (the notice, not a figure gate)', () => {
    expect(pageSource).toMatch(/<TerminalIpoNotice\s+status={ipo\.status}/);
  });
});
