// T-487 round 2: --check alone is self-referential (it only compares the
// regenerated aggregate against itself). This test compares the regenerated
// aggregate against origin/main's OWN committed aggregate content, catching
// a split that silently dropped an entry merged to main after the split ran
// (round-1 defect: g_reverse_sweep + g_repair_held landed on main between
// the split and the PR, and --check stayed green because it never looked at
// origin/main). Ignores key order; asserts id-set equality both directions.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');

function sh(args) {
  return execFileSync(args[0], args.slice(1), { cwd: REPO_ROOT, encoding: 'utf8' });
}

function originMainRef() {
  try {
    sh(['git', 'rev-parse', '--verify', 'origin/main']);
    return 'origin/main';
  } catch {
    return null;
  }
}

function parseFailureClassRows(text) {
  const rows = [];
  for (const line of text.split('\n')) {
    if (!line.startsWith('|')) continue;
    if (!line.trim().endsWith('|')) continue;
    const cells = line.split('|').slice(1, -1).map((c) => c.trim());
    if (cells.length !== 7) continue;
    if (cells[0] === 'class_id') continue;
    if (/^-+$/.test(cells[0])) continue;
    rows.push(cells[0]);
  }
  return rows;
}

test('regenerated detection-checks.json has the same check/notCovered ids as origin/main', () => {
  const ref = originMainRef();
  if (!ref) {
    // No network/remote in this environment — nothing to compare against.
    return;
  }
  const local = JSON.parse(readFileSync(join(REPO_ROOT, 'docs/reviews/detection-checks.json'), 'utf8'));
  const mainRaw = sh(['git', 'show', `${ref}:docs/reviews/detection-checks.json`]);
  const main = JSON.parse(mainRaw);

  const localIds = new Set(local.checks.map((c) => c.id));
  const mainIds = new Set(main.checks.map((c) => c.id));
  const missingFromLocal = [...mainIds].filter((id) => !localIds.has(id));
  const extraInLocal = [...localIds].filter((id) => !mainIds.has(id));
  assert.deepEqual(missingFromLocal, [], `local aggregate is missing check id(s) present on ${ref}: ${missingFromLocal.join(', ')}`);
  assert.deepEqual(extraInLocal, [], `local aggregate has check id(s) not on ${ref} (ok if this PR adds them, otherwise investigate): ${extraInLocal.join(', ')}`);

  const localNc = new Set(local.notCoveredByThisManifest);
  const mainNc = new Set(main.notCoveredByThisManifest);
  const missingNc = [...mainNc].filter((n) => !localNc.has(n));
  assert.deepEqual(missingNc, [], `local aggregate is missing notCoveredByThisManifest entr(y/ies) present on ${ref}: ${missingNc.map((n) => n.slice(0, 40)).join(' | ')}`);
});

test('regenerated failure-classes.md table has the same class_ids as origin/main', () => {
  const ref = originMainRef();
  if (!ref) return;
  const localText = readFileSync(join(REPO_ROOT, 'docs/reviews/failure-classes.md'), 'utf8');
  const mainText = sh(['git', 'show', `${ref}:docs/reviews/failure-classes.md`]);

  const localIds = new Set(parseFailureClassRows(localText));
  const mainIds = new Set(parseFailureClassRows(mainText));
  const missing = [...mainIds].filter((id) => !localIds.has(id));
  const extra = [...localIds].filter((id) => !mainIds.has(id));
  assert.deepEqual(missing, [], `local failure-classes.md is missing class_id(s) present on ${ref}: ${missing.join(', ')}`);
  assert.deepEqual(extra, [], `local failure-classes.md has class_id(s) not on ${ref}: ${extra.join(', ')}`);
});
