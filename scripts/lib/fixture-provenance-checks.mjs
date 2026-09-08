/**
 * T-518: fixture provenance predicates (RCA: PR #425 shipped
 * scraper/tests/fixtures/historical/vikran-engineering-cg-detail.html whose
 * own <title> read "Neochem Bio IPO..." — a page for a DIFFERENT company than
 * the filename claimed — and a test asserting "Vikran Engineering -> Specialty
 * Chemicals" PASSED against it. Nothing in CI could catch it; a human caught
 * it by opening the file).
 *
 * Class: every fixture file under scraper/tests/fixtures/** and
 * scraper/tests/unit/pipeline-stages/fixtures/** (existing and future, every
 * source site). web/tests/fixtures/*.fixture.ts are hand-written TypeScript
 * fixture MODULES (no raw page capture, nothing to attribute a source URL
 * to) and are out of scope; web/tests/unit/pipeline-stages/fixtures/** is
 * data (in scope, mirrors the scraper pipeline-stage fixtures).
 *
 * Provenance convention (documented at scraper/tests/fixtures/PROVENANCE.md):
 * every fixture data file `<name>.<ext>` carries a sibling
 * `<name>.<ext>.meta.json` recording where it came from and when. Chosen
 * over a leading HTML/JS comment because it applies uniformly to every
 * fixture type this repo actually has (HTML, JSON, TXT, PNG) without
 * touching a single byte of files whose exact content several tests already
 * assert against (a leading comment would shift byte offsets and break at
 * least the raw JSON.parse / exact-string fixtures that don't tolerate a
 * leading comment token).
 *
 * meta.json shape:
 *   {
 *     "sourceUrl": "https://www.chittorgarh.com/ipo/modern-diagnostic-ipo/2276/"
 *                   | "scraper/scripts/../document-store path"
 *                   | "n/a — hand-authored TDD fixture, no live capture (<reason>)",
 *     "capturedAt": "2026-08-01",           // YYYY-MM-DD
 *     "ipoId": "modern-diagnostic",         // optional
 *     "company": "Modern Diagnostic",       // required unless pageType:true
 *     "pageType": true                      // set true ONLY when the fixture
 *                                            // is a generic page-type sample
 *                                            // (e.g. sebi-drhp-listing.html)
 *                                            // with no single company
 *   }
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative, extname, basename } from 'node:path';

export const FIXTURE_ROOTS = [
  'scraper/tests/fixtures',
  'scraper/tests/unit/pipeline-stages/fixtures',
];

export const FIXTURE_DATA_EXTENSIONS = new Set(['.html', '.json', '.txt', '.png']);

// Never a fixture data file, even inside a fixtures/ dir.
const EXCLUDED_BASENAMES = new Set(['README.md', 'PROVENANCE.md']);

export function metaPathFor(fixturePath) {
  return `${fixturePath}.meta.json`;
}

export function isFixtureDataFile(relPath) {
  const base = basename(relPath);
  if (EXCLUDED_BASENAMES.has(base)) return false;
  if (base.endsWith('.meta.json')) return false;
  return FIXTURE_DATA_EXTENSIONS.has(extname(relPath));
}

/** List fixture data files (repo-root-relative, POSIX separators) under FIXTURE_ROOTS that exist in `root`. */
export function findFixtureFiles(root, roots = FIXTURE_ROOTS) {
  const out = [];
  for (const fixtureRoot of roots) {
    const abs = join(root, fixtureRoot);
    if (!existsSync(abs)) continue;
    walk(abs, root, out);
  }
  return out.sort();
}

function walk(dirAbs, root, out) {
  for (const entry of readdirSync(dirAbs, { withFileTypes: true })) {
    const abs = join(dirAbs, entry.name);
    if (entry.isDirectory()) {
      walk(abs, root, out);
      continue;
    }
    const rel = relative(root, abs).split('\\').join('/');
    if (isFixtureDataFile(rel)) out.push(rel);
  }
}

/**
 * Load and structurally validate a fixture's meta.json. Returns
 * { ok: true, meta } or { ok: false, reason }.
 */
export function readProvenance(root, fixtureRelPath) {
  const metaRel = metaPathFor(fixtureRelPath);
  const metaAbs = join(root, metaRel);
  if (!existsSync(metaAbs)) {
    return { ok: false, reason: `missing provenance file ${metaRel}` };
  }
  let meta;
  try {
    meta = JSON.parse(readFileSync(metaAbs, 'utf8'));
  } catch (e) {
    return { ok: false, reason: `${metaRel} is not valid JSON: ${e.message}` };
  }
  if (!meta.sourceUrl || typeof meta.sourceUrl !== 'string' || meta.sourceUrl.trim() === '') {
    return { ok: false, reason: `${metaRel} missing non-empty "sourceUrl"` };
  }
  if (!meta.capturedAt || !/^\d{4}-\d{2}-\d{2}$/.test(meta.capturedAt)) {
    return { ok: false, reason: `${metaRel} missing "capturedAt" in YYYY-MM-DD form` };
  }
  if (meta.pageType !== true) {
    if (!meta.company || typeof meta.company !== 'string' || meta.company.trim() === '') {
      return {
        ok: false,
        reason: `${metaRel} must set a non-empty "company", or "pageType": true if this fixture is a generic page-type sample with no single company`,
      };
    }
  }
  return { ok: true, meta };
}

// Whitelist-only: only these tokens are treated as source/page-type noise
// and stripped from the FRONT or BACK of the hyphen-split filename (never
// from the middle, so a company name containing one of these words in the
// middle is protected automatically, e.g. "modern-diagnostic-detail" keeps
// "diagnostic"). An unrecognized token is always assumed to be part of the
// company name — safer to over-claim (and require a real check) than to
// silently skip a fixture that does name a company.
const STRIP_TOKENS = new Set([
  'bse', 'nse', 'cg', 'sebi', 'chittorgarh', 'historical', 'documents', 'sme',
  'drhp', 'rhp', 'listing', 'search', 'match', 'detail', 'details', 'report',
  'debt', 'issue', 'rights', 'mainboard', 'acqdisp', 'page1', 'page', 'pages',
  'with', 'form', 'cover', 'company', 'cell',
]);

/**
 * Derive the company the filename claims, or null if the filename (after
 * stripping known source/page-type tokens from either end) claims no single
 * company. Operates on the fixture's basename without extension.
 */
export function deriveFilenameCompanyClaim(fixtureRelPath) {
  const base = basename(fixtureRelPath).replace(extname(fixtureRelPath), '');
  let tokens = base.split('-').filter(Boolean);
  let changed = true;
  while (changed && tokens.length > 0) {
    changed = false;
    if (tokens.length > 0 && STRIP_TOKENS.has(tokens[0].toLowerCase())) {
      tokens = tokens.slice(1);
      changed = true;
    }
    if (tokens.length > 0 && STRIP_TOKENS.has(tokens[tokens.length - 1].toLowerCase())) {
      tokens = tokens.slice(0, -1);
      changed = true;
    }
  }
  if (tokens.length === 0) return null;
  return tokens.join(' ');
}

const TITLE_RE = /<title[^>]*>([\s\S]*?)<\/title>/i;
const H1_RE = /<h1[^>]*>([\s\S]*?)<\/h1>/i;
const STOPWORDS = [' ipo', ' - ', ' | ', ' details', ' date', ' rhp', ' drhp', ' prospectus', ' public issues'];

function stripTags(s) {
  return s.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Extract the company name embedded in an HTML fixture's <title> or <h1>, or
 * null if neither tag has extractable text (a partial-page snippet fixture —
 * identity cannot be checked, provenance metadata is still required).
 */
export function extractHtmlCompanyName(html) {
  const titleMatch = html.match(TITLE_RE);
  const h1Match = html.match(H1_RE);
  const raw = titleMatch?.[1] || h1Match?.[1];
  if (!raw) return null;
  let text = stripTags(raw);
  if (!text) return null;
  // Common "SEBI | <company> - ..." prefix.
  text = text.replace(/^sebi\s*\|\s*/i, '');
  const lower = text.toLowerCase();
  let cut = text.length;
  for (const stop of STOPWORDS) {
    const idx = lower.indexOf(stop);
    if (idx !== -1 && idx < cut) cut = idx;
  }
  const name = text.slice(0, cut).trim();
  return name || null;
}

/** True if two normalized names refer to the same company (exact match, or one contains the other — filenames are often abbreviated). */
export function companiesMatch(normalizeFn, filenameClaim, contentName) {
  const a = normalizeFn(filenameClaim);
  const b = normalizeFn(contentName);
  if (!a || !b) return false;
  return a === b || a.includes(b) || b.includes(a);
}

/**
 * Full per-file check. Returns { status: 'pass' | 'fail', reasons: string[] }.
 */
export function checkFixture(root, fixtureRelPath, normalizeFn) {
  const reasons = [];
  const prov = readProvenance(root, fixtureRelPath);
  if (!prov.ok) {
    return { status: 'fail', reasons: [prov.reason] };
  }

  if (extname(fixtureRelPath) === '.html' && prov.meta.pageType !== true) {
    const filenameClaim = deriveFilenameCompanyClaim(fixtureRelPath);
    if (filenameClaim) {
      const html = readFileSync(join(root, fixtureRelPath), 'utf8');
      const contentName = extractHtmlCompanyName(html);
      if (contentName && !companiesMatch(normalizeFn, filenameClaim, contentName)) {
        reasons.push(
          `filename claims company "${filenameClaim}" but the page's own <title>/<h1> says "${contentName}" — ` +
            `either the fixture is mislabeled or it captured the wrong page`
        );
      }
    }
  }

  return reasons.length > 0 ? { status: 'fail', reasons } : { status: 'pass', reasons: [] };
}

/** Pure predicate for the shrink-only baseline rule: a new baseline may only DROP entries, never add. */
export function baselineIsShrinkOnly(oldPaths, newPaths) {
  const oldSet = new Set(oldPaths);
  const added = newPaths.filter((p) => !oldSet.has(p));
  return { ok: added.length === 0, added };
}
