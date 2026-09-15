// Item 12 slice G. `scripts/lib/repair-invariants/duplicate-ipo-rows.mjs` keeps its own literal
// copy of OPEN_DATE_TOLERANCE_DAYS, because it is a plain-node script that cannot import
// TypeScript. Same reason and pattern as scripts/tests/company-identity-fold-parity.test.mjs.
//
// This test imports the copy AND the TypeScript SSOT (via Node's erasable type-stripping, stable
// on 22.10+, default on 22.20.0) and asserts the two numbers are identical. On an older Node the
// SSOT import throws and the comparison FAILS LOUD rather than skipping — a parity test that
// silently skips is worse than no parity test, because it reads as coverage.
//
// WHY THIS MATTERS BEYOND TIDINESS: `checkMergeEligibility` (the merge tool's refusal gate) and
// the duplicate-ipo-rows invariant (the audit that REPORTS a pair as a duplicate) must agree on
// how many days apart two open_dates may be and still be "the same IPO twice" — otherwise the
// invariant reports a pair the tool then refuses to act on, or the tool merges a pair the
// invariant would not have grouped.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ssotPath = join(__dirname, '..', '..', 'packages', 'shared', 'src', 'utils', 'company-identity-fold.ts');
const copyPath = join(__dirname, '..', 'lib', 'repair-invariants', 'duplicate-ipo-rows.mjs');

// Hand-read the .mjs literal (it is a plain `const`, not exported) so this test does not need to
// change the .mjs's public surface just to compare a number.
const copySource = readSourceLiteral(copyPath);

function readSourceLiteral(path) {
  const text = readFileSync(path, 'utf8');
  const m = text.match(/const OPEN_DATE_TOLERANCE_DAYS\s*=\s*(\d+)\s*;/);
  if (!m) throw new Error(`OPEN_DATE_TOLERANCE_DAYS literal not found in ${path}`);
  return Number(m[1]);
}

let ssotValue = null;
let ssotLoadError = null;
try {
  const mod = await import(pathToFileURL(ssotPath).href);
  ssotValue = mod.OPEN_DATE_TOLERANCE_DAYS;
} catch (e) {
  ssotLoadError = e;
}

test('SSOT (company-identity-fold.ts) loads via type-stripping — fails loud, never skips', () => {
  assert.equal(
    ssotLoadError,
    null,
    `could not import the SSOT directly — Node too old for erasable-TS import. Error: ${ssotLoadError?.message}`,
  );
  assert.equal(typeof ssotValue, 'number');
});

test('the .mjs literal and the TypeScript SSOT export the SAME OPEN_DATE_TOLERANCE_DAYS', () => {
  assert.equal(
    copySource,
    ssotValue,
    `tolerance drift: .mjs copy=${copySource}, TS SSOT=${ssotValue} — re-measure per the SSOT's comment before changing either`,
  );
});
