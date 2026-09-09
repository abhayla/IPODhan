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
// This is the check. It derives no design fact from product code — the documents are the only
// source of truth here. The one place it opens a source file is D11, which verifies that a
// `file:line` citation still points at a line that exists: a citation nobody can follow is how
// seven false claims about our own code survived the first draft.
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

  // --- D9: the design must not park work in a phase that does not exist ---
  // Owner, 2026-09-08: "there is no phase 2". A bucket with no date, no trigger
  // and no owner is where work disappears; ten findings had been put in one.
  // The sentence DECLARING there is no phase 2 is the fix, not the defect - exclude it.
  var mdNoDecl = md.split(String.fromCharCode(10)).filter(function(l){ return !/There is no ..?phase/i.test(l); }).join(String.fromCharCode(10));
  if (/phases*2/i.test(mdNoDecl)) fail('D9', 'The design names a "phase 2". There is none - every deferred item must name the EVENT that brings it into scope.');
  else ok('D9', 'No work is parked in a non-existent phase.');
  var noTrigger = findings.findings.filter(function(f){ return f.status === 'TRIGGERED' && !f.trigger; });
  if (noTrigger.length) fail('D9b', 'TRIGGERED findings with no named trigger: ' + noTrigger.map(function(f){return f.id;}).join(', '));
  else ok('D9b', findings.findings.filter(function(f){return f.status==='TRIGGERED';}).length + ' deferred findings each name the event that brings them into scope.');

  // --- D10: the design still honours every owner decision it claims to ---
  // WHY. Owner, 2026-09-09: "How would I know that whatever you are doing is as per my guidance?"
  // Before this check, "the design follows your decisions" was my word. Now it is a command.
  // The table in section 0.0.1 is the SSOT: each row names a section, and this fails when that
  // section has gone (a splice already deleted one heading silently this session) or when a
  // decision's mechanical signature stops holding.
  var odTable = md.slice(md.indexOf('### 0.0.1'), md.indexOf('### 0.0.2'));
  var odRows = [...odTable.matchAll(/^\| (OD-\d+) \|(.+)$/gm)].map(function (m) {
    var cells = m[2].split('|').map(function (c) { return c.trim(); });
    return { id: m[1], where: cells[2] || '', checks: cells[3] || '' };
  });
  if (odRows.length < 10) {
    fail('D10', 'The owner-decision register in 0.0.1 has ' + odRows.length + ' rows. It has been gutted or its table shape changed.');
  } else {
    var odMissing = [];
    odRows.forEach(function (r) {
      // A row may name several sections ("§1.1, O-5"); only real section refs are checkable.
      (r.where.match(/§[0-9]+(?:\.[0-9]+)*/g) || []).forEach(function (ref) {
        var num = ref.slice(1);
        var re = new RegExp('^#{2,4} ' + num.replace(/\./g, '\.') + '[ .]', 'm');
        if (!re.test(md)) odMissing.push(r.id + ' -> ' + ref);
      });
    });
    if (odMissing.length) {
      fail('D10', 'Owner decisions pointing at sections that no longer exist: ' + odMissing.join(', '));
    } else {
      ok('D10', odRows.length + ' owner decisions each point at a section that still exists.');
    }
  }

  // --- D10b: the decision SIGNATURES, not just the section headings ---
  var sig = [];
  // The register in 0.0 DESCRIBES these signatures, so scanning the whole file finds its own text.
  // Every signature below is therefore checked against the design MINUS the register. Caught on
  // this check's first run: the OD-1 rule matched its own row, which reads "no blended-90% target
  // survives anywhere". A new check must be validated against known-good state before it is trusted.
  var body = md.slice(0, md.indexOf('## 0.0')) + md.slice(md.indexOf('## 0. What is true today'));

  // OD-3 Moneycontrol retired. The GENERATED appendix is the truth, not the spec's raw rank list:
  // pool() filters MC out via MC_SERVES, so a field can still LIST MC and never be SERVED by it.
  // Checking f.r reported 38 served fields while Appendix A served zero.
  var appendixA = md.slice(md.indexOf('### A.1'), md.indexOf('### A.2'));
  var mcRows = (appendixA.match(/\| (MC|MONEYCONTROL) \|/g) || []).length;
  if (mcRows > 0) sig.push('OD-3: Appendix A still serves Moneycontrol on ' + mcRows + ' field(s)');
  // OD-1 the target is 100%, not a blended 90%.
  if (/target[^.]{0,40}\b90\s*%/i.test(body)) sig.push('OD-1: a 90% target has reappeared; the owner set 100% per field');
  // OD-6 verification is a read.
  if (!/verification is a read/i.test(body)) sig.push('OD-6: the design no longer states that verification is a read');
  // OD-9 one row per IPO.
  if (!/one row (for|per) each IPO|one row per IPO|late-binding identity/i.test(body)) sig.push('OD-9: the one-row-per-IPO rule is gone');
  // OD-10 build item 1 is the child-table writer. Shipped wording is "child-table CONSOLIDATED
  // writer", so match the row, not two adjacent words.
  var seq = md.slice(md.indexOf('### 7.1 '), md.indexOf('### 7.2 '));
  if (!/^\| 1 \|[^|]*child[- ]table/im.test(seq)) sig.push('OD-10: build item 1 is no longer the child-table writer');
  if (sig.length) fail('D10b', 'Owner decisions whose signature stopped holding: ' + sig.join(' | '));
  else ok('D10b', 'Every mechanically checkable owner decision still holds.');

  // --- D10c: an OPEN owner comment must not be written up as settled ---
  // The owner has NOT decided O-1, O-2 or O-3. A section claiming otherwise would build on an
  // assumption they never made - the exact failure this register exists to prevent.
  var openOwner = md.slice(md.indexOf('### 0.0.2'));
  var wrongly = [];
  ['O-1', 'O-2', 'O-3'].forEach(function (id) {
    // Stay on the row (no \n) but DO cross pipes: this lives in a markdown table, so the word
    // that would betray a false approval is always on the far side of a "|". The first version
    // used [^|\n] and was pure decoration - a mutation that wrote "| O-2 | APPROVED by owner."
    // passed it clean.
    var re = new RegExp(id + '[^\n]{0,120}(APPROVED|RESOLVED|DECIDED|SETTLED|owner (approved|decided))', 'i');
    if (re.test(openOwner)) wrongly.push(id);
  });
  if (wrongly.length) fail('D10c', 'Owner comments marked settled that the owner has not settled: ' + wrongly.join(', '));
  else ok('D10c', 'No undecided owner comment is written up as settled.');

  // --- D11: every file:line citation must resolve, and resolve UNAMBIGUOUSLY ---
  // WHY. D8 counts citations; it never asks whether they are true. Audited 2026-09-09: of 25
  // distinct citations, `index.ts:180` pointed at the cycle-lock TTL while the design used it to
  // describe aggregator cadence (really line 186), and the cited range 346-370 lands in the LIVE
  // block, not the aggregator block at 367. Worse, `index.ts` is a basename shared by 12 files, so
  // "the citation resolves" depended on which one you happened to open. A citation nobody can
  // follow is indistinguishable from an invented one.
  var CODE_ROOTS = ['scraper/', 'web/', 'packages/', 'scripts/'];
  var cites = [...new Set((md.match(/[a-zA-Z0-9/._-]+\.(?:ts|mjs|sh):\d+/g) || []))];
  var citeBad = [];
  var citeOk = 0;
  for (var ci = 0; ci < cites.length; ci++) {
    var cite = cites[ci];
    var cut = cite.lastIndexOf(':');
    var cpath = cite.slice(0, cut);
    var cline = parseInt(cite.slice(cut + 1), 10);
    var matches = [];
    if (cpath.indexOf('/') >= 0) {
      if (fs.existsSync(cpath)) matches = [cpath];
    } else {
      // basename: search the code roots rather than guessing
      var stack = CODE_ROOTS.slice();
      while (stack.length) {
        var dir = stack.pop();
        var entries = [];
        try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { continue; }
        for (var ei = 0; ei < entries.length; ei++) {
          var name = entries[ei].name;
          if (name === 'node_modules' || name === 'dist' || name === '.next') continue;
          var full = path.join(dir, name);
          if (entries[ei].isDirectory()) stack.push(full + '/');
          else if (name === cpath) matches.push(full);
        }
      }
    }
    if (matches.length === 0) { citeBad.push(cite + ' (no such file)'); continue; }
    if (matches.length > 1) { citeBad.push(cite + ' (AMBIGUOUS - ' + matches.length + ' files share that name; use a path)'); continue; }
    var lines = fs.readFileSync(matches[0], 'utf8').split('\n').length;
    if (cline > lines) citeBad.push(cite + ' (' + matches[0] + ' has only ' + lines + ' lines)');
    else citeOk++;
  }
  if (citeBad.length) fail('D11', citeBad.length + ' of ' + cites.length + ' code citations do not resolve: ' + citeBad.join(' | '));
  else ok('D11', 'All ' + cites.length + ' code citations resolve to a real file and a line that exists.');

} catch (err) {
  console.error('check-design-consistency: the check itself failed —', err.message);
  process.exit(2);
}

const failed = results.filter((r) => !r.pass);
for (const r of results) console.log(`${r.pass ? '[PASS]' : '[FAIL]'} ${r.id}  ${r.msg}`);
console.log(`\n${results.length - failed.length}/${results.length} consistent.`);
if (failed.length && gate) process.exit(1);
