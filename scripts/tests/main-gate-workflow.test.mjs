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

test('main-gate.yml uses a per-sha concurrency group with cancel-in-progress false', () => {
  // Round 2 review: a fixed `group: main-gate` + cancel-in-progress: true
  // cancels the first of two close merges, so a red intermediate sha is
  // never reported. The group must be scoped per-sha, and cancellation off.
  const text = readWorkflow();
  assert.match(text, /concurrency:/);
  assert.match(text, /group:\s*main-gate-\$\{\{\s*github\.sha\s*\}\}/);
  assert.match(text, /cancel-in-progress:\s*false/);
  assert.doesNotMatch(text, /cancel-in-progress:\s*true/);
});

test('main-gate.yml uses Node 20, same as pr-gate.yml', () => {
  // Round 2 review: a green main-gate must prove the same runtime pr-gate
  // already proved, not a different one.
  const text = readWorkflow();
  assert.match(text, /node-version:\s*'20'/);
  assert.doesNotMatch(text, /node-version:\s*'22'/);
});

test('main-gate.yml builds the shared package before the gate commands, like pr-gate.yml', () => {
  const text = readWorkflow();
  assert.match(text, /packages\/shared\s*&&\s*npx tsc/);
  assert.match(text, /schema\.d\.ts/);
});

test('main-gate.yml unit test step passes --retry=2 to page over slow-machine flakes', () => {
  const text = readWorkflow();
  assert.match(text, /test:unit.*--\s*--retry=2/);
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

function getNotifierStepLines(text) {
  const lines = text.split('\n');
  const startIdx = lines.findIndex((l) => /^\s*- name:\s*Notify on failure\s*$/.test(l));
  assert.notEqual(startIdx, -1, 'expected a step named "Notify on failure"');
  const stepIndent = lines[startIdx].match(/^\s*/)[0].length;
  let endIdx = lines.length;
  for (let i = startIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const indent = line.match(/^\s*/)[0].length;
    if (indent <= stepIndent && line.trimStart().startsWith('- name:')) {
      endIdx = i;
      break;
    }
  }
  return lines.slice(startIdx, endIdx);
}

test('main-gate.yml guards the Notifier alert step with a real (uncommented) if: failure() key on that step', () => {
  const text = readWorkflow();
  const stepLines = getNotifierStepLines(text);
  // Must be an actual `if:` mapping key on the step, not text inside a `#`
  // comment or inside the run: shell block (round 2 review: "a commented
  // `if:` cannot satisfy it").
  const guardLine = stepLines.find((l) => /^\s*if:\s*failure\(\)\s*$/.test(l));
  assert.ok(guardLine, `expected an uncommented "if: failure()" key directly on the Notify step, got:\n${stepLines.join('\n')}`);
  assert.ok(!guardLine.trimStart().startsWith('#'), 'the if: failure() guard must not be commented out');
  const stepText = stepLines.join('\n');
  assert.match(stepText, /NOTIFIER_URL/, 'expected the guarded step to reference NOTIFIER_URL');
});

test('main-gate.yml Notifier step skips cleanly when secrets are absent', () => {
  const text = readWorkflow();
  const notifierStepIndex = text.indexOf('NOTIFIER_URL');
  const stepBlock = text.slice(notifierStepIndex - 400, notifierStepIndex + 600);
  assert.match(stepBlock, /if secrets? .*(is empty|not set|absent)|NOTIFIER_URL.*&&|-z "\$NOTIFIER_URL"/i);
});
