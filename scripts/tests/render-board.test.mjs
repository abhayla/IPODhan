#!/usr/bin/env node
// Tests for scripts/ops/render-board.mjs — the owner-facing board renderer.
//
// What these guard, in the order they were learned:
//   1. The counts on the page match the generated source, and a hand-typed
//      count cannot reach the page. (2026-09-20: the published board said
//      "12 built" while the source said 16 — the drift this renderer exists
//      to stop.)
//   2. Verdicts are counted PER ROW. A verdict word inside a row's evidence
//      prose must not be counted as a row; a document-wide grep returned 31
//      verdicts for 29 items exactly this way.
//   3. Every role's block is present. A page that silently loses the
//      environments table still looks fine and fails a whole role.
//   4. Both themes are defined at token level on bare :root.
//   5. Structural integrity: tags balance, no unescaped bare `&`.

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = join(__dirname, '..', '..');
const RENDER = join(REPO, 'scripts/ops/render-board.mjs');
const BOARD = join(REPO, 'docs/design/board');

let pass = 0;
const fails = [];
const ok = (name, cond, detail = '') => {
  if (cond) { pass += 1; } else { fails.push(`${name}${detail ? ' — ' + detail : ''}`); }
};

const tmp = mkdtempSync(join(tmpdir(), 'board-'));
const out = join(tmp, 'index.html');
const stdout = execFileSync('node', [RENDER, '--out', out], { encoding: 'utf8' });
const html = readFileSync(out, 'utf8');

// --- 1. counts are derived, and match the generated source ------------------
const gen = readFileSync(join(BOARD, 'plan-sections.generated.html'), 'utf8');
const completion = gen.match(/<section class="status" id="completion">[\s\S]*?<\/section>/)[0];
const rows = (completion.match(/<tr>[\s\S]*?<\/tr>/g) || []).filter((r) => r.includes('<td class="s">'));
const truth = { BUILT: 0, PARTIAL: 0, 'NOT BUILT': 0 };
for (const r of rows) {
  const v = r.match(/<span class="pill \w+">(BUILT|PARTIAL|NOT BUILT)<\/span>/);
  if (v) truth[v[1]] += 1;
}
ok('29 build items parsed', rows.length === 29, `got ${rows.length}`);
ok('verdicts sum to row count', truth.BUILT + truth.PARTIAL + truth['NOT BUILT'] === 29);
ok('page states the derived built count',
  html.includes(`${truth.BUILT} / 29 built`), `expected "${truth.BUILT} / 29 built"`);
ok('page states the derived breakdown',
  html.includes(`${truth.BUILT} built &middot; ${truth.PARTIAL} partial &middot; ${truth['NOT BUILT']} not built`));
ok('stdout reports the same numbers',
  stdout.includes(`(${truth.BUILT}/${truth.PARTIAL}/${truth['NOT BUILT']})`), stdout.trim());

// --- 2. per-row counting, not document-wide ---------------------------------
// A row whose EVIDENCE names a verdict must not inflate the count. Item 31's
// evidence literally contains "Card still reads NOT STARTED"; a naive match on
// verdict words across the section is what this guards.
const meterOk = (html.match(/<span class="on-ok"><\/span>/g) || []).length;
const meterWarn = (html.match(/<span class="on-warn"><\/span>/g) || []).length;
const meterBad = (html.match(/<span class="on-bad"><\/span>/g) || []).length;
ok('meter has exactly 29 segments', meterOk + meterWarn + meterBad === 29,
  `${meterOk}+${meterWarn}+${meterBad}`);
ok('meter segments match the verdicts',
  meterOk === truth.BUILT && meterWarn === truth.PARTIAL && meterBad === truth['NOT BUILT']);

// --- 3. every role's block is on the page -----------------------------------
const roleBlocks = {
  'Owner (decisions waiting)': 'id="decide"',
  'Product manager (reader impact)': 'id="impact"',
  'Deployment + Environments': 'id="environments"',
  'Deployment (rollback)': 'Release and rollback',
  'QA (gates)': 'id="gates"',
  'Architect + Implementation (chain)': 'id="chain"',
  'Delivery (changed since)': 'id="changed"',
  'Stage 3 slices': 'id="slices"',
  'Build items': 'id="completion"',
  'Owner decisions (63)': 'id="decisions"',
  'Sourced fields (190)': 'id="fields"',
};
for (const [role, needle] of Object.entries(roleBlocks)) {
  ok(`block present: ${role}`, html.includes(needle), `missing ${needle}`);
}
ok('every waiting decision carries a recommendation',
  (html.match(/class="rk">Recommended/g) || []).length ===
  JSON.parse(readFileSync(join(BOARD, 'board-data.json'), 'utf8')).waiting_on_owner.length);

// --- 4. theming -------------------------------------------------------------
ok('light palette on bare :root', /(^|\n):root\{--bg:/.test(html));
ok('dark via prefers-color-scheme, guarded', html.includes(':root:not([data-theme="light"])'));
ok('dark via explicit stamp', html.includes(':root[data-theme="dark"]'));
ok('body paints its own background', /body\{background:var\(--bg\)/.test(html));

// --- 5. structure -----------------------------------------------------------
for (const tag of ['details', 'summary', 'table', 'tbody', 'thead', 'div', 'main', 'section', 'dl']) {
  const o = (html.match(new RegExp(`<${tag}[\\s>]`, 'g')) || []).length;
  const c = (html.match(new RegExp(`</${tag}>`, 'g')) || []).length;
  ok(`<${tag}> balanced`, o === c, `${o} open vs ${c} close`);
}
// The Google Fonts <link> legitimately carries `&` as query separators; every
// OTHER bare `&` is an escaping bug in content.
const body = html.replace(/<link rel="stylesheet"[^>]*>/g, '');
const bareAmp = (body.match(/&(?![a-zA-Z#][a-zA-Z0-9]*;)/g) || []).length;
ok('no unescaped bare & in content', bareAmp === 0, `${bareAmp} found`);
ok('collapsible sections present', (html.match(/<details class="sec /g) || []).length >= 14);
// The page must show real content at rest — a stack of 15 closed rows tells a
// skimming reader nothing. Exactly one section (the slice table) opens.
ok('exactly one section open by default',
  (html.match(/<details class="sec [^"]+" id="[^"]+" open>/g) || []).length === 1,
  String((html.match(/ open>/g) || []).length) + ' open');

// --- 6. --check detects staleness -------------------------------------------
writeFileSync(out, html.replace('One Source Table Plan', 'Tampered'));
let checkFailed = false;
try {
  execFileSync('node', [RENDER, '--out', out, '--check'], { encoding: 'utf8', stdio: 'pipe' });
} catch { checkFailed = true; }
ok('--check exits non-zero on a stale file', checkFailed);

// --- report -----------------------------------------------------------------
console.log(`render-board: ${pass} passed, ${fails.length} failed`);
if (fails.length) {
  for (const f of fails) console.error('  FAIL ' + f);
  process.exit(1);
}
