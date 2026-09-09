#!/usr/bin/env node
// docs/design/check-build-cards.mjs
//
// WHY. A build card exists so an engineer who was in none of these conversations can build the item
// without asking a question. That promise is only kept if every card actually answers all eleven
// questions and every path it names is real. Both are checkable, and a card is exactly the kind of
// document that quietly loses a heading during an edit.
//
//   node docs/design/check-build-cards.mjs          report, exit 0
//   node docs/design/check-build-cards.mjs --gate     report + exit 1 on any failure
//
// EXIT: 0 all cards complete · 1 at least one card incomplete · 2 the check itself broke.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CARDS = path.join(HERE, 'build-cards');
const REPO = path.resolve(HERE, '../..');
const gate = process.argv.includes('--gate');

// Spelled exactly as `_TEMPLATE.md` spells them, in order.
const HEADINGS = ['## Purpose', '## Serves', '## Files', '## Schema', '## Interfaces',
  '## Feature flag', '## Tests', '## Detection', '## Staging proof', '## Rollback',
  '## Tier, budget and cost'];

try {
  const files = fs.readdirSync(CARDS).filter((f) => /^item-\d+-.*\.md$/.test(f)).sort();
  const problems = [];
  let pathsChecked = 0, pathsMissing = 0;

  for (const f of files) {
    const md = fs.readFileSync(path.join(CARDS, f), 'utf8');
    const missing = HEADINGS.filter((h) => !md.split(/\r?\n/).some((l) => l.trim() === h));
    if (missing.length) problems.push(`${f}: missing heading(s) ${missing.join(', ')}`);

    // Order matters: a card that answers the questions in a different order is fine to read, but a
    // card whose headings drifted is usually a card that was assembled rather than written.
    const order = HEADINGS.filter((h) => md.includes('\n' + h));
    const idx = order.map((h) => md.indexOf('\n' + h));
    if (idx.some((v, i) => i && v < idx[i - 1])) problems.push(`${f}: headings are out of the template order`);

    // Every repo path the card names must exist, or be marked NEW on the same line.
    const lines = md.split(/\r?\n/);
    for (const line of lines) {
      for (const m of line.matchAll(/`((?:scraper|web|packages|scripts|docs|\.github)\/[A-Za-z0-9._/-]+)`/g)) {
        const p = m[1];
        if (/[*?]/.test(p)) continue;                       // a glob is a description, not a path
        pathsChecked++;
        if (fs.existsSync(path.join(REPO, p))) continue;
        if (/\bNEW\b/i.test(line)) continue;                // declared as new on the same line
        pathsMissing++;
        problems.push(`${f}: cites \`${p}\` which does not exist and is not marked NEW`);
      }
    }

    // A budget line, because an item with no budget is an item that runs until somebody notices.
    if (!/Budget:\s*\d+\s*min/i.test(md)) problems.push(`${f}: no "Budget: <N> min" line`);
    // A tier, because the review depth is decided by blast radius, not by mood.
    if (!/\bTier\s*[:A-C]/.test(md)) problems.push(`${f}: no tier stated`);
  }

  console.log(`build cards: ${files.length}`);
  console.log(`paths cited: ${pathsChecked}, missing and not marked NEW: ${pathsMissing}`);
  if (!problems.length) {
    console.log('every card carries all eleven headings in order, a budget, a tier, and only paths that resolve.');
    process.exit(0);
  }
  for (const p of problems) console.log('  FAIL ' + p);
  console.log(`\n${problems.length} problem(s) across ${files.length} card(s).`);
  process.exit(gate ? 1 : 0);
} catch (err) {
  console.error('check-build-cards: the check itself failed —', err.message);
  process.exit(2);
}
