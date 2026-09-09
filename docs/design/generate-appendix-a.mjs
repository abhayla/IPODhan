#!/usr/bin/env node
// docs/design/generate-appendix-a.mjs
//
// WHY THIS EXISTS. Appendix A of `data-sourcing-pull-model.md` is GENERATED from
// `field-source-resolution.spec.mjs`, but for the whole of the design's authoring the generator
// lived only in the session that ran it: the table was regenerated inline and pasted. So the
// contract "edit the spec, never hand-edit the table" had no way to be OBEYED by the next person —
// only a way to be caught after the fact by check D1. This script is the missing half: it renders
// A.1 and A.2 from the spec's own `renderA1()` / `renderA2()` (not a second copy of the ranking
// logic) and splices them into the design in place, leaving every word of prose around them alone.
//
//   node docs/design/generate-appendix-a.mjs            report drift, exit 0
//   node docs/design/generate-appendix-a.mjs --check     report drift, exit 1 if any
//   node docs/design/generate-appendix-a.mjs --write     rewrite the design's A.1/A.2 tables
//
// EXIT CODES: 0 in sync (or written) · 1 drift under --check · 2 the generator itself broke.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DESIGN = path.join(HERE, 'data-sourcing-pull-model.md');
const SPEC = path.join(HERE, 'field-source-resolution.spec.mjs');

const check = process.argv.includes('--check');
const write = process.argv.includes('--write');

try {
  const { renderA1, renderA2, STATS } = await import(pathToFileURL(SPEC).href);
  const md = fs.readFileSync(DESIGN, 'utf8');
  // The design is a CRLF file. Splitting on '\n' alone leaves a trailing CR on every line, so a
  // freshly rendered LF row would differ from an identical stored row at the last character and the
  // generator would report all 242 rows as drift. Split on either, remember which, write back that.
  const eol = md.includes('\r\n') ? '\r\n' : '\n';
  const lines = md.split(/\r?\n/);

  // A generated table is the first contiguous run of `|` lines after its heading. Anything else in
  // the appendix — the prose above A.1, the three paragraphs under A.2 — is authored and untouched.
  const tableAfter = (headingRe) => {
    const h = lines.findIndex((l) => headingRe.test(l));
    if (h < 0) return null;
    let s = h + 1;
    while (s < lines.length && !lines[s].startsWith('|')) {
      if (/^#{2,4} /.test(lines[s])) return null;   // ran into the next section: no table here
      s++;
    }
    let e = s;
    while (e < lines.length && lines[e].startsWith('|')) e++;
    return { start: s, end: e };                    // [start, end)
  };

  const a1 = tableAfter(/^### A[.]1 /);
  const a2 = tableAfter(/^### A[.]2 /);
  if (!a1) throw new Error('could not locate the A.1 table in the design');
  if (!a2) throw new Error('could not locate the A.2 table in the design');

  const want = { A1: renderA1(), A2: renderA2() };
  const have = { A1: lines.slice(a1.start, a1.end), A2: lines.slice(a2.start, a2.end) };

  const drift = [];
  for (const k of ['A1', 'A2']) {
    if (have[k].length !== want[k].length) {
      drift.push(`${k}: ${have[k].length} rows in the design, ${want[k].length} from the spec`);
      continue;
    }
    const bad = have[k].map((l, i) => (l === want[k][i] ? null : i)).filter((i) => i !== null);
    if (bad.length) drift.push(`${k}: ${bad.length} row(s) differ, first at table line ${bad[0] + 1}`);
  }

  const s = STATS();
  console.log(`spec: ${s.fields} fields · E-1 ${s.e1} · single-source ${s.singleSource}`);

  if (write) {
    // Splice A.2 first: it sits later in the file, so rewriting it cannot move A.1's offsets.
    const next = lines.slice(0, a2.start).concat(want.A2, lines.slice(a2.end));
    const out = next.slice(0, a1.start).concat(want.A1, next.slice(a1.end));
    fs.writeFileSync(DESIGN, out.join('\n'));
    console.log(drift.length ? `written: ${drift.join(' · ')}` : 'written: no change (already in sync)');
    process.exit(0);
  }

  if (!drift.length) {
    console.log('Appendix A.1/A.2 in the design match the spec exactly.');
    process.exit(0);
  }
  console.log('DRIFT — ' + drift.join(' · ') + '\n  fix: node docs/design/generate-appendix-a.mjs --write');
  process.exit(check ? 1 : 0);
} catch (err) {
  console.error('generate-appendix-a: the generator itself failed —', err.message);
  process.exit(2);
}
