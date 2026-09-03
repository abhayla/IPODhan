/**
 * T-434 round 5 — every scraper TypeScript file must actually PARSE.
 *
 * WHY THIS EXISTS: scripts/persist-filing.ts shipped with a literal line break
 * inside a string literal (a patching script wrote a real newline where it meant
 * the two characters backslash-n). esbuild rejected the file with "Unterminated
 * string literal", so `npx tsx scripts/persist-filing.ts` would not start AT ALL
 * — while the whole vitest suite stayed green, because no test imports the CLI
 * entry points. Unit tests cover behaviour; nothing covered "does this file
 * compile", and a CLI nobody imports is exactly where that gap hides.
 *
 * This is a syntax gate, not a type check: it runs the same esbuild transform
 * tsx and vitest use, over every scraper source and script, and fails on any
 * transform error. Cheap enough to run on every commit.
 */
import { describe, it, expect } from 'vitest';
import { transform } from 'esbuild';
import { readFileSync } from 'fs';
import path from 'path';
import fg from 'fast-glob';

const ROOT = path.resolve(__dirname, '../../..');

function collect(): string[] {
  return fg.sync(['scripts/**/*.ts', 'src/**/*.ts'], {
    cwd: ROOT,
    absolute: false,
    dot: false,
  });
}

describe('every scraper TypeScript file parses', () => {
  const files = collect();

  it('finds the files to check', () => {
    expect(files.length).toBeGreaterThan(50);
    expect(files).toContain('scripts/persist-filing.ts');
  });

  it.each(files)('%s parses under esbuild', async (rel) => {
    const abs = path.join(ROOT, rel);
    const source = readFileSync(abs, 'utf8');
    let error: unknown = null;
    try {
      await transform(source, {
        loader: 'ts',
        format: 'esm',
        sourcefile: rel,
      });
    } catch (err) {
      error = err;
    }
    expect(
      error === null ? null : `${rel}: ${(error as Error).message}`
    ).toBeNull();
  });
});
