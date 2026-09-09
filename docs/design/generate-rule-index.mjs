#!/usr/bin/env node
// docs/design/generate-rule-index.mjs
//
// WHY THIS EXISTS. Owner, 2026-09-09: "How will the implementation prove it has followed this
// design, rule by rule?" A design of 3,000 lines states a few hundred rules. "We built what the
// design says" is unfalsifiable at that size — nobody can hold the design in their head while
// reading a diff. So every rule gets a STABLE ID, and the id is what the build card, the test and
// the CI check all name. The chain is then a command, not a claim.
//
// WHAT COUNTS AS A RULE, and why the extraction is deterministic rather than clever:
//
//   (a) A BLOCKQUOTE. This document states its binding rules as blockquotes — that convention
//       predates this generator (see 2.1, 2.3.1, 2.5, 2.11, 6.6). A blockquote is an author saying
//       "this sentence is the rule".
//   (b) A row of a table whose header row contains the word "Rule". Those tables are how this
//       design lists rule families (2.2.1's handling rules, 2.5.5's corrigendum rules, 4.5's corpus
//       rules, 7.6's configuration rules).
//   (c) Any other PARAGRAPH or TABLE ROW in sections 2-7 carrying a normative word —
//       "must", "never" or "always". The first version of this generator had only (a) and (b) and
//       found 30 rules, all of them in the sections written that same afternoon: a traceability
//       index that covers the newest sixth of a design and reports "in step" is worse than none,
//       because it makes the gap invisible.
//
// Nothing else is extracted, and (c) is deliberately BROAD rather than clever. A false positive
// costs one line in a build card; a false negative is a rule nobody has to implement, which is the
// failure this index exists to prevent. An LLM-ish "find the normative sentences" pass would
// produce a different set every run, and an id that moves is worse than no id at all.
//
// ID STABILITY. An id is bound to the HASH of its rule text. Re-running never renumbers an
// unchanged rule. A rule whose text changes gets a NEW id and the old one is retired in place
// (never deleted, never reused) — which is exactly the signal we want: the build card and the test
// that named the old id now fail D19 and the traceability check, so a changed rule drags its
// implementation and its test with it.
//
//   node docs/design/generate-rule-index.mjs            report only
//   node docs/design/generate-rule-index.mjs --apply    write docs/design/rules.json
//   node docs/design/generate-rule-index.mjs --check    exit 1 if rules.json is out of date
//
// EXIT CODES: 0 in step · 1 out of date (--check) · 2 the generator itself broke.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DESIGN = path.join(HERE, 'data-sourcing-pull-model.md');
const OUT = path.join(HERE, 'rules.json');

const apply = process.argv.includes('--apply');
const check = process.argv.includes('--check');

/** Whitespace-normalised, markdown-stripped text — the thing we hash. */
function skeleton(s) {
  return String(s)
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\*\*/g, '')
    .replace(/\*/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const hashOf = (text) => crypto.createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 12);

/**
 * Sections the index covers. Sections 0 and 1 describe what is TRUE TODAY and what each field is;
 * they are measurements and a mapping, not rules to implement. Appendix A is generated. Including
 * them would put hundreds of ids into the index that no build item could ever implement, which
 * turns D19 from a check into noise.
 */
const COVERED = /^#{2,4} (2|3|4|5|6|7)(\.|\s)/;
const NORMATIVE = /\b(must|never|always)\b/i;

function extract(md) {
  const lines = md.split('\n');
  const rules = [];
  let section = null;
  let covered = false;
  let tableIsRules = false;
  let inTable = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    const heading = line.match(/^(#{2,4}) (\S+)/);
    if (heading) {
      // A sub-heading with a PROSE title ("#### The two locks") belongs to the numbered section
      // above it and inherits its coverage. Resetting on it was this extractor's second silent
      // hole: section 2.1 states the whole cadence under prose sub-headings, so every rule in it
      // was skipped while the index reported "in step". An h2 always re-decides, because
      // "## Appendix A" must not inherit section 8.
      const numbered = /^#{2,4} \d/.test(line);
      if (heading[1].length === 2 || numbered) covered = COVERED.test(line);
      if (numbered || heading[1].length === 2) section = line.replace(/^#+\s*/, '').trim();
      inTable = false;
      tableIsRules = false;
      continue;
    }
    if (!covered) continue;

    // (a) blockquote rules — a run of "> " lines is ONE rule
    if (/^>\s/.test(line)) {
      const buf = [];
      let j = i;
      while (j < lines.length && /^>/.test(lines[j])) {
        buf.push(lines[j].replace(/^>\s?/, ''));
        j++;
      }
      const text = skeleton(buf.join(' '));
      i = j - 1;
      // A blockquote that only quotes the owner is a DECISION, recorded in 0.0.1, not a rule to
      // implement. They are recognisable: they are wrapped in quotation marks and attributed.
      if (text.length >= 25 && !/^Owner[,:]/i.test(text) && !/^["“]/.test(text)) {
        rules.push({ section, kind: 'blockquote', text });
      }
      continue;
    }

    // (b) rows of a table whose header names "Rule"
    if (/^\|/.test(line)) {
      if (!inTable) {
        inTable = true;
        tableIsRules = /\|\s*\**Rule\**\s*\|/i.test(line);
        continue;
      }
      if (/^\|[-\s|]+\|$/.test(line)) continue;
      const cells = line.split('|').slice(1, -1).map((c) => c.trim());
      if (cells.length < 2) continue;
      if (!tableIsRules && !NORMATIVE.test(line)) continue;
      const text = skeleton(cells.join(' — '));
      if (text.length >= 25) rules.push({ section, kind: tableIsRules ? 'table' : 'table-normative', text });
      continue;
    }
    inTable = false;
    tableIsRules = false;

    // (c) a prose paragraph carrying a normative word
    if (line.trim() === '' || /^#/.test(line)) continue;
    const buf = [];
    let j = i;
    while (j < lines.length && lines[j].trim() !== '' && !/^[|>#]/.test(lines[j])) {
      buf.push(lines[j]);
      j++;
    }
    i = j - 1;
    const para = buf.join(' ');
    if (!NORMATIVE.test(para)) continue;
    const text = skeleton(para);
    if (text.length >= 40) rules.push({ section, kind: 'prose', text });
  }
  return rules;
}

try {
  const md = fs.readFileSync(DESIGN, 'utf8');
  const found = extract(md).map((r) => ({ ...r, hash: hashOf(r.text) }));

  const prev = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : { rules: [], next_id: 1 };
  const byHash = new Map((prev.rules || []).map((r) => [r.hash, r]));
  let nextId = prev.next_id || 1;

  const live = [];
  for (const r of found) {
    const seen = byHash.get(r.hash);
    if (seen) {
      live.push({ ...seen, section: r.section, kind: r.kind, text: r.text, retired: false });
      byHash.delete(r.hash);
    } else {
      live.push({
        id: 'R-' + String(nextId++).padStart(3, '0'),
        hash: r.hash,
        section: r.section,
        kind: r.kind,
        text: r.text,
        first_seen: new Date().toISOString().slice(0, 10),
        retired: false,
      });
    }
  }
  // Whatever is left in byHash was in the index and is no longer in the document.
  const retired = [...byHash.values()].map((r) => ({ ...r, retired: true }));

  const next = {
    generated_by: 'docs/design/generate-rule-index.mjs',
    generated_at: new Date().toISOString(),
    extraction: 'blockquotes and rows of Rule-headed tables, in sections 2-7 of data-sourcing-pull-model.md',
    counts: { live: live.length, retired: retired.length },
    next_id: nextId,
    rules: [...live, ...retired],
  };

  const stable = (o) => JSON.stringify({ ...o, generated_at: null }, null, 2);

  if (apply) {
    fs.writeFileSync(OUT, JSON.stringify(next, null, 2) + '\n');
    console.log(`rules.json written: ${live.length} live, ${retired.length} retired, next id R-${String(nextId).padStart(3, '0')}`);
    process.exit(0);
  }

  if (!fs.existsSync(OUT)) {
    console.log('rules.json does not exist. Run with --apply.');
    process.exit(check ? 1 : 0);
  }
  const drifted = stable(prev) !== stable(next);
  console.log(`design rules: ${live.length} live, ${retired.length} retired`);
  if (drifted) {
    const prevLive = new Set((prev.rules || []).filter((r) => !r.retired).map((r) => r.hash));
    const added = live.filter((r) => !prevLive.has(r.hash)).length;
    console.log(`DRIFT — rules.json is out of date: ${added} new or changed rule(s), ${retired.length} retired. Run: node docs/design/generate-rule-index.mjs --apply`);
    process.exit(check ? 1 : 0);
  }
  console.log('rules.json is in step with the design.');
  process.exit(0);
} catch (err) {
  console.error('generate-rule-index: the generator itself failed —', err.message);
  process.exit(2);
}
