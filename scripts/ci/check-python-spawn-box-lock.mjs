#!/usr/bin/env node
/**
 * #151 round 3 (W-178c class): every python script the scraper SPAWNS takes the box lock.
 *
 * Prod and staging run on one 2-vCPU box. Two heavy python extractors at once (pdfplumber, OCR)
 * starved nginx/Next into Cloudflare 522s (W-178). The cross-slot exclusion is the fcntl file lock
 * /var/www/ipodhan/shared/extractor.lock taken INSIDE each extractor by
 * scraper/scripts/box_lock.py (`box_lock.acquire(...)`, exit 75 when busy). It is not a Redis key.
 * `read_corrigendum_pages.py` (item 9) was added later and took no lock, so staging and prod could
 * run it beside another extractor. This check makes the next such script fail the PR gate.
 *
 * How: every non-test .ts file under scraper/src that imports node:child_process is a spawn site;
 * every `<name>.py` string literal in its code (comments stripped) is a spawn target, resolved to
 * scraper/scripts/<name>.py. Each target must import box_lock AND call `box_lock.acquire(`.
 * Fails closed when no spawn target is found at all (a broken walk is not a pass).
 *
 *   node scripts/ci/check-python-spawn-box-lock.mjs
 * Self-test: node --test scripts/ci/tests/check-python-spawn-box-lock.test.mjs
 */
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, relative, sep, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..');
const SRC = join('scraper', 'src');
const SCRIPTS = join('scraper', 'scripts');
const TEST_FILE = /\.(test|spec)\.[a-z]+$/;
const CHILD_PROCESS_IMPORT = /from\s+['"](?:node:)?child_process['"]|require\(\s*['"](?:node:)?child_process['"]\s*\)/;
const PY_LITERAL = /['"`]([^'"`\s]*?\.py)['"`]/g;
const IMPORTS_BOX_LOCK = /^\s*(?:import\s+box_lock\b|from\s+box_lock\s+import\b)/m;
const CALLS_ACQUIRE = /\bbox_lock\.acquire\(/;

/** Code without comments: drops block comments, docblock lines and `//` tails (not inside a URL). */
export function stripComments(ts) {
  return ts
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split(/\r?\n/)
    .filter((line) => !/^\s*\*/.test(line))
    .map((line) => line.replace(/(^|[^:])\/\/.*$/, '$1'))
    .join('\n');
}

/** Python basenames a spawning TS file names in code. Empty for a file that spawns nothing. */
export function spawnTargets(ts) {
  if (!CHILD_PROCESS_IMPORT.test(ts)) return [];
  const code = stripComments(ts);
  const out = new Set();
  for (const m of code.matchAll(PY_LITERAL)) out.add(basename(m[1]));
  return [...out];
}

/** Why a python source fails the contract, or null when it takes the box lock. */
export function boxLockProblem(py) {
  if (py === null) return 'file not found in scraper/scripts';
  if (!IMPORTS_BOX_LOCK.test(py)) return 'does not import box_lock';
  if (!CALLS_ACQUIRE.test(py)) return 'imports box_lock but never calls box_lock.acquire(';
  return null;
}

/**
 * @param files repo-relative .ts paths under scraper/src
 * @param readText (repoRelPath) => string
 * @param readPy (basename) => string | null
 */
export function checkSpawnedPython(files, readText, readPy) {
  const targets = new Map();
  for (const file of files) {
    if (TEST_FILE.test(file)) continue;
    for (const py of spawnTargets(readText(file))) {
      if (!targets.has(py)) targets.set(py, []);
      targets.get(py).push(file);
    }
  }
  const offenders = [];
  for (const [py, from] of [...targets].sort()) {
    const problem = boxLockProblem(readPy(py));
    if (problem) offenders.push(`scraper/scripts/${py} (spawned from ${from.join(', ')}): ${problem}`);
  }
  return { targets: [...targets.keys()].sort(), offenders };
}

function walk(dir, out) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (/\.(ts|mts|js|mjs)$/.test(name)) out.push(relative(REPO, full).split(sep).join('/'));
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const files = [];
  walk(join(REPO, SRC), files);
  const { targets, offenders } = checkSpawnedPython(
    files,
    (f) => readFileSync(join(REPO, f), 'utf8'),
    (py) => {
      const p = join(REPO, SCRIPTS, py);
      return existsSync(p) ? readFileSync(p, 'utf8') : null;
    }
  );
  if (targets.length === 0) {
    console.error(`check-python-spawn-box-lock: found 0 spawned python scripts in ${files.length} files - the scan is broken, refusing to pass`);
    process.exit(1);
  }
  if (offenders.length > 0) {
    console.error(
      `check-python-spawn-box-lock: ${offenders.length} spawned python script(s) run without the cross-slot box lock (W-178c, #151).\n` +
        'Import box_lock and call box_lock.acquire(box_lock.resolve_lock_path(), <wait>) before any PDF work, exit 75 when busy\n' +
        '(see extract_filing.py / anchor_report_text.py / read_corrigendum_pages.py):\n' +
        offenders.map((o) => `  ${o}`).join('\n')
    );
    process.exit(1);
  }
  console.log(`check-python-spawn-box-lock: OK - ${targets.length} spawned python scripts all take the box lock: ${targets.join(', ')}`);
}
