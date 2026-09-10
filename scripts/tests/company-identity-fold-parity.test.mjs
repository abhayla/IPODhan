// Item 12 slice A. `scripts/lib/repair-invariants/duplicate-ipo-rows.mjs` keeps
// its own hand copy of the company-identity fold as `foldName`, because it is a
// plain-node script that cannot import TypeScript. Same reason and pattern as
// scripts/tests/normalize-company-name-parity.test.mjs (T-518).
//
// This test imports the copy AND the TypeScript SSOT (via Node's erasable
// type-stripping, stable on 22.10+, default on 22.20.0) and asserts identical
// output over the shared fixture. On an older Node the SSOT import throws and
// the comparison FAILS LOUD rather than skipping — a parity test that silently
// skips is worse than no parity test, because it reads as coverage.
//
// WHY THIS MATTERS BEYOND TIDINESS: two names folding equal are treated as the
// same company by the duplicate-row repair class, which DELETES a row. A drift
// between these two implementations means the report and the repair disagree
// about what they are about to delete.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { foldName as copyFold } from '../lib/repair-invariants/duplicate-ipo-rows.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ssotPath = join(__dirname, '..', '..', 'packages', 'shared', 'src', 'utils', 'company-identity-fold.ts');

let ssotFold = null;
let ssotFixture = null;
let ssotLoadError = null;
try {
  const mod = await import(pathToFileURL(ssotPath).href);
  ssotFold = mod.foldCompanyIdentity;
  ssotFixture = mod.IDENTITY_FOLD_FIXTURE;
} catch (e) {
  ssotLoadError = e;
}

test('SSOT (company-identity-fold.ts) loads via type-stripping — fails loud, never skips', () => {
  assert.equal(
    ssotLoadError,
    null,
    `could not import the SSOT directly — Node too old for erasable-TS import. Error: ${ssotLoadError?.message}`,
  );
  assert.equal(typeof ssotFold, 'function');
  assert.ok(Array.isArray(ssotFixture), 'IDENTITY_FOLD_FIXTURE must be exported as an array');
  assert.ok(ssotFixture.length >= 20, `fixture must carry >= 20 names, got ${ssotFixture.length}`);
});

test('the .mjs copy and the TypeScript SSOT fold every fixture name IDENTICALLY', () => {
  const divergences = [];
  for (const name of ssotFixture) {
    const ts = ssotFold(name);
    const mjs = copyFold(name);
    if (ts !== mjs) divergences.push(`"${name}" -> TS="${ts}"  MJS="${mjs}"`);
  }
  assert.deepEqual(divergences, [], `fold divergences between the TS SSOT and the .mjs copy:\n${divergences.join('\n')}`);
});

test('both implementations agree on the null/empty edge cases', () => {
  for (const input of [null, undefined, '', '   ', '.,()&\'"-']) {
    assert.equal(ssotFold(input), copyFold(input), `disagreement on ${JSON.stringify(input)}`);
  }
});

test('both agree that the ARCIL pair is ONE company and Sun/Sunrise are TWO', () => {
  const arcilA = 'ASSET RECONSTRUCTION COMPANY (INDIA) LIMITED';
  const arcilB = 'Asset Reconstruction Co.(India) Ltd.';
  assert.equal(ssotFold(arcilA), ssotFold(arcilB), 'TS: ARCIL pair must fold equal');
  assert.equal(copyFold(arcilA), copyFold(arcilB), 'MJS: ARCIL pair must fold equal');
  assert.notEqual(
    ssotFold('Sun Pharmaceutical Industries Ltd'),
    ssotFold('Sunrise Pharmaceutical Industries Ltd'),
    'TS: Sun and Sunrise are different companies and must not fold together',
  );
  assert.notEqual(
    copyFold('Sun Pharmaceutical Industries Ltd'),
    copyFold('Sunrise Pharmaceutical Industries Ltd'),
    'MJS: Sun and Sunrise are different companies and must not fold together',
  );
});
