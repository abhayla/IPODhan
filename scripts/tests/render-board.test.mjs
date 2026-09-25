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
const rows = (completion.match(/<tr[\s\S]*?<\/tr>/g) || []).filter((r) => r.includes('<td class="s">'));
const truth = { BUILT: 0, PARTIAL: 0, 'NOT BUILT': 0 };
let truthStaged = 0;
for (const r of rows) {
  const v = r.match(/<span class="pill \w+">(BUILT|PARTIAL|NOT BUILT)<\/span>/);
  if (v) truth[v[1]] += 1;
  if (r.includes('data-staged="1"')) truthStaged += 1;
}
ok('30 build items parsed', rows.length === 30, `got ${rows.length}`);
ok('verdicts sum to row count', truth.BUILT + truth.PARTIAL + truth['NOT BUILT'] === 30);
ok('page states the derived built count',
  html.includes(`${truth.BUILT} / 30 built`), `expected "${truth.BUILT} / 30 built"`);
ok('page states the derived breakdown',
  html.includes(`${truth.BUILT} built &middot; ${truth.PARTIAL} partial &middot; ${truth['NOT BUILT']} not built`));
ok('stdout reports the same numbers',
  stdout.includes(`(${truth.BUILT}/${truth.PARTIAL}/${truth['NOT BUILT']})`), stdout.trim());

// --- 1b. the staging tile says what it measures ------------------------------
// R2 (owner-status-artifact.md): a board figure must not claim more than its
// source measures. The vitals tile's "built" count comes from
// pull-model-completion-state.md, which describes code present on MAIN, not
// on staging — the tile label must say so, and the separate "proven on
// staging" figure must be DERIVED (a count of data-staged rows) or the literal
// word "unmeasured", never a typed number.
ok('tile label says "on main", not just "built"',
  html.includes(`${truth.BUILT} / 30 built on main`), `expected "${truth.BUILT} / 30 built on main"`);
ok('tile sub-line names the source is code on main',
  html.includes('(code on <b>main</b>)'));
ok('proven-on-staging figure is derived from data-staged rows',
  truthStaged === 0
    ? html.includes('Proven on staging: <b>unmeasured')
    : html.includes(`Proven on staging: <b>${truthStaged} of 30 items`),
  `truthStaged=${truthStaged}`);
ok('unmeasured proven-on-staging names the command/marker that would measure it',
  truthStaged > 0 || html.includes('Staging proof:'),
  'zero staged rows must still name the marker that would record one');

// --- 2. per-row counting, not document-wide ---------------------------------
// A row whose EVIDENCE names a verdict must not inflate the count. Item 31's
// evidence literally contains "Card still reads NOT STARTED"; a naive match on
// verdict words across the section is what this guards.
const meterOk = (html.match(/<span class="on-ok"><\/span>/g) || []).length;
const meterWarn = (html.match(/<span class="on-warn"><\/span>/g) || []).length;
const meterBad = (html.match(/<span class="on-bad"><\/span>/g) || []).length;
ok('meter has exactly 30 segments', meterOk + meterWarn + meterBad === 30,
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
  'Owner decisions': 'id="decisions"',
  'Sourced fields': 'id="fields"',
};
for (const [role, needle] of Object.entries(roleBlocks)) {
  ok(`block present: ${role}`, html.includes(needle), `missing ${needle}`);
}
ok('every waiting decision carries a recommendation',
  (html.match(/class="rk">Recommended/g) || []).length ===
  JSON.parse(readFileSync(join(BOARD, 'board-data.json'), 'utf8')).waiting_on_owner.length);

// --- 3b. decisions count and waiting-on-you count are DERIVED, not typed ----
// #929: the decisions tile said "All 63 recorded decisions" and "63 recorded
// &middot; 0 machine-verified" as literal strings while the spec had grown to
// 82 rows, and the waiting block said "These three need a word from you" as a
// literal string regardless of how many decision cards actually rendered.
// This mutation-tests both: re-typing either literal must turn this red.
const decSection = gen.match(/<section class="status" id="decisions">[\s\S]*?<\/section>/)[0];
const decRows = (decSection.match(/<tr>[\s\S]*?<\/tr>/g) || []).filter((r) => r.includes('<td class="s">OD-'));
let decVerified = 0;
for (const r of decRows) {
  const v = r.match(/<span class="pill \w+">([^<]*)<\/span>/);
  if (v && v[1].trim().toLowerCase() !== 'unverified') decVerified += 1;
}
ok('parsed at least one OD row', decRows.length > 0, `got ${decRows.length}`);
ok('heading count == number of OD rows rendered',
  html.includes(`All ${decRows.length} recorded decisions with the acceptance check the spec states for each.`),
  `expected ${decRows.length} recorded decisions in the heading`);
ok('decisions chip states the derived total and verified count',
  html.includes(`${decRows.length} recorded &middot; ${decVerified} machine-verified`));
ok('decisions count is NOT the stale hardcoded 63 unless it genuinely is 63',
  decRows.length !== 63 ? !html.includes('All 63 recorded decisions') : true,
  `source has ${decRows.length} OD rows but the page still says "All 63 recorded decisions"`);

const waitingCount = JSON.parse(readFileSync(join(BOARD, 'board-data.json'), 'utf8')).waiting_on_owner.length;
const cardCount = (html.match(/<div class="dcard">/g) || []).length;
ok('waiting-block N == number of cards rendered', cardCount === waitingCount, `${cardCount} cards vs ${waitingCount} in board-data.json`);
const waitingWord = waitingCount === 1 ? 'This one needs' : `These ${waitingCount} need`;
ok('waiting-block sentence names the derived count, not a hardcoded word',
  html.includes(`${waitingWord} a word from you`), `expected "${waitingWord} a word from you"`);
ok('waiting-block text is NOT the stale hardcoded "These three" unless it genuinely is 3',
  waitingCount !== 3 ? !html.includes('These three need a word from you') : true,
  `board-data.json has ${waitingCount} waiting but the page still says "These three need a word from you"`);

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

// --- 5b. the renderer does not depend on input line endings -----------------
// This is asserted on the RENDERED STRING, not by mutating files on disk and
// shelling out. The earlier version did the latter and was itself platform
// dependent: 37/37 on Windows, 36/1 on the Ubuntu runner, failing #850 a third
// time. A test that mutates the repo and depends on how git checked those files
// out is testing the environment, not the code.
//
// Belt and braces beside this: .gitattributes pins the board's generated files
// to eol=lf, and render-board.mjs reads every input through readText().
{
  const CRLFCH = String.fromCharCode(13, 10);
  const LFCH = String.fromCharCode(10);
  const crlfDir = mkdtempSync(join(tmpdir(), 'board-crlf-'));
  const a = join(crlfDir, 'a.html');
  execFileSync('node', [RENDER, '--out', a], { encoding: 'utf8' });
  const rendered = readFileSync(a, 'utf8');
  ok('rendered output carries no CRLF',
    !rendered.includes(CRLFCH),
    'output has CRLF; --check then depends on how git checked the file out');
  ok('rendered output is newline-terminated content',
    rendered.includes(LFCH), 'no newlines at all in the render');
}

// --- 6. --check detects staleness -------------------------------------------
writeFileSync(out, html.replace('One Source Table Plan', 'Tampered'));
let checkFailed = false;
try {
  execFileSync('node', [RENDER, '--out', out, '--check'], { encoding: 'utf8', stdio: 'pipe' });
} catch { checkFailed = true; }
ok('--check exits non-zero on a stale file', checkFailed);

// --- 7. measured facts: typed copies refused, stale/unmeasured labelled -------
// 2026-09-23: the environments rows (sha, since, migration counts) were typed
// on 2026-09-20 and republished seven times unchanged while staging moved from
// 61808af1 to 55b585cb. Every case below renders with fixture facts and a fixed
// --now so it cannot depend on when or where it runs.
{
  const dir = mkdtempSync(join(tmpdir(), 'board-facts-'));
  const NOW = '2026-09-23T02:00:00Z';
  const at = (hoursBefore) => new Date(Date.parse(NOW) - hoursBefore * 3600000).toISOString();
  const factsFile = (facts) => {
    const p = join(dir, `facts-${Math.random().toString(36).slice(2)}.json`);
    writeFileSync(p, JSON.stringify({ collected_at: NOW, facts }));
    return p;
  };
  const fresh = (value) => ({ value, measured_at: at(1), command: 'fixture' });
  const baseFacts = {
    'prod.sha': fresh('aaaa1111'), 'prod.since': fresh('2026-09-07T17:05:54.000Z'),
    'prod.migrations_applied': fresh(34),
    'staging.sha': fresh('bbbb2222'), 'staging.since': fresh('2026-09-22T16:06:17.000Z'),
    'staging.migrations_applied': fresh(51), 'main.migrations': fresh(52),
  };
  const render = (factsPath, dataPath) => {
    const o = join(dir, `out-${Math.random().toString(36).slice(2)}.html`);
    const args = [RENDER, '--out', o, '--facts', factsPath, '--now', NOW];
    if (dataPath) args.push('--data', dataPath);
    try {
      execFileSync('node', args, { encoding: 'utf8', stdio: 'pipe' });
      return { code: 0, html: readFileSync(o, 'utf8') };
    } catch (e) {
      return { code: e.status ?? 1, stderr: String(e.stderr || '') };
    }
  };
  const envRows = (html) => (html.match(/id="environments">[\s\S]*?<\/tbody>/) || [''])[0];

  // (a) a typed sha / since in board-data.json is refused, with a message
  const realData = JSON.parse(readFileSync(join(BOARD, 'board-data.json'), 'utf8'));
  for (const key of ['sha', 'since']) {
    const typed = JSON.parse(JSON.stringify(realData));
    typed.environments[0][key] = key === 'sha' ? 'deadbeef' : '2026-09-01';
    const p = join(dir, `typed-${key}.json`);
    writeFileSync(p, JSON.stringify(typed));
    const r = render(factsFile(baseFacts), p);
    ok(`typed environment "${key}" is refused (non-zero exit)`, r.code !== 0, `exit ${r.code}`);
    ok(`typed environment "${key}" refusal names the key and the collector`,
      r.code !== 0 && r.stderr.includes(`types "${key}"`) && r.stderr.includes('collect-board-facts'), r.stderr || '(exit 0)');
  }
  {
    const typed = { ...realData, stamp: '2026-09-20 15:36 IST' };
    const p = join(dir, 'typed-stamp.json');
    writeFileSync(p, JSON.stringify(typed));
    ok('typed "stamp" is refused', render(factsFile(baseFacts), p).code !== 0);
  }

  // (b) a 25h-old fact renders "stale — measured <IST date>"
  {
    const r = render(factsFile({ ...baseFacts, 'staging.sha': { value: 'bbbb2222', measured_at: at(25), command: 'fixture' } }));
    const env = r.code === 0 ? envRows(r.html) : '';
    ok('25h-old fact renders stale with its IST date',
      env.includes('bbbb2222 <small class="stale">stale &mdash; measured 2026-09-22</small>'), env.slice(0, 200) || r.stderr);
  }

  // (c) a null fact renders "unmeasured — <error>"
  {
    const r = render(factsFile({ ...baseFacts, 'prod.sha': { value: null, measured_at: at(0), command: 'fixture', error: 'ssh: connect timed out' } }));
    const env = r.code === 0 ? envRows(r.html) : '';
    ok('null fact renders unmeasured with its error',
      env.includes('unmeasured &mdash; ssh: connect timed out'), env.slice(0, 200) || r.stderr);
    ok('null fact never falls back to a typed value', !env.includes('f0c66b6b'));
  }

  // (d) a fresh fact renders its value, unlabelled, and derived counts follow it
  {
    const r = render(factsFile(baseFacts));
    const env = r.code === 0 ? envRows(r.html) : '';
    ok('fresh fact renders its value', env.includes('<td class="mono">aaaa1111</td>'), env.slice(0, 200) || r.stderr);
    ok('fresh facts carry no stale / unmeasured label', r.code === 0 && !/class="(stale|unmeasured)"/.test(env));
    ok('migration line is derived from facts', env.includes('34 of 52</b> on main applied (18 behind)'));
    ok('stamp is the render time in IST', r.code === 0 && r.html.includes('rendered 2026-09-23 07:30 IST'));
    ok('fact tokens in prose are filled', r.code === 0 && !r.html.includes('{{'));
  }

  // (d.1) a stale fact cited as a {{token}} in running text (the headline "lede")
  // must carry the SAME stale marker the table cells get — not the bare value.
  // Isolated to the <p class="lede"> paragraph so a table cell showing the same
  // sha (test (b)) cannot make this pass by coincidence.
  const lede = (html) => (html.match(/class="lede">([\s\S]*?)<\/p>/) || [, ''])[1];
  {
    const staleFacts = { ...baseFacts, 'staging.sha': { value: 'bbbb2222', measured_at: at(25), command: 'fixture' } };
    const r = render(factsFile(staleFacts));
    const l = r.code === 0 ? lede(r.html) : '';
    ok('stale token in headline lede carries the stale marker',
      /bbbb2222 <small class="stale">stale &mdash; measured 2026-09-22<\/small>/.test(l), l || r.stderr);
  }
  // (d.2) a fresh fact cited as a {{token}} in prose renders unlabelled.
  {
    const r = render(factsFile(baseFacts));
    const l = r.code === 0 ? lede(r.html) : '';
    ok('fresh token in headline lede carries no stale/unmeasured label',
      l.includes('bbbb2222') && !/class="(stale|unmeasured)"/.test(l), l || r.stderr);
  }
  // (d.3) a null (unmeasured) fact cited as a {{token}} in prose renders
  // "unmeasured", same as the table.
  {
    const r = render(factsFile({ ...baseFacts, 'staging.sha': { value: null, measured_at: at(0), command: 'fixture', error: 'ssh timeout' } }));
    const l = r.code === 0 ? lede(r.html) : '';
    ok('unmeasured token in headline lede renders "unmeasured"',
      l.includes('Staging serves unmeasured;'), l || r.stderr);
  }

  // (e) --check is deterministic: it re-renders with the page's recorded render
  // time, so a page rendered long ago still checks clean with the same inputs.
  {
    const o = join(dir, 'check.html');
    const f = factsFile(baseFacts);
    execFileSync('node', [RENDER, '--out', o, '--facts', f, '--now', NOW], { stdio: 'pipe' });
    let code = 0;
    try { execFileSync('node', [RENDER, '--out', o, '--facts', f, '--check'], { stdio: 'pipe' }); } catch (e) { code = e.status ?? 1; }
    ok('--check passes on an unchanged render regardless of wall clock', code === 0, `exit ${code}`);
  }
}

// --- report -----------------------------------------------------------------
console.log(`render-board: ${pass} passed, ${fails.length} failed`);
if (fails.length) {
  for (const f of fails) console.error('  FAIL ' + f);
  process.exit(1);
}
