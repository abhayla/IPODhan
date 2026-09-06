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
 * Round 4 tightening: a plain "does `timezone=UTC` appear within 5 lines"
 * scan could pass on an UNRELATED comment or a different Pool's config sitting
 * nearby — it never actually parsed the Pool's OWN config object. This is a
 * SOURCE-LEVEL scan, not a runtime test, but it now (a) extracts the balanced
 * `{ ... }` config object literal passed to each `new Pool(` call and requires
 * the `options:` key inside THAT object to literally read
 * `-c timezone=UTC`, and (b) requires `configureUtcTimestampParsing(` to
 * appear somewhere in the same file (the read-side half of the fix — the
 * `options:` pin alone only covers writes/`now()`, not parsing an existing
 * naive `timestamp` value back as UTC).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import fg from 'fast-glob';

const ROOT = path.resolve(__dirname, '../../..');
const OPTIONS_UTC_RE = /options\s*:\s*['"`]-c timezone=UTC/;

function collect(): string[] {
  return fg.sync(['scripts/**/*.ts'], { cwd: ROOT, absolute: false, dot: false });
}

/**
 * For each `new Pool(` call site in `source`, extract the balanced-paren
 * argument text (the config object literal, e.g. `{ host: ..., options: '-c
 * timezone=UTC', ... }`). Returns one entry per call site: { index, argText }.
 */
function extractPoolCallArgs(source: string): Array<{ index: number; argText: string }> {
  const sites: Array<{ index: number; argText: string }> = [];
  const callRe = /new Pool\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = callRe.exec(source)) !== null) {
    const openIdx = m.index + m[0].length - 1; // index of the '(' itself
    let depth = 0;
    let end = -1;
    for (let i = openIdx; i < source.length; i++) {
      if (source[i] === '(') depth++;
      else if (source[i] === ')') {
        depth--;
        if (depth === 0) { end = i; break; }
      }
    }
    if (end === -1) continue; // unbalanced — let another assertion catch the file
    sites.push({ index: m.index, argText: source.slice(openIdx + 1, end) });
  }
  return sites;
}

describe('every scraper script Pool() is UTC-pinned (options object literally pins timezone=UTC)', () => {
  const files = collect();

  it('finds scraper script files to check', () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it('has no Pool() site whose OWN config object is missing the options: timezone=UTC pin', () => {
    const offenders: string[] = [];
    for (const rel of files) {
      const abs = path.join(ROOT, rel);
      const source = readFileSync(abs, 'utf8');
      for (const site of extractPoolCallArgs(source)) {
        if (!OPTIONS_UTC_RE.test(site.argText)) {
          const lineNo = source.slice(0, site.index).split('\n').length;
          offenders.push(`${rel}:${lineNo}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('has no file with a Pool() site but no configureUtcTimestampParsing( call anywhere in it', () => {
    const offenders: string[] = [];
    for (const rel of files) {
      const abs = path.join(ROOT, rel);
      const source = readFileSync(abs, 'utf8');
      const sites = extractPoolCallArgs(source);
      if (sites.length > 0 && !/configureUtcTimestampParsing\(/.test(source)) {
        offenders.push(rel);
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
      const sites = extractPoolCallArgs(source);
      expect(sites.length).toBeGreaterThan(0);
      expect(OPTIONS_UTC_RE.test(sites[0].argText)).toBe(true);
      expect(source).toMatch(/configureUtcTimestampParsing\(/);
    }
  });
});
