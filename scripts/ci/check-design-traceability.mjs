#!/usr/bin/env node
// OD-52 / §8.5: the design-to-code traceability gate. After this ships, "the
// code implements this design" stops being a claim anyone has to take on
// trust — a pull request fails when a design rule has no build item, or a
// test names a rule that does not exist.
//
// Slice s1 (docs/design/build-cards/item-20-design-traceability-check.md):
// failure modes 1-3. Slice s2 (this file, mode 4): a rule's hash changed and
// neither its owning card nor a test that names it is in the pull request
// diff. #469 (mode 5): mode 1's ANY-card semantics let a card silently drop
// a rule it OWNS (per docs/design/rule-ownership.json) while a different,
// non-owning card's stale mention keeps the rule "claimed" and the gate
// green. Mode 5 additionally requires every rule id assigned by
// rule-ownership.json to item N to be claimed BY ITEM N's OWN card (hand-owned
// cards, per apply-rule-ownership.mjs's HAND_OWNED_MARKER, are exempt).
//
// detection-check: design_traceability
// ^ This file IS the check that docs/reviews/detection-checks/design_traceability.json
// names as its `auditScript`. The marker is what
// scripts/tests/audit-detection-floor.test.mjs's verifyForeignAuditScript()
// looks for: a registry entry pointing at a file that never records its own id
// would pass the wire-or-retire test while checking nothing.
//
// Usage:
//   node scripts/ci/check-design-traceability.mjs
//     [--rules <path>] [--cards <dir>] [--unclaimed <path>] [--ownership <path>]
//     [--tests <dir>]... [--base <ref>]
//
// --base is OPT-IN, not defaulted internally: mode 4 runs `git show` and
// `git diff` against the CURRENT WORKING DIRECTORY as the repo root, and
// this script's own self-test fixtures for modes 1-3 are deliberately NOT
// git repositories (they live in a bare temp dir) — defaulting --base to
// "origin/main" unconditionally would make every mode-1/2/3 fixture run a
// doomed `git show` and exit 2, breaking tests this slice must not modify.
// A caller that wants mode 4 (CI, via the pull request's base) passes
// --base explicitly; without it, mode 4 is skipped, exactly as before this
// slice. "Defaulting to origin/main" (per the build card's Interfaces
// section) describes what slice 4's workflow wiring passes as the ref
// value, not an unconditional default inside this script.
//
// Exit codes:
//   0 - clean (or only reporting-mode findings — see MODE2_ENFORCE below)
//   1 - a broken link in the chain (mode 1, 3 or 4 finding)
//   2 - the check itself failed (bad input, missing file, unparseable JSON,
//       an unreadable base ref for mode 4, or a self-guard: zero live
//       rules, or zero surviving test roots, is a FAIL, never a pass)

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HAND_OWNED_MARKER } from '../../docs/design/apply-rule-ownership.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');

// Failure mode 2 ("a card claims a rule id that no test declares") ships in
// REPORTING mode until build item 6 lands and real tests declaring rule ids
// exist for the pull-model write paths (see the card's "Feature flag"
// section). Flip this one constant to true at that release to make it
// enforcing (exit 1 on a finding) instead of exit 0.
// Test seam for the currently-unreachable enforcing path (MAJOR 2 fix): the
// shipped default stays false until build item 6, exactly as above — this
// env override exists only so a test can exercise MODE2_ENFORCE=true without
// restructuring the module or changing the shipped constant.
const MODE2_ENFORCE = process.env.DESIGN_TRACEABILITY_MODE2_ENFORCE === 'true' ? true : false;

function parseArgs(argv) {
  const opts = { rules: null, cards: null, unclaimed: null, ownership: null, tests: [], base: null, baseGiven: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--rules') opts.rules = argv[++i];
    else if (a === '--cards') opts.cards = argv[++i];
    else if (a === '--unclaimed') opts.unclaimed = argv[++i];
    else if (a === '--ownership') opts.ownership = argv[++i];
    else if (a === '--tests') opts.tests.push(argv[++i]);
    else if (a === '--base') {
      opts.baseGiven = true;
      opts.base = argv[++i];
    }
  }
  return opts;
}

// Returns the CANDIDATE default test roots, unfiltered by existence. Callers
// filter for existence themselves — keeping the unfiltered list around is
// what lets the zero-test-roots fatal message (main(), below) name every
// root it looked for, not just the ones that happened to exist (Finding 1).
function defaultTestRoots() {
  const roots = [
    join(REPO_ROOT, 'scraper', 'tests'),
    join(REPO_ROOT, 'web', 'tests'),
    join(REPO_ROOT, 'scripts', 'tests'),
    join(REPO_ROOT, 'scripts', 'ci', 'tests'),
  ];
  const packagesDir = join(REPO_ROOT, 'packages');
  if (existsSync(packagesDir)) {
    for (const entry of readdirSync(packagesDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      roots.push(join(packagesDir, entry.name, 'tests'));
    }
  }
  return roots;
}

function resolveOptions(argv) {
  const parsed = parseArgs(argv);
  const requestedTestRoots = parsed.tests.length ? parsed.tests : defaultTestRoots();
  const testRoots = requestedTestRoots.filter((r) => existsSync(r));
  const rulesPath = parsed.rules || join(REPO_ROOT, 'docs', 'design', 'rules.json');
  return {
    rulesPath,
    cardsDir: parsed.cards || join(REPO_ROOT, 'docs', 'design', 'build-cards'),
    unclaimedPath: parsed.unclaimed || join(REPO_ROOT, 'docs', 'design', 'rules-unclaimed.json'),
    // Default sits next to whatever --rules resolved to, NOT next to REPO_ROOT
    // unconditionally — a self-test fixture that passes --rules under a temp
    // dir must never see the REAL repo's rule-ownership.json cross the
    // boundary, which an REPO_ROOT-anchored default would do silently.
    ownershipPath: parsed.ownership || join(dirname(rulesPath), 'rule-ownership.json'),
    requestedTestRoots,
    testRoots,
    base: parsed.base,
    baseGiven: parsed.baseGiven,
  };
}

function fail2(message) {
  console.error(`check-design-traceability: FAIL (check error) — ${message}`);
  process.exit(2);
}

function loadRules(rulesPath) {
  if (!existsSync(rulesPath)) {
    fail2(`rules file not found: ${rulesPath} — run: node docs/design/generate-rule-index.mjs --apply`);
  }
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(rulesPath, 'utf8'));
  } catch (e) {
    fail2(`could not parse ${rulesPath} as JSON: ${e.message}`);
  }
  if (!parsed || !Array.isArray(parsed.rules)) {
    fail2(`${rulesPath} has no "rules" array`);
  }
  return parsed.rules;
}

function loadUnclaimed(unclaimedPath) {
  if (!existsSync(unclaimedPath)) return new Set();
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(unclaimedPath, 'utf8'));
  } catch (e) {
    fail2(`could not parse ${unclaimedPath} as JSON: ${e.message}`);
  }
  const declared = new Set();
  const unclaimed = (parsed && parsed.unclaimed) || {};
  for (const id of Object.keys(unclaimed)) {
    if (String(unclaimed[id] || '').trim().length > 0) declared.add(id);
  }
  return declared;
}

// A rule id is ALWAYS zero-padded to three digits (rules.json holds 188 of
// 188 in that form). The boundary matters: the older unanchored /R-\d+/ read
// the tail of a prose word as an id, so an "implements:" header mentioning
// "MAJOR-4" yielded the phantom id "R-4" and failed mode 3 on PR #763 for a
// rule nobody declared. \b on both sides refuses MAJOR-4 and MINOR-2 while
// still accepting "R-004," and "R-004." in a list.
const RULE_ID_RE = /\bR-\d{3}\b/g;

// Returns a Map<ruleId, {rel, full}[]> — every rule id claimed by every card,
// parsed from the generated "## Rules implemented" block (the same block
// docs/design/apply-rule-ownership.mjs writes and D19 in
// docs/design/check-design-consistency.mjs already reads).
function loadCardClaims(cardsDir) {
  const claims = new Map();
  if (!existsSync(cardsDir)) {
    fail2(`build-cards directory not found: ${cardsDir}`);
  }
  const files = readdirSync(cardsDir).filter((f) => /^item-\d+-.*\.md$/.test(f));
  for (const file of files) {
    const full = join(cardsDir, file);
    const text = readFileSync(full, 'utf8');
    // Anchor on the real HEADING line, not any substring occurrence — a
    // card's own prose (e.g. "its `## Rules implemented` block is generated
    // from that mapping") can mention the heading text before the actual
    // heading appears, and a plain indexOf() picks up that mention instead
    // (found against the repo's own item-19 card, which lost its whole
    // R-049..R-052 claim to this bug).
    const headingMatch = /^## Rules implemented\s*$/m.exec(text);
    if (!headingMatch) continue;
    const start = headingMatch.index;
    let section = text.slice(start);
    const nextHeading = section.slice(headingMatch[0].length).search(/\n## /);
    if (nextHeading >= 0) {
      section = section.slice(0, headingMatch[0].length + nextHeading);
    }
    const ids = section.match(RULE_ID_RE) || [];
    const rel = relative(REPO_ROOT, full).split('\\').join('/');
    for (const id of new Set(ids)) {
      if (!claims.has(id)) claims.set(id, []);
      // `full` (the absolute path) rides alongside `rel` so mode 4 can
      // re-express it relative to the git repo root (process.cwd()) for an
      // exact match against `git diff --name-only` output — `rel` above is
      // relative to REPO_ROOT (this script's own location), which is a
      // different path than the repo root of a self-test fixture.
      claims.get(id).push({ rel, full });
    }
  }
  return claims;
}

// Returns a Map<ruleId, {rel, full}[]> — every "// implements: R-nnn[, R-mmm]"
// header found anywhere in every test file under the given roots.
function loadTestDeclarations(testRoots) {
  const declares = new Map();
  const IMPLEMENTS_RE = /\/\/\s*implements:\s*([^\n\r]+)/gi;

  function walk(dir) {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === '.git') continue;
        walk(full);
      } else if (entry.isFile()) {
        visitFile(full);
      }
    }
  }

  function visitFile(full) {
    let text;
    try {
      text = readFileSync(full, 'utf8');
    } catch {
      return;
    }
    let match;
    IMPLEMENTS_RE.lastIndex = 0;
    while ((match = IMPLEMENTS_RE.exec(text))) {
      const ids = match[1].match(RULE_ID_RE) || [];
      const rel = relative(REPO_ROOT, full).split('\\').join('/');
      for (const id of ids) {
        if (!declares.has(id)) declares.set(id, []);
        // See the matching comment in loadCardClaims: `full` rides along
        // for mode 4's exact-path match against the pull request diff.
        declares.get(id).push({ rel, full });
      }
    }
  }

  for (const root of testRoots) walk(root);
  return declares;
}

// Returns Map<itemNumber, { file, claimedIds, handOwned }> — one entry per
// card file, independent of loadCardClaims()'s ruleId-keyed view. Mode 5
// needs to ask "does ITEM N's card claim this rule", which a ruleId->cards
// map cannot answer without re-deriving the item number from every card's
// path on every lookup.
function loadCardsByItem(cardsDir) {
  const byItem = new Map();
  const files = readdirSync(cardsDir).filter((f) => /^item-\d+-.*\.md$/.test(f));
  for (const file of files) {
    const full = join(cardsDir, file);
    const text = readFileSync(full, 'utf8');
    const headingMatch = /^## Rules implemented\s*$/m.exec(text);
    let claimedIds = new Set();
    let handOwned = false;
    if (headingMatch) {
      const start = headingMatch.index;
      let section = text.slice(start);
      const nextHeading = section.slice(headingMatch[0].length).search(/\n## /);
      if (nextHeading >= 0) section = section.slice(0, headingMatch[0].length + nextHeading);
      claimedIds = new Set(section.match(RULE_ID_RE) || []);
      // #1106's marker means the card's list is curated by hand and is never
      // regenerated — the same reason apply-rule-ownership.mjs treats it as
      // SKIPPED rather than REFUSED applies here: a hand-owned card is
      // exempt from the ownership-claim requirement below, not a violation.
      handOwned = section.includes(HAND_OWNED_MARKER);
    }
    const m = /^item-(\d+)/.exec(file);
    if (!m) continue;
    const rel = relative(REPO_ROOT, full).split('\\').join('/');
    byItem.set(Number(m[1]), { file: rel, claimedIds, handOwned });
  }
  return byItem;
}

// Returns Map<ruleId, Set<itemNumber>> | null. Mirrors the section->item walk
// in docs/design/apply-rule-ownership.mjs main() exactly (a rule's owning
// item(s) come from `own.sections[section-prefix]`, which is either an array
// of item numbers or null for "declared unclaimed by design"). Returns null
// when no ownership file exists at the resolved path — callers then fall
// back to the old ANY-card semantics for every rule, which is also what
// happens for any individual rule whose section has no row (unmapped) or a
// null row: those are informational gaps for apply-rule-ownership.mjs to
// report, not this gate's job to enforce ownership for.
function loadRuleOwnership(ownershipPath, rules) {
  if (!existsSync(ownershipPath)) return null;
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(ownershipPath, 'utf8'));
  } catch (e) {
    fail2(`could not parse ${ownershipPath} as JSON: ${e.message}`);
  }
  const sections = (parsed && parsed.sections) || {};
  const owners = new Map();
  for (const r of rules) {
    const sec = String(r.section || '').split(' ')[0];
    const items = sections[sec];
    if (!Array.isArray(items) || items.length === 0) continue; // unmapped or declared-null: no owner to enforce
    owners.set(r.id, new Set(items));
  }
  return owners;
}

// Returns the MODE 5 findings: a rule id whose rule-ownership.json owner is
// item N, where item N's card exists, is not hand-owned, and does not claim
// the id — regardless of whether some OTHER, non-owning card claims it. This
// is what issue #469 asked for: under the old ANY-card semantics, item-20's
// card could drop R-142..R-144 (§7.6, owned by items [2, 20]) while item-02's
// card kept claiming them, and the gate stayed green because "claimed by no
// card at all" was never true. Here, item 20 not claiming an id it owns is
// itself the finding, independent of item 2.
function computeOwnershipGaps(ownershipMap, cardsByItem) {
  const gaps = [];
  if (!ownershipMap) return gaps;
  for (const [id, items] of ownershipMap) {
    for (const item of [...items].sort((a, b) => a - b)) {
      const card = cardsByItem.get(item);
      if (!card) {
        gaps.push({ id, item, file: `(no item-${item}-*.md card file found)` });
        continue;
      }
      if (card.handOwned) continue;
      if (!card.claimedIds.has(id)) {
        gaps.push({ id, item, file: card.file });
      }
    }
  }
  return gaps;
}

// --- Mode 4 (hash drift) helpers. All git calls run with cwd = the current
// process's working directory, which is the repo root both in CI (checked
// out there) and in the self-test (spawnSync sets cwd to the fixture repo).

function runGit(args) {
  return spawnSync('git', args, { cwd: process.cwd(), encoding: 'utf8' });
}

function gitRelPath(absPath) {
  return relative(process.cwd(), absPath).split('\\').join('/');
}

// Reads docs/design/rules.json (or --rules' path) as it existed at <base>,
// via `git show`. Never falls back to a silent skip — an unreadable base is
// exit 2 (the check itself failed), naming the ref, per the card's mode-4
// self-guard.
function loadBaseRulesJson(base, rulesPath) {
  const relPath = gitRelPath(rulesPath);
  const res = runGit(['show', `${base}:${relPath}`]);
  if (res.error || res.status !== 0) {
    const detail = (res.stderr || (res.error && res.error.message) || '').trim();
    fail2(`could not read ${relPath} at base ref "${base}" — ${detail || 'git show failed'}`);
  }
  const raw = res.stdout;
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    fail2(`could not parse ${relPath} at base ref "${base}" as JSON: ${e.message}`);
  }
  if (!parsed || !Array.isArray(parsed.rules)) {
    fail2(`${relPath} at base ref "${base}" has no "rules" array`);
  }
  return { raw, rules: parsed.rules };
}

function loadChangedFiles(base) {
  const res = runGit(['diff', '--name-only', `${base}...HEAD`]);
  if (res.error || res.status !== 0) {
    const detail = (res.stderr || (res.error && res.error.message) || '').trim();
    fail2(`could not compute changed files against base ref "${base}" — ${detail || 'git diff failed'}`);
  }
  return new Set(
    res.stdout
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)
  );
}

// Returns { identical, comparedCount, driftedCount, uncovered }. `uncovered`
// is the blocking finding: live rules whose hash differs from base, where
// NEITHER the owning card NOR a declaring test appears in the pull
// request's changed-file list.
function computeHashDrift({ base, rulesPath, rules, cardClaims, testDeclarations }) {
  const baseInfo = loadBaseRulesJson(base, rulesPath);
  const headRaw = readFileSync(rulesPath, 'utf8');
  const identical = headRaw === baseInfo.raw;

  const baseById = new Map(baseInfo.rules.map((r) => [r.id, r]));
  const headLive = rules.filter((r) => !r.retired);

  const eligible = [];
  const drifted = [];
  for (const r of headLive) {
    const baseRule = baseById.get(r.id);
    if (!baseRule) continue; // new at HEAD, absent at base — mode 1's concern, not a drift
    eligible.push(r);
    if (baseRule.hash !== r.hash) drifted.push(r);
  }

  const uncovered = [];
  if (drifted.length > 0) {
    const changedFiles = loadChangedFiles(base);
    for (const r of drifted) {
      const cards = cardClaims.get(r.id) || [];
      const tests = testDeclarations.get(r.id) || [];
      // Match on the path RELATIVE TO THE GIT REPO ROOT (process.cwd()),
      // not the REPO_ROOT-relative `rel` also carried on these entries —
      // `git diff --name-only` reports paths relative to the repo it ran
      // in, which is process.cwd() here, not necessarily this script's own
      // on-disk location (they differ inside the self-test's fixture repos).
      const cardTouched = cards.some((c) => changedFiles.has(gitRelPath(c.full)));
      const testTouched = tests.some((t) => changedFiles.has(gitRelPath(t.full)));
      if (!cardTouched && !testTouched) {
        uncovered.push({
          id: r.id,
          section: r.section,
          cards: cards.map((c) => c.rel),
          tests: tests.map((t) => t.rel),
        });
      }
    }
  }

  return { identical, comparedCount: eligible.length, driftedCount: drifted.length, uncovered };
}

function main() {
  const { rulesPath, cardsDir, unclaimedPath, ownershipPath, requestedTestRoots, testRoots, base, baseGiven } =
    resolveOptions(process.argv.slice(2));

  // Self-guard, --base side: `--base` present with no value (empty string,
  // or as the final argv token) must not fall back to mode 4's ordinary
  // SKIPPED path — that path means "no comparison was requested", and here
  // one was. An unquoted `${{ github.event.pull_request.base.sha }}`
  // expanding to nothing (e.g. the workflow's `on:` trigger set grows to
  // include a push/workflow_dispatch event where base.sha is unset) must
  // fail loudly, not silently skip the drift check it was invoked for.
  if (baseGiven && !base) {
    fail2('--base was given with no ref value — the comparison was requested and cannot silently be skipped');
  }

  // Self-guard, test-root side (MAJOR 1 fix): a renamed/moved/missing test
  // root must not silently disarm mode 3 (bad rule-id declarations) by
  // walking zero directories. Mirrors the zero-live-rules self-guard below —
  // a check that scans nothing is not a clean pass. Name every root it
  // looked for so a reader can see WHICH roots were requested vs found
  // (signal-ownership.md R1 — identities, not just counts).
  if (testRoots.length === 0) {
    const missing = requestedTestRoots.filter((r) => !existsSync(r));
    fail2(
      `zero test roots exist out of ${requestedTestRoots.length} requested — a check that scans nothing is not a ` +
        `clean pass. Requested: ${requestedTestRoots.join(', ') || '(none)'}. ` +
        `Missing: ${missing.join(', ') || '(none)'}`
    );
  }

  const rules = loadRules(rulesPath);
  const liveIds = rules.filter((r) => !r.retired).map((r) => r.id);
  const liveIdSet = new Set(liveIds);

  // Self-guard (named explicitly by the card, mirrors D18's own self-guard):
  // a check that passes because it found nothing is the failure this whole
  // item exists to prevent. Zero live rules is a FAIL, never a pass.
  if (liveIds.length === 0) {
    fail2('zero live rules found in rules.json — a check that finds nothing is not a clean pass');
  }

  const declaredUnclaimed = loadUnclaimed(unclaimedPath);
  const cardClaims = loadCardClaims(cardsDir);
  const testDeclarations = loadTestDeclarations(testRoots);

  let hasBlockingFinding = false;
  const lines = [];

  // --- Mode 1: a live rule claimed by no card and not declared unclaimed ---
  const orphans = liveIds.filter((id) => !cardClaims.has(id) && !declaredUnclaimed.has(id));
  if (orphans.length > 0) {
    hasBlockingFinding = true;
    lines.push(`MODE 1 — ${orphans.length} live rule(s) claimed by no build card and not declared unclaimed:`);
    for (const id of orphans) lines.push(`  - ${id}`);
  }

  // --- Mode 5 (#469): per-card ownership. ANY-card semantics above cannot
  // notice a card silently dropping a rule it OWNS (docs/design/rule-ownership.json)
  // as long as some other, non-owning card still mentions the id — the §7.6
  // case from the issue (R-142..R-144 owned by items [2, 20]; item 20's card
  // dropping them stayed green because item 02's card still listed them).
  // Skipped entirely (not a failure) when no rule-ownership.json is found at
  // the resolved path — see loadRuleOwnership()'s doc comment.
  const cardsByItem = loadCardsByItem(cardsDir);
  // Retired rules are excluded, same as liveIds above — a retired rule's old
  // section->item row still sits in rule-ownership.json (nobody re-authors
  // history), and a card correctly stops listing a rule once it retires, so
  // scoring that as a "gap" would be counting the retirement itself as a bug.
  const ownershipMap = loadRuleOwnership(ownershipPath, rules.filter((r) => !r.retired));
  if (ownershipMap === null) {
    lines.push(`MODE 5 — SKIPPED (no rule-ownership.json found at ${ownershipPath})`);
  } else {
    const ownershipGaps = computeOwnershipGaps(ownershipMap, cardsByItem);
    if (ownershipGaps.length > 0) {
      hasBlockingFinding = true;
      lines.push(
        `MODE 5 — ${ownershipGaps.length} rule(s) assigned by rule-ownership.json to a card that does not claim them:`
      );
      for (const g of ownershipGaps) {
        lines.push(`  - ${g.id} assigned to item ${g.item}'s card (${g.file}), not claimed there`);
      }
    } else {
      lines.push(`MODE 5 — ${ownershipMap.size} owned rule(s) checked against their owning card(s), 0 gaps`);
    }
  }

  // --- Mode 2: a card claims a rule id that no test declares (REPORTING) ---
  const unTestedClaims = [];
  for (const [id, cards] of cardClaims) {
    if (!liveIdSet.has(id)) continue; // ghosts (retired/unknown ids) are mode 3's concern below, from the test side
    if (!testDeclarations.has(id)) {
      for (const card of cards) unTestedClaims.push({ id, card });
    }
  }
  if (unTestedClaims.length > 0) {
    if (MODE2_ENFORCE) hasBlockingFinding = true;
    lines.push(
      `MODE 2 (${MODE2_ENFORCE ? 'ENFORCING' : 'REPORTING — due to flip at build item 6'}) — ` +
        `${unTestedClaims.length} card claim(s) with no declaring test:`
    );
    for (const { id, card } of unTestedClaims) lines.push(`  - ${id} claimed by ${card.rel}, no test declares it`);
  }

  // --- Mode 3: a test declares an id that is not live ---
  const badDeclarations = [];
  for (const [id, files] of testDeclarations) {
    if (!liveIdSet.has(id)) {
      for (const file of files) badDeclarations.push({ id, file });
    }
  }
  if (badDeclarations.length > 0) {
    hasBlockingFinding = true;
    lines.push(`MODE 3 — ${badDeclarations.length} test declaration(s) name a rule id that is not live:`);
    for (const { id, file } of badDeclarations) lines.push(`  - ${id} declared by ${file.rel}`);
  }

  // --- Mode 4: a rule's hash changed at the same id, with neither its
  // owning card nor a declaring test in the pull request diff. Opt-in via
  // --base (see the file header for why this is not defaulted internally).
  if (base) {
    const hashDrift = computeHashDrift({ base, rulesPath, rules, cardClaims, testDeclarations });
    lines.push(
      `MODE 4 — ${hashDrift.comparedCount} rule id(s) compared against base "${base}", ` +
        `${hashDrift.driftedCount} drifted` +
        (hashDrift.identical
          ? ' (base and working-tree rules.json are byte-identical — checked, nothing changed)'
          : '')
    );
    if (hashDrift.uncovered.length > 0) {
      hasBlockingFinding = true;
      lines.push(
        `MODE 4 FAIL — ${hashDrift.uncovered.length} rule(s) changed wording with no owning card or ` +
          `declaring test in the diff:`
      );
      for (const u of hashDrift.uncovered) {
        const cardsStr = u.cards.length ? u.cards.join(', ') : '(no owning card)';
        const testsStr = u.tests.length ? u.tests.join(', ') : '(no declaring test)';
        lines.push(
          `  - ${u.id} (section: ${u.section}) — card(s): ${cardsStr}; test(s): ${testsStr} — ` +
            `none touched in this diff`
        );
      }
    }
  } else {
    lines.push('MODE 4 — SKIPPED (no --base given): hash drift was NOT compared');
  }

  const claimedLiveCount = liveIds.filter((id) => cardClaims.has(id) || declaredUnclaimed.has(id)).length;
  const declarationCount = [...testDeclarations.values()].reduce((n, files) => n + files.length, 0);
  const scannedRoots = testRoots.map((r) => relative(REPO_ROOT, r).split('\\').join('/')).join(', ');
  console.log(
    `check-design-traceability: ${liveIds.length} rules, ${claimedLiveCount} claimed, ${orphans.length} orphans, ` +
      `${declarationCount} test declaration(s) found, test roots scanned: ${scannedRoots}`
  );
  for (const line of lines) console.log(line);

  if (hasBlockingFinding) {
    console.error('check-design-traceability: FAIL');
    process.exit(1);
  }

  console.log('check-design-traceability: PASS');
  process.exit(0);
}

main();
