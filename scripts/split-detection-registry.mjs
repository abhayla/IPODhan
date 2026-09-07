#!/usr/bin/env node
// One-off migration (T-487): explode the committed detection-checks.json and
// failure-classes.md into one file per entry under docs/reviews/detection-checks/
// and docs/reviews/failure-classes/, so future PRs adding a check/class stop
// conflicting on the same two files. Run once; the result is committed. After
// this runs, edit per-entry files and use scripts/build-detection-registry.mjs
// to regenerate the two aggregates.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');

const CHECKS_JSON = join(REPO_ROOT, 'docs/reviews/detection-checks.json');
const CHECKS_DIR = join(REPO_ROOT, 'docs/reviews/detection-checks');
const CLASSES_MD = join(REPO_ROOT, 'docs/reviews/failure-classes.md');
const CLASSES_DIR = join(REPO_ROOT, 'docs/reviews/failure-classes');

function slugify(s) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

function splitChecksJson() {
  const manifest = JSON.parse(readFileSync(CHECKS_JSON, 'utf8'));
  mkdirSync(CHECKS_DIR, { recursive: true });

  const meta = {};
  for (const [k, v] of Object.entries(manifest)) {
    if (k === 'checks' || k === 'notCoveredByThisManifest') continue;
    meta[k] = v;
  }
  writeFileSync(
    join(CHECKS_DIR, '_meta.json'),
    JSON.stringify(meta, null, 2) + '\n',
    'utf8'
  );

  const seenIds = new Set();
  for (const check of manifest.checks) {
    const entry = { ...check, section: 'checks' };
    const id = check.id;
    if (seenIds.has(id)) throw new Error(`duplicate check id: ${id}`);
    seenIds.add(id);
    writeFileSync(
      join(CHECKS_DIR, `${id}.json`),
      JSON.stringify(entry, null, 2) + '\n',
      'utf8'
    );
  }

  let ncIndex = 0;
  for (const note of manifest.notCoveredByThisManifest || []) {
    ncIndex += 1;
    const slug = slugify(note.split(/[—–-]/)[0] || note.slice(0, 40));
    const id = `nc-${String(ncIndex).padStart(2, '0')}-${slug}`;
    const entry = { id, section: 'notCoveredByThisManifest', note };
    if (seenIds.has(id)) throw new Error(`duplicate check id: ${id}`);
    seenIds.add(id);
    writeFileSync(
      join(CHECKS_DIR, `${id}.json`),
      JSON.stringify(entry, null, 2) + '\n',
      'utf8'
    );
  }

  console.log(
    `split-detection-registry: wrote ${manifest.checks.length} checks + ${(manifest.notCoveredByThisManifest || []).length} notCovered entries + _meta.json to ${CHECKS_DIR}`
  );
}

// Parse the markdown table between `| class_id |` header and the first blank
// line, PLUS any stray `| ... |` row appended later in the file outside the
// table (a known orphan row at file end — captured so no data is lost).
function splitFailureClasses() {
  const text = readFileSync(CLASSES_MD, 'utf8');
  const lines = text.split('\n');

  const headerIdx = lines.findIndex((l) => l.startsWith('| class_id |'));
  if (headerIdx === -1) throw new Error('failure-classes.md: table header not found');
  const sepIdx = headerIdx + 1;

  let endIdx = sepIdx + 1;
  while (endIdx < lines.length && lines[endIdx].startsWith('|')) endIdx += 1;
  const mainRows = lines.slice(sepIdx + 1, endIdx).filter((l) => l.trim().length > 0);

  // Any additional `| ... |` row(s) elsewhere in the file (after endIdx),
  // not part of a contiguous table block — treat as extra data rows.
  const strayRows = [];
  for (let i = endIdx; i < lines.length; i += 1) {
    const l = lines[i];
    if (l.startsWith('|') && l.trim().endsWith('|') && l.split('|').length - 1 >= 7) {
      strayRows.push(l);
    }
  }

  mkdirSync(CLASSES_DIR, { recursive: true });

  const columns = ['class_id', 'feature', 'symptom', 'first_seen', 'fix_prs', 'detection_check', 'status'];
  const seenSlugs = new Set();
  const allRows = [...mainRows, ...strayRows];
  for (const row of allRows) {
    const cells = row
      .split('|')
      .slice(1, -1)
      .map((c) => c.trim());
    if (cells.length !== columns.length) {
      throw new Error(`failure-classes.md: row has ${cells.length} cells, expected ${columns.length}: ${row.slice(0, 80)}`);
    }
    const entry = {};
    columns.forEach((col, i) => {
      entry[col] = cells[i];
    });
    let slug = slugify(entry.class_id);
    let finalSlug = slug;
    let dupN = 1;
    while (seenSlugs.has(finalSlug)) {
      dupN += 1;
      finalSlug = `${slug}-${dupN}`;
    }
    seenSlugs.add(finalSlug);
    writeFileSync(
      join(CLASSES_DIR, `${finalSlug}.json`),
      JSON.stringify(entry, null, 2) + '\n',
      'utf8'
    );
  }

  console.log(
    `split-detection-registry: wrote ${allRows.length} failure-class rows (${mainRows.length} in-table + ${strayRows.length} stray) to ${CLASSES_DIR}`
  );
}

splitChecksJson();
splitFailureClasses();
