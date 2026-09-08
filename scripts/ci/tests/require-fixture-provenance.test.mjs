// T-518: red-first tests for the fixture-provenance gate (RCA in
// scripts/lib/fixture-provenance-checks.mjs header). These exercise the real
// predicates from scripts/lib/fixture-provenance-checks.mjs against
// throwaway temp fixtures, so weakening a predicate turns this red before
// the CI gate can silently stop catching that class again.
//
// Round 2 review additions: MAJOR 5 (meta.company is checked, not just the
// filename), MAJOR 4 (initialism matching + counted identity-check skips).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  checkFixture,
  deriveFilenameCompanyClaim,
  extractHtmlCompanyName,
  companiesMatch,
} from '../../lib/fixture-provenance-checks.mjs';
import { normalizeCompanyNameForMatching } from '../../lib/normalize-company-name.mjs';

function withTempFixtureRoot(fn) {
  const root = mkdtempSync(join(tmpdir(), 'fixture-provenance-'));
  const fixturesDir = join(root, 'scraper', 'tests', 'fixtures');
  mkdirSync(fixturesDir, { recursive: true });
  try {
    return fn(root, fixturesDir);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('case 1: a fixture with NO provenance file fails', () => {
  withTempFixtureRoot((root, dir) => {
    writeFileSync(join(dir, 'ather-cg-detail.html'), '<title>Ather Energy IPO Details</title>');
    const result = checkFixture(root, 'scraper/tests/fixtures/ather-cg-detail.html', normalizeCompanyNameForMatching);
    assert.equal(result.status, 'fail');
    assert.match(result.reasons.join(' '), /missing provenance file/);
  });
});

test('case 2: an HTML fixture whose embedded company name does not match its filename fails, naming BOTH names', () => {
  withTempFixtureRoot((root, dir) => {
    const file = 'vikran-engineering-cg-detail.html';
    writeFileSync(join(dir, file), '<html><head><title>Neochem Bio IPO Date, Price, GMP</title></head></html>');
    writeFileSync(
      join(dir, `${file}.meta.json`),
      JSON.stringify({
        sourceUrl: 'https://www.chittorgarh.com/ipo/vikran-engineering-ipo/9999/',
        capturedAt: '2026-08-01',
        company: 'Vikran Engineering',
      })
    );
    const result = checkFixture(root, `scraper/tests/fixtures/${file}`, normalizeCompanyNameForMatching);
    assert.equal(result.status, 'fail');
    const msg = result.reasons.join(' ');
    assert.match(msg, /vikran engineering/i);
    assert.match(msg, /neochem bio/i);
  });
});

test('case 3: a fixture WITH correct provenance and a matching identity passes', () => {
  withTempFixtureRoot((root, dir) => {
    const file = 'ather-cg-detail.html';
    writeFileSync(join(dir, file), '<html><head><title>Ather Energy IPO Date, Price, GMP, Review, Details</title></head></html>');
    writeFileSync(
      join(dir, `${file}.meta.json`),
      JSON.stringify({
        sourceUrl: 'https://www.chittorgarh.com/ipo/ather-energy-ipo/2100/',
        capturedAt: '2026-04-15',
        ipoId: 'ather-energy',
        company: 'Ather Energy',
      })
    );
    const result = checkFixture(root, `scraper/tests/fixtures/${file}`, normalizeCompanyNameForMatching);
    assert.equal(result.status, 'pass');
    assert.deepEqual(result.reasons, []);
    assert.equal(result.identityChecked, true);
  });
});

test('MAJOR 5: meta.company disagreeing with the page content fails even when the filename claim happens to look fine', () => {
  withTempFixtureRoot((root, dir) => {
    const file = 'vikran-engineering-cg-detail.html';
    // filename ALSO claims vikran, so the old filename-only check would pass this.
    writeFileSync(join(dir, file), '<html><head><title>Neochem Bio IPO Date, Price</title></head></html>');
    writeFileSync(
      join(dir, `${file}.meta.json`),
      JSON.stringify({ sourceUrl: 'https://x', capturedAt: '2026-08-01', company: 'Vikran Engineering' })
    );
    const result = checkFixture(root, `scraper/tests/fixtures/${file}`, normalizeCompanyNameForMatching);
    assert.equal(result.status, 'fail');
    assert.match(result.reasons.join(' '), /meta\.json declares company "Vikran Engineering"/);
  });
});

test('MAJOR 4: an initialism filename claim ("bajaj-hfl") matches its full expansion in the content', () => {
  withTempFixtureRoot((root, dir) => {
    const file = 'bajaj-hfl-detail.html';
    writeFileSync(join(dir, file), '<title>Bajaj Housing Finance Limited IPO Details</title>');
    writeFileSync(
      join(dir, `${file}.meta.json`),
      JSON.stringify({ sourceUrl: 'https://x', capturedAt: '2026-08-01', company: 'Bajaj Housing Finance Limited' })
    );
    const result = checkFixture(root, `scraper/tests/fixtures/${file}`, normalizeCompanyNameForMatching);
    assert.equal(result.status, 'pass');
  });
});

test('MAJOR 4: a generic-prefixed title ("Issue Details - X") still extracts and matches the company after it', () => {
  withTempFixtureRoot((root, dir) => {
    const file = 'vikran-engineering-detail.html';
    writeFileSync(join(dir, file), '<title>Issue Details - Vikran Engineering Ltd</title>');
    writeFileSync(
      join(dir, `${file}.meta.json`),
      JSON.stringify({ sourceUrl: 'https://x', capturedAt: '2026-08-01', company: 'Vikran Engineering' })
    );
    const result = checkFixture(root, `scraper/tests/fixtures/${file}`, normalizeCompanyNameForMatching);
    assert.equal(result.status, 'pass');
  });
});

test('MAJOR 4: pageType:true is counted as an identity-check skip, not silently invisible', () => {
  withTempFixtureRoot((root, dir) => {
    const file = 'malformed-price-band.html';
    writeFileSync(join(dir, file), '<title>Test Fixture Co IPO</title>');
    writeFileSync(
      join(dir, `${file}.meta.json`),
      JSON.stringify({ sourceUrl: 'https://x', capturedAt: '2026-08-01', pageType: true })
    );
    const result = checkFixture(root, `scraper/tests/fixtures/${file}`, normalizeCompanyNameForMatching);
    assert.equal(result.status, 'pass');
    assert.equal(result.identityChecked, false);
    assert.match(result.identitySkipReason, /pageType/);
  });
});

test('MAJOR 5: a non-HTML fixture (JSON) is counted as an identity-check skip with an explicit reason, never silent', () => {
  withTempFixtureRoot((root, dir) => {
    const file = 'some-data.json';
    writeFileSync(join(dir, file), '{}');
    writeFileSync(
      join(dir, `${file}.meta.json`),
      JSON.stringify({ sourceUrl: 'https://x', capturedAt: '2026-08-01', company: 'Some Co' })
    );
    const result = checkFixture(root, `scraper/tests/fixtures/${file}`, normalizeCompanyNameForMatching);
    assert.equal(result.status, 'pass');
    assert.equal(result.identityChecked, false);
    assert.match(result.identitySkipReason, /not implemented for \.json/);
  });
});

test('a company-claiming HTML fixture missing "company" and not marked pageType fails', () => {
  withTempFixtureRoot((root, dir) => {
    const file = 'ather-cg-detail.html';
    writeFileSync(join(dir, file), '<title>Ather Energy IPO Details</title>');
    writeFileSync(
      join(dir, `${file}.meta.json`),
      JSON.stringify({ sourceUrl: 'https://x', capturedAt: '2026-04-15' })
    );
    const result = checkFixture(root, `scraper/tests/fixtures/${file}`, normalizeCompanyNameForMatching);
    assert.equal(result.status, 'fail');
    assert.match(result.reasons.join(' '), /pageType/);
  });
});

test('deriveFilenameCompanyClaim strips known source/page-type tokens, keeps unknown middle tokens', () => {
  assert.equal(deriveFilenameCompanyClaim('ather-cg-detail.html'), 'ather');
  assert.equal(deriveFilenameCompanyClaim('chittorgarh-modern-diagnostic-detail.html'), 'modern diagnostic');
  assert.equal(deriveFilenameCompanyClaim('sebi-drhp-listing.html'), null);
  assert.equal(deriveFilenameCompanyClaim('sebi-drhp-search-match.html'), null);
  assert.equal(deriveFilenameCompanyClaim('bse-debt-issue-detail.html'), null);
});

test('extractHtmlCompanyName returns null for a titleless snippet (no false identity failure on partial-page fixtures)', () => {
  assert.equal(extractHtmlCompanyName('<div id="ipofinancial"><h2>Company Financials</h2></div>'), null);
});

test('companiesMatch: initialism direction works both ways, and unrelated names never match', () => {
  assert.equal(companiesMatch(normalizeCompanyNameForMatching, 'bajaj hfl', 'Bajaj Housing Finance Limited'), true);
  assert.equal(companiesMatch(normalizeCompanyNameForMatching, 'Bajaj Housing Finance Limited', 'bajaj hfl'), true);
  assert.equal(companiesMatch(normalizeCompanyNameForMatching, 'vikran engineering', 'Neochem Bio Ventures'), false);
});

test('MAJOR 3(a): an exchange/ticker-prefixed title ("NSE: VIKRAN - Vikran Engineering Ltd") still extracts and matches', () => {
  withTempFixtureRoot((root, dir) => {
    const file = 'vikran-engineering-detail.html';
    writeFileSync(join(dir, file), '<title>NSE: VIKRAN - Vikran Engineering Ltd</title>');
    writeFileSync(
      join(dir, `${file}.meta.json`),
      JSON.stringify({ sourceUrl: 'https://x', capturedAt: '2026-08-01', company: 'Vikran Engineering' })
    );
    const result = checkFixture(root, `scraper/tests/fixtures/${file}`, normalizeCompanyNameForMatching);
    assert.equal(result.status, 'pass');
  });
});

test('MAJOR 3(a): h1 is preferred over title when both exist', () => {
  const html = '<title>NSE: JIOFIN - Some SEO Noise</title><h1>Reliance Strategic Investments Ltd</h1>';
  assert.equal(extractHtmlCompanyName(html), 'Reliance Strategic Investments Ltd');
});

test('MAJOR 3(b): meta.identitySkipReason skips ONLY the filename check, meta.company is still enforced', () => {
  withTempFixtureRoot((root, dir) => {
    const file = 'jio-financial-detail.html';
    writeFileSync(join(dir, file), '<h1>Reliance Strategic Investments Ltd</h1>');
    writeFileSync(
      join(dir, `${file}.meta.json`),
      JSON.stringify({
        sourceUrl: 'https://x',
        capturedAt: '2026-08-01',
        company: 'Reliance Strategic Investments',
        identitySkipReason: 'brand name "Jio Financial" differs from the legal entity on the captured page',
      })
    );
    const result = checkFixture(root, `scraper/tests/fixtures/${file}`, normalizeCompanyNameForMatching);
    assert.equal(result.status, 'pass');
    assert.ok(result.filenameCheckSkipReason);

    // Now prove meta.company is STILL enforced even with identitySkipReason set.
    writeFileSync(
      join(dir, `${file}.meta.json`),
      JSON.stringify({
        sourceUrl: 'https://x',
        capturedAt: '2026-08-01',
        company: 'Totally Wrong Company',
        identitySkipReason: 'brand name "Jio Financial" differs from the legal entity on the captured page',
      })
    );
    const result2 = checkFixture(root, `scraper/tests/fixtures/${file}`, normalizeCompanyNameForMatching);
    assert.equal(result2.status, 'fail');
  });
});

test('MAJOR 3(b): identitySkipReason under 20 chars is refused as a real provenance error', () => {
  withTempFixtureRoot((root, dir) => {
    const file = 'x-detail.html';
    writeFileSync(join(dir, file), '<title>X Co IPO</title>');
    writeFileSync(
      join(dir, `${file}.meta.json`),
      JSON.stringify({ sourceUrl: 'https://x', capturedAt: '2026-08-01', company: 'X Co', identitySkipReason: 'too short' })
    );
    const result = checkFixture(root, `scraper/tests/fixtures/${file}`, normalizeCompanyNameForMatching);
    assert.equal(result.status, 'fail');
    assert.match(result.reasons.join(' '), /20\+ characters/);
  });
});
