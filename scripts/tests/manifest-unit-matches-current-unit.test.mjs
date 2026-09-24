// F-156 / item 11 — detection check (a): every field-manifest.json entry whose real column has a
// MEASURED current_unit (docs/design/probes/amount-columns.out.json) must carry that unit, not the
// column's amount-class default. This is the SECOND occurrence of failure class
// `threshold-in-one-unit-column-in-another` (docs/reviews/failure-classes/
// threshold-in-one-unit-column-in-another.json) — the manifest and the admin validators trusted a
// wrong unit tag on 12 real columns (5 rupee-stored OD-67 columns, 7 per-row-unit
// financial_statements columns) for weeks before F-156 measured it.
//
// Run: node --test scripts/tests/manifest-unit-matches-current-unit.test.mjs
//
// This reads the REAL committed manifest and the REAL probe output (never a copied literal), so a
// future regenerate that silently drops a current_unit override fails HERE, not just in the
// content test (which only covers the 8 Group-C fields) or the drift gate (which only proves the
// committed file equals the generator's OWN output, not that the generator is deriving the right
// answer).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const MANIFEST_PATH = join(ROOT, 'scraper', 'config', 'field-manifest.json');
const AMOUNT_COLUMNS_PATH = join(ROOT, 'docs', 'design', 'probes', 'amount-columns.out.json');

function currentUnitToManifestUnit(currentUnit) {
  if (currentUnit === 'RUPEES') return 'rupee';
  if (currentUnit === 'CRORE') return 'crore';
  if (currentUnit === 'PER_ROW_UNIT') return 'per_row';
  return null; // no override recorded — the class default governs, not this test
}

test('every manifest field with a measured current_unit carries the matching unit tag', () => {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  const probe = JSON.parse(fs.readFileSync(AMOUNT_COLUMNS_PATH, 'utf8'));

  const overridden = probe.columns.filter((c) => c.current_unit);
  // Guard against the probe itself silently losing its current_unit measurements (the class this
  // test exists to catch could otherwise hide behind an empty overridden[] and pass vacuously).
  assert.ok(
    overridden.length >= 12,
    `expected at least the 12 known current_unit overrides (5 OD-67 rupee columns + 7 financial_statements per-row columns), found ${overridden.length}`
  );

  const mismatches = [];
  for (const col of overridden) {
    const key = `${col.table}.${col.col}`;
    const entry = manifest.fields[key];
    if (!entry) continue; // not every probed column is a sourced (D/T/X/W/M) manifest field
    const expected = currentUnitToManifestUnit(col.current_unit);
    if (entry.unit !== expected) {
      mismatches.push(`${key}: manifest unit=${entry.unit} but current_unit=${col.current_unit} expects ${expected}`);
    }
  }
  assert.deepEqual(mismatches, []);
});

test('mutation: a wrong manifest unit on a real overridden field is caught (proves the assertion can fail)', () => {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  const probe = JSON.parse(fs.readFileSync(AMOUNT_COLUMNS_PATH, 'utf8'));
  const overridden = probe.columns.filter((c) => c.current_unit);
  const target = overridden.find((c) => manifest.fields[`${c.table}.${c.col}`]);
  assert.ok(target, 'fixture assumption: at least one overridden column is a manifest field');

  const mutated = JSON.parse(JSON.stringify(manifest));
  const key = `${target.table}.${target.col}`;
  mutated.fields[key].unit = mutated.fields[key].unit === 'crore' ? 'rupee' : 'crore';

  const expected = currentUnitToManifestUnit(target.current_unit);
  assert.notEqual(mutated.fields[key].unit, expected, 'the mutation must actually disagree with the expected unit');
});
