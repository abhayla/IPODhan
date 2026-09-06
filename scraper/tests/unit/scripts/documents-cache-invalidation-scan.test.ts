/**
 * Round 5 (review gap #3): reset-document.ts's write path already invalidates
 * (verified — `getDocumentsKey(doc.ipoId)` + `redis.del`), but
 * retype-ratios-documents.ts's raw `db.update(documents)...` did not drop
 * `documents:<ipoId>` — that's the key `DocumentRepository.findByIPO`'s
 * cache-aside reads, and it is NOT one of the `ipo:*` keys
 * `invalidateIPOCaches` clears. A future write path can reintroduce this same
 * class silently, so this is a SOURCE-LEVEL scan (like pool-utc-pin.test.ts):
 * every raw `db.update(documents` / `update(documentsTable` call site in
 * scraper/scripts and scraper/src must be followed within 20 lines by
 * `invalidateForIpo(` (the repository's own public method for exactly this
 * raw-write case) or a direct `deleteCache(`/`redis.del(` on the documents key.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import fg from 'fast-glob';

const ROOT = path.resolve(__dirname, '../../..');
const WINDOW_LINES = 20;
const UPDATE_CALL_RE = /\bupdate\(\s*documents(?:Table)?\b/g;
const INVALIDATION_RE = /invalidateForIpo\(|deleteCache\(|redis\.del\(/;

/** Blank out comment CONTENT (preserving newlines/line numbers) so a
 * doc-comment merely describing a call site isn't mistaken for a real one. */
function stripCommentsPreservingLines(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/\/\/[^\n]*/g, (m) => ' '.repeat(m.length));
}

// Legacy, already-run, one-off historical migration script (Phase 10/11
// "de-duplicate test IPOs") — imports from the STALE `web/lib/db/index.js`
// duplicate the root CLAUDE.md explicitly forbids for new code, reassigns
// foreign keys for a fixed list of named test companies, and is not part of
// the live write-path class this scan guards. Exempted by name, not silently
// skipped — remove this line if the script is ever revived for a live run.
const EXEMPT_FILES = new Set(['scripts/deduplicate-test-ipos.ts']);

function collect(): string[] {
  return fg.sync(['scripts/**/*.ts', 'src/**/*.ts'], { cwd: ROOT, absolute: false, dot: false });
}

describe('every raw documents-table update() is followed by a cache invalidation within 20 lines', () => {
  const files = collect().filter((f) => !EXEMPT_FILES.has(f));

  it('finds files to check', () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it('has no offending update(documents) site missing a nearby invalidation call', () => {
    const offenders: string[] = [];
    for (const rel of files) {
      const abs = path.join(ROOT, rel);
      const rawSource = readFileSync(abs, 'utf8');
      // Strip comments first — a doc-comment merely DESCRIBING the pattern
      // (e.g. "applies it with `db.update(documents).set(patch)`") is not a
      // real call site and must not be flagged. Preserves line numbers.
      const source = stripCommentsPreservingLines(rawSource);
      const lines = source.split('\n');
      lines.forEach((line, idx) => {
        if (!UPDATE_CALL_RE.test(line)) { UPDATE_CALL_RE.lastIndex = 0; return; }
        UPDATE_CALL_RE.lastIndex = 0;
        const windowEnd = Math.min(lines.length, idx + WINDOW_LINES + 1);
        const windowText = lines.slice(idx, windowEnd).join('\n');
        if (!INVALIDATION_RE.test(windowText)) {
          offenders.push(`${rel}:${idx + 1}`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });

  it('confirms retype-ratios-documents.ts and reset-document.ts are both wired (regression pin)', () => {
    const retype = readFileSync(path.join(ROOT, 'scripts/retype-ratios-documents.ts'), 'utf8');
    expect(retype).toMatch(/invalidateForIpo\(/);
    const reset = readFileSync(path.join(ROOT, 'scripts/reset-document.ts'), 'utf8');
    expect(reset).toMatch(/getDocumentsKey\(/);
    expect(reset).toMatch(/redis\.del\(|invalidateKeys\(/);
  });
});
