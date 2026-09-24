#!/usr/bin/env node
// Build the plan board's three tracking sections from their sources, so the
// owner-facing page cannot drift from the spec it claims to report.
//
// The owner asked (2026-09-20): "Every feature from the spec should be tracked
// in this artifact so that we do not miss anything. And I always see what is
// the current status. It should be user friendly and updated without consuming
// too many tokens." Asked to pick a scope he answered "1+2+3": build items AND
// all owner decisions AND all sourced fields.
//
// THREE SOURCES, read verbatim, never re-derived:
//   1. docs/design/pull-model-completion-state.md  -> 29 build items (verdict is
//      IN the markdown; this script reads it, it does not recompute it)
//   2. docs/design/data-sourcing-pull-model.md     -> 63 OD owner decisions
//   3. scraper/config/field-manifest.json          -> 190 sourced fields
//
// Every count is asserted. A parse that yields a different number FAILS LOUDLY
// rather than emitting a short table, because a tracker that silently drops
// rows looks authoritative and lies — the exact failure this replaces.
//
// USAGE
//   node scripts/ops/build-plan-board.mjs            # write the generated file
//   node scripts/ops/build-plan-board.mjs --check    # exit 1 if it would differ
//   node scripts/ops/build-plan-board.mjs --stdout   # print the HTML, write nothing
//
// OUTPUT
//   docs/design/board/plan-sections.generated.html  — the three <section>s.
//   docs/design/board/patch-plan.py splices this file into the saved page.
//
// TOKEN COST — a first-class requirement of this task.
//   Updating the board does NOT mean reading the 52KB page into context. A
//   status change is: edit ONE line in ONE source file, then run ONE command.
//   This script reads ~3 files from disk and writes one; nothing about the 282
//   rows passes through a model. Reading this header (~60 lines) is the whole
//   context cost of knowing how to update the board.
//
// WHAT IS *NOT* DERIVED HERE, on purpose:
//   - OD implementation status. You cannot mechanically know whether a decision
//     is implemented. Every OD row is marked `unverified` with that word visible
//     in the row, and the spec's own acceptance condition ("What D10 checks") is
//     shown instead. A row claiming `implemented` without evidence is worse than
//     a row saying `unverified`.
//   - Whether a field is actually being WRITTEN. That needs a DB read, which
//     this script deliberately does not do. That column says `unmeasured`, and
//     the section intro names the command that would measure it.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');

const ITEMS_MD = join(REPO_ROOT, 'docs/design/pull-model-completion-state.md');
const SPEC_MD = join(REPO_ROOT, 'docs/design/data-sourcing-pull-model.md');
const MANIFEST = join(REPO_ROOT, 'scraper/config/field-manifest.json');
const OUT = join(REPO_ROOT, 'docs/design/board/plan-sections.generated.html');

// Expected counts, verified against the sources on 2026-09-20. A change here
// must be a deliberate edit accompanying a real source change, never a shrug
// at a failing assertion.
export const EXPECT = { items: 29, decisions: 89, fields: 190 };

// ---------------------------------------------------------------- formatting

export function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Markdown the sources actually contain: `code`, **bold**, *italic*. Escape
// FIRST, then add markup, so source text can never inject tags.
export function mdToHtml(s) {
  let out = esc(s);
  out = out.replace(/`([^`]+)`/g, '<code>$1</code>');
  out = out.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
  out = out.replace(/(^|[^*])\*([^*]+)\*(?!\*)/g, '$1<i>$2</i>');
  return out;
}

// Truncate the plain text to `max` chars on a word boundary, then render its
// markdown. Truncating AFTER rendering would cut a tag in half.
export function truncateMd(s, max = 140) {
  let t = String(s).trim();
  if (t.length <= max) return mdToHtml(t);
  let cut = t.slice(0, max);
  const sp = cut.lastIndexOf(' ');
  if (sp > max * 0.6) cut = cut.slice(0, sp);
  // never end mid-`code` or mid-**bold**: drop a dangling opener
  const ticks = (cut.match(/`/g) || []).length;
  if (ticks % 2) cut = cut.slice(0, cut.lastIndexOf('`'));
  const stars = (cut.match(/\*\*/g) || []).length;
  if (stars % 2) cut = cut.slice(0, cut.lastIndexOf('**'));
  return mdToHtml(cut.trim()) + '&hellip;';
}

// A markdown table row -> its cells. Splits on unescaped pipes that are not
// inside a `code span`, because several spec rows contain a piped code literal.
export function splitRow(line) {
  const cells = [];
  let cur = '';
  let inCode = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '\\' && line[i + 1] === '|') { cur += '|'; i++; continue; }
    if (ch === '`') inCode = !inCode;
    if (ch === '|' && !inCode) { cells.push(cur); cur = ''; continue; }
    cur += ch;
  }
  cells.push(cur);
  // a well-formed row starts and ends with a pipe -> empty first and last cell
  if (cells.length >= 2 && cells[0].trim() === '' && cells[cells.length - 1].trim() === '') {
    return cells.slice(1, -1).map((c) => c.trim());
  }
  return cells.map((c) => c.trim());
}

function fail(msg) {
  console.error('build-plan-board: ' + msg);
  process.exit(1);
}

// ------------------------------------------------------------------- parsing

const ITEM_ROW = /^\|\s*(\d+)\s*\|\s*(.+?)\s*\|\s*\*\*(BUILT|PARTIAL|NOT BUILT)\*\*\s*\|\s*(.+?)\s*\|$/;

export function parseItems(md) {
  const items = [];
  const seen = new Set();
  for (const line of md.split(/\r?\n/)) {
    const m = ITEM_ROW.exec(line);
    if (!m) continue;
    const id = Number(m[1]);
    if (seen.has(id)) fail(`duplicate build item id ${id} — the source has two rows for one item`);
    seen.add(id);
    items.push({ id, what: m[2], verdict: m[3], evidence: m[4] });
  }
  return items;
}

const OD_ROW = /^\|\s*(OD-\d+)\s*\|/;

export function parseDecisions(md) {
  const rows = [];
  const seen = new Set();
  for (const line of md.split(/\r?\n/)) {
    if (!OD_ROW.test(line)) continue;
    const cells = splitRow(line);
    // Real column layout, read from the source (line 54):
    //   | id | Your words | Date | Lives in | What D10 checks |
    if (cells.length !== 5) {
      fail(`malformed OD row (${cells.length} cells, expected 5): ${line.slice(0, 90)}`);
    }
    const [id, words, date, livesIn, acceptance] = cells;
    if (!/^OD-\d+$/.test(id)) fail(`malformed OD id: ${id}`);
    if (seen.has(id)) fail(`duplicate decision ${id}`);
    seen.add(id);
    rows.push({ id, words, date, livesIn, acceptance });
  }
  return rows;
}

export function parseFields(manifest) {
  if (!manifest || typeof manifest.fields !== 'object') fail('field manifest has no `fields` object');
  return Object.entries(manifest.fields).map(([name, f]) => {
    const rank = f.rank && typeof f.rank === 'object' ? f.rank : {};
    // Sources, ranked. Segments usually share a ranking; show it once when they
    // agree, and per segment when they differ — that difference is real and
    // collapsing it would be the kind of quiet lie this script exists to avoid.
    const perSeg = Object.entries(rank).map(([seg, list]) => [seg, (list || []).join(' > ')]);
    const uniq = [...new Set(perSeg.map(([, v]) => v))];
    const sources = uniq.length === 1 && perSeg.length > 0
      ? uniq[0]
      : perSeg.map(([seg, v]) => `${seg}: ${v}`).join(' · ');
    const table = name.includes('.') ? name.slice(0, name.indexOf('.')) : '(ungrouped)';
    return {
      name,
      table,
      cls: f.class || '—',
      documentType: f.documentType || '',
      sources: sources || '(no ranking)',
      na: Array.isArray(f.na) ? f.na : [],
    };
  });
}

// ------------------------------------------------------------------ rendering

function pill(cls, text) {
  return `<span class="pill ${cls}">${esc(text)}</span>`;
}

// Verdict -> the board's existing pill vocabulary. BUILT is landed-green,
// PARTIAL is merged-amber (work acknowledged but incomplete), NOT BUILT is
// queued-grey. No new colour vocabulary is invented.
const VERDICT_PILL = { BUILT: 'landed', PARTIAL: 'merged', 'NOT BUILT': 'queued' };

function renderSummary(items, decisions, fields, stamp) {
  const built = items.filter((i) => i.verdict === 'BUILT').length;
  const partial = items.filter((i) => i.verdict === 'PARTIAL').length;
  const notBuilt = items.filter((i) => i.verdict === 'NOT BUILT').length;
  const tables = new Set(fields.map((f) => f.table)).size;
  const cells = [
    ['Build items', `${built} built &middot; ${partial} partial &middot; ${notBuilt} not built <span class="mute">of ${items.length}</span>`],
    ['Owner decisions', `${decisions.length} recorded &middot; <b>0 machine-verified</b> <span class="mute">status is not derivable; see below</span>`],
    ['Sourced fields', `${fields.length} in the manifest across ${tables} tables &middot; <b>write coverage unmeasured</b>`],
  ];
  return `
<section class="status" id="plan-summary">
 <div class="hd"><h2>Everything the spec asks for, in three lists</h2><span class="stamp">generated ${esc(stamp)}</span></div>
 <div class="now">${cells.map(([k, v]) => `<div><span class="k">${esc(k)}</span>${v}</div>`).join('')}</div>
 <p class="rule">Generated by <code>node scripts/ops/build-plan-board.mjs</code> from three source files. Nothing on this page is typed by hand, so it cannot drift from the spec. Where a status is not mechanically knowable it says so in the row rather than guessing.</p>
</section>`;
}

// A per-item "proven on staging" marker, read from the item's OWN evidence
// text — never typed elsewhere and never inferred from the verdict. An item
// records it by putting the literal text `Staging proof:` in its evidence
// cell in pull-model-completion-state.md, followed by the citation (a run,
// a PR, a script + result). No item recording one yet is not an error — the
// count is simply 0, and render-board.mjs shows that as `unmeasured` rather
// than inventing a number.
const STAGING_PROOF = /Staging proof:/;

function renderItems(items) {
  const trs = items.map((i) => {
    const cls = VERDICT_PILL[i.verdict];
    const staged = STAGING_PROOF.test(i.evidence) ? ' data-staged="1"' : '';
    return `<tr${staged}><td class="s">${i.id}</td><td>${mdToHtml(i.what)}</td><td>${pill(cls, i.verdict)}</td><td>${mdToHtml(i.evidence)}</td></tr>`;
  }).join('');
  return `
<section class="status" id="completion">
 <div class="hd"><h2>1. Build items &mdash; what exists in the code</h2><span class="stamp">${items.length} items</span></div>
 <p class="rule">Read verbatim from <code>docs/design/pull-model-completion-state.md</code>. The verdict is written in that file by whoever measured it; this table does not recompute it. To change a status, edit that one row and re-run the generator.</p>
 <div class="wrap"><table>
 <thead><tr><th>#</th><th>What it is</th><th>Status</th><th>Evidence / what is missing</th></tr></thead>
 <tbody>${trs}</tbody></table></div>
</section>`;
}

function renderDecisions(decisions) {
  const trs = decisions.map((d) => {
    return `<tr><td class="s">${esc(d.id)}</td><td>${truncateMd(d.words, 140)}</td><td class="mono">${esc(d.date)}</td><td class="mono">${mdToHtml(d.livesIn)}</td><td>${mdToHtml(d.acceptance)}</td><td>${pill('queued', 'unverified')}</td></tr>`;
  }).join('');
  return `
<section class="status" id="decisions">
 <div class="hd"><h2>2. Owner decisions &mdash; every OD in the spec</h2><span class="stamp">${decisions.length} decisions</span></div>
 <p class="rule"><b>Every row says <code>unverified</code>, and that is the honest answer.</b> Whether a decision is actually implemented cannot be derived from the spec text — only a human or a named check can say so. What the spec DOES state is the acceptance condition, shown here in its own column: that is what a reviewer must confirm. A row claiming &ldquo;implemented&rdquo; without evidence would be worse than one saying unverified. The decision text is truncated to ~140 characters; the full wording is in <code>docs/design/data-sourcing-pull-model.md</code>.</p>
 <div class="wrap"><table>
 <thead><tr><th>ID</th><th>The decision</th><th>Date</th><th>Lives in</th><th>What its acceptance check is</th><th>Status</th></tr></thead>
 <tbody>${trs}</tbody></table></div>
</section>`;
}

function renderFields(fields) {
  const byTable = new Map();
  for (const f of fields) {
    if (!byTable.has(f.table)) byTable.set(f.table, []);
    byTable.get(f.table).push(f);
  }
  // Grouped by table inside a <details> per table, collapsed by default.
  // WHY: 190 rows in one open table is ~6 screens and buries the two sections
  // above it, which are the ones the owner reads daily. Grouping by table (not
  // by an arbitrary page size) matches how a field is actually looked up — you
  // know the table before you know the column — and each group's header carries
  // its own count, so the totals stay checkable without expanding anything.
  const groups = [...byTable.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([table, list]) => {
      const trs = list.map((f) => {
        const na = f.na.length ? `<span class="mute"> n/a: ${esc(f.na.join(', '))}</span>` : '';
        const doc = f.documentType ? ` <span class="mute">(${esc(f.documentType)})</span>` : '';
        return `<tr><td class="mono">${esc(f.name)}</td><td class="s">${esc(f.cls)}${doc}</td><td>${esc(f.sources)}${na}</td><td>${pill('queued', 'unmeasured')}</td></tr>`;
      }).join('');
      return `<details><summary><b>${esc(table)}</b> &mdash; ${list.length} field${list.length === 1 ? '' : 's'}</summary>
 <div class="wrap"><table>
 <thead><tr><th>Field</th><th>Class</th><th>Ranked sources</th><th>Being written?</th></tr></thead>
 <tbody>${trs}</tbody></table></div></details>`;
    }).join('\n');
  return `
<section class="status" id="fields">
 <div class="hd"><h2>3. Sourced fields &mdash; every field in the manifest</h2><span class="stamp">${fields.length} fields</span></div>
 <p class="rule">From <code>scraper/config/field-manifest.json</code>: each field's class, its per-segment source ranking (shown once when the segments agree), and the offering types it is not applicable to. <b>The &ldquo;being written&rdquo; column says <code>unmeasured</code> because it needs a database read, which this generator deliberately does not do.</b> To measure it: <code>node scripts/audit-coverage.mjs --gate</code> against the staging database through the tunnel (recipe in <code>docs/ops/prod-ops-recipes.md</code> &sect;2). Collapsed by table so 190 rows do not bury the two sections above.</p>
 ${groups}
</section>`;
}

// --------------------------------------------------------------------- build

export function build({ itemsMd, specMd, manifest, stamp }) {
  const items = parseItems(itemsMd);
  const decisions = parseDecisions(specMd);
  const fields = parseFields(manifest);

  if (items.length !== EXPECT.items) {
    fail(`parsed ${items.length} build items, expected ${EXPECT.items} — the parse is wrong, or the source changed. Refusing to emit a short table.`);
  }
  if (decisions.length !== EXPECT.decisions) {
    fail(`parsed ${decisions.length} owner decisions, expected ${EXPECT.decisions} — refusing to emit a short table.`);
  }
  if (fields.length !== EXPECT.fields) {
    fail(`parsed ${fields.length} fields, expected ${EXPECT.fields} — refusing to emit a short table.`);
  }

  const html = [
    '<!-- GENERATED by scripts/ops/build-plan-board.mjs — do not hand-edit. -->',
    renderSummary(items, decisions, fields, stamp),
    renderItems(items),
    renderDecisions(decisions),
    renderFields(fields),
    '<!-- /GENERATED -->',
    '',
  ].join('\n');
  return { html, counts: { items: items.length, decisions: decisions.length, fields: fields.length } };
}

function main() {
  const argv = process.argv.slice(2);
  const check = argv.includes('--check');
  const toStdout = argv.includes('--stdout');

  for (const p of [ITEMS_MD, SPEC_MD, MANIFEST]) {
    if (!existsSync(p)) fail(`source missing: ${p}`);
  }

  // A fixed stamp under --check, so the idempotence check is about content and
  // not about the clock. A real write stamps the date it ran (IST).
  const stamp = check
    ? (/(<span class="stamp">generated )([^<]*)/.exec(existsSync(OUT) ? readFileSync(OUT, 'utf8') : '') || [, , ''])[2]
    : new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10) + ' IST';

  const { html, counts } = build({
    itemsMd: readFileSync(ITEMS_MD, 'utf8'),
    specMd: readFileSync(SPEC_MD, 'utf8'),
    manifest: JSON.parse(readFileSync(MANIFEST, 'utf8')),
    stamp,
  });

  if (toStdout) { process.stdout.write(html); return; }

  if (check) {
    const current = existsSync(OUT) ? readFileSync(OUT, 'utf8') : '';
    if (current !== html) {
      fail(`${OUT} is stale — re-run: node scripts/ops/build-plan-board.mjs`);
    }
    console.log(`build-plan-board --check: up to date (${counts.items} items, ${counts.decisions} decisions, ${counts.fields} fields)`);
    return;
  }

  writeFileSync(OUT, html, 'utf8');
  console.log(`build-plan-board: wrote ${OUT} (${html.length} bytes) — ${counts.items} build items, ${counts.decisions} owner decisions, ${counts.fields} fields`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
