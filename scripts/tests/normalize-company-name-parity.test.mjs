// T-518: scripts/lib/normalize-company-name.mjs is a hand copy of the SSOT
// (packages/shared/src/utils/company-name-normalizer.ts) — same reason and
// pattern as scripts/tests/generate-ipo-slug-parity.test.mjs. This test
// imports the copy AND the SSOT itself (unmodified) via Node's erasable
// TypeScript type-stripping (stable on Node 22.10+, default on 22.20.0 —
// verified in this worktree) and asserts identical output on a real name set.
// On an older Node the SSOT import throws and the comparison tests SKIP
// (never silently pass) — the first test below still asserts the load itself.
//
// GUARD, not a sample (owner finding, 2026-09-11): a probe of 5 names outside
// this file's original 12-name REAL_NAMES fixture found two live divergences
// ("ABC (India) Ltd" and "Hy-Tech Engineers Limited" — hyphens were not
// folded and a trailing "(India)" paren was not stripped in the copy) that
// this test had never caught, because REAL_NAMES happened to contain no
// hyphenated name and no "(India)" suffix. RULE_CASES below adds one input
// PER TRANSFORMATION RULE the SSOT applies, each chosen so that rule firing
// is the reason copy output would diverge from SSOT output if that rule were
// missing from the copy — proven by scripts/tests/mutation-log.md-style
// one-rule-at-a-time deletion (see the fix commit), not by inspection alone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import {
  normalizeCompanyNameForMatching as copyNormalize,
  rowKeyForName as copyRowKeyForName,
  JUNK_NAME_KEY_PREFIX as copyJunkPrefix,
} from '../lib/normalize-company-name.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ssotPath = join(__dirname, '..', '..', 'packages', 'shared', 'src', 'utils', 'company-name-normalizer.ts');

let ssotNormalize = null;
let ssotRowKeyForName = null;
let ssotJunkPrefix = null;
let ssotLoadError = null;
try {
  const mod = await import(pathToFileURL(ssotPath).href);
  ssotNormalize = mod.normalizeCompanyNameForMatching;
  ssotRowKeyForName = mod.rowKeyForName;
  ssotJunkPrefix = mod.JUNK_NAME_KEY_PREFIX;
} catch (e) {
  ssotLoadError = e;
}

test('SSOT (company-name-normalizer.ts) loaded via type-stripping (fails loud, not silent, if the runtime cannot import it)', () => {
  assert.equal(
    ssotLoadError,
    null,
    `could not import the SSOT directly — Node version too old for erasable-TS import. Error: ${ssotLoadError?.message}`
  );
  assert.equal(typeof ssotNormalize, 'function');
  assert.equal(typeof ssotRowKeyForName, 'function');
  assert.equal(typeof ssotJunkPrefix, 'string');
});

const REAL_NAMES = [
  'Vikran Engineering Ltd',
  'Neochem Bio Ventures Limited',
  'Ather Energy',
  'ESDS Software Solution Limited',
  'Modern Diagnostic Restore Ltd.',
  'Deepa Jewellers Ltd.',
  'SMC Global Securities Limited',
  'MIDWEST GOLD LIMITED',
  'SUNSHIELD CHEMICALS LTD',
  'Manipal Payment & Identity Solutions (Manipal Cards)',
  "Rays of Belief (Mom's Belief)",
  'Kanohar Electricals Limited',
];

// The two owner-reproduced divergences, verbatim, plus the punctuation-only
// junk shapes the row-key coverage check's tests already rely on. These are
// covered by RULE_CASES below too (rule 6/11 and rule 7 respectively), kept
// here ALSO as a standalone regression pin quoting the owner's own report.
const DIVERGING_SHAPES_FROM_OWNER_REPORT = [
  'ABC (India) Ltd',
  'Hy-Tech Engineers Limited',
  '----',
  '(())',
];

// One case per numbered RULE comment in both normalizeCompanyNameForMatching
// copies — chosen so that rule NOT firing (rule deleted from the copy, SSOT
// left untouched) changes the copy's output relative to the SSOT's for that
// name. Tag numbers match the `// RULE <n>:` comments in
// scripts/lib/normalize-company-name.mjs — keep them in lock-step when a
// rule is added there.
const RULE_CASES = [
  { rule: 1, name: 'Bright Metals Ltd XY' }, // trailing 1-2 letter code directly after Ltd/Limited, NOT one of rule 2's known codes (o/p/lt/ct) — isolates rule 1 from rule 2
  { rule: 2, name: 'Crystal Foods Ltd. (Crystal IPO) O' }, // trailing code after a paren block
  { rule: 3, name: 'Sun.Moon Traders Limited' }, // mid-name period, not a corp-suffix abbreviation
  { rule: 4, name: 'Sun & Moon Traders Limited' }, // "&" -> " and "
  { rule: 5, name: 'Bright Metals Ltd. (Bright Metals IPO)' }, // whole trailing paren block dropped
  { rule: 6, name: 'ABC (India) Ltd' }, // mid-string paren folded to space, not dropped whole
  { rule: 7, name: 'Hy-Tech Engineers Limited' }, // hyphen folded to space
  { rule: 8, name: 'Bright Metals Limited IPO' }, // trailing " ipo" stripped before the corp-word strip
  { rule: 9, name: 'Bright Metals Limited FPO' }, // trailing " fpo" stripped before the corp-word strip
  { rule: 10, name: 'Vikran Engineering Ltd' }, // whole-word corporate-form strip
  { rule: 11, name: 'Jindal Supreme (India) Ltd.' }, // trailing "india"/"indian" token stripped
];

// Not a rule-isolation case — a correctness pin for RULE 11's negative
// lookbehind guard ("of"/"for" immediately before "india"/"indian" blocks
// the strip, so "Bank of India" keeps its identity). Included in the
// compared set below but not in RULE_CASES since deleting rule 11 entirely
// does not change this particular name's output either way.
const GUARD_CASES = ['Bank of India', 'Indian Railway Finance Corporation', 'East India Drums Limited'];

const ALL_NAMES = [
  ...REAL_NAMES,
  ...DIVERGING_SHAPES_FROM_OWNER_REPORT,
  ...RULE_CASES.map((c) => c.name),
  ...GUARD_CASES,
];

test('normalize-company-name.mjs copy matches the SSOT on every fixture name (real names, owner-reported divergences, one case per transformation rule, and the india/indian guard)', (t) => {
  if (!ssotNormalize) return t.skip('SSOT not importable in this runtime — see the preceding load test');
  const mismatches = [];
  for (const name of ALL_NAMES) {
    const fromCopy = copyNormalize(name);
    const fromSsot = ssotNormalize(name);
    if (fromCopy !== fromSsot) mismatches.push(`"${name}": copy="${fromCopy}" ssot="${fromSsot}"`);
  }
  assert.deepEqual(mismatches, [], `normalize drift between the copy and the SSOT:\n${mismatches.join('\n')}`);
});

test('each RULE_CASES name actually exercises its rule (SSOT output is non-trivially transformed, not just lowercased/trimmed)', () => {
  for (const { rule, name } of RULE_CASES) {
    if (!ssotNormalize) break;
    const out = ssotNormalize(name);
    const trivial = name.toLowerCase().trim();
    assert.notEqual(out, trivial, `rule ${rule} case "${name}" does not appear to fire — SSOT output "${out}" is just lowercase/trim`);
  }
});

test('normalize-company-name.mjs handles empty/null input', () => {
  assert.equal(copyNormalize(''), '');
  assert.equal(copyNormalize(null), '');
  assert.equal(copyNormalize(undefined), '');
});

// ---- rowKeyForName parity (T-518 owner directive: "extend it to
// rowKeyForName as well, since that is now also copied") -------------------

const ROW_KEY_NAMES = [...ALL_NAMES, null, undefined, '', '   ', 'N/A'];

test('rowKeyForName copy matches the SSOT on every fixture name plus null/empty/whitespace/junk', (t) => {
  if (!ssotRowKeyForName) return t.skip('SSOT not importable in this runtime — see the preceding load test');
  const mismatches = [];
  for (const name of ROW_KEY_NAMES) {
    const fromCopy = copyRowKeyForName(name);
    const fromSsot = ssotRowKeyForName(name);
    if (fromCopy !== fromSsot) mismatches.push(`${JSON.stringify(name)}: copy=${JSON.stringify(fromCopy)} ssot=${JSON.stringify(fromSsot)}`);
  }
  assert.deepEqual(mismatches, [], `rowKeyForName drift between the copy and the SSOT:\n${mismatches.join('\n')}`);
});

test('JUNK_NAME_KEY_PREFIX copy matches the SSOT', () => {
  if (!ssotJunkPrefix) return;
  assert.equal(copyJunkPrefix, ssotJunkPrefix);
});
