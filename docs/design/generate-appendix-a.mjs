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

  // ---------------------------------------------------------------------------
  // A.0's evidence summary is generated too. It was not, and within an hour of the mapper being
  // tightened the prose said "114 of 386 pairs, NSE 19 of 38" while the probe returned 105 of 387 and
  // NSE 15 of 42 — in a section whose own first sentence claims the numbers are generated rather than
  // counted by a person. A number that describes a generator has to come FROM the generator.
  // ---------------------------------------------------------------------------
  const MAPOUT = path.join(HERE, 'probes', 'evidence-map.out.json');
  let summary = null;
  if (fs.existsSync(MAPOUT)) {
    const m = JSON.parse(fs.readFileSync(MAPOUT, 'utf8'));
    const t = m.totals || {};
    const total = (m.pairs || []).length;
    const rows = ['| Source | Rank backed by a saved payload | Searched, nothing matched | Not probed this round |',
                  '|---|---:|---:|---:|'];
    for (const src of ['DOC', 'NSE', 'BSE', 'CG', 'IG', 'REG', 'ADMIN']) {
      const v = (m.by_source || {})[src];
      if (!v) continue;
      rows.push(`| \`${src}\` | ${v.CARRIES || 0} | ${v.UNPROVEN || 0} | ${v.UNPROBED || 0} |`);
    }
    summary = rows.join('\n') + '\n\n' +
      `**${t.CARRIES || 0} of ${total} pairs are backed by a payload we hold.** Check **D15** enforces that ` +
      `number as a ratchet: it may rise, and the gate fails if it falls — and since 2026-09-09 it also ` +
      `refuses a reference whose cited label is not actually in the file it points at.\n\n` +
      `**What the other ${(t.UNPROVEN || 0) + (t.UNPROBED || 0)} mean, precisely, because this is where an honest report is easy to fake.**`;
  }
  const SUMMARY_OPEN = '<!-- generated:evidence-summary';
  const SUMMARY_CLOSE = '<!-- /generated:evidence-summary -->';

  // Is the generated evidence summary the one the probe would produce right now?
  const so = lines.findIndex((l) => l.startsWith(SUMMARY_OPEN));
  const sc = lines.findIndex((l) => l.trim() === SUMMARY_CLOSE);
  if (summary !== null && so >= 0 && sc > so &&
      lines.slice(so + 1, sc).join('\n').trim() !== summary.trim()) {
    drift.push('the A.0 evidence summary differs from the probe output');
  }

  if (write) {
    // Splice from the BOTTOM up, so rewriting one block cannot move the offsets of the ones above it.
    // And join with the file's OWN line ending: this joined with '\n' for two runs and silently
    // rewrote a CRLF document as LF, which turns a one-row regeneration into a whole-file diff and
    // hides the real change from any reviewer reading the pull request.
    let out = lines;
    out = out.slice(0, a2.start).concat(want.A2, out.slice(a2.end));
    out = out.slice(0, a1.start).concat(want.A1, out.slice(a1.end));
    if (summary !== null && so >= 0 && sc > so) {
      out = out.slice(0, so + 1).concat(summary.split('\n'), out.slice(sc));
    }
    fs.writeFileSync(DESIGN, out.join(eol));
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
