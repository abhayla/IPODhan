/**
 * W-108b regression: the tier 3b prefix-name corroboration added to
 * `resolveIpoRow` (packages/shared/src/repositories/ipo-identity.ts) is DEAD
 * in the live write path unless every live caller actually passes
 * `openDate`/`priceRangeMin` on the `IpoIdentity` they build. This is a
 * structural (grep-style) wiring test, not a behavior test — the behavior of
 * the tier itself is covered by `packages/shared/src/repositories/ipo-identity.test.ts`.
 *
 * Live callers:
 *   - scraper/src/base/BaseScraperOrchestrator.ts (the live scraper write path)
 *   - scraper/src/services/data-consolidation-orchestrator.ts (the main
 *     consolidated-write path every real-time scrape goes through)
 *   - scraper/src/services/data-persister.ts (the `preResolvedIPO === undefined`
 *     branch of `upsertIPO` — T-403 Tier-A review item 7: this THIRD live
 *     caller passed only companyName/normalizedName/slug and silently never
 *     got tier 3b corroboration, or the T-403 segment guard, at all)
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const REPO_ROOT = join(__dirname, '..', '..');

function readSource(relativePath: string): string {
  return readFileSync(join(REPO_ROOT, relativePath), 'utf-8');
}

/**
 * Extracts a `resolveIpoRow(<repoExpr>, { ... })` call-site object literal
 * from a source file so assertions are scoped to the actual call, not just
 * "the string appears somewhere in the file". `callPrefix` lets each caller
 * be matched by its own repo expression (`this.ipoRepository` vs the bare
 * `ipoRepository` local data-persister.ts uses).
 */
function extractResolveIpoRowCallSite(source: string, callPrefix = 'resolveIpoRow(this.ipoRepository, {'): string {
  const callStart = source.indexOf(callPrefix);
  if (callStart === -1) {
    throw new Error(`${callPrefix} ... }) call site not found`);
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

  // T-403 Tier-A review (item 7): data-persister.ts's own `upsertIPO`
  // (preResolvedIPO === undefined branch) is a THIRD live resolveIpoRow
  // caller the original W-108b wiring test never covered — it passed only
  // companyName/normalizedName/slug, so tier 3b corroboration AND the T-403
  // segment guard were both silently dead on this path.
  it('data-persister.ts passes isin, symbol, openDate, priceRangeMin, and segment', () => {
    const source = readSource('src/services/data-persister.ts');
    const callSite = extractResolveIpoRowCallSite(source, 'resolveIpoRow(ipoRepository, {');
    expect(callSite).toMatch(/isin:\s*scrapedIPO\.isin/);
    expect(callSite).toMatch(/symbol:\s*scrapedIPO\.symbol/);
    expect(callSite).toMatch(/openDate:\s*scrapedIPO\.openDate/);
    expect(callSite).toMatch(/priceRangeMin:\s*scrapedIPO\.priceRangeMin/);
    expect(callSite).toMatch(/segment:\s*scrapedIPO\.segment/);
  });
});
