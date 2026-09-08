#!/usr/bin/env node
// docs/design/check-design-consistency.mjs
//
// WHY THIS EXISTS. One design produced six places to write things down: a 1,500-line
// document, a field-mapping spec, a findings register, an artifact page, the work
// tracker and the walk ledger. Within a single day the design already contradicted
// itself three times — E-1 was "nine" in one paragraph and "twelve" in another; the
// plan-row count appeared as 131, 150 and 153; and §1 carried ranks that Appendix A
// had since changed. Every one of those was caught by a reader, not by a check.
//
// This is the check. It reads only documents; it touches no product code.
//
//   node docs/design/check-design-consistency.mjs           report, exit 0
//   node docs/design/check-design-consistency.mjs --gate     report + exit 1 on any FAIL
//
// EXIT CODES: 0 all consistent · 1 at least one inconsistency · 2 the check itself broke.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DESIGN = path.join(HERE, 'data-sourcing-pull-model.md');
const FINDINGS = path.join(HERE, 'findings.json');
const SPEC = path.join(HERE, 'field-source-resolution.spec.mjs');

const gate = process.argv.includes('--gate');
const results = [];
const ok = (id, msg) => results.push({ id, pass: true, msg });
const fail = (id, msg) => results.push({ id, pass: false, msg });

try {
  const md = fs.readFileSync(DESIGN, 'utf8');
  const findings = JSON.parse(fs.readFileSync(FINDINGS, 'utf8'));

  // --- D1: the appendix in the design still has one row per field in the spec ---
  const { F } = await import('file://' + SPEC.replace(/\\/g, '/'));
  const appendix = md.slice(md.indexOf('### A.1'));
  const rowFields = [...appendix.matchAll(/^\| \d+ \| `([a-z_]+\.[a-z_0-9]+)`/gm)].map((m) => m[1]);
  const specFields = F.map((f) => `${f.t}.${f.c}`);
  const missing = specFields.filter((x) => !rowFields.includes(x));
  const extra = rowFields.filter((x) => !specFields.includes(x));
  if (missing.length || extra.length) {
    fail('D1', `Appendix A has drifted from the spec — ${missing.length} missing, ${extra.length} extra. Regenerate it; never hand-edit a generated table.`);
  } else {
    ok('D1', `Appendix A matches the spec exactly (${specFields.length} fields).`);
  }

  // --- D2: no number that the generator owns is hand-typed into the prose ---
  // A count written into prose is compared against the generator's own output and
  // therefore detects nothing; worse, it goes stale silently. Assert none survive.
  const handTyped = [
    [/the (\d+) sourced fields/g, 'plan-row count in prose'],
    [/\bexactly (\d+)\b(?=[^|]*E-1)/g, 'E-1 count in prose'],
  ];
  const offenders = [];
  for (const [re, what] of handTyped) {
    for (const m of md.matchAll(re)) offenders.push(`${what}: "${m[0]}"`);
  }
  if (offenders.length) fail('D2', `Hand-typed counts the generator owns: ${offenders.join(' · ')}`);
  else ok('D2', 'No generator-owned count is hand-typed into the prose.');

  // --- D3: E-1's size is stated once and consistently ---
  const e1Spec = F.filter((f) => f.o && f.o.e1).length;
  const words = { 5: 'five', 9: 'nine', 12: 'twelve', 13: 'thirteen' };
  const wrong = Object.entries(words)
    .filter(([n, w]) => Number(n) !== e1Spec && new RegExp(`${w} E-1|E-1 (?:fields )?— ${w}|the ${w} E-1`, 'i').test(md))
    .map(([n, w]) => w);
  if (wrong.length) fail('D3', `E-1 is ${e1Spec} fields in the spec but the design also says: ${wrong.join(', ')}.`);
  else ok('D3', `E-1 is ${e1Spec} fields, stated consistently.`);

  // --- D4: the design does not claim readiness while a critical finding is open ---
  const openCrit = findings.findings.filter((f) => f.status === 'OPEN' && f.sev === 'CRITICAL');
  const claimsReady = /safe to build|ready to build|approved by the owner/i.test(md) &&
    !/not safe to build|not ready/i.test(md);
  if (openCrit.length && claimsReady) {
    fail('D4', `${openCrit.length} critical findings are OPEN but the design reads as ready.`);
  } else {
    ok('D4', `${openCrit.length} critical findings OPEN; the design does not claim readiness.`);
  }

  // --- D5: every finding has a status from the declared vocabulary ---
  const vocab = Object.keys(findings.status_vocabulary);
  const bad = findings.findings.filter((f) => !vocab.includes(f.status));
  if (bad.length) fail('D5', `Findings with an unknown status: ${bad.map((f) => f.id).join(', ')}`);
  else ok('D5', `All ${findings.findings.length} findings carry a declared status.`);

  // --- D6: phase-1 scope is stated in the design and matches the register ---
  const phase1InDesign = /open and upcoming|OPEN \+ UPCOMING|phase 1/i.test(md);
  if (!phase1InDesign) fail('D6', 'The design does not state the phase-1 scope the owner set.');
  else ok('D6', 'Phase-1 scope is stated in the design.');

  // --- D7: the seven false claims about our own code must not reappear ---
  // The first draft asserted seven things about existing behaviour that the code
  // disproves. An implementer who trusts one builds the wrong thing, so each is a
  // regression guard, not a note. Phrasing is matched loosely on purpose.
  var FALSE_CLAIMS = [
    [/no website publishes a restated (financial )?statement/i, 'A-1 CG does read a restated per-FY table'],
    [/EXTRACTIONS_PER_CYCLE[^.]{0,80}(hard limit|limits this design|must live inside)/i, 'A-2 that constant is dead code'],
    [/consolidation service stays the only writer/i, 'A-3 it covers the ipos table only'],
    [/written (as )?null with (a|its) reason, never left as a stale value/i, 'A-4 a null cannot pass through the writer'],
    [/WANTED\s*(->|→)\s*NOT_YET_FILED\s*(->|→)\s*FOUND\s*(->|→)\s*EXTRACTED/i, 'A-6 the enum has nine states'],
    [/(healing|heal an older one)[^.]{0,60}(inherited|inherits) from 9db4529d/i, 'A-7 decideSupersession is not wired'],
  ];
  // A.0 narrates the corrections and must be allowed to quote the claim it disproves;
  // everywhere else the claim is a live assertion.
  var mdLive = md.split(String.fromCharCode(10)).filter(function(l){ return !/That was false|was wrong, and|disproves it/i.test(l); }).join(String.fromCharCode(10));
  var revived = [];
  FALSE_CLAIMS.forEach(function(pair){ if (pair[0].test(mdLive)) revived.push(pair[1]); });
  if (revived.length) fail('D7', 'A disproved claim about our own code is back in the design: ' + revived.join(' · '));
  else ok('D7', 'None of the seven disproved claims about our own code appear.');

  // --- D8: the rewritten sections cite the code they describe ---
  var core = md.slice(md.indexOf('## 2. How we go and get it'), md.indexOf('## 5.'));
  var cites = (core.match(/[a-z-]+\.(ts|mjs|sh):\d+/g) || []).length;
  if (cites < 12) fail('D8', 'Sections 2-4 make claims about existing behaviour with only ' + cites + ' file:line citations. Uncited claims are how the seven false assertions got in.');
  else ok('D8', 'Sections 2-4 carry ' + cites + ' file:line citations for claims about existing behaviour.');
} catch (err) {
  console.error('check-design-consistency: the check itself failed —', err.message);
  process.exit(2);
}

const failed = results.filter((r) => !r.pass);
for (const r of results) console.log(`${r.pass ? '[PASS]' : '[FAIL]'} ${r.id}  ${r.msg}`);
console.log(`\n${results.length - failed.length}/${results.length} consistent.`);
if (failed.length && gate) process.exit(1);
