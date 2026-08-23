#!/usr/bin/env node
/**
 * Production audit — objective, repeatable health + data-integrity check.
 *
 * Turns the manual production review into a script so "iterate until clean"
 * is measurable, not vibes. Read-only: hits the live site + public/admin APIs,
 * never writes. Exit 0 = all checks pass, exit 1 = at least one failure.
 *
 * Usage:
 *   node scripts/audit-prod.mjs                 # against https://ipodhan.com
 *   BASE_URL=http://localhost:3001 node scripts/audit-prod.mjs
 *   ADMIN_API_TOKEN=xxx node scripts/audit-prod.mjs   # enables admin checks
 *
 * Checks map to the GitHub issues filed 2026-06-12 (#2–#14).
 */

const BASE = (process.env.BASE_URL || 'https://ipodhan.com').replace(/\/$/, '');
const ADMIN_TOKEN = process.env.ADMIN_API_TOKEN || '';
const TIMEOUT_MS = 20000;

const results = [];
function record(name, pass, detail) {
  results.push({ name, pass, detail });
  const tag = pass ? 'PASS' : 'FAIL';
  console.log(`[${tag}] ${name}${detail ? ' — ' + detail : ''}`);
}

async function get(path, opts = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(BASE + path, {
      signal: ctrl.signal,
      headers: ADMIN_TOKEN && opts.admin ? { Authorization: `Bearer ${ADMIN_TOKEN}` } : {},
    });
    const text = await res.text();
    let json;
    try { json = JSON.parse(text); } catch { /* not json */ }
    return { status: res.status, text, json };
  } finally {
    clearTimeout(t);
  }
}

// T-297 (gap G1) — FABRICATION FINGERPRINTS.
//
// The seed-name list below is an exact-match blocklist: it only catches the
// specific fabricated names we already know about, and only in the IPO API.
// Two separate incidents got past it because the fabricated rows were on a
// DIFFERENT endpoint and carried DIFFERENT invented names:
//   * T-264 P1-1 — 39/54 registrar rows fabricated in prod (Alpha/Beta/Gamma,
//     each duplicated 13x) with the placeholder phone 022-12345678.
//   * T-272 P1-2 — /api/registrars served 41 rows while the DB held 15; the 26
//     extras were unit-test fixtures left in a 7-day Redis key after an
//     integration suite was pointed at the production database.
// An investor could call an invented phone number to chase a real allotment.
//
// These patterns match the SHAPE of test/placeholder data rather than a
// specific string, so a new fixture leak is caught the first time it ships.
// T-272's own verdict specified this check ("no registrar name matches
// ^(Alpha|Beta|Gamma|Test)") and estimated it would have caught the incident
// within 30 minutes. It was never built until now.
const FABRICATION_PATTERNS = [
  // Greek-letter fixtures are ONLY matched next to "Registrar". Real Indian
  // listed companies are called Delta Corp, Alpha Logic Industries, Beta Drugs —
  // a broader Greek-letter rule would false-positive on genuine issuers. No real
  // SEBI-registered registrar is named Alpha/Beta/Gamma Registrar, and that is
  // the exact fixture shape both incidents shipped.
  { label: 'fixture registrar name',
    re: /\b(Alpha|Beta|Gamma|Delta|Omega)\s+Registrar\b/i },
  // Unambiguous test tokens next to any business-entity word. "Test Industries"
  // is not a company anyone floats an IPO for.
  { label: 'fixture-shaped name',
    re: /\b(Test|Demo|Sample|Dummy|Example|Placeholder|Foo|Bar)\s+(Registrar|Enterprises?|Technologies|Services|Company|Corp|Ltd|Limited|Industries|Solutions)\b/i },
  // Placeholder phone numbers — sequential/reverse-sequential digit runs behind
  // an Indian STD code. 022-12345678 and 011-87654321 both shipped to prod.
  { label: 'placeholder phone', re: /\b0\d{2,3}[-\s]?(12345678|87654321|11111111|00000000|1234567890)\b/ },
  // Placeholder domains in emails or allotment links.
  { label: 'placeholder domain', re: /\b(?:https?:\/\/(?:www\.)?|@)(?:example|test|demo|sample|localhost|alpharegistrar|betaregistrar|gammaregistrar)\.(?:com|org|net|in)\b/i },
];

// Endpoints whose payloads must be free of fabrication fingerprints. Registrars
// is first because that is where both known incidents landed and because a fake
// "check your allotment" link is the highest-trust-damage row on the site.
const FABRICATION_ENDPOINTS = [
  '/api/registrars',
  '/api/ipos?limit=100',
  '/api/ipos/listings',
];

// Seed/dummy company names that must never appear in production (GitHub #5).
const SEED_NAMES = [
  'Modern Enterprises', 'Smart Hospitality', 'Innovative Pharmaceuticals',
  'Technology Group Ltd', 'United Electronics Holdings', 'Progressive Financial Services',
  'Tech Innovations Ltd', 'Green Energy Solutions', 'Healthcare Plus India',
  'Digital Finance Ltd', 'Manufacturing Excellence', 'Progressive Electronics',
  'Prime Packaging', 'Dynamic Renewable Energy',
];

// Pages that must render 200 (subset of the route inventory; the full sweep is in CI).
const PUBLIC_ROUTES = [
  '/', '/dashboard', '/history', '/mainboard-ipos', '/sme-ipos',
  '/mainboard-ipo-listings', '/sme-ipo-listings', '/mainboard-ipo-performance-tracker',
  '/mainboard-ipo-calendar', '/market-holidays', '/registrars', '/ncd', '/rights-issues',
  '/fpo-listings', '/ofs', '/tools/lot-calculator', '/tools/compare', '/affiliates',
];

// Internal pages that MUST be gated (404) in production (GitHub #11).
const GATED_ROUTES = ['/components-test', '/test/live-updates'];

async function run() {
  console.log(`\n=== IPODhan production audit — ${BASE} ===\n`);

  // 1. Public routes render 200
  for (const r of PUBLIC_ROUTES) {
    const { status } = await get(r);
    record(`route ${r} renders`, status === 200, `HTTP ${status}`);
  }

  // 2. Internal test pages are gated (#11)
  for (const r of GATED_ROUTES) {
    const { status } = await get(r);
    record(`internal page ${r} gated`, status === 404, `HTTP ${status} (want 404)`);
  }

  // 3. Health endpoints agree and are healthy (#10)
  const health = await get('/api/health');
  record('/api/health DB healthy', health.json?.services?.database === 'healthy',
    `db=${health.json?.services?.database}, err=${health.json?.details?.database?.error || 'none'}`);

  // 4. OPEN IPO count is domain-plausible (#4)
  const open = await get('/api/ipos?status=OPEN&limit=100');
  const openCount = open.json?.meta?.total ?? open.json?.data?.length ?? -1;
  record('OPEN IPO count plausible (<= 15)', openCount >= 0 && openCount <= 15,
    `${openCount} open`);

  // 5. No OPEN IPO has a close date in the past (#4)
  const today = new Date().toISOString().slice(0, 10);
  const staleOpen = (open.json?.data || []).filter(i => i.closeDate && i.closeDate < today);
  record('no OPEN IPO past its close date', staleOpen.length === 0,
    staleOpen.length ? `${staleOpen.length} stale (e.g. ${staleOpen[0].slug})` : 'none');

  // 5b. OPEN IPOs expose live GMP + subscription on the list API (#89 / T-261).
  // The data lives in gmp_records / subscriptions; the ipos.* current-value columns
  // are never written, so this check catches a regression back to serving them raw.
  {
    const openIpos = open.json?.data || [];
    if (openIpos.length === 0) {
      record('OPEN IPOs expose live GMP + subscription', true, 'no open IPOs right now — nothing to check');
    } else {
      const withGmp = openIpos.filter(i => i.gmpPrice !== null && i.gmpPrice !== undefined);
      const withSub = openIpos.filter(i => i.subscriptionTotal !== null && i.subscriptionTotal !== undefined);
      const pct = n => Math.round((n / openIpos.length) * 100);
      const missGmp = openIpos.filter(i => i.gmpPrice === null || i.gmpPrice === undefined).map(i => i.slug);
      const missSub = openIpos.filter(i => i.subscriptionTotal === null || i.subscriptionTotal === undefined).map(i => i.slug);
      record('OPEN IPO GMP coverage >= 80%', pct(withGmp.length) >= 80,
        `${withGmp.length}/${openIpos.length} (${pct(withGmp.length)}%)` + (missGmp.length ? ` — missing: ${missGmp.join(', ')}` : ''));
      record('OPEN IPO subscription coverage >= 80%', pct(withSub.length) >= 80,
        `${withSub.length}/${openIpos.length} (${pct(withSub.length)}%)` + (missSub.length ? ` — missing: ${missSub.join(', ')}` : ''));
    }
  }

  // 6. No seed/dummy company names visible (#5)
  const listings = await get('/api/ipos/listings');
  const ipoList = await get('/api/ipos?limit=100');
  const haystack = (listings.text || '') + (ipoList.text || '');
  const found = SEED_NAMES.filter(n => haystack.includes(n));
  record('no seed/dummy companies in API', found.length === 0,
    found.length ? `found: ${found.join(', ')}` : 'none');

  // 6b. No FABRICATION FINGERPRINTS on any list endpoint (T-297 gap G1).
  // Shape-based, not exact-match — see FABRICATION_PATTERNS above for the two
  // incidents (T-264 P1-1, T-272 P1-2) this closes.
  for (const ep of FABRICATION_ENDPOINTS) {
    const res = await get(ep);
    if (res.status !== 200) {
      record(`fabrication scan ${ep}`, false, `HTTP ${res.status} — endpoint unreachable, scan did not run`);
      continue;
    }
    const hits = [];
    for (const { label, re } of FABRICATION_PATTERNS) {
      const m = (res.text || '').match(re);
      if (m) hits.push(`${label}: "${m[0]}"`);
    }
    record(`no fabricated/placeholder data on ${ep}`, hits.length === 0,
      hits.length ? hits.join('; ') : 'clean');
  }

  // 7. Admin-gated checks (only if token provided)
  if (ADMIN_TOKEN) {
    const status = await get('/api/admin/scraper/status', { admin: true });
    const health = status.json?.health;
    record('scraper health not CRITICAL', health && health !== 'CRITICAL', `health=${health}`);

    const sources = ['nse', 'bse'];
    for (const s of sources) {
      const recs = status.json?.[s]?.recordsProcessed24h ?? 0;
      // Informational: records can legitimately be 0 if no IPOs are active.
      record(`scraper ${s} reachable`, !!status.json?.[s]?.lastRun,
        `recordsProcessed24h=${recs}, lastRun=${status.json?.[s]?.lastRun || 'never'}`);
    }

    const pipeline = await get('/api/admin/metrics/data-pipeline', { admin: true });
    const completeness = pipeline.json?.data?.dataQuality?.fieldCompleteness;
    record('data-pipeline metrics reachable', pipeline.status === 200, `fieldCompleteness=${completeness}`);
  } else {
    console.log('[SKIP] admin checks — set ADMIN_API_TOKEN to enable');
  }

  // Summary
  const failed = results.filter(r => !r.pass);
  console.log(`\n=== ${results.length - failed.length}/${results.length} passed, ${failed.length} failed ===`);
  if (failed.length) {
    console.log('\nFailures:');
    for (const f of failed) console.log(`  - ${f.name}: ${f.detail}`);
    process.exit(1);
  }
  process.exit(0);
}

run().catch(err => {
  console.error('audit-prod crashed:', err.message);
  process.exit(2);
});
