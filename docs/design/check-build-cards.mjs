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
import { spawnSync } from 'node:child_process';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CARDS = path.join(HERE, 'build-cards');
const REPO = path.resolve(HERE, '../..');
const gate = process.argv.includes('--gate');

// Spelled exactly as `_TEMPLATE.md` spells them, in order.
//
// Thirteen since 2026-09-09 (OD-52). `Rules implemented` is what makes the design's rule ids
// traceable into code — without it D19 has nothing to read. `Known gaps` is where a finding that
// this card owns but does not close is written down, so "zero open findings" cannot be reached by
// quietly dropping one.
const HEADINGS = ['## Purpose', '## Serves', '## Files', '## Schema', '## Interfaces',
  '## Feature flag', '## Tests', '## Detection', '## Staging proof', '## Rollback',
  '## Tier, budget and cost', '## Rules implemented', '## Known gaps'];

/** Does the repository deliberately ignore this path? Asked of git, never guessed from a pattern. */
const ignoreCache = new Map();
function isIgnored(p) {
  if (ignoreCache.has(p)) return ignoreCache.get(p);
  // The exit code alone cannot be trusted here. On Windows (Git 2.53.0.windows.2), `git
  // check-ignore -q --` for a path written with a trailing slash exits 0 ("ignored") whenever NO
  // .gitignore pattern actually matches it — and this is NOT an existence quirk: it reproduces for
  // `scraper/config/` and `scripts/state/` whether or not the directory exists on disk (confirmed
  // both ways; an untracked `scripts/state/` created on disk still falsely reports ignored under
  // `-q` with a trailing slash). Stripping the trailing slash is not a safe fix either — it breaks
  // the opposite, genuine case: `docs/design/probes/fixtures/pdf/` IS a real directory-only
  // .gitignore entry (line ends `/`), and for a path that doesn't exist on disk, git can only tell
  // it's meant to be a directory from the trailing slash on the QUERY; asking without one makes
  // even a real match report "not ignored".
  //
  // -v (not -q) resolves this without guessing: on a genuine match it prints the matching pattern
  // before the tab (`.gitignore:356:docs/design/probes/fixtures/pdf/\t...`); on the false-positive
  // exit-0 case it prints an EMPTY pattern field (`.gitignore:349:\t...` — line 349 is a blank line
  // in .gitignore, not a pattern). So "ignored" is exit 0 AND a non-empty reported pattern — that
  // reads the same regardless of whether the path exists.
  const r = spawnSync('git', ['check-ignore', '-v', '--', p], { cwd: REPO, encoding: 'utf8' });
  // 0 = a pattern matched (verify it below), 1 = no pattern matched, anything else = git could not
  // answer, and an unanswered question is not a pass.
  let answer = false;
  if (r.status === 0) {
    const firstLine = (r.stdout || '').split(/\r?\n/, 1)[0];
    const beforeTab = firstLine.split('\t')[0];
    const m = /^(.*):(\d+):(.*)$/.exec(beforeTab);
    answer = Boolean(m && m[3].trim().length > 0);
  }
  ignoreCache.set(p, answer);
  return answer;
}

// Exported so `scripts/tests/check-build-cards-isignored.test.mjs` can exercise the real function
// (not a re-implementation of its git-parsing logic) without running the whole gate as a
// subprocess for every case.
export { isIgnored };

const isMain = Boolean(process.argv[1]) && (
  import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}`
  || import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}`
);

if (isMain) try {
  const files = fs.readdirSync(CARDS).filter((f) => /^item-\d+-.*\.md$/.test(f)).sort();
  const problems = [];
  let pathsChecked = 0, pathsMissing = 0, excused = 0;

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
        // The marker must sit IMMEDIATELY AFTER the citation, and it is case-sensitive.
        //
        // The old test was `/\bNEW\b/i` over the whole line, and a reviewer measured what that was
        // worth on 2026-09-09: it excused 164 of 352 citations, because ordinary prose on the same
        // line ("New method", "the new column") satisfied it. They replaced a real path with
        // `NOT-A-REAL-FILE-xyz.ts` on such a line and the gate still printed "only paths that
        // resolve". A marker that any sentence can supply is not a marker.
        const rest = line.slice(m.index + m[0].length, m.index + m[0].length + 48);
        // The two markers are NOT interchangeable, and the first version of this fix made them so.
        // A second-round reviewer renamed a real file to `NOT-A-REAL-FILE-xyz.ts` (LOCAL) and the
        // gate passed: a regression the fix itself introduced, and worse than the hole it closed,
        // because LOCAL is now a universal excuse. LOCAL is only ever valid for a path git actually
        // ignores; NEW is for a path this item creates.
        //
        // The prefix class also no longer eats a dash. `[\s|—-]*` let "— NEW method" prose count as
        // a marker, which is the same "any sentence can supply it" hole one step smaller.
        const isNew = /^[\s|]*\(?\*{0,2}NEW\b/.test(rest);
        const isLocal = /^[\s|]*\(?\*{0,2}LOCAL\b/.test(rest);
        // A path the repository deliberately IGNORES cannot exist in a fresh checkout, so this
        // check used to pass only on the machine that had run the probe. Found 2026-09-09: a card
        // cited `docs/design/probes/fixtures/pdf/`, which `.gitignore` excludes on purpose (PDFs
        // are never committed, OD-43), and the gate went red in every new worktree. An ignored path
        // is legitimate — it just has to say so, so a reader knows not to go looking for it.
        if (isNew || (isLocal && isIgnored(p))) { excused++; continue; }
        if (isLocal && !isIgnored(p)) {
          pathsMissing++;
          problems.push(`${f}: cites \`${p}\` (LOCAL), but git does not ignore that path — LOCAL is only for a path .gitignore excludes. If this item creates the file, mark it (NEW).`);
          continue;
        }
        pathsMissing++;
        problems.push(isIgnored(p)
          ? `${f}: cites \`${p}\`, which .gitignore excludes — write \`${p}\` (LOCAL) so a reader knows it exists only on a machine that ran the probe`
          : `${f}: cites \`${p}\` which does not exist — write \`${p}\` (NEW) immediately after the path if this item creates it`);
      }
    }

    // A budget line, because an item with no budget is an item that runs until somebody notices.
    if (!/Budget:\s*\d+\s*min/i.test(md)) problems.push(`${f}: no "Budget: <N> min" line`);
    // A tier, because the review depth is decided by blast radius, not by mood.
    if (!/\bTier\s*[:A-C]/.test(md)) problems.push(`${f}: no tier stated`);
  }

  console.log(`build cards: ${files.length}`);
  console.log(`paths cited: ${pathsChecked}, excused by an adjacent (NEW)/(LOCAL): ${excused}, missing and unexcused: ${pathsMissing}`);
  if (!problems.length) {
    console.log('every card carries all thirteen headings in order, a budget, a tier, and only paths that resolve.');
    process.exit(0);
  }
  for (const p of problems) console.log('  FAIL ' + p);
  console.log(`\n${problems.length} problem(s) across ${files.length} card(s).`);
  process.exit(gate ? 1 : 0);
} catch (err) {
  console.error('check-build-cards: the check itself failed —', err.message);
  process.exit(2);
}
