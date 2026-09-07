#!/usr/bin/env node
// scripts/audit-reverse-sweep.mjs — #187 (T-461), the G-B "reverse sweep".
//
// WHY THIS EXISTS: every other audit in this repo iterates OUR OWN rows —
// coverage gaps, substance smells, cross-source date conflicts. An IPO the
// market knows about that we never created is invisible to all of them,
// because a row that does not exist fails no such check. Mopshop
// Distribution Ltd. (stored offering_type='FPO', 404 on its detail page)
// was found this way once, by hand (#181). Issue #351 (2026-09-07) is the
// same class again: prod's UPCOMING mainboard list was missing Karamtara
// Engineering, Infrax Renewable, Rentomojo, Manipal Payment, Steamhouse
// India, Vinod Texworld while staging had discovered some of them days
// earlier — nightly, unattended, this script is the standing detector.
//
// WHAT IT CHECKS, per external IPO on chittorgarh.com's public dashboard
// (see scripts/lib/chittorgarh-oracle-parser.mjs for the source and why it
// is independent of our own scraper's ingestion path):
//   (a) a matching row exists on the target — by slug, then by a
//       search-and-normalize fallback (never by trusting HTTP 200 alone —
//       see the e_unknown_slug_404 class, issue #350: an unknown slug can
//       resolve to a DIFFERENT real row instead of 404ing)
//   (b) that row's offeringType === 'IPO' (the Mopshop failure shape)
//   (c) GET {BASE_URL}/ipos/<slug> returns 200 AND the page body contains
//       the company name (guards the same wrong-row-resolves shape on the
//       rendered page, not just the API)
//
// Usage:
//   node scripts/audit-reverse-sweep.mjs                        -> human report, exit 0 always
//   node scripts/audit-reverse-sweep.mjs --gate                  -> report + gate
//   BASE_URL=https://ipodhan.com node scripts/audit-reverse-sweep.mjs --gate
//
// EXIT CODES (--gate mode; report mode always exits 0):
//   0  every external IPO matched all three assertions.
//   1  at least one external IPO FAILed (a)/(b)/(c) — a defect is live.
//   3  no FAIL, but the external calendar was UNVERIFIABLE (could not be
//      fetched at all) — the audit was BLIND tonight, never a silent pass.
//   2  the audit itself crashed.
//
// Read-only: GET requests only, no writes, no DB mutation. Never asserts
// reverse containment (issue #187 out-of-scope: trackers are incomplete,
// that would be noise) and does not cover recently-CLOSED IPOs (see the
// "KNOWN GAP" note in chittorgarh-oracle-parser.mjs — declared, not silent).
import { pathToFileURL } from 'node:url';
import { fetchOracleCalendar } from './lib/chittorgarh-oracle-parser.mjs';
import { generateIPOSlug } from './lib/generate-ipo-slug.mjs';
import { stripLegalSuffix } from './lib/seo-surface-checks.mjs';

// External calendar names rarely carry the legal-entity suffix our own DB
// slugs do ("Prasol Chemicals" vs stored "Prasol Chemicals Ltd." ->
// prasol-chemicals-ltd) — a strict generateIPOSlug(name) equality check
// false-negatived EVERY real match on the first live run against prod
// (2026-09-07: 40/40 "missing" before this fix, including Prasol Chemicals
// and Kanohar Electricals which prod visibly serves today). Compare on the
// slug with any trailing legal-suffix token stripped, both sides, reusing
// the same predicate scripts/lib/seo-surface-checks.mjs already uses for
// the sitemap-duplicate check (T-464) rather than inventing a second one.
function baseSlug(slug) {
  return stripLegalSuffix(slug) || slug;
}

const GATE = process.argv.includes('--gate');
const BASE_URL = (process.env.BASE_URL || 'https://ipodhan.com').replace(/\/$/, '');

function record(id, status, detail) {
  console.log(`[${status}] ${id}${detail ? ' — ' + detail : ''}`);
}
// detection-check: g_reverse_sweep

/**
 * Resolve one external IPO against the target site. Never throws — a
 * network failure becomes { matched:false, reason: 'unverifiable', ... }
 * so the caller can distinguish "row missing" from "could not check".
 * @param {{name:string, slug:string}} ext
 * @param {{ fetchImpl?: typeof fetch, baseUrl: string }} deps
 */
export async function resolveAgainstTarget(ext, deps) {
  const fetchImpl = deps.fetchImpl || fetch;
  const baseUrl = deps.baseUrl;
  const expectedSlug = generateIPOSlug(ext.name);

  let apiRow = null;
  let matchedVia = null;

  // (a1) direct slug lookup — verify the RETURNED row's own name still
  // normalizes to the slug we asked for, because an unknown slug on prod
  // has been observed to resolve to an unrelated real row (issue #350)
  // rather than 404ing.
  try {
    const res = await fetchImpl(`${baseUrl}/api/ipos/${expectedSlug}`);
    if (res.status === 200) {
      const json = await res.json();
      const row = json?.ipo || json?.data || null;
      if (row && row.companyName && baseSlug(generateIPOSlug(row.companyName)) === baseSlug(expectedSlug)) {
        apiRow = row;
        matchedVia = 'slug';
      }
    }
  } catch (e) {
    return { matched: false, reason: 'unverifiable', detail: `GET /api/ipos/${expectedSlug} failed: ${e.message}` };
  }

  // (a2) search-and-normalize fallback — the slug we derived may not be
  // exactly how the row was stored (title casing, punctuation); search by
  // company name and accept a row whose OWN normalized name equals ours.
  if (!apiRow) {
    try {
      const res = await fetchImpl(`${baseUrl}/api/ipos?search=${encodeURIComponent(ext.name)}&limit=20`);
      if (res.status === 200) {
        const json = await res.json();
        const rows = Array.isArray(json?.data) ? json.data : [];
        const hit = rows.find((r) => r?.companyName && baseSlug(generateIPOSlug(r.companyName)) === baseSlug(expectedSlug));
        if (hit) {
          apiRow = hit;
          matchedVia = 'search';
        }
      }
    } catch (e) {
      return { matched: false, reason: 'unverifiable', detail: `GET /api/ipos?search=${ext.name} failed: ${e.message}` };
    }
  }

  if (!apiRow) {
    return { matched: false, reason: 'missing', detail: `no row on ${baseUrl} matches "${ext.name}" (expected slug ${expectedSlug})` };
  }

  const rowSlug = apiRow.slug || expectedSlug;
  const offeringType = apiRow.offeringType ?? apiRow.offering_type;
  if (offeringType !== 'IPO') {
    return {
      matched: true,
      reason: 'mistyped',
      detail: `${ext.name} (${rowSlug}) matched via ${matchedVia} but offeringType='${offeringType}' (expected 'IPO') — the Mopshop shape`,
      slug: rowSlug,
    };
  }

  // (c) rendered detail page returns 200 AND actually shows this company
  let pageOk = false;
  let pageDetail = '';
  try {
    const pageRes = await fetchImpl(`${baseUrl}/ipos/${rowSlug}`);
    if (pageRes.status !== 200) {
      pageDetail = `GET /ipos/${rowSlug} returned ${pageRes.status}`;
    } else {
      const html = await pageRes.text();
      const nameHint = ext.name.split(/\s+/)[0]; // first token is enough to catch a wrong-row page
      pageOk = html.toLowerCase().includes(nameHint.toLowerCase());
      if (!pageOk) pageDetail = `GET /ipos/${rowSlug} returned 200 but body does not mention "${nameHint}" — wrong row rendered`;
    }
  } catch (e) {
    return { matched: true, reason: 'unverifiable', detail: `GET /ipos/${rowSlug} failed: ${e.message}`, slug: rowSlug };
  }

  if (!pageOk) {
    return { matched: true, reason: '404-or-wrong-page', detail: pageDetail, slug: rowSlug };
  }

  return { matched: true, reason: 'ok', detail: `matched via ${matchedVia}, offeringType=IPO, page 200`, slug: rowSlug };
}

/**
 * Run the full sweep. Pure of process.exit — returns a summary the caller
 * (main() below, or the self-test) can act on.
 */
export async function runReverseSweep({ fetchImpl = fetch, baseUrl = BASE_URL, calendar } = {}) {
  const cal = calendar || (await fetchOracleCalendar({ fetchImpl }));

  if (!cal.ok && cal.entries.length === 0) {
    return { status: 'UNVERIFIABLE', results: [], calendarErrors: cal.errors };
  }

  const results = [];
  for (const ext of cal.entries) {
    const r = await resolveAgainstTarget(ext, { fetchImpl, baseUrl });
    results.push({ external: ext, ...r });
  }

  const failing = results.filter((r) => !r.matched || r.reason === 'mistyped' || r.reason === '404-or-wrong-page');
  const unverifiable = results.filter((r) => r.reason === 'unverifiable');
  let status = 'PASS';
  if (failing.length > 0) status = 'FAIL';
  else if (unverifiable.length > 0 || !cal.ok) status = 'UNVERIFIABLE';

  return { status, results, failing, unverifiable, calendarErrors: cal.errors, calendarPartial: !cal.ok, closedWindowCoverage: cal.closedWindowCoverage };
}

async function main() {
  const summary = await runReverseSweep({});

  record(
    'g_reverse_sweep',
    summary.status,
    summary.status === 'UNVERIFIABLE' && summary.results.length === 0
      ? `external calendar unreachable: ${summary.calendarErrors?.join('; ')}`
      : `${summary.results.length} external IPO(s) checked, ${summary.failing?.length ?? 0} failing, ${summary.unverifiable?.length ?? 0} unverifiable (closedWindowCoverage=${summary.closedWindowCoverage ?? 'none'})`
  );

  for (const r of summary.results || []) {
    if (!r.matched) {
      console.log(`  FAIL   ${r.external.name} — ${r.detail}`);
    } else if (r.reason === 'mistyped' || r.reason === '404-or-wrong-page') {
      console.log(`  FAIL   ${r.external.name} (${r.slug}) — ${r.detail}`);
    } else if (r.reason === 'unverifiable') {
      console.log(`  UNVER  ${r.external.name} — ${r.detail}`);
    } else {
      console.log(`  OK     ${r.external.name} (${r.slug})`);
    }
  }
  if (summary.calendarErrors?.length) {
    for (const e of summary.calendarErrors) console.log(`  CALENDAR-ERROR: ${e}`);
  }

  if (!GATE) {
    process.exit(0);
  }
  if (summary.status === 'FAIL') process.exit(1);
  if (summary.status === 'UNVERIFIABLE') process.exit(3);
  process.exit(0);
}

const isMainModule = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMainModule) {
  main().catch((e) => {
    console.error('FATAL:', e);
    process.exit(2);
  });
}
