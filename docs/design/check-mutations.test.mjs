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
        .replace('## 8. Definition of done', 'Rs 2Â lakh and RenÃ¨e.\n\n## 8. Definition of done'));
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
