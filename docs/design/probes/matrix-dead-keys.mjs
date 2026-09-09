#!/usr/bin/env node
// docs/design/probes/matrix-dead-keys.mjs — how many priority-matrix keys are actually dead.
//
// WHY. The design says "13 of the 77 matrix keys are dead duplicates in the wrong case". That number
// was counted by eye. Consolidation writes camelCase, so a snake_case key matches nothing — but the
// interesting question is not how many snake_case keys LOOK like duplicates, it is how many are
// UNREACHABLE. This counts them, and separates the harmless duplicates from the ones that are worse
// than duplicates: a live field with no matrix entry at all, silently falling to the default rules
// every cycle.
//
// Read-only: it opens two source files. No database, no network.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../../..');
const MATRIX = path.join(REPO, 'scraper/src/config/field-priority-matrix.ts');

const src = fs.readFileSync(MATRIX, 'utf8');
const body = src.slice(src.indexOf('FIELD_PRIORITY_MATRIX'));
const keys = [...new Set([...body.matchAll(/^\s{2}([a-zA-Z_][a-zA-Z0-9_]*):\s*\{/gm)].map((m) => m[1]))];

const snake = keys.filter((k) => k.includes('_'));
const camelOf = (k) => k.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());
const shadowed = snake.filter((k) => keys.includes(camelOf(k)));
const orphan = snake.filter((k) => !keys.includes(camelOf(k)));

const out = {
  probe: 'matrix-dead-keys',
  generated_at: new Date().toISOString(),
  source: 'scraper/src/config/field-priority-matrix.ts',
  note: 'Consolidation writes camelCase keys, so a snake_case matrix key can never match. A shadowed ' +
        'one is harmless duplication. An ORPHAN is worse: the live camelCase field has no matrix entry ' +
        'at all and silently takes the default rules every cycle.',
  total_keys: keys.length,
  snake_case_keys: snake.length,
  shadowed_by_a_camelCase_sibling: shadowed.sort(),
  orphaned_no_sibling: orphan.sort(),
};
fs.writeFileSync(path.join(HERE, 'matrix-dead-keys.out.json'), JSON.stringify(out, null, 2) + '\n');
console.log(`matrix keys: ${keys.length}`);
console.log(`snake_case (unreachable): ${snake.length}`);
console.log(`  shadowed by a camelCase sibling: ${shadowed.length} — ${shadowed.join(', ')}`);
console.log(`  ORPHANED, no sibling entry at all: ${orphan.length} — ${orphan.join(', ')}`);
console.log('written: matrix-dead-keys.out.json');
