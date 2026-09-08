// T-518: red-first tests for the fixture-provenance gate (RCA in
// scripts/lib/fixture-provenance-checks.mjs header). Written BEFORE
// scripts/ci/require-fixture-provenance.mjs existed, per the defect-fix
// contract's "failing test first" step — these exercise the real predicates
// from scripts/lib/fixture-provenance-checks.mjs against throwaway temp
// fixtures, so weakening a predicate turns this red before the CI gate can
// silently stop catching that class again.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  checkFixture,
  baselineIsShrinkOnly,
  deriveFilenameCompanyClaim,
  extractHtmlCompanyName,
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
    assert.deepEqual(result, { status: 'pass', reasons: [] });
  });
});

test('a page-type fixture (pageType: true) with provenance but no single company skips the identity check', () => {
  withTempFixtureRoot((root, dir) => {
    const file = 'sebi-drhp-listing.html';
    writeFileSync(join(dir, file), '<html><head><title>SEBI | Public Issues</title></head></html>');
    writeFileSync(
      join(dir, `${file}.meta.json`),
      JSON.stringify({
        sourceUrl: 'https://www.sebi.gov.in/sebiweb/other/OtherAction.do?doRecognisedFpi=yes',
        capturedAt: '2025-10-18',
        pageType: true,
      })
    );
    const result = checkFixture(root, `scraper/tests/fixtures/${file}`, normalizeCompanyNameForMatching);
    assert.deepEqual(result, { status: 'pass', reasons: [] });
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

test('baselineIsShrinkOnly: dropping an entry is allowed', () => {
  const result = baselineIsShrinkOnly(['a.html', 'b.html'], ['a.html']);
  assert.equal(result.ok, true);
});

test('baselineIsShrinkOnly: adding a NEW entry is rejected', () => {
  const result = baselineIsShrinkOnly(['a.html'], ['a.html', 'c.html']);
  assert.equal(result.ok, false);
  assert.deepEqual(result.added, ['c.html']);
});
