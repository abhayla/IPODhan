// Mutation-proof self-tests for scripts/lib/seo-surface-checks.mjs (#190, T-464).
//
// Imports the ACTUAL predicates from the lib under test — not a
// re-implementation — so weakening a check turns its fixture RED. Each
// fixture reproduces the exact defect SHAPE named in the issue:
//   1. T-272 P2-4 — a live 200 route absent from the sitemap.
//   2. T-291 P2-2 — duplicate IPO slugs (same company, both indexed).
//   3. T-264 P3-5 / T-272 P2-3 — a page type serving the homepage <title>.
//
// Run: node --test scripts/tests/seo-surface-checks.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  checkSitemapCompleteness,
  checkDuplicateSlugs,
  checkTitleCollisions,
  stripLegalSuffix,
  nextIpoSlugsPage,
} from '../lib/seo-surface-checks.mjs';

// --- Sub-check 1: sitemap completeness -------------------------------------

test('checkSitemapCompleteness: passes when every live route is in the sitemap', () => {
  const liveRoutes = ['/', '/mainboard-ipos', '/sme-ipos'];
  const sitemapPaths = ['/', '/mainboard-ipos', '/sme-ipos', '/ncd'];
  const result = checkSitemapCompleteness(liveRoutes, sitemapPaths);
  assert.equal(result.pass, true);
  assert.deepEqual(result.missing, []);
});

test('checkSitemapCompleteness: FAILS red on the T-272 P2-4 shape (segment pages 200 but absent from sitemap)', () => {
  // Known-good sitemap missing 4 live segment landing pages, per the issue.
  const liveRoutes = ['/', '/mainboard-ipos', '/sme-ipos', '/ncd', '/ofs'];
  const sitemapPaths = ['/']; // the sitemap fixture — missing all four segment pages
  const result = checkSitemapCompleteness(liveRoutes, sitemapPaths);
  assert.equal(result.pass, false);
  assert.deepEqual(
    result.missing.sort(),
    ['/mainboard-ipos', '/ncd', '/ofs', '/sme-ipos'].sort()
  );
});

// --- Pagination guard (round 2, #363 review) --------------------------------

test('nextIpoSlugsPage: FAILS loud (throws) when pagination is missing, instead of silently treating it as the last page', () => {
  // The exact defect shape: a /api/ipos response with `data` but no
  // `pagination` object used to be read as "no more pages" and silently
  // degrade the sitemap-completeness check to the first 100 slugs.
  const responseMissingPagination = { data: [{ slug: 'fractal-analytics-ltd' }] };
  assert.throws(
    () => nextIpoSlugsPage(responseMissingPagination),
    /pagination missing from \/api\/ipos response/
  );
});

test('nextIpoSlugsPage: reads slugs and hasMore normally when pagination is present', () => {
  const result = nextIpoSlugsPage({ data: [{ slug: 'fractal-analytics-ltd' }], pagination: { hasMore: true } });
  assert.deepEqual(result, { slugs: ['fractal-analytics-ltd'], hasMore: true });
});

// --- Sub-check 2: duplicate slugs -------------------------------------------

test('stripLegalSuffix: strips exactly one trailing legal-entity token', () => {
  assert.equal(stripLegalSuffix('xyz-tech-pvt-ltd'), 'xyz-tech');
  assert.equal(stripLegalSuffix('xyz-tech-ltd'), 'xyz-tech');
  assert.equal(stripLegalSuffix('xyz-tech'), 'xyz-tech');
});

test('checkDuplicateSlugs: passes when every base slug is unique', () => {
  const result = checkDuplicateSlugs(['fractal-analytics-ltd', 'abc-corp-pvt-ltd']);
  assert.equal(result.pass, true);
  assert.deepEqual(result.duplicateGroups, []);
});

test('checkDuplicateSlugs: FAILS red on the T-291 P2-2 shape (both slugs for one company indexed)', () => {
  const result = checkDuplicateSlugs(['skyways-air-ltd', 'skyways-air-pvt-ltd', 'fractal-analytics-ltd']);
  assert.equal(result.pass, false);
  assert.equal(result.duplicateGroups.length, 1);
  assert.equal(result.duplicateGroups[0].base, 'skyways-air');
  assert.deepEqual(result.duplicateGroups[0].slugs.sort(), ['skyways-air-ltd', 'skyways-air-pvt-ltd']);
});

// --- Sub-check 3: page-type title collisions --------------------------------

test('checkTitleCollisions: passes when every page type has a distinct, non-homepage title', () => {
  const result = checkTitleCollisions(
    {
      home: 'IPODhan - Latest IPO GMP, Subscription & Allotment',
      mainboardReviews: 'Mainboard IPO Reviews | IPODhan',
      smeReviews: 'SME IPO Reviews | IPODhan',
    },
    'IPODhan - Latest IPO GMP, Subscription & Allotment'
  );
  assert.equal(result.pass, true);
  assert.deepEqual(result.collisions, []);
});

test('checkTitleCollisions: FAILS red on the T-264 P3-5 shape (review page serves the homepage title)', () => {
  const homepageTitle = 'IPODhan - Latest IPO GMP, Subscription & Allotment';
  const result = checkTitleCollisions(
    {
      home: homepageTitle,
      mainboardReviews: homepageTitle, // regression: generic <title>, not a page-specific one
      smeReviews: 'SME IPO Reviews | IPODhan',
    },
    homepageTitle
  );
  assert.equal(result.pass, false);
  assert.equal(result.collisions.length, 1);
  assert.equal(result.collisions[0].type, 'mainboardReviews');
  assert.equal(result.collisions[0].matchesHomepage, true);
});

test('checkTitleCollisions: FAILS red when two non-home page types share one title', () => {
  const result = checkTitleCollisions(
    {
      home: 'IPODhan Home',
      mainboardReviews: 'Reviews | IPODhan',
      smeReviews: 'Reviews | IPODhan', // regression: both twins collapsed to the same title
    },
    'IPODhan Home'
  );
  assert.equal(result.pass, false);
  assert.equal(result.collisions.length, 1);
  assert.equal(result.collisions[0].matchesHomepage, false);
});
