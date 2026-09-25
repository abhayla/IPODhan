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
const offlineParkedCheckSkip = process.argv.includes('--offline-parked-check=skip');

// Item 32 (#1027, owner decision 2026-09-25, "Add PARTIAL shape (Recommended)"): once every
// UNKNOWN_ALLOWED card below has resolved to DONE / NOT STARTED / PARTIAL, the supervisor flips
// this to `true` and empties UNKNOWN_ALLOWED in the same change — `unknown` is then refused
// outright, for every card, with no allow-list. Flipping it early (before the six cards below
// resolve) makes the gate red on the whole tree; that is the point of the flip, not a bug in it.
const REFUSE_UNKNOWN = true;

// Spelled exactly as `_TEMPLATE.md` spells them, in order.
//
// Thirteen since 2026-09-09 (OD-52). `Rules implemented` is what makes the design's rule ids
// traceable into code — without it D19 has nothing to read. `Known gaps` is where a finding that
// this card owns but does not close is written down, so "zero open findings" cannot be reached by
// quietly dropping one.
const HEADINGS = ['## Purpose', '## Serves', '## Files', '## Schema', '## Interfaces',
  '## Feature flag', '## Tests', '## Detection', '## Staging proof', '## Rollback',
  '## Tier, budget and cost', '## Rules implemented', '## Known gaps'];

// Item 32 follow-up (2026-09-23): `unknown` was accepted for ANY card, and 24 of 42 read it —
// a shape check-build-cards.mjs accepted as valid while telling nobody anything
// (staging-is-the-release-gate.md R5). Resolving each card against refs/remotes/origin/main
// found ten whose item is itself genuinely PARTIAL (measured in
// docs/design/pull-model-completion-state.md, not guessed) — those ten keep `unknown`, but ONLY
// these ten. This list is SHRINK-ONLY: a card comes off it by becoming DONE or NOT STARTED, and
// nothing may be added back without re-doing the same origin/main + PR-merge verification this
// list was built from. A NEW card reading `unknown` that is not on this list fails the gate.
const UNKNOWN_ALLOWED = new Set([
]);

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
  //
  // Issue #810: when the DECIDING match is a negation pattern (`!docs/**`), `-v` reports that
  // pattern with exit 0 even though the path is genuinely NOT ignored -- confirmed by running
  // `-q` on the same path, which correctly exits 1. `-v` and `-q` disagree on this exact case.
  // A negation pattern can never be the reason a path IS ignored, so a reported pattern starting
  // with `!` is always treated as "not ignored", regardless of the exit code.
  let answer = false;
  if (r.status === 0) {
    const firstLine = (r.stdout || '').split(/\r?\n/, 1)[0];
    const beforeTab = firstLine.split('\t')[0];
    const m = /^(.*):(\d+):(.*)$/.exec(beforeTab);
    const pattern = m ? m[3].trim() : '';
    answer = Boolean(pattern.length > 0 && !pattern.startsWith('!'));
  }
  ignoreCache.set(p, answer);
  return answer;
}

// Exported so `scripts/tests/check-build-cards-isignored.test.mjs` can exercise the real function
// (not a re-implementation of its git-parsing logic) without running the whole gate as a
// subprocess for every case.
export { isIgnored };

// --- Status-line shapes (item 32; #1027 adds PARTIAL) ---
//
// Four shapes are matched against, but only three are ever ACCEPTED unconditionally: `unknown`
// is accepted only for the cards on UNKNOWN_ALLOWED (or refused outright once REFUSE_UNKNOWN
// flips). PARTIAL is accepted only when every parked issue it names resolves as open + labelled
// `parked` — that resolution is NOT done here, so this function stays a pure string match the
// tests can drive with no network.
const NOT_STARTED_RE = /^Status: NOT STARTED$/;
const DONE_RE = /^Status: DONE \d{4}-\d{2}-\d{2} PRs #.+ proof .+$/;
const UNKNOWN_RE = /^Status: unknown — .+$/;
// `parked #NNN[, #NNN...]` at the very end of the line — one or more issue numbers, comma-separated.
const PARTIAL_RE = /^Status: PARTIAL \d{4}-\d{2}-\d{2} PRs #.+ proof .+ parked (#\d+(?:,\s*#\d+)*)$/;

/**
 * Classify a card's Status line by shape alone (no issue-state resolution).
 * Returns `{ shape: 'NOT_STARTED' | 'DONE' | 'UNKNOWN' | 'PARTIAL' | 'INVALID', parkedIssues? }`.
 * `parkedIssues` (PARTIAL only) is an array of issue numbers, as written on the line.
 */
export function classifyStatusLine(statusLine) {
  if (NOT_STARTED_RE.test(statusLine)) return { shape: 'NOT_STARTED' };
  if (DONE_RE.test(statusLine)) return { shape: 'DONE' };
  if (UNKNOWN_RE.test(statusLine)) return { shape: 'UNKNOWN' };
  const m = PARTIAL_RE.exec(statusLine);
  if (m) {
    const parkedIssues = [...m[1].matchAll(/\d+/g)].map((x) => Number(x[0]));
    return { shape: 'PARTIAL', parkedIssues };
  }
  return { shape: 'INVALID' };
}

/**
 * The full predicate for one card's Status line, pure and network-free: every fact it needs
 * about the outside world (whether `gh` could be asked at all, and each parked issue's resolved
 * state) is passed in as `parkedIssueStates` (a `Map<number, {state, labels}|null>`) and `ghOk`
 * (boolean) rather than fetched here — this is what lets
 * `scripts/tests/check-build-cards-status.test.mjs` drive every PARTIAL branch with no network
 * call.
 *
 * Returns a problem string, or `null` when the line is accepted.
 */
export function validateStatusLine(statusLine, filename, opts) {
  const { unknownAllowed, ghOk, parkedIssueStates, offlineSkip, refuseUnknown } = opts;
  const parsed = classifyStatusLine(statusLine);

  if (parsed.shape === 'INVALID') {
    return `${filename}: no "Status:" line immediately after the H1, or one that does not match the accepted shapes (NOT STARTED / DONE / PARTIAL / allow-listed unknown)`;
  }

  if (parsed.shape === 'UNKNOWN') {
    if (refuseUnknown) {
      return `${filename}: "Status: unknown" is refused (REFUSE_UNKNOWN is true) — resolve this card to DONE, NOT STARTED or PARTIAL`;
    }
    if (!unknownAllowed.has(filename)) {
      return `${filename}: "Status: unknown" is only accepted for the cards named in UNKNOWN_ALLOWED (item 32 follow-up) — resolve this card against refs/remotes/origin/main instead of adding it to that list`;
    }
    return null;
  }

  if (parsed.shape === 'PARTIAL') {
    if (offlineSkip) return null; // local-only escape hatch; never set in CI (see main()).
    if (!ghOk) {
      return `${filename}: PARTIAL names parked issue(s) but \`gh\` could not be reached to verify them — this fails CLOSED by design; if you are offline, re-run locally with --offline-parked-check=skip (never in CI)`;
    }
    for (const n of parsed.parkedIssues) {
      const state = parkedIssueStates.get(n);
      if (state === undefined || state === null) {
        return `${filename}: PARTIAL names parked issue #${n}, which \`gh\` could not read (missing, inaccessible, or the run's single lookup for it failed)`;
      }
      if (state.state !== 'OPEN') {
        return `${filename}: PARTIAL names parked issue #${n}, but it is ${state.state}, not open — PARTIAL requires every named issue to be open and labelled \`parked\``;
      }
      if (!state.labels.includes('parked')) {
        return `${filename}: PARTIAL names parked issue #${n}, which is open but not labelled \`parked\` — PARTIAL requires the label`;
      }
    }
    return null;
  }

  return null; // NOT_STARTED / DONE
}

/**
 * Resolve every named parked-issue number to `{state, labels}` (or `null` if `gh` could not read
 * it) with exactly one `gh issue view` call per distinct number for the whole run — never once
 * per card. Returns `{ ghOk, parkedIssueStates }`. Skipped entirely (returns `ghOk: true`, an
 * empty map — `offlineSkip` is checked before the map is ever consulted) when `offlineSkip`.
 */
export function resolveParkedIssueStates(numbers, offlineSkip) {
  const parkedIssueStates = new Map();
  if (offlineSkip || numbers.size === 0) return { ghOk: true, parkedIssueStates };

  // No `gh auth status` probe: in GitHub Actions it exits non-zero for the
  // installation token (it cannot read /user) even though `gh issue view`
  // works. Reachability is judged from the real calls instead: if EVERY view
  // fails, gh is unreachable and the gate fails closed.
  let anyOk = false;
  for (const n of numbers) {
    const r = spawnSync('gh', ['issue', 'view', String(n), '--json', 'state,labels'], { encoding: 'utf8' });
    if (r.status !== 0) { parkedIssueStates.set(n, null); continue; }
    anyOk = true;
    try {
      const data = JSON.parse(r.stdout);
      parkedIssueStates.set(n, { state: data.state, labels: (data.labels || []).map((l) => l.name) });
    } catch {
      parkedIssueStates.set(n, null);
    }
  }
  return { ghOk: anyOk, parkedIssueStates };
}

const isMain = Boolean(process.argv[1]) && (
  import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}`
  || import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}`
);

if (isMain) try {
  // `--offline-parked-check=skip` is a local-only escape hatch (no `gh` reachable) — never valid
  // in CI, which always has GH_TOKEN wired for this step (see docs-gate.yml).
  if (offlineParkedCheckSkip && process.env.CI) {
    console.error('check-build-cards: --offline-parked-check=skip is refused in CI (process.env.CI is set) — CI must resolve parked issues for real, never skip the check.');
    process.exit(2);
  }

  const files = fs.readdirSync(CARDS).filter((f) => /^item-\d+-.*\.md$/.test(f)).sort();
  const problems = [];
  let pathsChecked = 0, pathsMissing = 0, excused = 0;

  // Pass 1: read every card's Status line and collect the union of parked-issue numbers PARTIAL
  // lines name, so the run resolves each one exactly once — never once per card.
  const cardStatusLines = new Map(); // filename -> statusLine
  const parkedNumbers = new Set();
  for (const f of files) {
    const md = fs.readFileSync(path.join(CARDS, f), 'utf8');
    const bodyLines = md.split(/\r?\n/);
    const h1Idx = bodyLines.findIndex((l) => l.startsWith('# '));
    let statusIdx = h1Idx + 1;
    while (statusIdx < bodyLines.length && bodyLines[statusIdx].trim() === '') statusIdx++;
    const statusLine = h1Idx === -1 ? '' : (bodyLines[statusIdx] || '');
    cardStatusLines.set(f, statusLine);
    const parsed = classifyStatusLine(statusLine);
    if (parsed.shape === 'PARTIAL') parsed.parkedIssues.forEach((n) => parkedNumbers.add(n));
  }
  const { ghOk, parkedIssueStates } = resolveParkedIssueStates(parkedNumbers, offlineParkedCheckSkip);

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
    // A Status line (build item 32), so the spec and the board cannot disagree about what exists.
    // Checked at its CANONICAL position — the first non-blank line after the H1 — not anywhere in
    // the file: a card's own body (this one included) may cite example Status lines in prose, and
    // a bare `.test(md)` over the whole file is satisfied by those examples even when the real
    // line at the top is missing. Measured while writing this gate's own mutation test.
    // A bolded `**Status:**` must NOT satisfy this. The Budget regex above is
    // /Budget:\s*\d+\s*min/i and a bolded Budget line is invisible to it — the same shape that
    // let a build card ship with a Budget the gate could not see.
    //
    // Three accepted shapes now (#1027): NOT STARTED, DONE, and PARTIAL (a built part proven, a
    // remainder parked to a named, open, `parked`-labelled issue). `unknown` is a fourth, TEMPORARY
    // shape accepted only for the six cards on UNKNOWN_ALLOWED until each resolves — see
    // REFUSE_UNKNOWN above.
    const statusLine = cardStatusLines.get(f);
    const problem = validateStatusLine(statusLine, f, {
      unknownAllowed: UNKNOWN_ALLOWED, ghOk, parkedIssueStates, offlineSkip: offlineParkedCheckSkip,
      refuseUnknown: REFUSE_UNKNOWN,
    });
    if (problem) problems.push(problem);
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
