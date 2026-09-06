/**
 * Cache-key parity guard for admin write paths (web/app/api/admin/**).
 *
 * RCA: update-field-record/route.ts invalidated `documents:ipo:<id>` (a
 * hand-typed key) while DocumentRepository.findByIPO reads
 * `getDocumentsKey(ipoId)` == `documents:<ipoId>`. The two never matched, so
 * an admin edit left the scraper/read path serving a stale document row for
 * up to CacheTTL.DOCUMENTS (1h). This test pins both halves: (1) no admin
 * route hand-types a `<table>:<something>:${...}` cache key that shadows a
 * key the shared helpers already own, and (2) the documents write path
 * specifically invalidates via `getDocumentsKey`.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { getDocumentsKey } from '@/lib/cache/cache-keys';

const ADMIN_API_DIR = join(__dirname, '../../../../app/api/admin');

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

// Matches a hand-typed cache key like `documents:ipo:${ipoId}` or
// `ipo:${ipoId}` built inline instead of via a shared key helper.
const HAND_TYPED_KEY_PATTERN = /['"`](documents|ipo|ipos|subscription|gmp):[^'"`]*\$\{/g;

describe('admin cache-key parity', () => {
  it('has no hand-typed documents/ipo/subscription/gmp cache keys under web/app/api/admin/**', () => {
    const files = collectSourceFiles(ADMIN_API_DIR);
    const offenders: { file: string; match: string }[] = [];

    for (const file of files) {
      const src = readFileSync(file, 'utf-8');
      const matches = src.match(HAND_TYPED_KEY_PATTERN);
      if (matches) {
        for (const m of matches) {
          offenders.push({ file, match: m });
        }
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
});
