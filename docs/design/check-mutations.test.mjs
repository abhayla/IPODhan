#!/usr/bin/env node
// docs/design/check-mutations.test.mjs
//
// WHY THIS EXISTS. "A check that has never been red is not a check" is this design's own most
// expensive lesson, and on 2026-09-09 a reviewer proved it again: they attacked six of the gate's
// checks and FIVE stayed green under a mutation that falsified the check's own PASS line. The
// evidence ratchet could be set to zero by the same change it was meant to constrain. The card
// gate excused a fake path because the word "new" appeared elsewhere on the line — 164 of 352
// citations were excused that way. The card-rewriting tool deleted hand-written prose and
// reported success.
//
// Every one of those is fixed. This file is what stops them coming back: it applies the reviewer's
// exact mutations, asserts the gate goes RED, and restores every file byte-for-byte (md5-checked).
//
// 2026-09-09, second round: the remaining twenty checks — D1-D9, D9b, D10, D10b, D10c, D11-D14,
// D16, D17, D19 — had no standing mutation at all. Four of them were decoration and are fixed in
// the same change as the case that exposed them (D3 could not notice a count being deleted, D6
// passed on any table that quoted the words "open and upcoming", D8's floor of 12 sat forty
// citations below the truth, and D9's regex could not match the string "phase 2").
//
//   node docs/design/check-mutations.test.mjs
//
// EXIT: 0 every mutation was caught · 1 at least one mutation slipped through · 2 the test broke.
//
// SAFETY: it writes to real files under docs/design/ and restores them. It refuses to run when the
// working tree already has uncommitted changes to those files, because then "restored" would mean
// restoring to something this test never verified.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../..');
process.chdir(REPO);

const md5 = (p) => crypto.createHash('md5').update(fs.readFileSync(p)).digest('hex');
const run = (args) => spawnSync('node', args, { encoding: 'utf8' });
const designGate = () => run(['docs/design/check-design-consistency.mjs', '--gate']);
const cardGate = () => run(['docs/design/check-build-cards.mjs', '--gate']);

const DESIGN = 'docs/design/data-sourcing-pull-model.md';
const FINDINGS = 'docs/design/findings.json';
const CARD1 = 'docs/design/build-cards/item-01-child-table-consolidated-writer.md';
const CARD2 = 'docs/design/build-cards/item-02-field-manifest-and-priority-config.md';
const read = (p) => fs.readFileSync(p, 'utf8');
const write = (p, s) => fs.writeFileSync(p, s);
const NL = String.fromCharCode(10);

const CASES = [
  {
    id: 'D15 evidence ratchet — set the floor to 0 and empty evidence.json in the same change',
    files: ['docs/design/field-source-resolution.spec.mjs', 'docs/design/evidence.json'],
    mutate() {
      let s = fs.readFileSync('docs/design/field-source-resolution.spec.mjs', 'utf8');
      fs.writeFileSync('docs/design/field-source-resolution.spec.mjs',
        s.replace(/EVIDENCE_FLOOR\s*=\s*\d+/, 'EVIDENCE_FLOOR = 0'));
      const ev = JSON.parse(fs.readFileSync('docs/design/evidence.json', 'utf8'));
      ev.fields = {};
      fs.writeFileSync('docs/design/evidence.json', JSON.stringify(ev, null, 2) + '\n');
    },
    gate: designGate,
    expect: /^\[FAIL\] D15\b/m,
  },
  {
    id: 'D15 declared-unreachable laundering — turn every CARRIES pair into a fake "unreachable" string',
    files: ['docs/design/evidence.json'],
    mutate() {
      // 2026-09-09: the "unreachable on <date>: <reason>" form was added so a probed-but-unreachable
      // pair could be DECLARED rather than left silent. That string must never count toward the
      // floor — if it did, this mutation (relabelling every real CARRIES pair as "unreachable")
      // would make the floor pass with ZERO real evidence, exactly the D15-laundering hole a
      // reviewer found in the ratchet itself on this same date.
      const ev = JSON.parse(fs.readFileSync('docs/design/evidence.json', 'utf8'));
      for (const bySrc of Object.values(ev.fields)) {
        for (const src of Object.keys(bySrc)) bySrc[src] = 'unreachable on 2026-09-09: mutation test';
      }
      fs.writeFileSync('docs/design/evidence.json', JSON.stringify(ev, null, 2) + '\n');
    },
    gate: designGate,
    expect: /^\[FAIL\] D15\b/m,
  },
  {
    id: 'D18 check roster — remove the backticks around one check id (a pure formatting edit)',
    files: ['docs/design/data-sourcing-pull-model.md'],
    mutate() {
      const p = 'docs/design/data-sourcing-pull-model.md';
      fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replace('| `PULL-NOBLANK` |', '| PULL NOBLANK |'));
    },
    gate: designGate,
    expect: /^\[FAIL\] D18\b/m,
  },
  {
    id: 'D20 encoding — insert the commonest mojibake of all (C2 before a non-breaking space)',
    files: ['docs/design/data-sourcing-pull-model.md'],
    mutate() {
      const p = 'docs/design/data-sourcing-pull-model.md';
      fs.writeFileSync(p, fs.readFileSync(p, 'utf8')
        .replace('## 8. Definition of done', 'Rs 2Â lakh and RenÃ¨e.\n\n## 8. Definition of done'));
    },
    gate: designGate,
    expect: /^\[FAIL\] D20\b/m,
  },
  {
    id: 'card gate — repoint a real path at a file that does not exist, on a line containing the word "new"',
    files: ['docs/design/build-cards/item-01-child-table-consolidated-writer.md'],
    mutate() {
      const p = 'docs/design/build-cards/item-01-child-table-consolidated-writer.md';
      fs.writeFileSync(p, fs.readFileSync(p, 'utf8')
        .replace('`scraper/src/services/data-consolidation-orchestrator.ts`',
                 '`scraper/src/services/NOT-A-REAL-FILE-xyz.ts`'));
    },
    gate: cardGate,
    expect: /NOT-A-REAL-FILE-xyz\.ts/,
  },

  // ---------------------------------------------------------------------------------------------
  // Round two: the twenty checks that had no standing mutation. One case per check, two where a
  // check has two independent failure modes. Each case names the drift an author could plausibly
  // introduce, and the message the gate has to print.
  // ---------------------------------------------------------------------------------------------
  {
    // drift: a row is hand-deleted from the generated Appendix A table — the commonest way a
    // generated table rots. expect: D1 says the appendix has drifted from the spec.
    id: 'D1 appendix/spec parity — delete one row from the generated Appendix A table',
    files: [DESIGN],
    mutate() {
      // Edited inside the appendix only, so the case cannot accidentally hit the field-plan table
      // in section 1, which numbers its rows the same way.
      const s = read(DESIGN), at = s.indexOf('### A.1');
      write(DESIGN, s.slice(0, at) + s.slice(at).replace(/^\| 4 \| `ipos\.lot_size`[^\n]*\n/m, ''));
    },
    gate: designGate,
    expect: /^\[FAIL\] D1\b/m,
  },
  {
    // drift: a count the generator owns is typed into the prose, where it goes stale silently.
    // expect: D2 names the hand-typed plan-row count.
    id: 'D2 hand-typed counts — write "the 240 sourced fields" into the prose',
    files: [DESIGN],
    mutate() {
      write(DESIGN, read(DESIGN).replace('## 8. Definition of done',
        'Together the 240 sourced fields are covered.\n\n## 8. Definition of done'));
    },
    gate: designGate,
    expect: /^\[FAIL\] D2\b/m,
  },
  {
    // drift: a number inside a GENERATED block is edited by hand, so the block stops matching the
    // generator that owns it. expect: D2 reports a drifted generated block.
    id: 'D2 generated block — edit a number inside the generated evidence-summary block in A.0',
    files: [DESIGN],
    mutate() {
      write(DESIGN, read(DESIGN).replace('| `NSE` | 21 |', '| `NSE` | 29 |'));
    },
    gate: designGate,
    expect: /^\[FAIL\] D2\b/m,
  },
  {
    // drift: the prose count of E-1 contradicts the spec — the "nine in one paragraph, twelve in
    // another" defect that this whole gate was built for. expect: D3 names the wrong word.
    id: 'D3 E-1 size — prose says "the nine E-1 fields" while the spec has ten',
    files: [DESIGN],
    mutate() { write(DESIGN, read(DESIGN).replace('the ten E-1 fields', 'the nine E-1 fields')); },
    gate: designGate,
    expect: /^\[FAIL\] D3\b/m,
  },
  {
    // drift: the count is dropped from the prose altogether, so there is nothing left to
    // contradict and nothing left to check. expect: D3 fails because the size is no longer stated.
    id: 'D3 E-1 size — delete every stated count of E-1 from the prose',
    files: [DESIGN],
    mutate() {
      write(DESIGN, read(DESIGN)
        .replace(/the ten E-1 fields/g, 'the E-1 fields')
        .replace(/E-1 — ten\./g, 'E-1.')
        .replace(/the ten E-1\b/g, 'the E-1'));
    },
    gate: designGate,
    expect: /^\[FAIL\] D3\b/m,
  },
  {
    // drift: a CRITICAL finding is opened (or re-opened) while the design still reads as approved.
    // expect: D4 refuses the readiness claim.
    id: 'D4 readiness — open a CRITICAL finding while the design still claims approval',
    files: [FINDINGS],
    mutate() {
      const j = JSON.parse(read(FINDINGS));
      j.findings.push({ id: 'F-999', sev: 'CRITICAL', status: 'OPEN', what: 'mutation probe' });
      write(FINDINGS, JSON.stringify(j, null, 2) + '\n');
    },
    gate: designGate,
    expect: /^\[FAIL\] D4\b/m,
  },
  {
    // drift: a finding is given a status nobody declared ("DONE" rather than FIXED), so the
    // register's own vocabulary stops meaning anything. expect: D5 names the finding.
    id: 'D5 status vocabulary — give one finding an undeclared status',
    files: [FINDINGS],
    mutate() {
      const j = JSON.parse(read(FINDINGS));
      j.findings[0].status = 'DONE';
      write(FINDINGS, JSON.stringify(j, null, 2) + '\n');
    },
    gate: designGate,
    expect: /^\[FAIL\] D5\b/m,
  },
  {
    // drift: the owner's scope sentence is deleted in an edit, leaving the words "open and
    // upcoming" alive only in the tables that quote it. expect: D6 fails.
    id: 'D6 phase-1 scope — delete the owner scope statement, leaving the phrase in other tables',
    files: [DESIGN],
    mutate() {
      write(DESIGN, read(DESIGN).split(NL)
        .filter((l) => !/^> \*\*Scope \(owner/.test(l))
        .join(NL));
    },
    gate: designGate,
    expect: /^\[FAIL\] D6\b/m,
  },
  {
    // drift: one of the disproved claims about our own code is written back in as a live
    // assertion. expect: D7 names A-3.
    id: 'D7 disproved claims — reassert that the consolidation service is the only writer',
    files: [DESIGN],
    mutate() {
      write(DESIGN, read(DESIGN).replace('## 8. Definition of done',
        'The consolidation service stays the only writer.\n\n## 8. Definition of done'));
    },
    gate: designGate,
    expect: /^\[FAIL\] D7\b/m,
  },
  {
    // drift: a section of 2-4 is rewritten and its file:line citations go with it — exactly how the
    // seven false claims got in. expect: D8 fails on the DROP, not on a floor forty below the truth.
    id: 'D8 citations — strip 30 file:line citations out of sections 2-4',
    files: [DESIGN],
    mutate() {
      let n = 0;
      write(DESIGN, read(DESIGN).replace(/([a-zA-Z0-9/._-]+\.(?:ts|mjs|sh)):(\d+)/g,
        (m, f) => (++n <= 30 ? f : m)));
    },
    gate: designGate,
    expect: /^\[FAIL\] D8\b/m,
  },
  {
    // drift: deferred work is parked in a phase that does not exist (owner: "there is no phase 2").
    // expect: D9 fails.
    id: 'D9 non-existent phase — park an item in "phase 2"',
    files: [DESIGN],
    mutate() {
      write(DESIGN, read(DESIGN).replace('## 8. Definition of done',
        'The remaining ten rows are deferred to phase 2.\n\n## 8. Definition of done'));
    },
    gate: designGate,
    expect: /^\[FAIL\] D9\b/m,
  },
  {
    // drift: a TRIGGERED finding loses the event that would bring it back into scope, which is the
    // only thing separating "deferred" from "dropped". expect: D9b names it.
    id: 'D9b deferred findings — delete the trigger from a TRIGGERED finding',
    files: [FINDINGS],
    mutate() {
      const j = JSON.parse(read(FINDINGS));
      delete j.findings.find((f) => f.status === 'TRIGGERED').trigger;
      write(FINDINGS, JSON.stringify(j, null, 2) + '\n');
    },
    gate: designGate,
    expect: /^\[FAIL\] D9b\b/m,
  },
  {
    // drift: a section an owner decision points at is renamed — a splice already deleted one
    // heading silently this design. expect: D10 names OD-1 and the section it lost.
    id: 'D10 owner-decision sections — rename the section OD-1 points at',
    files: [DESIGN],
    mutate() { write(DESIGN, read(DESIGN).replace('\n### 1.1 How to read it', '\n### 1.1b How to read it')); },
    gate: designGate,
    expect: /^\[FAIL\] D10\b/m,
  },
  {
    // drift: an owner decision's substance is deleted while its register row and its section
    // heading both survive — D10 would still pass. expect: D10b names OD-6.
    id: 'D10b decision signatures — delete the "verification is a read" rule from the body',
    files: [DESIGN],
    mutate() {
      write(DESIGN, read(DESIGN).replace('verification is a read. It writes only when something changed.',
        'the verifier re-reads the page. It writes only when something changed.'));
    },
    gate: designGate,
    expect: /^\[FAIL\] D10b\b/m,
  },
  {
    // drift: an open owner fork is written up as decided in its own status cell — the assumption
    // the owner never made, laundered into a decision. expect: D10c names O-14.
    id: 'D10c open comments — mark an undecided fork APPROVED in its status cell',
    files: [DESIGN],
    mutate() {
      write(DESIGN, read(DESIGN).replace('**RECOMMENDED: let the probe decide the fact',
        '**APPROVED by the owner: let the probe decide the fact'));
    },
    gate: designGate,
    expect: /^\[FAIL\] D10c\b/m,
  },
  {
    // drift: a citation points past the end of the file it names — the shape a line number takes
    // once the file it cites has been edited. expect: D11 says the file has fewer lines.
    id: 'D11 citations resolve — point a citation at a line the file does not have',
    files: [DESIGN],
    mutate() {
      let done = false;
      write(DESIGN, read(DESIGN).replace(/([a-zA-Z0-9/._-]+\.(?:ts|mjs|sh)):(\d+)/g, (m, f) => {
        if (done) return m;
        done = true;
        return f + ':999999';
      }));
    },
    gate: designGate,
    expect: /^\[FAIL\] D11\b/m,
  },
  {
    // drift: one of the owner's three job times is changed in an edit. expect: D12 names the
    // cadence element that stopped holding.
    id: 'D12 cadence — move the closed-IPO job off 22:00',
    files: [DESIGN],
    mutate() {
      write(DESIGN, read(DESIGN).replace(/(\*\*Closed-IPO job\*\*[^\n]*)22:00/, '$123:00'));
    },
    gate: designGate,
    expect: /^\[FAIL\] D12\b/m,
  },
  {
    // drift: a document read is put back on a clock, in a sentence that happens to carry an
    // ordinary word the negation list once treated as a denial ("until", "goes"). The owner has had
    // to say this twice. expect: D12 names the line.
    id: 'D12 documents on a clock — re-read every 30 minutes, in a sentence containing "until"',
    files: [DESIGN],
    mutate() {
      write(DESIGN, read(DESIGN).replace('## 8. Definition of done',
        'Each offer document is re-read every 30 minutes until the extraction goes clean.\n\n## 8. Definition of done'));
    },
    gate: designGate,
    expect: /^\[FAIL\] D12\b/m,
  },
  {
    // drift: an amount column is dropped from the 5.2 inventory while the probe still classifies it
    // CRORE — a 10,000,000x error on a public page. expect: D13 reports it missing.
    id: 'D13 amount inventory — delete one CRORE column from the 5.2 table',
    files: [DESIGN],
    mutate() {
      write(DESIGN, read(DESIGN).replace(/^\| `anchor_investors` \| `total_amount_raised` \|[^\n]*\n/m, ''));
    },
    gate: designGate,
    expect: /^\[FAIL\] D13\b/m,
  },
  {
    // drift: a PROVISIONAL marker names a fork row nobody wrote, so a guess is recorded as though
    // the owner had been asked. expect: D14 names the dangling marker.
    id: 'D14 provisional markers — point a marker at an O-id that has no row',
    files: [DESIGN],
    mutate() { write(DESIGN, read(DESIGN).replace('PROVISIONAL on O-14', 'PROVISIONAL on O-99')); },
    gate: designGate,
    expect: /^\[FAIL\] D14\b/m,
  },
  {
    // drift: a build card loses one of its thirteen headings in an edit, so the implementer never
    // learns how to roll the item back. expect: D16 reports the card gate failing.
    id: 'D16 build cards — rename the "## Rollback" heading on a card',
    files: [CARD2],
    mutate() { write(CARD2, read(CARD2).replace(/(\r?\n)## Rollback(\r?\n)/, '$1## Rolling back$2')); },
    gate: designGate,
    expect: /^\[FAIL\] D16\b/m,
  },
  {
    // drift: the substance of a 2026-09-09 decision is deleted while its register row survives.
    // expect: D17 names OD-48's rupee precision.
    id: 'D17 decision signatures — delete the rupee-precision decision (OD-48)',
    files: [DESIGN],
    mutate() { write(DESIGN, read(DESIGN).replace(/numeric\(15,2\)/g, 'a wider numeric type')); },
    gate: designGate,
    expect: /^\[FAIL\] D17\b/m,
  },
  {
    // drift: a card claims a rule id no live rule has — the shape a card takes when the rule index
    // is regenerated under it. expect: D19 reports a ghost claim.
    id: 'D19 rule ownership — make a card claim a rule id that does not exist',
    files: [CARD1],
    mutate() { write(CARD1, read(CARD1).replace('| §1.12 | R-158 |', '| §1.12 | R-158 |\n| §9.9 | R-999 |')); },
    gate: designGate,
    expect: /^\[FAIL\] D19\b/m,
  },
];

try {
  // Refuse on a dirty tree: "restored" has to mean something.
  const dirty = spawnSync('git', ['status', '--porcelain', '--', ...new Set(CASES.flatMap((c) => c.files))],
                          { encoding: 'utf8' });
  if (String(dirty.stdout).trim()) {
    console.log('REFUSED — these files have uncommitted changes, so a restore could not be verified:');
    console.log(String(dirty.stdout).trim());
    process.exit(2);
  }

  let caught = 0, missed = 0;
  for (const c of CASES) {
    const before = Object.fromEntries(c.files.map((f) => [f, { md5: md5(f), buf: fs.readFileSync(f) }]));
    c.mutate();
    // A mutation that changed nothing would "pass" by never having been applied. Assert it landed.
    if (c.files.every((f) => md5(f) === before[f].md5)) {
      console.log(`NO-OP MUTATION for ${c.id} — the string it edits is gone from the file; fix the case.`);
      process.exit(2);
    }
    const r = c.gate();
    const red = r.status === 1 && c.expect.test(String(r.stdout || ''));
    for (const f of c.files) fs.writeFileSync(f, before[f].buf);
    const restored = c.files.every((f) => md5(f) === before[f].md5);
    if (!restored) {
      console.log(`RESTORE FAILED for ${c.id} — stop and check the working tree by hand.`);
      process.exit(2);
    }
    console.log(`${(red ? 'RED (caught)' : 'GREEN (HOLE)').padEnd(14)} ${c.id}`);
    if (red) caught++; else missed++;
  }

  const after = designGate();
  const cards = cardGate();
  console.log(`\n${caught} mutation(s) caught, ${missed} missed.`);
  console.log(`After restore: design gate exit ${after.status}, card gate exit ${cards.status}.`);
  if (missed || after.status !== 0 || cards.status !== 0) process.exit(1);
  process.exit(0);
} catch (err) {
  console.error('check-mutations: the test itself failed —', err.message);
  process.exit(2);
}
