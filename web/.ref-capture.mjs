import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
const OUT = process.argv[2];
mkdirSync(OUT, { recursive: true });
const REFS = [
  ['screener-detail', 'https://www.screener.in/company/RELIANCE/consolidated/'],
  ['zerodha-stock', 'https://zerodha.com/markets/stocks/NSE/RELIANCE/'],
  ['levels-table', 'https://www.levels.fyi/t/software-engineer/locations/india'],
];
const VIEWPORTS = [['mobile', 390, 844], ['desktop', 1280, 800]];
const browser = await chromium.launch();
for (const [slug, url] of REFS) {
  for (const [tag, w, h] of VIEWPORTS) {
    const ctx = await browser.newContext({
      viewport: { width: w, height: h },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
    });
    const page = await ctx.newPage();
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(1200);
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.waitForTimeout(500);
      await page.screenshot({ path: `${OUT}/${slug}.${tag}.png`, fullPage: true });
      console.log(`OK  ${slug}.${tag}`);
    } catch (e) { console.log(`ERR ${slug}.${tag} ${String(e).slice(0, 100)}`); }
    await ctx.close();
  }
}
await browser.close();
