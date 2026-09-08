#!/usr/bin/env node
/**
 * T-518: create a test fixture WITH provenance, from a real capture, in one
 * step — so nobody hand-saves a page (and forgets where it came from) again.
 * See scraper/tests/fixtures/PROVENANCE.md for the convention this writes.
 *
 * Deliberately does NOT fetch from the VPS — the scraper's document store
 * (`/var/www/ipodhan/shared/prospectus/<slot>/<ipoId>/<TYPE>-<sha8>.pdf`,
 * scraper/src/services/document-store.ts) is production infra; per
 * `.claude/rules/` "no ad-hoc runs on the VPS", copy the file down through
 * whatever read path is already approved (SSH/rsync/tunnel) and hand this
 * script the resulting LOCAL path.
 *
 * Usage:
 *   node scripts/create-fixture-from-capture.mjs \
 *     --out scraper/tests/fixtures/historical/<name>.html \
 *     --from-file /path/to/local/capture.html \
 *     --source-url "https://www.chittorgarh.com/ipo/<slug>/<id>/" \
 *     --company "Modern Diagnostic" \
 *     [--ipo-id modern-diagnostic] [--captured-at 2026-09-08]
 *
 *   node scripts/create-fixture-from-capture.mjs \
 *     --out scraper/tests/fixtures/documents/sebi-drhp-listing.html \
 *     --from-url "https://www.sebi.gov.in/..." \
 *     --page-type
 *
 * Exactly one of --from-file / --from-url is required. Exactly one of
 * --company / --page-type is required.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, extname } from 'node:path';
import { extractHtmlCompanyName, companiesMatch } from './lib/fixture-provenance-checks.mjs';
import { normalizeCompanyNameForMatching } from './lib/normalize-company-name.mjs';

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--page-type') {
      out.pageType = true;
      continue;
    }
    if (a.startsWith('--')) {
      const key = a.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      out[key] = argv[++i];
    }
  }
  return out;
}

function printHelp() {
  console.log(`Usage:
  node scripts/create-fixture-from-capture.mjs --out <path> (--from-file <path> | --from-url <url>) (--company "<name>" | --page-type) [--ipo-id <id>] [--captured-at YYYY-MM-DD] [--source-url <url>]

See the file header for the full contract.`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.out || (!args.fromFile && !args.fromUrl) || (!args.company && !args.pageType)) {
    printHelp();
    process.exit(args.help ? 0 : 1);
  }

  let content;
  let resolvedSourceUrl;
  if (args.fromFile) {
    if (!existsSync(args.fromFile)) {
      console.error(`--from-file not found: ${args.fromFile}`);
      process.exit(1);
    }
    content = readFileSync(args.fromFile);
    resolvedSourceUrl = args.sourceUrl || args.fromFile;
    if (!args.sourceUrl) {
      console.warn(
        'WARNING: no --source-url given for a --from-file capture — recording the local path as sourceUrl. ' +
          'Pass --source-url explicitly when the file came from a live page (recommended).'
      );
    }
  } else {
    const res = await fetch(args.fromUrl);
    if (!res.ok) {
      console.error(`fetch ${args.fromUrl} -> HTTP ${res.status}`);
      process.exit(1);
    }
    content = Buffer.from(await res.arrayBuffer());
    resolvedSourceUrl = args.fromUrl;
  }

  const capturedAt = args.capturedAt || new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(capturedAt)) {
    console.error(`--captured-at must be YYYY-MM-DD, got: ${capturedAt}`);
    process.exit(1);
  }

  const meta = { sourceUrl: resolvedSourceUrl, capturedAt };
  if (args.ipoId) meta.ipoId = args.ipoId;
  if (args.pageType) {
    meta.pageType = true;
  } else {
    meta.company = args.company;
  }

  // Round 2 review, MINOR 6: validate the identity claim against the bytes
  // just captured BEFORE writing anything — the cheapest place to catch a
  // wrong --company / wrong page, before it is ever committed.
  if (extname(args.out) === '.html' && !args.pageType) {
    const contentName = extractHtmlCompanyName(content.toString('utf8'));
    if (contentName && !companiesMatch(normalizeCompanyNameForMatching, args.company, contentName)) {
      console.error(
        `REFUSED: --company "${args.company}" does not match the captured page's own <title>/<h1> ` +
          `("${contentName}"). Either fix --company, or this captured the wrong page.`
      );
      process.exit(1);
    }
  }

  mkdirSync(dirname(args.out), { recursive: true });
  writeFileSync(args.out, content);
  writeFileSync(`${args.out}.meta.json`, JSON.stringify(meta, null, 2) + '\n');

  console.log(`Wrote ${args.out} (${content.length} bytes) + ${args.out}.meta.json`);
}

main().catch((e) => {
  console.error(e.stack || e.message);
  process.exit(1);
});
