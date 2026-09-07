// T-461 round 2: scripts/lib/generate-ipo-slug.mjs is a hand copy of the SSOT
// (packages/shared/src/utils/slug.ts) — this repo's audit scripts run with
// plain `node scripts/*.mjs`, no build step, no node_modules in a fresh
// worktree, so importing the compiled @ipodhan/shared package is not always
// available (packages/shared/dist does not exist until `cd packages/shared
// && npx tsc` runs, which needs `typescript` installed). Node's stable
// `.mjs` loader also cannot import a `.ts` file directly without a loader.
//
// Given that, this test is the parity guard: it imports the copy AND the
// SSOT ITSELF (packages/shared/src/utils/slug.ts, unmodified, no re-typing)
// directly — Node (v22.10+, and v22.20.0 by default with no flag needed,
// verified 2026-09-07) strips its erasable TypeScript syntax (an
// `interface` and typed params/returns only, no enums/namespaces) on
// import. On an older Node without type-stripping, the import throws; the
// tests below then SKIP (not silently pass) rather than fail the whole
// suite on a runtime gap unrelated to the code under test — but the first
// test below still asserts the load itself succeeded, so that gap is never
// invisible in the run's output.
// 20 real company names pulled from the chittorgarh dashboard fixture /
// live captures this task used (2026-09-07) — ampersands, "(India)"/"(Mom's
// Belief)" parentheticals, and Ltd./Limited/Pvt Ltd/Private Limited suffix
// variants all included, because those are exactly the transforms most
// likely to drift silently.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { generateIPOSlug as copySlug } from '../lib/generate-ipo-slug.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ssotPath = join(__dirname, '..', '..', 'packages', 'shared', 'src', 'utils', 'slug.ts');

let ssotSlug = null;
let ssotLoadError = null;
try {
  const mod = await import(pathToFileURL(ssotPath).href);
  ssotSlug = mod.generateIPOSlug;
} catch (e) {
  ssotLoadError = e;
}

test('SSOT (slug.ts) loaded via --experimental-strip-types (fails loud, not silent, if the runtime cannot import it)', () => {
  assert.equal(
    ssotLoadError,
    null,
    `could not import the SSOT directly — run with \`node --experimental-strip-types\`, or Node version too old. Error: ${ssotLoadError?.message}`
  );
  assert.equal(typeof ssotSlug, 'function');
});

const REAL_NAMES = [
  'Karamtara Engineering',
  'Mopshop Distribution',
  'Prasol Chemicals Ltd.',
  'Sumax Engineering Ltd.',
  'Manipal Payment & Identity Solutions (Manipal Cards)',
  'Asset Reconstruction Co.(India)',
  'Glass Wall Systems (India)',
  "Rays of Belief (Mom's Belief)",
  'Veegaland Developers Ltd',
  'Kanohar Electricals Limited',
  'LCC Projects Pvt Ltd',
  'ESDS Software Solution Private Limited',
  'Purple Style Labs (Pernia\'s Pop-Up Studio)',
  'National Stock Exchange of India (NSE)',
  'Maharaja & Speedex India',
  'Complete Sports & Management India',
  'Fly-Hi Maritime Travels',
  "Deepa Jewellers",
  'Rentomojo',
  'Vinod Texworld',
];

test('generate-ipo-slug.mjs copy matches the SSOT (packages/shared/src/utils/slug.ts) on 20 real company names', (t) => {
  if (!ssotSlug) return t.skip('SSOT not importable in this runtime — see the preceding load test');
  const mismatches = [];
  for (const name of REAL_NAMES) {
    const fromCopy = copySlug(name);
    const fromSsot = ssotSlug(name, {});
    if (fromCopy !== fromSsot) mismatches.push(`"${name}": copy="${fromCopy}" ssot="${fromSsot}"`);
  }
  assert.deepEqual(mismatches, [], `slug drift between the copy and the SSOT:\n${mismatches.join('\n')}`);
});

test('generate-ipo-slug.mjs copy matches the SSOT with suffix/maxLength options', (t) => {
  if (!ssotSlug) return t.skip('SSOT not importable in this runtime — see the preceding load test');
  assert.equal(copySlug('Test Co Ltd', { suffix: '-ipo' }), ssotSlug('Test Co Ltd', { suffix: '-ipo' }));
  assert.equal(copySlug('A Very Long Company Name Private Limited', { maxLength: 20 }), ssotSlug('A Very Long Company Name Private Limited', { maxLength: 20 }));
});
