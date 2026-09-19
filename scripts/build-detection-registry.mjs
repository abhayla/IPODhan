#!/usr/bin/env node
// T-487: assemble docs/reviews/detection-checks.json and the failure-classes.md
// table deterministically from one-file-per-entry sources, so parallel PRs
// each adding one check/class file stop conflicting on the two shared
// aggregates. Run after adding/editing a file under docs/reviews/detection-checks/
// or docs/reviews/failure-classes/.
//
// Usage:
//   node scripts/build-detection-registry.mjs           # write the aggregates
//   node scripts/build-detection-registry.mjs --check    # fail (exit 1) if the
//                                                         # committed aggregates
//                                                         # would differ

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');

const CHECKS_DIR = join(REPO_ROOT, 'docs/reviews/detection-checks');
const CHECKS_JSON = join(REPO_ROOT, 'docs/reviews/detection-checks.json');
const CLASSES_DIR = join(REPO_ROOT, 'docs/reviews/failure-classes');
const CLASSES_MD = join(REPO_ROOT, 'docs/reviews/failure-classes.md');
const SPEC_PATH = join(REPO_ROOT, 'docs/design/data-sourcing-pull-model.md');

const TABLE_START = '<!-- BEGIN GENERATED TABLE (scripts/build-detection-registry.mjs) -->';
const TABLE_END = '<!-- END GENERATED TABLE -->';
// item 34: spec_ref added. A key outside this fixed list validates cleanly, passes --check,
// and renders nowhere (R5b) — a measurements_* key did exactly that on 2026-09-19 while this
// item was being written, on the very file (card-fact-false-patched-silently.json) that
// already carried a spec_ref none of this code was reading yet.
const COLUMNS = ['class_id', 'feature', 'symptom', 'first_seen', 'fix_prs', 'detection_check', 'status', 'spec_ref'];
// Display labels for the markdown header — must match origin/main's table
// header text exactly; distinct from the JSON field names in COLUMNS.
const HEADER_LABELS = {
  class_id: 'class_id',
  feature: 'feature',
  symptom: 'symptom (user-visible)',
  first_seen: 'first_seen',
  fix_prs: 'fix_prs',
  detection_check: 'detection_check',
  status: 'status',
  spec_ref: 'spec_ref',
};

// Read once: the set of section numbers the spec itself declares as headings (## through
// ####, "0.0.4", "2.11", etc). A hand-kept list of valid sections is a second definition of
// the spec's shape that drifts the first time a section is renumbered — read it off the
// document instead.
function knownSpecSections() {
  const spec = readFileSync(SPEC_PATH, 'utf8');
  const SECTION_RE = /^#{2,4} (\d+(?:\.\d+)*)/gm;
  return new Set([...spec.matchAll(SECTION_RE)].map((m) => '§' + m[1]));
}

/**
 * Every failure-class entry must carry `spec_ref` (an array; `[]` for "touches no part of the
 * pull model" — a class with a genuinely empty list and a class where the key is simply
 * missing must not read identically, so a missing key is refused rather than defaulted).
 * Every named section must exist in the spec's own heading list, refreshed each run so a
 * later renumbering is caught rather than silently going stale.
 */
function validateSpecRefs(entries) {
  const known = knownSpecSections();
  for (const { file, data } of entries) {
    if (!('spec_ref' in data)) {
      throw new Error(`failure-classes/${file}: missing "spec_ref" (use [] if this class touches no part of the pull model)`);
    }
    if (!Array.isArray(data.spec_ref)) {
      throw new Error(`failure-classes/${file}: "spec_ref" must be an array of section strings (e.g. ["§2.5"])`);
    }
    for (const ref of data.spec_ref) {
      if (!known.has(ref)) {
        throw new Error(`failure-classes/${file}: spec_ref ${JSON.stringify(ref)} names no section of ${SPEC_PATH}`);
      }
    }
  }
}

function readJsonFiles(dir) {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json') && f !== '_meta.json')
    .sort()
    .map((f) => ({ file: f, data: JSON.parse(readFileSync(join(dir, f), 'utf8')) }));
}

// A notCoveredByThisManifest entry historically carried a hand-written
// `note` string. Retired entries (retiredBy/retiredReason) and four
// pre-existing entries never had one, which silently serialized as `null`
// in the generated aggregate (nothing asserted non-null, so --check and the
// floor test both passed with nulls in the array). Derive a real string
// instead of ever writing null.
function deriveNcNote(data) {
  if (typeof data.note === 'string' && data.note.trim() !== '') return data.note;
  if (data.retiredBy || data.retiredReason) {
    return `Retired: ${data.retiredReason || 'no reason recorded'} (replaced by ${data.retiredBy || 'unknown'})`;
  }
  if (typeof data.why === 'string' && data.why.trim() !== '') return data.why;
  if (typeof data.notCoveredReason === 'string' && data.notCoveredReason.trim() !== '') return data.notCoveredReason;
  if (typeof data.findingClass === 'string' && data.findingClass.trim() !== '') return data.findingClass;
  return '';
}

function buildChecksJson() {
  const meta = JSON.parse(readFileSync(join(CHECKS_DIR, '_meta.json'), 'utf8'));
  const entries = readJsonFiles(CHECKS_DIR);

  const checksEntries = entries.filter((e) => e.data.section === 'checks');
  const ncEntries = entries.filter((e) => e.data.section === 'notCoveredByThisManifest');

  const badSection = entries.filter(
    (e) => e.data.section !== 'checks' && e.data.section !== 'notCoveredByThisManifest'
  );
  if (badSection.length > 0) {
    throw new Error(
      `detection-checks/${badSection[0].file}: "section" must be "checks" or "notCoveredByThisManifest", got ${JSON.stringify(badSection[0].data.section)}`
    );
  }

  checksEntries.sort((a, b) => (a.data.id < b.data.id ? -1 : a.data.id > b.data.id ? 1 : 0));
  ncEntries.sort((a, b) => (a.data.id < b.data.id ? -1 : a.data.id > b.data.id ? 1 : 0));

  // Ids must be unique across BOTH sections, not just within one — two
  // different files (even in different directories/sections) declaring the
  // same id would silently shadow one another downstream.
  const idOwners = new Map();
  for (const e of entries) {
    const id = e.data.id;
    if (idOwners.has(id)) {
      throw new Error(
        `duplicate detection-checks id "${id}" in ${idOwners.get(id)} and ${e.file}`
      );
    }
    idOwners.set(id, e.file);
  }

  const checks = checksEntries.map((e) => {
    const { section, ...rest } = e.data;
    return rest;
  });
  const notCoveredByThisManifest = ncEntries.map((e) => {
    const note = deriveNcNote(e.data);
    if (typeof note !== 'string' || note.trim() === '') {
      throw new Error(
        `detection-checks/${e.file}: notCoveredByThisManifest entry "${e.data.id}" has no usable note (no note, retiredBy/retiredReason, why, notCoveredReason, findingClass or id to derive one from)`
      );
    }
    return note;
  });

  // Stable key order: manifest metadata, then checks/notCoveredByThisManifest
  // in the position the hand-authored file historically used, then any
  // remaining meta fields (exitCodes, paging, ...) that follow them.
  const leadKeys = ['$schema', 'generatedBy', 'sourceRca', 'auditScript', 'selfTest', 'wiredInto'];
  const out = {};
  for (const k of leadKeys) if (k in meta) out[k] = meta[k];
  out.checks = checks;
  out.notCoveredByThisManifest = notCoveredByThisManifest;
  for (const [k, v] of Object.entries(meta)) {
    if (!leadKeys.includes(k)) out[k] = v;
  }

  return JSON.stringify(out, null, 2) + '\n';
}

function mdEscape(cell) {
  if (Array.isArray(cell)) return cell.join(', ').replace(/\n/g, ' ');
  return String(cell).replace(/\n/g, ' ');
}

function buildFailureClassesTable() {
  const entries = readJsonFiles(CLASSES_DIR);
  validateSpecRefs(entries);
  entries.sort((a, b) => {
    const ai = a.data.class_id || '';
    const bi = b.data.class_id || '';
    return ai < bi ? -1 : ai > bi ? 1 : 0;
  });

  const header = `| ${COLUMNS.map((c) => HEADER_LABELS[c]).join(' | ')} |`;
  const sep = `|${COLUMNS.map(() => '---').join('|')}|`;
  const rows = entries.map((e) => {
    const cells = COLUMNS.map((c) => mdEscape(e.data[c] ?? ''));
    return `| ${cells.join(' | ')} |`;
  });

  return [header, sep, ...rows].join('\n');
}

function writeFailureClassesMd(checkOnly) {
  const original = readFileSync(CLASSES_MD, 'utf8');
  const table = buildFailureClassesTable();

  const startIdx = original.indexOf(TABLE_START);
  const endIdx = original.indexOf(TABLE_END);

  let updated;
  if (startIdx === -1 || endIdx === -1) {
    // First run after migration: replace the legacy inline table (from the
    // `| class_id |` header through the last contiguous `|`-prefixed line)
    // with the marker-wrapped generated block, in place.
    const lines = original.split('\n');
    const headerIdx = lines.findIndex((l) => l.startsWith('| class_id |'));
    if (headerIdx === -1) {
      throw new Error('failure-classes.md: neither generated markers nor a legacy table header found');
    }
    let endLineIdx = headerIdx + 2;
    while (endLineIdx < lines.length && lines[endLineIdx].startsWith('|')) endLineIdx += 1;
    // Also drop the stray orphan row (any `|...|` row with >=7 cells) found
    // later in the file — its content now lives in the generated table.
    const kept = lines.filter((l, i) => {
      if (i >= headerIdx && i < endLineIdx) return false;
      if (i >= endLineIdx && l.startsWith('|') && l.trim().endsWith('|') && l.split('|').length - 1 >= 7) {
        return false;
      }
      return true;
    });
    kept.splice(headerIdx, 0, TABLE_START, table, TABLE_END);
    updated = kept.join('\n');
  } else {
    updated = original.slice(0, startIdx) + TABLE_START + '\n' + table + '\n' + original.slice(endIdx);
  }

  if (checkOnly) {
    return { path: CLASSES_MD, matches: sameIgnoringEol(updated, original), content: updated };
  }
  writeFileSync(CLASSES_MD, updated, 'utf8');
  return { path: CLASSES_MD, matches: true, content: updated };
}

// Windows checkouts with core.autocrlf=true hold CRLF copies of the aggregates while the
// generator emits LF; --check compares content, not line endings (2026-09-07).
function sameIgnoringEol(a, b) {
  return a.replace(/\r\n/g, '\n') === b.replace(/\r\n/g, '\n');
}

function main() {
  const checkOnly = process.argv.includes('--check');

  const checksJson = buildChecksJson();
  const results = [];

  if (checkOnly) {
    const existing = readFileSync(CHECKS_JSON, 'utf8');
    results.push({ path: CHECKS_JSON, matches: sameIgnoringEol(checksJson, existing) });
  } else {
    writeFileSync(CHECKS_JSON, checksJson, 'utf8');
    results.push({ path: CHECKS_JSON, matches: true });
  }

  results.push(writeFailureClassesMd(checkOnly));

  if (checkOnly) {
    const drifted = results.filter((r) => !r.matches);
    if (drifted.length > 0) {
      console.error('build-detection-registry --check: FAIL — committed aggregate(s) drifted from source files:');
      for (const r of drifted) console.error(`  - ${r.path}`);
      console.error('Run `node scripts/build-detection-registry.mjs` and commit the result.');
      process.exit(1);
    }
    console.log('build-detection-registry --check: PASS — aggregates match source files');
    process.exit(0);
  }

  console.log(`build-detection-registry: wrote ${CHECKS_JSON} and ${CLASSES_MD}`);
}

main();
