#!/usr/bin/env node
// docs/design/probes/item43-r2-cg-pages.mjs -- item 43 round 2: capture live Chittorgarh IPO detail pages as
// scraper fixtures (with .meta.json provenance) for the financial / shareholding / timetable mappings.
// Polite: one GET per page, >= 10.5 s apart (one host). Run: node docs/design/probes/item43-r2-cg-pages.mjs
import fs from 'node:fs';
import path from 'node:path';
import { HERE, fetchWithRetry, nowStamp } from './_lib.mjs';

const PAGES = [
  { slug: 'dove-soft', url: 'https://www.chittorgarh.com/ipo/dove-soft-ipo/2424/', note: 'SME' },
  { slug: 'vishal-nirmiti', url: 'https://www.chittorgarh.com/ipo/vishal-nirmiti-ipo/2665/', note: 'mainboard, open' },
];
const OUT = path.join(HERE, '..', '..', '..', 'scraper', 'tests', 'fixtures', 'chittorgarh');
// IST calendar day (ist-timezone rule), never the UTC day.
const day = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
for (const [i, p] of PAGES.entries()) {
  if (i > 0) await sleep(10_500);
  const r = await fetchWithRetry(p.url, { spacingMs: 15_000, attempts: 2 });
  console.log(p.slug, r.status, r.size ?? 0, r.error ?? '');
  if (!r.ok) continue;
  const file = path.join(OUT, `chittorgarh-${p.slug}-detail-${day}.html`);
  fs.writeFileSync(file, r.body);
  fs.writeFileSync(`${file}.meta.json`, JSON.stringify({
    sourceUrl: p.url, capturedAt: day, fetchedAt: nowStamp(), ipoId: p.slug, company: p.slug,
    purpose: `item 43 round 2 CG detail mappings (OD-164(e)); ${p.note}`,
  }, null, 2) + '\n');
}
