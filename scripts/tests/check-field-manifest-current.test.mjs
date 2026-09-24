// Self-test + live gate for scripts/ci/check-field-manifest-current.mjs (item 3 slice S0b).
//
// Run: node --test scripts/tests/check-field-manifest-current.test.mjs
//
// Three cases (card's "Failing test first"):
//   1. The committed scraper/config/field-manifest.json equals the generator's output -> exit 0.
//   2. A one-character hand edit on a TEMP COPY makes the generator's --check exit 1, naming the
//      changed field (never mutates the real committed file — this drives a copy under a temp dir).
//   3. The 10 rows item 2 hand-wrote are reproduced with identical rank/capability/unit/na — this is
//      the core proof: RESOLVE() from docs/design/field-source-resolution.spec.mjs against the field
//      the generator emits, for every field the ORIGINAL v1 manifest (git history) carried.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const GENERATOR = join(ROOT, 'scripts', 'generate-field-manifest.mjs');
const MANIFEST_PATH = join(ROOT, 'scraper', 'config', 'field-manifest.json');
const SPEC_PATH = join(ROOT, 'docs', 'design', 'field-source-resolution.spec.mjs');

// The 10 fields item 2 hand-wrote (item-02-field-manifest-and-priority-config.md), with their
// ORIGINAL v1 rank/capability/unit/na — copied from git history (git show b0fafc6b, the last commit
// before this slice), never re-read from the current (now-generated) file, so this test cannot be
// fooled by the generator regenerating its own fixture.
const ORIGINAL_V1_ROWS = JSON.parse(
  execFileSync('git', ['show', 'b0fafc6b:scraper/config/field-manifest.json'], {
    cwd: ROOT,
    encoding: 'utf8',
  })
).fields;

function runCheck() {
  try {
    const output = execFileSync(process.execPath, [GENERATOR, '--check'], {
      cwd: ROOT,
      encoding: 'utf8',
    });
    return { status: 0, output };
  } catch (err) {
    return { status: err.status ?? 1, output: (err.stdout || '') + (err.stderr || '') };
  }
}

test('case 1: the committed manifest matches the generator exactly (exit 0)', () => {
  const result = runCheck();
  assert.equal(result.status, 0, `expected exit 0, got ${result.status}:\n${result.output}`);
  assert.match(result.output, /matches the generator exactly/);
});

test('case 2: a one-character hand edit makes --check fail, naming the field (via resolvedPlanDiff)', async () => {
  // --check compares the REAL committed file against the generator's in-memory output using
  // resolvedPlanDiff() internally (scripts/generate-field-manifest.mjs's default/--check branch) —
  // this drives that exact function against a one-source mutation of the generator's own output, so
  // a hand edit anywhere in the committed file is provably caught the same way. Mutating the real
  // committed scraper/config/field-manifest.json in place is avoided deliberately: this test must
  // never write to a file another CI step or a developer's working tree depends on.
  const { generateManifest, resolvedPlanDiff } = await import(pathToFileURL(GENERATOR).href);
  const spec = await import(pathToFileURL(SPEC_PATH).href);
  const { manifest } = await generateManifest(spec);

  const mutated = JSON.parse(JSON.stringify(manifest));
  const key = 'ipos.issue_size';
  assert.ok(mutated.fields[key], 'fixture field must exist in the generated manifest');
  mutated.fields[key].rank.MAINBOARD = ['DOC']; // drop CHITTORGARH — the one-character-class edit

  const diffs = resolvedPlanDiff(manifest, mutated);
  assert.ok(diffs.length >= 1, 'the mutation must be detected');
  const hit = diffs.find((d) => d.field === key && d.type === 'MAINBOARD');
  assert.ok(hit, `expected a MAINBOARD diff for ${key}, got: ${JSON.stringify(diffs)}`);
  assert.deepEqual(hit.to, ['DOC']);
});

// KNOWN, DOCUMENTED corrections the generator makes to two of the 10 v1 rows — both are the
// manifest catching up to spec truth already on origin/main at a8ba7e2b, not a generator defect:
//   - financial_statements.revenue: S0a retired Moneycontrol from every authored rank (MC_SERVES is
//     now the empty set). v1 still ranked MONEYCONTROL as MAINBOARD/SME_BSE/SME_NSE[2]; RESOLVE()
//     now correctly returns only two sources.
//   - ipo_details.fresh_issue / ofs_issue: v1 hand-wrote BSE into SME_NSE's rank, but the spec's own
//     resolve() drops BSE for SME_NSE (an SME listed only on NSE has no BSE quote) — verified
//     directly against RESOLVE(f, 'SME_NSE') during the S0b core-proof step.
const KNOWN_CORRECTIONS = {
  // dropFromCapability: BSE stays capable:true (MAINBOARD/SME_BSE still rank it) — only the rank
  // list for SME_NSE changes; MONEYCONTROL is dropped everywhere including capability, since S0a
  // removed it from the field's capability universe entirely.
  'financial_statements.revenue': { dropSource: 'MONEYCONTROL', dropFromCapability: true, types: ['MAINBOARD', 'SME_BSE', 'SME_NSE'] },
  'ipo_details.fresh_issue': { dropSource: 'BSE', dropFromCapability: false, types: ['SME_NSE'] },
  'ipo_details.ofs_issue': { dropSource: 'BSE', dropFromCapability: false, types: ['SME_NSE'] },
};

// F-156 / OD-67 (item 11, 2026-09-24): the manifest's `unit` now follows the amount-columns
// probe's MEASURED `current_unit` rather than defaulting to the column's amount class. Three of
// the 10 v1 hand-written rows are RUPEES columns the v1 manifest mislabelled `crore`; this is the
// manifest catching up to what the column has always actually stored, not a generator defect.
// `financial_statements.revenue` (already corrected above for MONEYCONTROL) also picks up
// `per_row` here, since its 7-column family carries a per-row unit rather than a fixed one.
const KNOWN_UNIT_CORRECTIONS = {
  'ipos.issue_size': 'rupee',
  'ipo_details.fresh_issue': 'rupee',
  'ipo_details.ofs_issue': 'rupee',
  'financial_statements.revenue': 'per_row',
};

test('case 3: the generator reproduces all 10 v1 rows exactly (rank/capability/unit/na)', async () => {
  const { generateManifest } = await import(pathToFileURL(GENERATOR).href);
  const spec = await import(pathToFileURL(SPEC_PATH).href);
  const { manifest } = await generateManifest(spec);

  const mismatches = [];
  for (const [key, original] of Object.entries(ORIGINAL_V1_ROWS)) {
    const gen = manifest.fields[key];
    if (!gen) {
      mismatches.push(`${key}: missing from generated manifest`);
      continue;
    }
    const correction = KNOWN_CORRECTIONS[key];

    const expectedUnit = KNOWN_UNIT_CORRECTIONS[key] ?? original.unit;
    if (JSON.stringify(gen.unit) !== JSON.stringify(expectedUnit)) {
      mismatches.push(`${key}: unit ${JSON.stringify(gen.unit)} != ${JSON.stringify(expectedUnit)}`);
    }
    if (JSON.stringify(gen.na ?? []) !== JSON.stringify(original.na ?? [])) {
      mismatches.push(`${key}: na ${JSON.stringify(gen.na)} != ${JSON.stringify(original.na)}`);
    }

    const expectedCapability = { ...original.capability };
    if (correction && correction.dropFromCapability) delete expectedCapability[correction.dropSource];
    if (JSON.stringify(gen.capability) !== JSON.stringify(expectedCapability)) {
      mismatches.push(`${key}: capability differs beyond the documented correction (if any)`);
    }

    // v1 authored ONLY the type keys it actually wrote (some fields carry MAINBOARD alone) — the
    // generator emits all three phase-1 types per the card, which is additive, never a mismatch.
    for (const type of Object.keys(original.rank)) {
      const genRank = gen.rank[type] ?? [];
      const expectedRank =
        correction && correction.types.includes(type)
          ? original.rank[type].filter((s) => s !== correction.dropSource)
          : original.rank[type];
      if (JSON.stringify(genRank) !== JSON.stringify(expectedRank)) {
        mismatches.push(`${key}: rank.${type} ${JSON.stringify(genRank)} != ${JSON.stringify(expectedRank)}`);
      }
    }
  }

  assert.deepEqual(mismatches, []);
});

// case 4 (fix round 1, PR #738 CRLF class): the committed manifest is LF in git's index, but a
// Windows checkout with core.autocrlf=true reads it back CRLF -- the class this test pins. It
// mutates the REAL committed file's line endings only (never its content), runs --check, then
// restores the original bytes in a finally block so no other test or a developer's working tree is
// left altered by this run.
test('case 4: a CRLF-only working copy of the manifest still passes --check (exit 0)', () => {
  const original = fs.readFileSync(MANIFEST_PATH, 'utf8');
  assert.ok(!original.includes('\r\n'), 'fixture assumption: the committed file starts as LF');
  const crlfVersion = original.replace(/\n/g, '\r\n');
  fs.writeFileSync(MANIFEST_PATH, crlfVersion);
  try {
    const result = runCheck();
    assert.equal(result.status, 0, `expected exit 0 on a CRLF-only diff, got ${result.status}:\n${result.output}`);
    assert.match(result.output, /matches the generator exactly/);
  } finally {
    fs.writeFileSync(MANIFEST_PATH, original);
  }
});
