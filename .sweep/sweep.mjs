// Prod IPO detail-page deep sweep: screenshot every IPO/FPO page + verify data presence.
// Flags: non-200, NaN/undefined/Invalid Date, blank shell, and DB-has-value-but-page-blank.
import { chromium } from 'playwright';
import fs from 'fs';

const BASE = 'https://ipodhan.com';
const OUT = 'D:/Abhay/VibeCoding/IPODhan/.sweep';
const SHOTS = `${OUT}/screenshots`;
fs.mkdirSync(SHOTS, { recursive: true });

const all = JSON.parse(fs.readFileSync(`${OUT}/ipos.json`, 'utf8'));
const only = process.argv[2] ? process.argv[2].split(',') : null; // smoke subset by slug
let ipos = all.filter((r) => ['IPO', 'FPO'].includes(r.offering_type) && r.slug);
if (only) ipos = ipos.filter((r) => only.includes(r.slug));

const CONCURRENCY = 4;
const RED = /\bNaN\b|\bundefined\b|Invalid Date|₹NaN|₹undefined|\bnull\b/;

function crores(v) { // issue_size stored in rupees; page shows Cr
  if (v == null) return null;
  const cr = Number(v) / 1e7;
  return cr >= 1 ? cr.toFixed(2) : null;
}

async function checkOne(ctx, ipo) {
  const url = `${BASE}/ipos/${ipo.slug}`;
  const page = await ctx.newPage();
  const consoleErrors = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  const flags = [];
  let httpStatus = 0;
  try {
    const resp = await page.goto(url, { waitUntil: 'networkidle', timeout: 45000 });
    httpStatus = resp ? resp.status() : 0;
    await page.waitForTimeout(600);
    if (httpStatus !== 200) flags.push(`HTTP_${httpStatus}`);
    const body = (await page.locator('body').innerText().catch(() => '')) || '';
    const h1 = (await page.locator('h1').first().innerText().catch(() => '')) || '';
    if (body.length < 400) flags.push('BLANK_SHELL');
    if (!h1 || h1.trim().length < 2) flags.push('NO_H1');
    if (RED.test(body)) flags.push('RED_TOKEN:' + (body.match(RED) || [''])[0]);
    // DB-has-value-but-page-blank checks (only assert what the DB actually holds)
    const naCount = (body.match(/N\/A|TBA|--/g) || []).length;
    const cr = crores(ipo.issue_size);
    if (cr && !body.includes(cr) && !new RegExp(`${Math.round(ipo.issue_size/1e7)}\\s*Cr`, 'i').test(body)) {
      // issue size present in DB but its Cr value not on page
      if (/issue size/i.test(body)) flags.push('ISSUE_SIZE_MISSING');
    }
    if (ipo.price_range_max && !body.includes(String(ipo.price_range_max))) {
      if (/price band|price range/i.test(body)) flags.push('PRICE_BAND_MISSING');
    }
    const shot = `${SHOTS}/${ipo.slug}.png`;
    await page.screenshot({ path: shot, fullPage: true });
    await page.close();
    return { slug: ipo.slug, company: ipo.company_name, segment: ipo.segment, status: ipo.status, httpStatus, flags, naCount, consoleErrors: consoleErrors.slice(0, 3), bodyLen: body.length };
  } catch (e) {
    await page.close().catch(() => {});
    return { slug: ipo.slug, company: ipo.company_name, segment: ipo.segment, status: ipo.status, httpStatus, flags: ['EXCEPTION:' + e.message.slice(0, 80)], consoleErrors };
  }
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const results = [];
let i = 0;
async function worker() {
  while (i < ipos.length) {
    const idx = i++;
    const r = await checkOne(ctx, ipos[idx]);
    results.push(r);
    if (r.flags.length) console.log(`[FLAG] ${r.slug} (${r.status}) -> ${r.flags.join(', ')}`);
    else if ((idx + 1) % 25 === 0) console.log(`  ...${idx + 1}/${ipos.length} ok`);
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker));
await browser.close();

const flagged = results.filter((r) => r.flags.length);
fs.writeFileSync(`${OUT}/report.json`, JSON.stringify({ total: results.length, flaggedCount: flagged.length, flagged, all: results }, null, 2));
console.log(`\n=== SWEEP DONE: ${results.length} pages, ${flagged.length} flagged ===`);
flagged.forEach((f) => console.log(`  ${f.slug} [${f.segment}/${f.status}] -> ${f.flags.join(', ')}`));
