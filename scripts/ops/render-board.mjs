#!/usr/bin/env node
// Render the WHOLE owner-facing board page from source files.
//
// WHY THIS REPLACES patch-plan.py
//   patch-plan.py spliced new content into a saved copy of the LIVE page and
//   asserted on that page's structure (`<section class="status" id="status">`,
//   an `<h2>` anchor). That makes the renderer depend on its own previous
//   output: restructure the page once and the next render assert-fails, which
//   is exactly what happened on 2026-09-20. A renderer must read DATA, never
//   the artifact it produces.
//
// FOUR SOURCES, all on disk, none read from the published page:
//   1. docs/design/board/board-data.json        -> the hand-owned judgements
//      (stamp, environments, decisions waiting, gates, reader impact, chain)
//   2. docs/design/board/board-prose.json       -> the 10 explanatory sections
//   3. docs/design/board/status.json            -> the 16 stage-3 slice rows
//   4. docs/design/board/plan-sections.generated.html
//      -> 29 build items + 63 owner decisions + 190 sourced fields, produced by
//         build-plan-board.mjs from the spec. Regenerate that first if a
//         build item, an OD or a manifest field changed.
//
// TOKEN COST — a first-class requirement (owner, 2026-09-20: "minimum tokens").
//   Updating the board does NOT mean reading the 150KB page into context, and
//   does NOT mean `Artifact read_file` of the live page. It is: edit one value
//   in board-data.json or status.json, run this command, publish the output.
//   None of the 282 tracked rows or the 10 prose sections passes through a
//   model. Reading this header is the whole context cost of knowing how.
//
// THE NINE ROLES THIS PAGE IS BUILT FOR (owner ask, 2026-09-20: every role
// must rate it >9/10). Each block below names the role whose question it
// answers, so a future edit knows what it would break:
//   Owner              -> "Waiting on you" (decisions, with a recommendation)
//   Product manager    -> "What a reader sees" (impact in plain language)
//   Senior architect   -> the dependency chain strip
//   Implementation     -> "Next up" inside the vitals
//   Delivery / PM      -> "Changed since <date>"
//   Deployment         -> the release + rollback block
//   Environments       -> the environments table (sha, age, flags, DB per slot)
//   QA                 -> the gates table (what ran, what never ran)
//   Data / domain      -> reader impact stated in rupees, not row counts
//
// USAGE
//   node scripts/ops/render-board.mjs                 # write index.html
//   node scripts/ops/render-board.mjs --out <path>    # elsewhere
//   node scripts/ops/render-board.mjs --check         # exit 1 if stale
//
// OUTPUT
//   docs/design/board/index.html — publish this file with the board URL.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');
const BOARD = join(REPO_ROOT, 'docs/design/board');

const DATA = join(BOARD, 'board-data.json');
const PROSE = join(BOARD, 'board-prose.json');
const STATUS = join(BOARD, 'status.json');
const PLAN = join(BOARD, 'plan-sections.generated.html');
const OUT_DEFAULT = join(BOARD, 'index.html');

const argv = process.argv.slice(2);
const CHECK = argv.includes('--check');
const outIdx = argv.indexOf('--out');
const OUT = outIdx >= 0 ? argv[outIdx + 1] : OUT_DEFAULT;

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));

const data = readJson(DATA);
const prose = readJson(PROSE);
const status = readJson(STATUS);

// The generated tracking sections are required, not optional: a board that
// silently drops the 282 tracked rows looks complete and lies.
if (!existsSync(PLAN)) {
  console.error(`missing ${PLAN}\nrun: node scripts/ops/build-plan-board.mjs`);
  process.exit(1);
}
const planSections = readFileSync(PLAN, 'utf8').trim();
if (!planSections.includes('<!-- /GENERATED -->')) {
  console.error('plan-sections.generated.html is missing its end marker — regenerate it');
  process.exit(1);
}

// ---- assertions: fail loudly rather than render a short page ----------------
const need = (cond, msg) => { if (!cond) { console.error('render-board: ' + msg); process.exit(1); } };
need(Array.isArray(status.slices) && status.slices.length >= 10, 'status.json has too few slices');
need(prose.length === 10, `expected 10 prose sections, got ${prose.length}`);
need(data.environments.length >= 2, 'need at least prod and staging environments');
need(data.waiting_on_owner.length >= 1, 'waiting_on_owner is empty — if nothing is waiting, say so explicitly');
for (const k of ['stamp', 'headline', 'release', 'gates', 'reader_impact', 'chain', 'changed_since', 'now'])
  need(data[k] !== undefined, `board-data.json missing "${k}"`);

// ---- derived counts: never typed by hand -----------------------------------
// Build-item verdicts are parsed out of the generated section so the vitals
// tile and the table can never disagree. Typing "12 built" by hand is how the
// previous board drifted.
// Count PER ROW, never by matching verdict words across the whole section: a
// row's evidence prose can name a verdict ("...still reads NOT STARTED"), and a
// document-wide match counts that as a row. Measured 2026-09-20: a grep over the
// source markdown returned 31 verdicts for 29 items for exactly this reason.
const completion = planSections.match(/<section class="status" id="completion">[\s\S]*?<\/section>/);
need(completion, 'generated file has no completion section');
const itemRows = (completion[0].match(/<tr>[\s\S]*?<\/tr>/g) || []).filter((r) => r.includes('<td class="s">'));
const verdicts = { BUILT: 0, PARTIAL: 0, 'NOT BUILT': 0 };
for (const r of itemRows) {
  const v = r.match(/<span class="pill \w+">(BUILT|PARTIAL|NOT BUILT)<\/span>/);
  need(v, `build-item row carries no verdict: ${r.slice(0, 90)}`);
  verdicts[v[1]] += 1;
}
const built = verdicts.BUILT;
const partial = verdicts.PARTIAL;
const notBuilt = verdicts['NOT BUILT'];
const itemsTotal = itemRows.length;
need(itemsTotal === 29, `parsed ${itemsTotal} build items, expected 29`);
need(built + partial + notBuilt === itemsTotal, 'verdict counts do not sum to the row count');

const slices = status.slices;
const landedSlices = slices.filter((s) => s.state === 'landed').length;

const esc = (s) => String(s).replace(/&(?![a-zA-Z#][a-zA-Z0-9]*;)/g, '&amp;');
const toneClass = { ok: 'ok', warn: 'warn', bad: 'bad', info: 'info', building: 'building', queued: 'queued', red: 'bad', landed: 'ok', merged: 'warn' };

// ---- the page --------------------------------------------------------------
// Production age is derived from its deploy date, so the tile cannot say "13
// days" a week later. Every other tile shows a quantity; this one must too.
const prodAgeDays = Math.round(
  (Date.parse(data.stamp.slice(0, 10)) - Date.parse(data.environments[0].since)) / 86400000);
need(Number.isFinite(prodAgeDays) && prodAgeDays >= 0,
  `cannot derive production age from stamp "${data.stamp}" and since "${data.environments[0].since}"`);

const meter = [
  ...Array(built).fill('on-ok'),
  ...Array(partial).fill('on-warn'),
  ...Array(notBuilt).fill('on-bad'),
].map((c) => `<span class="${c}"></span>`).join('');

const vitals = `
<div class="vitals">
 <div class="bad"><span class="k">Production</span><span class="v">${prodAgeDays} days behind</span><span class="sub">Serving <b>${data.environments[0].sha}</b> since ${esc(data.environments[0].since)}. ${esc(data.environments[0].note)}</span></div>
 <div class="warn"><span class="k">Staging &mdash; the release gate</span><span class="v">${built} / ${itemsTotal} built</span><span class="sub">${built} built &middot; ${partial} partial &middot; ${notBuilt} not built. The bar for a production window is <b>feature-complete here</b>, not a green build.</span>
  <div class="meter" aria-hidden="true">${meter}</div></div>
 <div class="ok"><span class="k">Stage 3 slices</span><span class="v">${landedSlices} landed</span><span class="sub">${landedSlices} of ${slices.length} rows landed. ${esc(data.now.Blocked ? 'See blocked, below.' : '')}</span></div>
 <div class="acc"><span class="k">Next up</span><span class="v">${data.chain[0].id}</span><span class="sub">${esc(data.chain[0].what)} <span class="mute">(${esc(data.chain[0].note)})</span></span></div>
</div>`;

// Owner block — first thing on the page, because the owner's question is
// "what needs me?", not "what is the status?".
const waiting = `
<section class="decide" id="decide">
 <h2>Waiting on you <span class="count">${data.waiting_on_owner.length}</span></h2>
 <div class="dgrid">${data.waiting_on_owner.map((d) => `
  <div class="dcard">
   <div class="did">${esc(d.id)}</div>
   <p class="dask">${esc(d.ask)}</p>
   <p class="drec"><span class="rk">Recommended</span> <b>${esc(d.recommend)}</b> &mdash; ${esc(d.why)}</p>
   <p class="dblk"><span class="rk">Blocks</span> ${esc(d.blocks)}</p>
  </div>`).join('')}</div>
 <p class="rule">Everything else on this page is information. These three need a word from you; each carries the recommendation so a one-word answer is enough.</p>
</section>`;

const readerImpact = `
<section class="status" id="impact">
 <div class="hd"><h2>What a reader of the site sees today</h2><span class="stamp">plain language, no jargon</span></div>
 <div class="wrap"><table>
 <thead><tr><th>The problem</th><th>What it looks like to someone using the site</th><th>Where it stands</th><th>Ref</th></tr></thead>
 <tbody>${data.reader_impact.map((r) => `<tr><td><span class="dot ${toneClass[r.state]}"></span><b>${esc(r.what)}</b></td><td>${esc(r.plain)}</td><td>${esc(r.status)}</td><td class="mono">${esc(r.issue)}</td></tr>`).join('')}</tbody></table></div>
</section>`;

const envs = `
<section class="status" id="environments">
 <div class="hd"><h2>Environments</h2><span class="stamp">what is running where</span></div>
 <div class="wrap"><table>
 <thead><tr><th>Slot</th><th>Serving</th><th>Since</th><th>Feature flags</th><th>State</th></tr></thead>
 <tbody>${data.environments.map((e) => `<tr><td class="s"><b>${esc(e.slot)}</b><br><small>${esc(e.url)}</small></td><td class="mono">${esc(e.sha)}</td><td class="mono">${esc(e.since)}</td><td>${esc(e.flags)}</td><td><span class="dot ${toneClass[e.state]}"></span>${esc(e.note)}</td></tr>`).join('')}</tbody></table></div>
 <div class="relbox">
  <h3>Release and rollback</h3>
  <dl class="rel">
   <dt>Window</dt><dd>${esc(data.release.window)}</dd>
   <dt>Branch</dt><dd>${data.release.branch}</dd>
   <dt>Next release</dt><dd>${esc(data.release.contents)}</dd>
   <dt>Rollback</dt><dd>${data.release.rollback}</dd>
   <dt>Scheduled</dt><dd>${data.release.scheduled ? esc(String(data.release.scheduled)) : '<b>No production deploy is scheduled.</b>'}</dd>
  </dl>
 </div>
</section>`;

const gates = `
<section class="status" id="gates">
 <div class="hd"><h2>Gates and proofs</h2><span class="stamp">what ran, and what never ran</span></div>
 <div class="wrap"><table>
 <thead><tr><th>Gate</th><th>State</th><th>Detail</th></tr></thead>
 <tbody>${data.gates.map((g) => `<tr><td class="s">${esc(g.name)}</td><td><span class="pill ${g.state === 'ok' ? 'landed' : g.state === 'warn' ? 'merged' : 'red'}">${g.state === 'ok' ? 'green' : g.state === 'warn' ? 'partial' : 'not run'}</span></td><td>${g.detail}</td></tr>`).join('')}</tbody></table></div>
</section>`;

const chain = `
<section class="status" id="chain">
 <div class="hd"><h2>The order the remaining work runs in</h2><span class="stamp">dependency order, read from the spec</span></div>
 <ol class="chain">${data.chain.map((c) => `<li class="c-${toneClass[c.state]}"><span class="cid">${esc(c.id)}</span><span class="cwhat">${esc(c.what)}</span><span class="cnote">${esc(c.note)}</span></li>`).join('')}</ol>
 <p class="rule">One short branch per item, never stacked. An item does not start until the one it depends on has landed with its proof read.</p>
</section>`;

const changed = `
<section class="status" id="changed">
 <div class="hd"><h2>Changed since ${esc(data.changed_since.date)}</h2><span class="stamp">read this if you were here before</span></div>
 <ul class="changed">${data.changed_since.lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>
</section>`;

// Stage-3 slice table (the detail behind the "slices landed" tile)
const cls = { landed: 'landed', merged: 'merged', building: 'building', review: 'building', red: 'red', queued: 'queued' };
const sliceRows = slices.map((r) => `<tr><td class="s">${esc(r.id)}</td><td>${esc(r.what)}</td><td>${r.tier === '-' ? '&mdash;' : `<span class="tier ${r.tier}">${r.tier}</span>`}</td><td class="mono">${esc(r.pr || '&mdash;')}</td><td class="mono">${esc(r.sha || '&mdash;')}</td><td>${esc(r.review)}</td><td>${esc(r.proof)}</td><td>${esc(r.gate || '&mdash;')}</td><td><span class="pill ${cls[r.state]}">${esc(r.status)}</span></td></tr>`).join('');

const sec = (id, tone, title, gloss, chipClass, chip, body, open) => `
<details class="sec ${tone}" id="${id}"${open ? ' open' : ''}>
 <summary><span class="caret">&#9654;</span><span class="ttl">${title}</span><span class="chip"><span class="pill ${chipClass}">${chip}</span></span><span class="gloss">${gloss}</span></summary>
 <div class="body">
${body}
 </div>
</details>`;

const slicesSection = sec('slices', 'ok', `Stage 3 slices &mdash; the ${slices.length} rows`,
  'Every slice of the one-source-table work, with its PR, merged sha, review tier, staging proof and gate result.',
  'landed', `${landedSlices} landed`,
  `<div class="wrap"><table>
 <thead><tr><th>Slice</th><th>What it lands</th><th>Tier</th><th>PR</th><th>Merged sha</th><th>Review</th><th>Staging proof</th><th>Gate</th><th>Status</th></tr></thead>
 <tbody>${sliceRows}</tbody></table></div>
 <p class="rule">Landed = merged on main + staging proof read by identity + <code>check-stage3-dod.mjs</code> all PASS.</p>`,
  true); // open by default: the page must show real detail at rest, not 15 closed rows

const nowSection = sec('now', 'info', 'Where the work stands, in three lines',
  'What landed, what is next, and what is blocked.', 'building', 'in progress',
  Object.entries(data.now).map(([k, v]) => `<h3>${esc(k)}</h3>\n<p>${v}</p>`).join('\n'));

const proseSections = prose.map((p) => sec(p.id, p.tone, p.title, p.gloss, p.chip_class, p.chip, p.body)).join('');

// The three generated tracking sections arrive as bare <section class="status">
// blocks; wrap each in a collapsible so the 282 rows do not bury the page.
const wrapGenerated = (html) => {
  const meta = {
    completion: ['warn', 'Build items &mdash; what exists in the code', `All ${itemsTotal} items of the spec, each with the evidence for its verdict or the named thing that is missing.`, 'merged', `${built} built &middot; ${partial} partial &middot; ${notBuilt} not built`],
    decisions: ['info', 'Owner decisions &mdash; every OD in the spec', 'All 63 recorded decisions with the acceptance check the spec states for each.', 'queued', '63 recorded &middot; 0 machine-verified'],
    fields: ['info', 'Sourced fields &mdash; every field in the manifest', 'All 190 fields across 18 tables, collapsed per table.', 'queued', '190 fields &middot; coverage unmeasured'],
  };
  let out = '';
  for (const [id, [tone, title, gloss, cc, chip]] of Object.entries(meta)) {
    const re = new RegExp(`<section class="status" id="${id}">([\\s\\S]*?)</section>`);
    const m = html.match(re);
    if (!m) { console.error(`render-board: generated section "${id}" not found`); process.exit(1); }
    // drop the generated section's own <h2> header row; the summary carries it
    const body = m[1].replace(/<div class="hd">[\s\S]*?<\/div>\s*/, '');
    out += sec(id, tone, title, gloss, cc, chip, body);
  }
  return out;
};
const generated = wrapGenerated(planSections);

const css = readFileSync(join(BOARD, 'board.css'), 'utf8');

const page = `<title>One Source Table Plan</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap">
<style>
${css}</style>
<main>
<h1>One Source Table Plan</h1>
<p class="lede">${esc(data.headline)}</p>
<p class="stamp">${esc(data.stage)} &middot; updated ${esc(data.stamp)} &middot; generated by <code>scripts/ops/render-board.mjs</code></p>
${waiting}
${vitals}
<div class="legend"><span><i style="background:var(--ok)"></i>built / landed</span><span><i style="background:var(--warn)"></i>partial, or proof owed</span><span><i style="background:var(--bad)"></i>not built</span><span><i style="background:var(--accent)"></i>context, no status</span></div>
${readerImpact}
${envs}
${gates}
${chain}
${changed}
<div class="controls">
 <button type="button" data-all="open">Expand all</button>
 <button type="button" data-all="close">Collapse all</button>
 <span class="hint">Each section below carries its own status. Click a heading to open it.</span>
</div>
${slicesSection}
${nowSection}
${generated}
${proseSections}
<p class="foot">This page is generated from four files in <code>docs/design/board/</code> &mdash; nothing on it is typed into the published HTML, so it cannot drift from the spec it reports. Written 2026-09-17 by the stage 3 supervisor session; restructured 2026-09-20 into per-section status for the nine roles that read it. Sources: docs/design/data-sourcing-pull-model.md, docs/design/pull-model-completion-state.md, scraper/config/field-manifest.json.</p>
</main>
<script>
document.querySelectorAll(".controls button").forEach(function (b) {
  b.addEventListener("click", function () {
    var open = b.dataset.all === "open";
    document.querySelectorAll("details.sec").forEach(function (d) { d.open = open; });
  });
});
</script>
`;

if (CHECK) {
  const current = existsSync(OUT) ? readFileSync(OUT, 'utf8') : '';
  if (current !== page) {
    console.error('board is stale — run: node scripts/ops/render-board.mjs');
    process.exit(1);
  }
  console.log('board up to date');
  process.exit(0);
}

writeFileSync(OUT, page);
console.log(`written ${OUT} ${page.length} bytes; ${itemsTotal} build items (${built}/${partial}/${notBuilt}), ${slices.length} slices, ${prose.length} prose sections, ${data.waiting_on_owner.length} decisions waiting`);
