// Stage-0 HEADED Playwright sweep of IPODhan IPO detail pages.
//
// For each slug: navigate to <BASE_URL>/ipos/<slug>, wait for the app-ready
// signal, take a FULL-PAGE screenshot into
//   docs/contracts/.run/screenshots/<pass>/<slug>.png
// and write a per-page JSON sidecar (console errors + failed requests + flags)
// next to it as <slug>.json.
//
// HEADED on purpose (headless: false) — a real browser catches rendering/paint
// regressions a headless shell can mask. On a headless Linux box wrap the run in
// `xvfb-run -a node headed-sweep.mjs ...`; the Windows VPS has a desktop so it
// runs directly.
//
// Readiness (.claude/rules/e2e-readiness-signal.md): the IPODhan app emits NO
// explicit data-ready attribute, so we wait on a real content signal — the
// detail-page <h1> becoming visible after `networkidle` — NOT a blind timeout.
// A short post-settle delay (annotated) only covers late client paint.
//
// USAGE:
//   node headed-sweep.mjs [pass] --slugs sun-pharma,foo,bar
//   node headed-sweep.mjs [pass] --slugs-file slugs.txt   # newline-delimited
//   BASE_URL=https://staging.example.com node headed-sweep.mjs stage0 --slugs foo
//
// Playwright browsers must be installed (`npx playwright install chromium`).
// `playwright` resolves from the monorepo root node_modules (hoisted).

import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// scraper/scripts/audit -> repo root is ../../..
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

const BASE = (process.env.BASE_URL || 'https://ipodhan.com').replace(/\/+$/, '');

// ---- args -----------------------------------------------------------------
const argv = process.argv.slice(2);
function argVal(name) {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : null;
}
const pass = argv[0] && !argv[0].startsWith('--') ? argv[0] : 'stage0';

let slugs = [];
const slugsCsv = argVal('--slugs');
const slugsFile = argVal('--slugs-file');
if (slugsCsv) slugs = slugsCsv.split(',').map((s) => s.trim()).filter(Boolean);
else if (slugsFile) {
  slugs = fs
    .readFileSync(slugsFile, 'utf8')
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter((s) => s && !s.startsWith('#'));
}
if (!slugs.length) {
  console.error('No slugs. Pass --slugs a,b,c or --slugs-file path (newline-delimited).');
  process.exit(2);
}

const SHOTS = path.join(REPO_ROOT, 'docs', 'contracts', '.run', 'screenshots', pass);
fs.mkdirSync(SHOTS, { recursive: true });

const RED = /\bNaN\b|\bundefined\b|Invalid Date|₹NaN|₹undefined|\bnull\b/;

async function sweepOne(ctx, slug) {
  const url = `${BASE}/ipos/${slug}`;
  const page = await ctx.newPage();
  const consoleErrors = [];
  const failedRequests = [];
  const flags = [];
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text());
  });
  page.on('requestfailed', (req) => {
    failedRequests.push({ url: req.url(), method: req.method(), failure: req.failure()?.errorText || 'unknown' });
  });

  let httpStatus = 0;
  try {
    const resp = await page.goto(url, { waitUntil: 'networkidle', timeout: 45000 });
    httpStatus = resp ? resp.status() : 0;
    if (httpStatus !== 200) flags.push(`HTTP_${httpStatus}`);

    // Readiness signal: wait for the detail-page H1 content (targeted, not a timeout).
    try {
      await page.locator('h1').first().waitFor({ state: 'visible', timeout: 15000 });
    } catch {
      flags.push('NO_H1_READY');
    }
    // Short settle for late client paint only (last-resort, no clean DOM signal).
    await page.waitForTimeout(500);

    const body = (await page.locator('body').innerText().catch(() => '')) || '';
    const h1 = (await page.locator('h1').first().innerText().catch(() => '')) || '';
    if (body.length < 400) flags.push('BLANK_SHELL');
    if (!h1 || h1.trim().length < 2) flags.push('NO_H1');
    const redHit = body.match(RED);
    if (redHit) flags.push('RED_TOKEN:' + redHit[0]);

    const shot = path.join(SHOTS, `${slug}.png`);
    await page.screenshot({ path: shot, fullPage: true });

    const sidecar = {
      slug,
      url,
      pass,
      httpStatus,
      flags,
      h1: h1.slice(0, 120),
      bodyLen: body.length,
      consoleErrors: consoleErrors.slice(0, 20),
      failedRequests: failedRequests.slice(0, 20),
      screenshot: path.relative(REPO_ROOT, shot),
      capturedAt: new Date().toISOString(),
    };
    fs.writeFileSync(path.join(SHOTS, `${slug}.json`), JSON.stringify(sidecar, null, 2));
    await page.close();
    return sidecar;
  } catch (e) {
    flags.push('EXCEPTION:' + String(e.message || e).slice(0, 100));
    const sidecar = { slug, url, pass, httpStatus, flags, consoleErrors, failedRequests, capturedAt: new Date().toISOString() };
    fs.writeFileSync(path.join(SHOTS, `${slug}.json`), JSON.stringify(sidecar, null, 2));
    await page.close().catch(() => {});
    return sidecar;
  }
}

const browser = await chromium.launch({ headless: false });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const results = [];
for (const slug of slugs) {
  const r = await sweepOne(ctx, slug);
  results.push(r);
  const tag = r.flags && r.flags.length ? `[FLAG] ${r.flags.join(', ')}` : '[ok]';
  console.log(`${tag} ${slug} (${r.httpStatus}) -> ${r.screenshot || 'no-shot'}`);
}
await browser.close();

const flagged = results.filter((r) => r.flags && r.flags.length);
const summary = { base: BASE, pass, total: results.length, flaggedCount: flagged.length, outDir: path.relative(REPO_ROOT, SHOTS), flagged, results };
fs.writeFileSync(path.join(SHOTS, '_sweep-summary.json'), JSON.stringify(summary, null, 2));
console.log(`\n=== HEADED SWEEP DONE: ${results.length} pages, ${flagged.length} flagged (pass=${pass}) ===`);
console.log(`screenshots + sidecars: ${path.relative(REPO_ROOT, SHOTS)}`);
