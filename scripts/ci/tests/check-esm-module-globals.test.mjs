// Mutation-proof for scripts/ci/check-esm-module-globals.mjs.
//
// Every case drives the REAL check binary against a fixture tree in a temp dir
// (outside the repo, so the check never picks this test file up as a source
// file). A guard that cannot be shown to FAIL is not a guard — cases 2, 4 and 6
// are the mutations that prove it can.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(__dirname, '..', 'check-esm-module-globals.mjs');
const REPO_ROOT = join(__dirname, '..', '..', '..');

function makeRoot() {
  const root = mkdtempSync(join(tmpdir(), 'esm-globals-fixture-'));
  mkdirSync(join(root, 'scraper', 'src', 'config'), { recursive: true });
  mkdirSync(join(root, 'packages', 'shared', 'src'), { recursive: true });
  return root;
}

function writeFile(root, relPath, content) {
  const full = join(root, relPath);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content);
}

function run(cwd) {
  const r = spawnSync(process.execPath, [SCRIPT], { cwd, encoding: 'utf8' });
  return { code: r.status, out: r.stdout || '', err: r.stderr || '' };
}

test('clean ESM module passes', () => {
  const root = makeRoot();
  try {
    writeFile(
      root,
      'scraper/src/config/loader.ts',
      "import { fileURLToPath } from 'url';\n" +
        "import { dirname } from 'path';\n" +
        'const MODULE_DIR = dirname(fileURLToPath(import.meta.url));\n' +
        'export const p = MODULE_DIR;\n'
    );
    const { code, out } = run(root);
    assert.equal(code, 0, out);
    assert.match(out, /PASS/);
    assert.match(out, /scanned 1 file\(s\)/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('MUTATION: bare __dirname at module scope fails, naming file and line', () => {
  const root = makeRoot();
  try {
    writeFile(
      root,
      'scraper/src/config/loader.ts',
      "import { join } from 'path';\n" + "export const P = join(__dirname, '..', 'x.json');\n"
    );
    const { code, err } = run(root);
    assert.equal(code, 1, err);
    assert.match(err, /FAIL — 1 CommonJS-only global/);
    assert.match(err, /scraper\/src\/config\/loader\.ts:2\s+__dirname/);
    // The message must tell the reader the fix, not just the fault.
    assert.match(err, /import\.meta\.url/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('__dirname declared in-file passes (the index.ts pattern)', () => {
  const root = makeRoot();
  try {
    writeFile(
      root,
      'scraper/src/config/loader.ts',
      "import { fileURLToPath } from 'url';\n" +
        "import { dirname, join } from 'path';\n" +
        'const __filename = fileURLToPath(import.meta.url);\n' +
        'const __dirname = dirname(__filename);\n' +
        "export const P = join(__dirname, 'x.json');\n"
    );
    const { code, out } = run(root);
    assert.equal(code, 0, out);
    assert.match(out, /PASS/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('MUTATION: bare require( fails', () => {
  const root = makeRoot();
  try {
    writeFile(root, 'packages/shared/src/thing.ts', 'const dotenv = require("dotenv");\nexport default dotenv;\n');
    const { code, err } = run(root);
    assert.equal(code, 1, err);
    assert.match(err, /packages\/shared\/src\/thing\.ts:1\s+require/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('__dirname and require inside comments and strings do NOT fail', () => {
  // Three real docblocks under scraper/src/scripts/ show a
  // `npx tsx -e "require('dotenv').config(...)"` usage example. Reporting those
  // would make the check noise, and noise gets switched off.
  const root = makeRoot();
  try {
    writeFile(
      root,
      'scraper/src/config/documented.ts',
      '/**\n' +
        " *   npx tsx -e \"require('dotenv').config({path:'../web/.env'})\"\n" +
        ' *   and note that __dirname is unavailable here.\n' +
        ' */\n' +
        "// require('x') and __filename in a line comment too\n" +
        "export const NOTE = 'mentions __dirname and require( in a string';\n"
    );
    const { code, out, err } = run(root);
    assert.equal(code, 0, err || out);
    assert.match(out, /PASS/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('test files are excluded from the scan', () => {
  const root = makeRoot();
  try {
    writeFile(root, 'scraper/src/config/keep.ts', 'export const a = 1;\n');
    writeFile(root, 'scraper/src/config/thing.test.ts', "const p = __dirname;\nexport default p;\n");
    const { code, out } = run(root);
    assert.equal(code, 0, out);
    assert.match(out, /scanned 1 file\(s\)/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('MUTATION: scanning zero files exits 2, never PASS', () => {
  // The hollow-observable floor. A renamed root or a wrong working directory
  // must be a loud check error, not a green tick over an empty scan.
  const root = mkdtempSync(join(tmpdir(), 'esm-globals-empty-'));
  try {
    const { code, err, out } = run(root);
    assert.equal(code, 2, out);
    assert.match(err, /FAIL \(check error\).*scanned 0 files/s);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('MUTATION: __filename is enforced, not just __dirname', () => {
  // The first Tier A review of this check proved that removing __filename from
  // BANNED left the whole suite green — half the banned list had zero coverage.
  const root = makeRoot();
  try {
    writeFile(root, 'scraper/src/config/loader.ts', 'export const F = __filename;\n');
    const { code, err } = run(root);
    assert.equal(code, 1, err);
    assert.match(err, /scraper\/src\/config\/loader\.ts:1\s+__filename/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('MUTATION: __dirname inside a template interpolation is caught', () => {
  // The first Tier A review proved this was silently PASSing. `${...}` is CODE,
  // not string text, and this is the idiomatic way to write the exact bug the
  // check exists for.
  const root = makeRoot();
  try {
    writeFile(root, 'scraper/src/config/loader.ts', 'export const s = `path: ${__dirname}/x`;\n');
    const { code, err } = run(root);
    assert.equal(code, 1, err);
    assert.match(err, /loader\.ts:1\s+__dirname/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('MUTATION: a nested interpolation does not hide it either', () => {
  const root = makeRoot();
  try {
    writeFile(root, 'scraper/src/config/loader.ts', 'export const s = `a ${ {k: `b ${__filename}`}.k }`;\n');
    const { code, err } = run(root);
    assert.equal(code, 1, err);
    assert.match(err, /loader\.ts:1\s+__filename/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('an unparsable file degrades to the conservative scan and still reports', () => {
  // A regex literal holding a backtick desynchronises the scanner. It must fall
  // back to comments-only (which over-reports) and say so — never silently pass.
  const root = makeRoot();
  try {
    writeFile(
      root,
      'scraper/src/config/loader.ts',
      'const strip = s => s.replace(/`([^`]*)`/g, "$1");\nexport const P = __dirname;\nexport default strip;\n'
    );
    const { code, out, err } = run(root);
    assert.match(out, /could not be fully parsed/);
    assert.equal(code, 1, out);
    assert.match(err, /loader\.ts:2\s+__dirname/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('createRequire(import.meta.url) is accepted; a bare require is not', () => {
  const root = makeRoot();
  try {
    writeFile(
      root,
      'scripts/ok.mjs',
      "import { createRequire } from 'node:module';\n" +
        'const require = createRequire(import.meta.url);\n' +
        "const { Client } = require('pg');\n" +
        'export default Client;\n'
    );
    const { code, out } = run(root);
    assert.equal(code, 0, out);
    assert.match(out, /PASS/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('tool config files are excluded (vite bundles them to CJS)', () => {
  const root = makeRoot();
  try {
    writeFile(root, 'scraper/keep.ts', 'export const a = 1;\n');
    writeFile(root, 'scraper/vitest.config.ts', "import path from 'path';\nexport default { root: path.resolve(__dirname) };\n");
    const { code, out } = run(root);
    assert.equal(code, 0, out);
    assert.match(out, /scanned 1 file\(s\)/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('CommonJS trees are NOT scanned (web/*.js, scripts/*.js may use __dirname)', () => {
  // The repo root and web/ are "type": "commonjs". Flagging scripts/export-
  // issues.js would be a false positive, and a check that cries wolf gets
  // switched off. Only .mjs/.mts are picked up outside the ESM packages.
  const root = makeRoot();
  try {
    writeFile(root, 'scripts/legacy.js', 'const p = __dirname;\nmodule.exports = p;\n');
    writeFile(root, 'scraper/src/keep.ts', 'export const a = 1;\n');
    const { code, out } = run(root);
    assert.equal(code, 0, out);
    assert.match(out, /scanned 1 file\(s\)/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('the real repository passes (regression guard on the two fixed loaders)', () => {
  const { code, out, err } = run(REPO_ROOT);
  assert.equal(code, 0, err || out);
  assert.match(out, /PASS/);
  // Guards the floor against a future refactor that empties the scan.
  const scanned = Number(/scanned (\d+) file\(s\)/.exec(out)?.[1] ?? 0);
  assert.ok(scanned > 100, `expected a real scan, got ${scanned} file(s)`);
});
