// #504 + #81 (same class, one PR): a CI step or a Playwright config that boots
// an app / runs E2E specs without a database produces failures that are not
// evidence of a code bug, and passes that are not evidence of a working
// feature. This test asserts the SHAPE that prevents that, on the real files.
//
// #504: `.github/workflows/ci.yml`'s "Run E2E tests" step must set
// DATABASE_URL (like the sibling "Run integration tests" step does), because
// `web/playwright.config.ts`'s webServer boots `npm run dev` and inherits the
// step's env.
//
// #81: `web/playwright.config.ts` must not boot a local dev server for the
// production-verification run — it must skip `webServer` whenever
// PROD_BASE_URL is set. (Already fixed by 840a9f99 / #102 / W-164; this test
// pins that shape so it cannot regress silently.)
//
// Run: node --test scripts/tests/e2e-env-shape.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CI_YML = join(ROOT, '.github', 'workflows', 'ci.yml');
const PLAYWRIGHT_CONFIG = join(ROOT, 'web', 'playwright.config.ts');

function readText(path) {
  return readFileSync(path, 'utf8');
}

/**
 * Extract the block of a named step from a GitHub Actions job's step list,
 * by slicing from the step's `- name: <name>` line to the next `- name:` (or
 * EOF). Deliberately simple (line-based), matching this repo's existing
 * workflow tests — a real YAML parser is unnecessary for one field's shape
 * and would need a devDependency this repo does not carry for CI scripts.
 */
export function extractStepBlock(ymlText, stepName) {
  const lines = ymlText.split('\n');
  const startIdx = lines.findIndex((l) => l.trim() === `- name: ${stepName}`);
  if (startIdx === -1) return null;
  const stepIndent = lines[startIdx].match(/^(\s*)/)[1].length;
  let endIdx = lines.length;
  for (let i = startIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === '') continue;
    const indent = line.match(/^(\s*)/)[1].length;
    // A new step at the SAME indent as `- name:` ends this step's block.
    if (indent <= stepIndent && line.trim().startsWith('- name:')) {
      endIdx = i;
      break;
    }
    // Dropping below the step's own indent (e.g. back to the `steps:` key or
    // a following job) also ends it.
    if (indent < stepIndent && line.trim() !== '') {
      endIdx = i;
      break;
    }
  }
  return lines.slice(startIdx, endIdx).join('\n');
}

test('extractStepBlock finds the named step and stops at the next one (self-test)', () => {
  const fixture = [
    '      - name: Step A',
    '        run: echo a',
    '        env:',
    '          FOO: bar',
    '      - name: Step B',
    '        run: echo b',
  ].join('\n');
  const block = extractStepBlock(fixture, 'Step A');
  assert.match(block, /echo a/);
  assert.match(block, /FOO: bar/);
  assert.doesNotMatch(block, /echo b/);
});

test('extractStepBlock returns null for a step that does not exist', () => {
  assert.equal(extractStepBlock('- name: Only Step\n  run: echo\n', 'Missing Step'), null);
});

// ---- #504: the real ci.yml E2E step must carry DATABASE_URL ----

test('#504: ci.yml "Run E2E tests" step sets DATABASE_URL', () => {
  const ymlText = readText(CI_YML);
  const block = extractStepBlock(ymlText, 'Run E2E tests');
  assert.ok(block, 'ci.yml must contain a step named "Run E2E tests"');
  assert.match(
    block,
    /DATABASE_URL:\s*\S+/,
    'the E2E step must set DATABASE_URL — playwright.config.ts\'s webServer ' +
      'boots `npm run dev` inheriting this step\'s env, and a missing ' +
      'DATABASE_URL makes every pass and every failure untrustworthy (#504)'
  );
});

test('#504: the E2E step DATABASE_URL matches the integration step\'s (same test DB)', () => {
  const ymlText = readText(CI_YML);
  const integrationBlock = extractStepBlock(ymlText, 'Run integration tests');
  const e2eBlock = extractStepBlock(ymlText, 'Run E2E tests');
  assert.ok(integrationBlock, 'sibling "Run integration tests" step must exist to compare against');
  const dbUrlOf = (block) => block.match(/DATABASE_URL:\s*(\S+)/)?.[1];
  const integrationDbUrl = dbUrlOf(integrationBlock);
  const e2eDbUrl = dbUrlOf(e2eBlock);
  assert.ok(integrationDbUrl, 'integration step must itself set DATABASE_URL (regression guard)');
  assert.equal(
    e2eDbUrl,
    integrationDbUrl,
    'E2E and integration steps must point at the same test database'
  );
});

// ---- #81: playwright.config.ts must not boot webServer for prod-verify ----

test('#81: playwright.config.ts skips webServer when PROD_BASE_URL is set', () => {
  const configText = readText(PLAYWRIGHT_CONFIG);
  const webServerMatch = configText.match(/webServer:\s*([\s\S]*?)\n\s*\}\)/);
  assert.ok(webServerMatch, 'playwright.config.ts must define webServer');
  assert.match(
    webServerMatch[1],
    /process\.env\.PROD_BASE_URL\s*\?\s*undefined/,
    'webServer must be gated off (undefined) when PROD_BASE_URL is set, or ' +
      'the prod-verify sweep boots a local `npm run dev` with no database ' +
      'and reports its own DB errors as live-site console errors (#81)'
  );
});

test('#81: the production-verification spec targets an absolute PROD_BASE_URL, not the relative baseURL', () => {
  const specPath = join(ROOT, 'web', 'tests', 'e2e', 'production-verification.spec.ts');
  const specText = readText(specPath);
  assert.match(
    specText,
    /PROD_BASE_URL/,
    'the prod-verify spec must key off PROD_BASE_URL directly (it does not rely on ' +
      'the shared, hardcoded localhost baseURL) — this is what makes the ' +
      'webServer gate in playwright.config.ts sufficient rather than also ' +
      'needing a conditional baseURL'
  );
});
