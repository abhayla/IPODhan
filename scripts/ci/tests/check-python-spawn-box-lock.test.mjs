// #151 round 3: the real predicates of scripts/ci/check-python-spawn-box-lock.mjs against fixtures,
// plus one run of the CLI against the live tree (so an unguarded spawned script turns this red).
//
//   node --test scripts/ci/tests/check-python-spawn-box-lock.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnTargets, boxLockProblem, checkSpawnedPython } from '../check-python-spawn-box-lock.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const GUARDED = 'import box_lock\n\ndef main():\n    if not box_lock.acquire(box_lock.resolve_lock_path(), 90):\n        return 75\n';

test('a spawning file names its python targets; comments and non-spawning files do not count', () => {
  const spawner = [
    "import { spawnSync } from 'node:child_process';",
    "// see `old_tool.py` for history",
    ' * `doc_only.py` in a docblock',
    "const s = path.join(here, 'scripts', 'reader.py');",
    "const t = '../../scripts/other_tool.py';",
  ].join('\n');
  assert.deepEqual(spawnTargets(spawner).sort(), ['other_tool.py', 'reader.py']);
  assert.deepEqual(spawnTargets("const s = 'reader.py'; // no child_process import"), []);
});

test('boxLockProblem: import + acquire passes; missing import, missing call or missing file fails', () => {
  assert.equal(boxLockProblem(GUARDED), null);
  assert.match(boxLockProblem('import json\nprint(1)\n'), /does not import box_lock/);
  assert.match(boxLockProblem('import box_lock\n'), /never calls box_lock\.acquire/);
  assert.match(boxLockProblem('# import box_lock\nbox_lock.acquire(x, 1)\n'), /does not import box_lock/);
  assert.match(boxLockProblem(null), /not found/);
});

test('checkSpawnedPython names the unguarded target and where it is spawned from', () => {
  const ts = {
    'scraper/src/a.ts': "import { spawnSync } from 'node:child_process';\nconst p = 'guarded.py';",
    'scraper/src/b.ts': "import { spawnSync } from 'child_process';\nconst p = 'unguarded.py';",
    'scraper/src/b.test.ts': "import { spawnSync } from 'child_process';\nconst p = 'test_only.py';",
  };
  const py = { 'guarded.py': GUARDED, 'unguarded.py': 'import pdfplumber\n' };
  const { targets, offenders } = checkSpawnedPython(Object.keys(ts), (f) => ts[f], (n) => py[n] ?? null);
  assert.deepEqual(targets, ['guarded.py', 'unguarded.py']);
  assert.deepEqual(offenders, ['scraper/scripts/unguarded.py (spawned from scraper/src/b.ts): does not import box_lock']);
});

test('the live tree: every python script scraper/src spawns takes the box lock (includes the corrigendum reader)', () => {
  const run = spawnSync(process.execPath, [join(ROOT, 'scripts', 'ci', 'check-python-spawn-box-lock.mjs')], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  for (const py of ['anchor_report_text.py', 'extract_filing.py', 'read_corrigendum_pages.py']) {
    assert.ok(run.stdout.includes(py), `expected ${py} among the spawn targets: ${run.stdout}`);
  }
});
