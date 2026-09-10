#!/usr/bin/env node
// OD-52 / §8.5: the design-to-code traceability gate. After this ships, "the
// code implements this design" stops being a claim anyone has to take on
// trust — a pull request fails when a design rule has no build item, or a
// test names a rule that does not exist.
//
// Slice s1 (docs/design/build-cards/item-20-design-traceability-check.md):
// failure modes 1-3. Slice s2 (this file, mode 4): a rule's hash changed and
// neither its owning card nor a test that names it is in the pull request
// diff.
//
// Usage:
//   node scripts/ci/check-design-traceability.mjs
//     [--rules <path>] [--cards <dir>] [--unclaimed <path>]
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
  const opts = { rules: null, cards: null, unclaimed: null, tests: [], base: null, baseGiven: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--rules') opts.rules = argv[++i];
    else if (a === '--cards') opts.cards = argv[++i];
    else if (a === '--unclaimed') opts.unclaimed = argv[++i];
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
  return {
    rulesPath: parsed.rules || join(REPO_ROOT, 'docs', 'design', 'rules.json'),
    cardsDir: parsed.cards || join(REPO_ROOT, 'docs', 'design', 'build-cards'),
    unclaimedPath: parsed.unclaimed || join(REPO_ROOT, 'docs', 'design', 'rules-unclaimed.json'),
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
    const ids = section.match(/R-\d+/g) || [];
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
      const ids = match[1].match(/R-\d+/g) || [];
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
  const { rulesPath, cardsDir, unclaimedPath, requestedTestRoots, testRoots, base, baseGiven } = resolveOptions(
    process.argv.slice(2)
  );

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
