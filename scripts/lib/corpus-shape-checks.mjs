// Pure predicates for item 10's CORPUS-SHAPE check
// (docs/design/data-sourcing-pull-model.md §4.5, §2.1 fixture-corpus rules).
//
// What it asks: per source, does the live page behind each fixture still match
// the fixture's SHAPE — the labels and structure the extractor depends on —
// never the VALUES, which are supposed to change.
//
// Why a label, not a diff: the class this exists to stop is "a markup change
// silently stops a field extracting, and we find out when a value on the site
// is wrong". A whole-page diff alarms on every price move and is therefore
// ignored within a week. The labels the extractors key on are the narrow thing
// whose disappearance actually breaks extraction.
//
// Imported by both scripts/audit-detection-floor.mjs (real fetches) and
// scripts/tests/corpus-shape-checks.test.mjs (planted drift) so the audit and
// its self-test exercise the SAME logic — never a re-implementation in the
// test, which is exactly how a paper check hides.

import { readFileSync, existsSync } from 'node:fs';

// Labels are compared case- and whitespace-insensitively: a site that
// re-cases or re-spaces a heading has not broken anything the extractors read.
function normalizeLabel(s) {
  return String(s).replace(/\s+/g, ' ').trim().toLowerCase();
}

// A "label" is header-ish text: a <th>, a <dt>, or a heading tag. These are
// what the table/definition-list extractors locate a value BY. Cell values
// (<td>, <dd>) are deliberately excluded — they are the thing that changes.
const LABEL_TAG_RE = /<(th|dt|h[1-6])\b[^>]*>([\s\S]*?)<\/\1>/gi;

// A label with no letters (a bare number, a rupee sign, an arrow) is a value
// that happens to sit in a header cell, not something an extractor keys on.
const HAS_LETTERS_RE = /[a-z]/i;

// A header cell can hold a VALUE that merely contains letters — a period
// column header such as "31 Mar 2024", a currency amount such as "1,200.50 Cr".
// Measured 2026-09-22 on scraper/tests/fixtures/historical/ather-cg-detail.html:
// of 113 extracted labels, five were financial-period headers of exactly this
// shape. Keeping them would make the check FAIL every year-end for a reason
// that is not a markup change — the false alarm that gets a check ignored.
const VALUE_LIKE_LABEL_RES = [
  /^\d{1,2} [a-z]{3,9},? \d{4}$/i,            // 31 mar 2024 / 31 december 2024
  /^[a-z]{3,9},? \d{4}$/i,                           // mar 2024
  /^fy ?\d{2,4}(-\d{2,4})?$/i,                // fy24 / fy2024-25
  /^q[1-4] ?fy ?\d{2,4}$/i,                          // q3 fy25
  /^[\d,.]+ ?(cr|crore|lakh|lakhs|mn|bn)$/i,         // 1,200.50 cr
];

function isValueLikeLabel(text) {
  return VALUE_LIKE_LABEL_RES.some((re) => re.test(text));
}

// Above this, the page is a listing table whose every row-header is a company
// name — those are values, and including them would make every new listing
// read as a shape change. Named, not a magic number.
const MAX_LABELS_PER_PAGE = 400;

/**
 * The SHAPE of an HTML page: the set of labels an extractor can key on, plus
 * a coarse structural skeleton (which label-bearing containers exist, and how
 * many). Values never enter it.
 */
export function extractShape(html) {
  const labels = new Set();
  const tagCounts = {};
  let m;
  LABEL_TAG_RE.lastIndex = 0;
  while ((m = LABEL_TAG_RE.exec(html)) !== null) {
    const tag = m[1].toLowerCase();
    const text = normalizeLabel(m[2].replace(/<[^>]*>/g, ' '));
    if (!text || !HAS_LETTERS_RE.test(text) || isValueLikeLabel(text)) continue;
    tagCounts[tag] = (tagCounts[tag] || 0) + 1;
    if (labels.size < MAX_LABELS_PER_PAGE) labels.add(text);
  }
  return { labels: [...labels].sort(), tagCounts };
}

/**
 * Compare a fixture's shape against the live page's shape.
 *
 * `movedLabels` = labels the FIXTURE had that the live page no longer does.
 * That is the asymmetry that matters: a label the extractor depended on has
 * gone, been renamed, or been restructured out. A label the live page ADDED
 * breaks nothing — the extractor still finds what it needs — so `newLabels`
 * is reported for information and does NOT make `same` false.
 */
export function compareShape(fixtureShape, liveShape) {
  const fixtureLabels = new Set(fixtureShape.labels);
  const liveLabels = new Set(liveShape.labels);
  const movedLabels = [...fixtureLabels].filter((l) => !liveLabels.has(l)).sort();
  const newLabels = [...liveLabels].filter((l) => !fixtureLabels.has(l)).sort();
  return { same: movedLabels.length === 0, movedLabels, newLabels };
}

// A sourceUrl must be an http(s) URL to prove anything about a LIVE page.
// scripts/create-fixture-from-capture.mjs records the LOCAL PATH as sourceUrl
// when --source-url is omitted (it warns, then does it anyway); re-reading
// that local file would compare a fixture against itself and always PASS —
// the exact false-green this check exists to avoid.
function isFetchableUrl(u) {
  return typeof u === 'string' && /^https?:\/\//i.test(u);
}

/**
 * Split the fixture corpus into what this check can actually measure and what
 * it cannot. `unattributable` is not a failure — those fixtures are
 * grandfathered in config/fixture-provenance-baseline.json — but it must be
 * COUNTED and reported, because it is the difference between "every live page
 * still matches" and "we checked nothing".
 */
export function partitionFixtures(entries) {
  const checkable = [];
  const unattributable = [];
  for (const e of entries) {
    if (e.meta && isFetchableUrl(e.meta.sourceUrl)) checkable.push(e);
    else unattributable.push(e);
  }
  return { checkable, unattributable };
}

/** Load the HTML fixtures of the corpus with their sibling meta, if any. */
export function loadHtmlFixtureEntries(files) {
  return files
    .filter((f) => /\.html?$/i.test(f))
    .map((file) => {
      const metaPath = file + '.meta.json';
      let meta = null;
      if (existsSync(metaPath)) {
        try { meta = JSON.parse(readFileSync(metaPath, 'utf8')); } catch { meta = null; }
      }
      return { file, meta };
    });
}

// Cap the offenders rendered into one line, mirroring the floor's own
// MAX_OFFENDERS convention so a wide break cannot blow up the findings file.
const MAX_REPORTED = 10;

/**
 * Turn per-fixture results into the one line the nightly floor records.
 *
 * Status rules, in order:
 *   FAIL          — at least one live page lost a label the fixture had.
 *   UNVERIFIABLE  — nothing was checkable, or a fetch failed. NEVER a PASS:
 *                   a check that measured nothing has not established that
 *                   anything is fine (m_document_state and check_roster use
 *                   the same status for the same reason).
 *   PASS          — every checkable fixture's live page still matches.
 */
export function summarizeCorpusShape({ checkable, unattributable, results }) {
  const total = checkable.length + unattributable.length;

  const moved = results.filter((r) => r.same === false);
  if (moved.length > 0) {
    const detail = moved.slice(0, MAX_REPORTED)
      .map((r) => `${r.sourceUrl} -> ${r.file}: label(s) moved: ${r.movedLabels.join(', ')}`)
      .join('; ');
    return {
      status: 'FAIL',
      detail: `${moved.length} of ${checkable.length} checkable fixture(s) no longer match their live page — ${detail}`,
      offenders: moved,
    };
  }

  const errored = results.filter((r) => r.error);
  if (errored.length > 0) {
    const detail = errored.slice(0, MAX_REPORTED)
      .map((r) => `${r.file} (${r.sourceUrl}): ${r.error}`)
      .join('; ');
    return {
      status: 'UNVERIFIABLE',
      detail: `${errored.length} of ${checkable.length} checkable fixture(s) could not be fetched — ${detail}`,
      offenders: errored,
    };
  }

  if (checkable.length === 0) {
    return {
      status: 'UNVERIFIABLE',
      detail: `0 of ${total} HTML fixture(s) carry a fetchable sourceUrl, so no live page could be compared — `
        + `this is not a pass. Attribute a fixture via scripts/create-fixture-from-capture.mjs --source-url `
        + `(and drop it from config/fixture-provenance-baseline.json) to bring it under this check.`,
      offenders: [],
    };
  }

  return {
    status: 'PASS',
    detail: `${checkable.length} of ${total} HTML fixture(s) checked; every live page still carries the labels its fixture does`
      + (unattributable.length > 0 ? ` (${unattributable.length} unattributable, not checked)` : ''),
    offenders: [],
  };
}

/**
 * A Windows-produced relative path uses backslashes; every consumer of this
 * check (the findings file, the issue body, the fixture paths in the baseline)
 * reads and compares POSIX-style, so normalize once, here.
 */
export function toPosixPath(p) {
  return p.split('\\').join('/');
}
