// Planted-drift self-tests for item 10's CORPUS-SHAPE check. Imports the ACTUAL
// predicates from scripts/lib/corpus-shape-checks.mjs — never a
// re-implementation — so a weakened or deleted check turns these RED.
// Run: node --test scripts/tests/corpus-shape-checks.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  extractShape,
  compareShape,
  partitionFixtures,
  summarizeCorpusShape,
  toPosixPath,
} from '../lib/corpus-shape-checks.mjs';

// ---- extractShape: SHAPE, never VALUES -------------------------------------

test('extractShape keeps the labels the extractor keys on', () => {
  const html = `<html><body>
    <table><tr><th>Issue Size</th><td>1,200.50 Cr</td></tr>
    <tr><th>Price Band</th><td>310 to 326</td></tr></table>
  </body></html>`;
  const shape = extractShape(html);
  assert.ok(shape.labels.includes('issue size'), 'Issue Size label must be in the shape');
  assert.ok(shape.labels.includes('price band'), 'Price Band label must be in the shape');
});

test('extractShape ignores VALUES — the same page with different numbers has the SAME shape', () => {
  const a = `<html><body><table><tr><th>Issue Size</th><td>1,200.50 Cr</td></tr></table></body></html>`;
  const b = `<html><body><table><tr><th>Issue Size</th><td>9,999.99 Cr</td></tr></table></body></html>`;
  assert.deepEqual(compareShape(extractShape(a), extractShape(b)).movedLabels, [],
    'a value change must NOT be reported as a shape difference');
});

// ---- compareShape: the mutation the check exists to catch -------------------

test('compareShape FAILS when a label the extractor depends on disappears', () => {
  const fixture = `<html><body><table>
    <tr><th>Issue Size</th><td>1,200 Cr</td></tr>
    <tr><th>Price Band</th><td>310-326</td></tr></table></body></html>`;
  // The live page renamed "Price Band" to "Offer Price" — exactly the class
  // this check exists to catch, one step BEFORE a field silently stops
  // extracting.
  const live = `<html><body><table>
    <tr><th>Issue Size</th><td>1,200 Cr</td></tr>
    <tr><th>Offer Price</th><td>310-326</td></tr></table></body></html>`;
  const diff = compareShape(extractShape(fixture), extractShape(live));
  assert.deepEqual(diff.movedLabels, ['price band'],
    'the label that moved must be NAMED, not just counted');
  assert.equal(diff.same, false);
});

test('compareShape PASSES when the live page is structurally identical', () => {
  const html = `<html><body><table><tr><th>Issue Size</th><td>1,200 Cr</td></tr></table></body></html>`;
  const diff = compareShape(extractShape(html), extractShape(html));
  assert.equal(diff.same, true);
  assert.deepEqual(diff.movedLabels, []);
});

test('compareShape reports a NEW label separately from a MOVED one', () => {
  const fixture = `<html><body><table><tr><th>Issue Size</th><td>1</td></tr></table></body></html>`;
  const live = `<html><body><table><tr><th>Issue Size</th><td>1</td></tr>
    <tr><th>Lot Size</th><td>46</td></tr></table></body></html>`;
  const diff = compareShape(extractShape(fixture), extractShape(live));
  assert.deepEqual(diff.movedLabels, [], 'nothing the extractor depends on was lost');
  assert.deepEqual(diff.newLabels, ['lot size']);
  assert.equal(diff.same, true, 'an ADDED label is not a break — the extractor still finds what it needs');
});

// ---- partitionFixtures: the honest-input gate ------------------------------

test('partitionFixtures separates fetchable fixtures from unattributable ones', () => {
  const entries = [
    { file: 'a.html', meta: { sourceUrl: 'https://example.com/a' } },
    { file: 'b.html', meta: null },
    { file: 'c.html', meta: { capturedAt: '2026-01-01' } },
  ];
  const p = partitionFixtures(entries);
  assert.deepEqual(p.checkable.map((e) => e.file), ['a.html']);
  assert.deepEqual(p.unattributable.map((e) => e.file), ['b.html', 'c.html']);
});

test('partitionFixtures treats a local-path sourceUrl as unattributable, not fetchable', () => {
  // scripts/create-fixture-from-capture.mjs records the LOCAL PATH as
  // sourceUrl when --source-url is omitted (it warns, then does it anyway).
  // Fetching that proves nothing about the live page.
  const entries = [{ file: 'a.html', meta: { sourceUrl: '/tmp/capture.html' } }];
  const p = partitionFixtures(entries);
  assert.equal(p.checkable.length, 0);
  assert.equal(p.unattributable.length, 1);
});

// ---- summarizeCorpusShape: the status the floor records --------------------

test('summarizeCorpusShape is UNVERIFIABLE — not PASS — when NOTHING is checkable', () => {
  // This is today's real corpus: 11 HTML fixtures, 0 with a sourceUrl. A PASS
  // here would read as "every live page still matches", which is a claim the
  // check cannot make. Measured 2026-09-22 on origin/main.
  const s = summarizeCorpusShape({ checkable: [], unattributable: [{ file: 'a.html' }], results: [] });
  assert.equal(s.status, 'UNVERIFIABLE');
  assert.match(s.detail, /0 of 1/);
});

test('summarizeCorpusShape PASSES when every checkable fixture still matches', () => {
  const s = summarizeCorpusShape({
    checkable: [{ file: 'a.html' }],
    unattributable: [],
    results: [{ file: 'a.html', sourceUrl: 'https://x/a', same: true, movedLabels: [] }],
  });
  assert.equal(s.status, 'PASS');
});

test('summarizeCorpusShape FAILS naming the source, the fixture AND the label that moved', () => {
  const s = summarizeCorpusShape({
    checkable: [{ file: 'scraper/tests/fixtures/historical/ather-cg-detail.html' }],
    unattributable: [],
    results: [{
      file: 'scraper/tests/fixtures/historical/ather-cg-detail.html',
      sourceUrl: 'https://www.chittorgarh.com/ipo/ather/1/',
      same: false,
      movedLabels: ['price band'],
    }],
  });
  assert.equal(s.status, 'FAIL');
  assert.match(s.detail, /chittorgarh\.com/, 'the SOURCE must be named');
  assert.match(s.detail, /ather-cg-detail\.html/, 'the FIXTURE must be named');
  assert.match(s.detail, /price band/, 'the LABEL that moved must be named');
});

test('summarizeCorpusShape is UNVERIFIABLE when a fetch failed — never a silent PASS', () => {
  const s = summarizeCorpusShape({
    checkable: [{ file: 'a.html' }],
    unattributable: [],
    results: [{ file: 'a.html', sourceUrl: 'https://x/a', error: 'HTTP 503' }],
  });
  assert.equal(s.status, 'UNVERIFIABLE');
  assert.match(s.detail, /503/);
});

test('summarizeCorpusShape FAILS even when one of several fixtures moved', () => {
  const s = summarizeCorpusShape({
    checkable: [{ file: 'a.html' }, { file: 'b.html' }],
    unattributable: [],
    results: [
      { file: 'a.html', sourceUrl: 'https://x/a', same: true, movedLabels: [] },
      { file: 'b.html', sourceUrl: 'https://x/b', same: false, movedLabels: ['lot size'] },
    ],
  });
  assert.equal(s.status, 'FAIL', 'one moved label among many passing fixtures is still a FAIL');
});

// ---- toPosixPath -----------------------------------------------------------

test('toPosixPath normalizes a Windows relative path for the findings file', () => {
  assert.equal(toPosixPath('scraper\\tests\\fixtures\\a.html'), 'scraper/tests/fixtures/a.html');
});

test('toPosixPath leaves an already-POSIX path untouched', () => {
  assert.equal(toPosixPath('scraper/tests/fixtures/a.html'), 'scraper/tests/fixtures/a.html');
});

// ---- value-like header text is NOT a label ---------------------------------

test('extractShape drops a financial-period header — a year roll is not a markup change', () => {
  // Measured on scraper/tests/fixtures/historical/ather-cg-detail.html: five of
  // its 113 header cells were period headers of this shape. Keeping them would
  // FAIL the check every year-end for a reason that is not a shape change.
  const y2024 = `<table><tr><th>Revenue</th><th>31 Mar 2024</th></tr></table>`;
  const y2025 = `<table><tr><th>Revenue</th><th>31 Mar 2025</th></tr></table>`;
  const shape = extractShape(y2024);
  assert.ok(shape.labels.includes('revenue'));
  assert.ok(!shape.labels.includes('31 mar 2024'), 'a period header is a VALUE, not a label');
  assert.deepEqual(compareShape(extractShape(y2024), extractShape(y2025)).movedLabels, [],
    'the year rolling forward must NOT read as a moved label');
});

test('extractShape drops a currency amount sitting in a header cell', () => {
  const a = `<table><tr><th>Issue Size</th><th>1,200.50 Cr</th></tr></table>`;
  const shape = extractShape(a);
  assert.ok(shape.labels.includes('issue size'));
  assert.ok(!shape.labels.includes('1,200.50 cr'));
});

test('extractShape KEEPS a real label that merely contains a digit', () => {
  // The filter must not be so wide it eats real labels.
  const a = `<table><tr><th>Top 10 Shareholders</th><td>x</td></tr></table>`;
  assert.ok(extractShape(a).labels.includes('top 10 shareholders'));
});
