/**
 * Round-N residue (review gap #2): repair-dates-and-leadmanagers-t299.ts and
 * repair-subscription-regressions-t299.ts opened a raw `pg` Pool with NEITHER
 * `options: '-c timezone=UTC'` NOR `configureUtcTimestampParsing()` — the same
 * "Timestamps off by 5h30m" class documented in the root CLAUDE.md
 * troubleshooting table and already fixed in scraper/src/jobs/refresh-calendar.ts
 * and packages/shared/src/db/index.ts. The first script writes
 * `updated_at = now()`; the second reads/orders the naive `timestamp` column.
 * Both silently disagree with app writes without the UTC session pin.
 *
 * This is a SOURCE-LEVEL scan, not a runtime test: it asserts every
 * `new Pool(` call site under scraper/scripts is within 5 lines of a
 * `timezone=UTC` marker, so a future script cannot reintroduce this class
 * without the gate naming the offending file+line.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import fg from 'fast-glob';

const ROOT = path.resolve(__dirname, '../../..');
const WINDOW = 5;

function findPoolSites(source: string): number[] {
  const lines = source.split('\n');
  const sites: number[] = [];
  lines.forEach((line, idx) => {
    if (/new Pool\s*\(/.test(line)) sites.push(idx);
  });
  return sites;
}

function collect(): string[] {
  return fg.sync(['scripts/**/*.ts'], { cwd: ROOT, absolute: false, dot: false });
}

describe('every scraper script Pool() is UTC-pinned (timezone=UTC within 5 lines)', () => {
  const files = collect();

  it('finds scraper script files to check', () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it('has no offending Pool() sites missing the UTC pin', () => {
    const offenders: string[] = [];
    for (const rel of files) {
      const abs = path.join(ROOT, rel);
      const source = readFileSync(abs, 'utf8');
      const lines = source.split('\n');
      for (const lineIdx of findPoolSites(source)) {
        const windowStart = Math.max(0, lineIdx - WINDOW);
        const windowEnd = Math.min(lines.length, lineIdx + WINDOW + 1);
        const windowText = lines.slice(windowStart, windowEnd).join('\n');
        if (!/timezone\s*=\s*UTC/.test(windowText)) {
          offenders.push(`${rel}:${lineIdx + 1}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('confirms the two named T-299 repair scripts are pinned (regression pin)', () => {
    for (const rel of [
      'scripts/repair-dates-and-leadmanagers-t299.ts',
      'scripts/repair-subscription-regressions-t299.ts',
    ]) {
      const source = readFileSync(path.join(ROOT, rel), 'utf8');
      expect(source).toMatch(/options:\s*'-c timezone=UTC'/);
      expect(source).toMatch(/configureUtcTimestampParsing\(\)/);
    }
  });
});
