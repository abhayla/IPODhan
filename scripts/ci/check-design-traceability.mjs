#!/usr/bin/env node
// OD-52 / §8.5: the design-to-code traceability gate. After this ships, "the
// code implements this design" stops being a claim anyone has to take on
// trust — a pull request fails when a design rule has no build item, or a
// test names a rule that does not exist.
//
// Slice s1 (docs/design/build-cards/item-20-design-traceability-check.md):
// failure modes 1-3 only. Mode 4 (a rule's hash changed and neither its
// owning card nor a test that names it is in the diff) is a later slice.
//
// Usage:
//   node scripts/ci/check-design-traceability.mjs
//     [--rules <path>] [--cards <dir>] [--unclaimed <path>]
//     [--tests <dir>]...
//
// Exit codes:
//   0 - clean (or only reporting-mode findings — see MODE2_ENFORCE below)
//   1 - a broken link in the chain (mode 1 or mode 3 finding)
//   2 - the check itself failed (bad input, missing file, unparseable JSON,
//       or the self-guard: zero live rules is a FAIL, never a pass)

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');

// Failure mode 2 ("a card claims a rule id that no test declares") ships in
// REPORTING mode until build item 6 lands and real tests declaring rule ids
// exist for the pull-model write paths (see the card's "Feature flag"
// section). Flip this one constant to true at that release to make it
// enforcing (exit 1 on a finding) instead of exit 0.
const MODE2_ENFORCE = false;

function parseArgs(argv) {
  const opts = { rules: null, cards: null, unclaimed: null, tests: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--rules') opts.rules = argv[++i];
    else if (a === '--cards') opts.cards = argv[++i];
    else if (a === '--unclaimed') opts.unclaimed = argv[++i];
    else if (a === '--tests') opts.tests.push(argv[++i]);
  }
  return opts;
}

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
      const testsDir = join(packagesDir, entry.name, 'tests');
      if (existsSync(testsDir)) roots.push(testsDir);
    }
  }
  return roots.filter((r) => existsSync(r));
}

function resolveOptions(argv) {
  const parsed = parseArgs(argv);
  return {
    rulesPath: parsed.rules || join(REPO_ROOT, 'docs', 'design', 'rules.json'),
    cardsDir: parsed.cards || join(REPO_ROOT, 'docs', 'design', 'build-cards'),
    unclaimedPath: parsed.unclaimed || join(REPO_ROOT, 'docs', 'design', 'rules-unclaimed.json'),
    testRoots: parsed.tests.length ? parsed.tests.filter((r) => existsSync(r)) : defaultTestRoots(),
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

// Returns a Map<ruleId, cardRelPath[]> — every rule id claimed by every card,
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
      claims.get(id).push(rel);
    }
  }
  return claims;
}

// Returns a Map<ruleId, {file, path}[]> — every "// implements: R-nnn[, R-mmm]"
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
        declares.get(id).push(rel);
      }
    }
  }

  for (const root of testRoots) walk(root);
  return declares;
}

function main() {
  const { rulesPath, cardsDir, unclaimedPath, testRoots } = resolveOptions(process.argv.slice(2));

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
    for (const { id, card } of unTestedClaims) lines.push(`  - ${id} claimed by ${card}, no test declares it`);
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
    for (const { id, file } of badDeclarations) lines.push(`  - ${id} declared by ${file}`);
  }

  const claimedLiveCount = liveIds.filter((id) => cardClaims.has(id) || declaredUnclaimed.has(id)).length;
  console.log(
    `check-design-traceability: ${liveIds.length} rules, ${claimedLiveCount} claimed, ${orphans.length} orphans`
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
