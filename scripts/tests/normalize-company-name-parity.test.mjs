// T-518: scripts/lib/normalize-company-name.mjs is a hand copy of the SSOT
// (packages/shared/src/utils/company-name-normalizer.ts) — same reason and
// pattern as scripts/tests/generate-ipo-slug-parity.test.mjs. This test
// imports the copy AND the SSOT itself (unmodified) via Node's erasable
// TypeScript type-stripping (stable on Node 22.10+, default on 22.20.0 —
// verified in this worktree) and asserts identical output on a real name set.
// On an older Node the SSOT import throws and the comparison tests SKIP
// (never silently pass) — the first test below still asserts the load itself.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { normalizeCompanyNameForMatching as copyNormalize } from '../lib/normalize-company-name.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ssotPath = join(__dirname, '..', '..', 'packages', 'shared', 'src', 'utils', 'company-name-normalizer.ts');

let ssotNormalize = null;
let ssotLoadError = null;
try {
  const mod = await import(pathToFileURL(ssotPath).href);
  ssotNormalize = mod.normalizeCompanyNameForMatching;
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

test('normalize-company-name.mjs copy matches the SSOT on real company names', (t) => {
  if (!ssotNormalize) return t.skip('SSOT not importable in this runtime — see the preceding load test');
  const mismatches = [];
  for (const name of REAL_NAMES) {
    const fromCopy = copyNormalize(name);
    const fromSsot = ssotNormalize(name);
    if (fromCopy !== fromSsot) mismatches.push(`"${name}": copy="${fromCopy}" ssot="${fromSsot}"`);
  }
  assert.deepEqual(mismatches, [], `normalize drift between the copy and the SSOT:\n${mismatches.join('\n')}`);
});

test('normalize-company-name.mjs handles empty/null input', () => {
  assert.equal(copyNormalize(''), '');
  assert.equal(copyNormalize(null), '');
  assert.equal(copyNormalize(undefined), '');
});
