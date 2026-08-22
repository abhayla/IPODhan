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
