// Self-test for docs/design/generate-rule-index.mjs duplicate-id handling.
// The generator resolves its files relative to its own location, so each case copies the REAL
// script into a temp dir next to a tiny design document and a fixture rules.json.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

const GEN = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'docs', 'design', 'generate-rule-index.mjs');

const DESIGN = `# Design\n\n## 2. Section two\n\n> The first fixture rule must always hold for every row.\n\n> The second fixture rule must never be skipped by any job.\n`;

function fixture(rules, nextId, base = {}) {
  const root = mkdtempSync(join(tmpdir(), 'rule-index-'));
  copyFileSync(GEN, join(root, 'generate-rule-index.mjs'));
  writeFileSync(join(root, 'data-sourcing-pull-model.md'), DESIGN);
  writeFileSync(join(root, 'rules.json'), JSON.stringify({ ...base, next_id: nextId, rules }, null, 2));
  return root;
}
// install-order-ok: the child is a temp copy of docs/design/generate-rule-index.mjs, which imports only node:fs and node:path (no package)
const run = (root, ...args) => spawnSync('node', [join(root, 'generate-rule-index.mjs'), ...args], { encoding: 'utf8' });
const ids = (root) => JSON.parse(readFileSync(join(root, 'rules.json'), 'utf8')).rules.map((r) => r.id);

// First get the real extracted hashes by letting the generator allocate from an empty file.
function realRules() {
  const root = fixture([], 1);
  try {
    assert.equal(run(root, '--apply').status, 0);
    return JSON.parse(readFileSync(join(root, 'rules.json'), 'utf8'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('--check on a rules.json with a duplicate id -> exit 1 naming the id', () => {
  const { rules: [a, b], ...meta } = realRules();
  const root = fixture([a, { ...b, id: a.id }], 3, meta);
  try {
    const res = run(root, '--check');
    assert.equal(res.status, 1, res.stdout + res.stderr);
    assert.match(res.stdout, new RegExp(`DUPLICATE RULE ID.*${a.id}`));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('--apply repairs: first keeps the id, later duplicate gets next_id, then --check passes', () => {
  const { rules: [a, b], ...meta } = realRules();
  const root = fixture([a, { ...b, id: a.id }], 3, meta);
  try {
    assert.equal(run(root, '--apply').status, 0);
    assert.deepEqual(ids(root), [a.id, 'R-003']);
    const res = run(root, '--check');
    assert.equal(res.status, 0, res.stdout + res.stderr);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('retired duplicates are repaired too', () => {
  const { rules: [a, b], ...meta } = realRules();
  const ghost = { id: a.id, hash: crypto.createHash('sha256').update('gone').digest('hex').slice(0, 12), section: '2', kind: 'prose', text: 'gone', retired: true };
  const root = fixture([a, b, ghost], 3, meta);
  try {
    assert.equal(run(root, '--apply').status, 0);
    const out = ids(root);
    assert.equal(new Set(out).size, out.length);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('unique ids stay untouched and --check passes', () => {
  const { rules, ...meta } = realRules();
  const root = fixture(rules, 3, meta);
  try {
    assert.equal(run(root, '--check').status, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
