/**
 * W-108b regression: the tier 3b prefix-name corroboration added to
 * `resolveIpoRow` (packages/shared/src/repositories/ipo-identity.ts) is DEAD
 * in the live write path unless both live callers actually pass
 * `openDate`/`priceRangeMin` on the `IpoIdentity` they build. This is a
 * structural (grep-style) wiring test, not a behavior test — the behavior of
 * the tier itself is covered by `packages/shared/src/repositories/ipo-identity.test.ts`.
 *
 * Live callers:
 *   - scraper/src/base/BaseScraperOrchestrator.ts (the live scraper write path)
 *   - scraper/src/services/data-consolidation-orchestrator.ts (the main
 *     consolidated-write path every real-time scrape goes through)
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const REPO_ROOT = join(__dirname, '..', '..');

function readSource(relativePath: string): string {
  return readFileSync(join(REPO_ROOT, relativePath), 'utf-8');
}

/**
 * Extracts the `resolveIpoRow(this.ipoRepository, { ... })` call-site object
 * literal from a source file so assertions are scoped to the actual call,
 * not just "the string appears somewhere in the file".
 */
function extractResolveIpoRowCallSite(source: string): string {
  const callStart = source.indexOf('resolveIpoRow(this.ipoRepository, {');
  if (callStart === -1) {
    throw new Error('resolveIpoRow(this.ipoRepository, { ... }) call site not found');
  }
  const objStart = source.indexOf('{', callStart);
  let depth = 0;
  for (let i = objStart; i < source.length; i++) {
    if (source[i] === '{') depth++;
    if (source[i] === '}') {
      depth--;
      if (depth === 0) {
        return source.slice(objStart, i + 1);
      }
    }
  }
  throw new Error('Unterminated resolveIpoRow call-site object literal');
}

describe('W-108b / tier 3b corroboration keys threaded through every live resolveIpoRow caller', () => {
  it('BaseScraperOrchestrator passes openDate and priceRangeMin', () => {
    const source = readSource('src/base/BaseScraperOrchestrator.ts');
    const callSite = extractResolveIpoRowCallSite(source);
    expect(callSite).toMatch(/openDate:\s*validatedIPO\.openDate/);
    expect(callSite).toMatch(/priceRangeMin:\s*validatedIPO\.priceRangeMin/);
  });

  it('data-consolidation-orchestrator passes openDate and priceRangeMin', () => {
    const source = readSource('src/services/data-consolidation-orchestrator.ts');
    const callSite = extractResolveIpoRowCallSite(source);
    expect(callSite).toMatch(/openDate:\s*scrapedIPO\.openDate/);
    expect(callSite).toMatch(/priceRangeMin:\s*scrapedIPO\.priceRangeMin/);
  });
});
