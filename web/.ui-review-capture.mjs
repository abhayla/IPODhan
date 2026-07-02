// Bulk page-screenshot harness for the IPODhan UI/UX review loop.
// Usage: node capture.mjs <baseUrl> <outDir> [routesCsv]
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const BASE = process.argv[2] || 'https://ipodhan.com';
const OUT = process.argv[3] || 'baseline';
const ONLY = process.argv[4] ? process.argv[4].split(',') : null;

const ROUTES = [
  ['home', '/'],
  ['mainboard-ipos', '/mainboard-ipos'],
  ['sme-ipos', '/sme-ipos'],
  ['ipo-detail', '/ipos/knack-packaging-ltd'],
  ['mainboard-calendar', '/mainboard-ipo-calendar'],
  ['sme-calendar', '/sme-ipo-calendar'],
  ['mainboard-listings', '/mainboard-ipo-listings'],
  ['sme-listings', '/sme-ipo-listings'],
  ['fpo-listings', '/fpo-listings'],
  ['mainboard-performance', '/mainboard-ipo-performance-tracker'],
  ['sme-performance', '/sme-ipo-performance-tracker'],
  ['mainboard-prospectus', '/mainboard-ipo-prospectus'],
  ['sme-prospectus', '/sme-ipo-prospectus'],
  ['mainboard-reviews', '/mainboard-ipo-reviews'],
  ['sme-reviews', '/sme-ipo-reviews'],
  ['history', '/history'],
  ['ncd', '/ncd'],
  ['ofs', '/ofs'],
  ['rights-issues', '/rights-issues'],
  ['tools', '/tools'],
  ['lot-calculator', '/tools/lot-calculator'],
  ['compare', '/tools/compare'],
  ['market-holidays', '/market-holidays'],
  ['registrars', '/registrars'],
  ['resources', '/resources'],
  ['about', '/about'],
  ['affiliates', '/affiliates'],
  ['disclaimer', '/disclaimer'],
  ['privacy', '/privacy'],
  ['terms', '/terms'],
];

const VIEWPORTS = [
  ['mobile', 390, 844],
  ['desktop', 1280, 800],
];

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
const results = [];

for (const [slug, path] of ROUTES) {
  if (ONLY && !ONLY.includes(slug)) continue;
  for (const [tag, w, h] of VIEWPORTS) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h } });
    const page = await ctx.newPage();
    const errors = [];
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text().slice(0, 120)));
    try {
      const resp = await page.goto(BASE + path, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
      // trigger lazy content, then settle back at top
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(800);
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.waitForTimeout(400);
      const file = join(OUT, `${slug}.${tag}.png`);
      await page.screenshot({ path: file, fullPage: true });
      results.push({ slug, tag, status: resp?.status(), errors: errors.length, file });
      console.log(`OK  ${slug}.${tag}  http=${resp?.status()} consoleErr=${errors.length}`);
    } catch (e) {
      results.push({ slug, tag, error: String(e).slice(0, 150) });
      console.log(`ERR ${slug}.${tag}  ${String(e).slice(0, 120)}`);
    }
    await ctx.close();
  }
}
await browser.close();
console.log('DONE', results.filter((r) => !r.error).length, 'captured,', results.filter((r) => r.error).length, 'failed');
