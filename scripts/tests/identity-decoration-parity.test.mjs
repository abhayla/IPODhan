// OD-68: the rule that strips page-status suffixes and page-title text before an identity match
// lives in packages/shared/src/utils/identity-decoration.ts (used by resolveIpoRow and the
// create-time hold). The nightly check i_same_ipo_two_rows keeps a plain-JS twin in
// scripts/lib/detection-floor-checks.mjs, because a plain-node script cannot import TypeScript on
// the VPS. This test imports BOTH (the TS through Node's erasable type-stripping — same pattern as
// duplicate-ipo-merge-tolerance-parity.test.mjs) and fails on any divergence, so the matcher and
// the check that audits it cannot drift. On a Node too old to type-strip, the import fails LOUD.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import * as twin from '../lib/detection-floor-checks.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ssotPath = join(__dirname, '..', '..', 'packages', 'shared', 'src', 'utils', 'identity-decoration.ts');

let ssot = null;
let loadError = null;
try {
  ssot = await import(pathToFileURL(ssotPath).href);
} catch (e) {
  loadError = e;
}

// Real names from ipodhan_staging / production (2026-09-23) plus the spec's S1/S3/S6 cases.
const NAMES = [
  'Rays of Belief Limited- For Profit Social Enterprise',
  'Rays of Belief Ltd. O',
  'Rays of Belief Ltd.',
  'Rays of Belief Limited',
  'G.V.Electricals Ltd.',
  'G.V. Electricals Ltd. O',
  'Himalayan Solar Ltd.',
  'Himalaya Nutravedics India Ltd.',
  'Technocraft Ventures Ltd.',
  'Technocrats Plasma Systems Ltd.',
  "Purple Style Labs Ltd - Pernia's Pop-Up Studio IPO",
  'National Stock Exchange of India Ltd (NSE IPO)',
  'Asset Reconstruction Co.(India) Ltd.',
  'ASSET RECONSTRUCTION COMPANY (INDIA) LIMITED',
  'Indo-MIM Ltd',
  'Twinkle Papers IPO',
  'Shree Balaji (Mala) Textiles Ltd. LT',
  'H.R. Hygiene Ltd. CT',
  'Some Company Ltd. P',
  '',
];
const SLUGS = ['rays-of-belief-ltd-o', 'rays-of-belief-ltd', 'x-ltd-lt', 'x-ltd-ct', 'x-ltd-p', 'acme-ofs-2026', 'acme-ofs-unknown', 'co', ''];

test('the TS SSOT loads via type-stripping (fails loud, never skips)', () => {
  assert.equal(loadError, null, `could not import ${ssotPath}: ${loadError?.message}`);
});

for (const fn of ['stripIdentityNameDecoration', 'normalizeIdentityCompanyName']) {
  test(`${fn}: the .mjs twin and the TS SSOT agree on every real name`, () => {
    for (const name of NAMES) {
      assert.equal(twin[fn](name), ssot[fn](name), `${fn}(${JSON.stringify(name)}) diverged`);
    }
  });
}

test('stripIdentitySlugSuffix: the .mjs twin and the TS SSOT agree on every slug', () => {
  for (const slug of SLUGS) {
    assert.equal(twin.stripIdentitySlugSuffix(slug), ssot.stripIdentitySlugSuffix(slug), `slug ${slug} diverged`);
  }
});

test('the S1 and S6 verdicts hold in both copies', () => {
  for (const impl of [twin, ssot]) {
    assert.equal(impl.normalizeIdentityCompanyName('Rays of Belief Ltd. O'), impl.normalizeIdentityCompanyName('Rays of Belief Limited- For Profit Social Enterprise'));
    assert.notEqual(impl.normalizeIdentityCompanyName('Himalayan Solar Ltd.'), impl.normalizeIdentityCompanyName('Himalaya Nutravedics India Ltd.'));
    assert.notEqual(impl.normalizeIdentityCompanyName('Technocraft Ventures Ltd.'), impl.normalizeIdentityCompanyName('Technocrats Plasma Systems Ltd.'));
  }
});
