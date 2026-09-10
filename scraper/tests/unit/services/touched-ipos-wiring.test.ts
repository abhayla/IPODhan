/**
 * The WIRING test, and it is the only one that matters for this slice.
 *
 * The tracker's own unit tests prove the function behaves. They prove nothing
 * about whether anything calls it — which is the exact class item 20's wiring
 * gate was built for after three security controls shipped with no callers.
 * This asserts the call site, statically, at the one choke point.
 *
 * A static read rather than an execution test on purpose: driving
 * consolidatedUpsertIPO end to end needs a database, a Redis, and a distributed
 * lock, and the thing under test is one line of wiring. A test that needs three
 * services to assert one call is a test that gets skipped.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// __dirname does not exist at module scope in an ESM package. This is the same
// mistake that took the production scraper down on 2026-09-10 and the reason
// item 20 slice 5b's scanner exists.
const here = dirname(fileURLToPath(import.meta.url));
const ORCHESTRATOR = join(here, '../../../src/services/data-consolidation-orchestrator.ts');

describe('the touched-IPOs tracker is actually wired', () => {
  const src = readFileSync(ORCHESTRATOR, 'utf8');
  // Comments discuss the name too; only real code counts as a call site.
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

  it('the orchestrator imports it', () => {
    expect(code).toMatch(/import\s*\{[^}]*recordTouchedIfChanged[^}]*\}\s*from\s*'\.\/touched-ipos-tracker\.js'/);
  });

  it('it is CALLED, not merely imported - an unused import is not wiring', () => {
    const calls = code.match(/recordTouchedIfChanged\s*\(/g) ?? [];
    expect(calls.length).toBeGreaterThan(0);
  });

  it('it is called with the slug and the result the caller receives', () => {
    // Passing a freshly built object instead of `result` would let the two
    // drift: the page could be refreshed for a write the caller was told was
    // skipped, or missed for one it was told succeeded.
    expect(code).toMatch(/recordTouchedIfChanged\(\s*slug\s*,\s*result\s*\)/);
  });

  it('the call sits on the SUCCESS path, after the result is built', () => {
    const build = code.indexOf('const result: ConsolidatedUpsertResult');
    const call = code.indexOf('recordTouchedIfChanged(slug, result)');
    expect(build).toBeGreaterThan(-1);
    expect(call).toBeGreaterThan(build);
  });

  it('the error return is NOT followed by a record call', () => {
    // The catch block returns skipped:true. recordTouchedIfChanged would ignore
    // it anyway, but a call there would mean the choke point has two record
    // sites and only one is reasoned about.
    const errIdx = code.indexOf("skipReason: 'ERROR: '");
    expect(errIdx).toBeGreaterThan(-1);
    expect(code.slice(errIdx).includes('recordTouchedIfChanged')).toBe(false);
  });
});
