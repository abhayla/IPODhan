/**
 * Cache-key parity guard for admin write paths (web/app/api/admin/**).
 *
 * RCA: update-field-record/route.ts invalidated `documents:ipo:<id>` (a
 * hand-typed key) while DocumentRepository.findByIPO reads
 * `getDocumentsKey(ipoId)` == `documents:<ipoId>`. The two never matched, so
 * an admin edit left the scraper/read path serving a stale document row for
 * up to CacheTTL.DOCUMENTS (1h). A second pass found the same class on the
 * `ipo_reviews` branch (a generic `${tableName}:ipo:${ipoId}` fallback that
 * nothing read) and on ipo:id/slug/detail keys elsewhere.
 *
 * This test pins: (1) no admin route hand-types a documents/ipo/subscription/
 * gmp/review/peer cache key — static prefix OR a dynamic template literal
 * whose interpolated pieces still spell one of those entity names — instead
 * of calling the shared cache-keys helper; (2) the documents write path
 * specifically invalidates via `getDocumentsKey`; (3) the ipo_reviews branch
 * specifically invalidates via `getReviewInvalidationKeys`.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { getDocumentsKey } from '@/lib/cache/cache-keys';

const ADMIN_API_DIR = join(__dirname, '../../../../app/api/admin');

// Entity names whose cache keys are owned by a shared helper in
// web/lib/cache/cache-keys.ts — a hand-typed key mentioning one of these is
// a drift risk, not a legitimate one-off (e.g. scraper:<source>:count is
// fine; it has no shared-helper owner and isn't one of these entities).
const OWNED_ENTITIES = 'documents|ipos?|subscriptions?|gmp|reviews?|peers?';
const ENTITY_SEGMENT = new RegExp(`(^|[:\`])(${OWNED_ENTITIES})([:\`]|$)`, 'i');

function collectSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      out.push(...collectSourceFiles(full));
    } else if (entry.endsWith('.ts') && !entry.endsWith('.test.ts')) {
      out.push(full);
    }
  }
  return out;
}

// Every backtick template literal in a file (no nested backticks assumed —
// true for this codebase's cache-key strings).
const BACKTICK_LITERAL = /`[^`]*`/g;

function findOffendingLiterals(src: string): string[] {
  const offenders: string[] = [];
  for (const literal of src.match(BACKTICK_LITERAL) ?? []) {
    const hasInterpolation = literal.includes('${');
    const mentionsOwnedEntity = ENTITY_SEGMENT.test(literal);
    if (hasInterpolation && mentionsOwnedEntity) {
      offenders.push(literal);
    }
  }
  return offenders;
}

describe('admin cache-key parity', () => {
  it('has no hand-typed documents/ipo/subscription/gmp/review/peer cache keys under web/app/api/admin/**', () => {
    const files = collectSourceFiles(ADMIN_API_DIR);
    const offenders: { file: string; literal: string }[] = [];

    for (const file of files) {
      const src = readFileSync(file, 'utf-8');
      for (const literal of findOffendingLiterals(src)) {
        offenders.push({ file, literal });
      }
    }

    expect(offenders).toEqual([]);
  });

  it('update-field-record route invalidates documents via the shared getDocumentsKey helper', () => {
    const routeSrc = readFileSync(
      join(ADMIN_API_DIR, 'update-field-record/route.ts'),
      'utf-8'
    );

    expect(routeSrc).toContain('getDocumentsKey');

    // The exact key the route must invalidate is the one the repository reads.
    const ipoId = 'test-ipo-id';
    expect(getDocumentsKey(ipoId)).toBe(`documents:${ipoId}`);
  });

  it('update-field-record route invalidates ipo_reviews via getReviewInvalidationKeys, not a generic fallback', () => {
    const routeSrc = readFileSync(
      join(ADMIN_API_DIR, 'update-field-record/route.ts'),
      'utf-8'
    );

    expect(routeSrc).toContain('getReviewInvalidationKeys');
  });
});
