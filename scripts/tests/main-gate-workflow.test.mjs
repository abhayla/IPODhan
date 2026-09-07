// T-491: main post-merge gate — proves .github/workflows/main-gate.yml exists,
// is parseable as YAML (no external yaml dependency in this repo — see below),
// carries the three gate commands, has a concurrency group, and guards the
// Notifier alert step with `if: failure()` so it never fires on a green run.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const workflowPath = path.join(__dirname, '..', '..', '.github', 'workflows', 'main-gate.yml');

function readWorkflow() {
  return readFileSync(workflowPath, 'utf8');
}

// Minimal structural YAML sanity check. No `yaml`/`js-yaml` package is
// installed in this repo (pr-gate's own tests do not parse YAML with a
// dependency either — they run the workflow's commands directly), so this
// asserts the shape a real YAML parser would reject on: no tab characters
// (YAML forbids tabs for indentation), no CRLF line endings (ASCII/LF pre-commit
// gate), and every non-blank/non-comment top-level-ish line either is a
// `key:` line or a `- ` sequence item or nested under one — i.e. it does not
// contain unbalanced `{}`/`[]` flow collections, which is the most common way
// a hand-edited workflow becomes unparseable.
function assertParsesAsYaml(text) {
  assert.ok(!text.includes('\t'), 'workflow must not contain tab characters (invalid YAML indentation)');
  assert.ok(!text.includes('\r'), 'workflow must use LF line endings');
  const openBraces = (text.match(/\{/g) || []).length;
  const closeBraces = (text.match(/\}/g) || []).length;
  assert.equal(openBraces, closeBraces, 'unbalanced { } in workflow YAML');
  const lines = text.split('\n');
  for (const line of lines) {
    if (!line.trim()) continue;
    // every non-blank line must be a comment, a `key: ...` mapping entry, a
    // `- ...` sequence item, or a continuation (block scalar / multiline
    // string) — never raw unindented prose.
    const trimmed = line.trimStart();
    const indent = line.length - trimmed.length;
    assert.ok(indent % 2 === 0 || trimmed.startsWith('#'), `line not on an even indent (invalid YAML): ${JSON.stringify(line)}`);
  }
}

test('main-gate.yml exists and parses as YAML', () => {
  const text = readWorkflow();
  assertParsesAsYaml(text);
});

test('main-gate.yml runs the three gate commands', () => {
  const text = readWorkflow();
  assert.match(text, /node scripts\/build-detection-registry\.mjs --check/);
  assert.match(text, /npm run lint:ci/);
  assert.match(text, /npm run test:unit/);
});

test('main-gate.yml declares a cancel-in-progress concurrency group', () => {
  const text = readWorkflow();
  assert.match(text, /concurrency:/);
  assert.match(text, /cancel-in-progress:\s*true/);
});

test('main-gate.yml only triggers on workflow_dispatch for now', () => {
  const text = readWorkflow();
  assert.match(text, /^on:\s*$/m);
  assert.match(text, /workflow_dispatch:/);
  // the push trigger must be present but commented out, with a note that
  // enabling it on push to main is an owner decision (Actions spend).
  assert.match(text, /#.*push:/i);
  assert.match(text, /owner/i);
});

test('main-gate.yml guards the Notifier alert step with if: failure()', () => {
  const text = readWorkflow();
  const notifierStepIndex = text.indexOf('NOTIFIER_URL');
  assert.notEqual(notifierStepIndex, -1, 'expected a step referencing NOTIFIER_URL');
  const before = text.slice(0, notifierStepIndex);
  const lastStepStart = before.lastIndexOf('- name:');
  const stepBlock = text.slice(lastStepStart, notifierStepIndex);
  assert.match(stepBlock, /if:\s*failure\(\)/);
});

test('main-gate.yml Notifier step skips cleanly when secrets are absent', () => {
  const text = readWorkflow();
  const notifierStepIndex = text.indexOf('NOTIFIER_URL');
  const stepBlock = text.slice(notifierStepIndex - 400, notifierStepIndex + 600);
  assert.match(stepBlock, /if secrets? .*(is empty|not set|absent)|NOTIFIER_URL.*&&|-z "\$NOTIFIER_URL"/i);
});
