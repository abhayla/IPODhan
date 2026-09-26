/**
 * Guard: no Math.random() in web/lib/services (#98)
 *
 * `Math.random()` in a service that a page renders is fabricated data
 * presented as real — the exact class this issue removed (mocked 60/40 /
 * 25%/15% gain-loss splits, random subscription multiples). This test fails
 * the build the moment a NEW Math.random() call lands in web/lib/services,
 * rather than relying on a reviewer to notice.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SERVICES_DIR = join(__dirname, '..', '..', '..', '..', 'lib', 'services');

function listServiceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir).sort()) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...listServiceFiles(full));
    } else if (entry.endsWith('.ts') && !entry.endsWith('.test.ts')) {
      out.push(full);
    }
  }
  return out;
}

describe('web/lib/services must not contain Math.random()', () => {
  it('has zero Math.random() call sites', () => {
    const files = listServiceFiles(SERVICES_DIR);
    expect(files.length).toBeGreaterThan(0); // guard against a broken path silently passing

    const offenders: string[] = [];
    for (const file of files) {
      const content = readFileSync(file, 'utf-8');
      // Strip /* ... */ block comments and // line comments before matching,
      // so a doc comment that MENTIONS Math.random() (e.g. explaining what a
      // mock used to do, or why this guard exists) doesn't false-positive.
      const withoutBlockComments = content.replace(/\/\*[\s\S]*?\*\//g, '');
      const withoutLineComments = withoutBlockComments.replace(/\/\/.*$/gm, '');
      if (/Math\.random\s*\(/.test(withoutLineComments)) {
        offenders.push(file);
      }
    }

    expect(offenders).toEqual([]);
  });
});
