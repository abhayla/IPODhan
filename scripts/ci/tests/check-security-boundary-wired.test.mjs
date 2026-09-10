// Mutation-proof for scripts/ci/check-security-boundary-wired.mjs.
//
// Every case drives the REAL check binary against a fixture tree in a temp dir.
// The mutations matter more than the happy path here: this check exists because
// three controls shipped green while doing nothing, so a version of it that
// cannot fail would be the same defect one level up.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(__dirname, '..', 'check-security-boundary-wired.mjs');
const REPO_ROOT = join(__dirname, '..', '..', '..');

function makeRoot({ boundaries, unwired = [], files = {} }) {
  const root = mkdtempSync(join(tmpdir(), 'boundary-wired-'));
  mkdirSync(join(root, 'docs', 'reviews'), { recursive: true });
  mkdirSync(join(root, 'config'), { recursive: true });
  mkdirSync(join(root, 'scraper', 'src', 'services'), { recursive: true });
  writeFileSync(join(root, 'docs/reviews/security-boundary-wiring.json'), JSON.stringify({ boundaries }));
  writeFileSync(join(root, 'config/security-boundary-wiring-baseline.json'), JSON.stringify({ unwired }));
  for (const [rel, content] of Object.entries(files)) {
    const full = join(root, rel);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  return root;
}

function run(cwd) {
  const r = spawnSync(process.execPath, [SCRIPT], { cwd, encoding: 'utf8' });
  return { code: r.status, out: r.stdout || '', err: r.stderr || '' };
}

const MODULE = 'scraper/src/services/boundary.ts';
const refBoundary = [
  { id: 'refusal', export: 'refuseIt', module: MODULE, rule: 'referenced-somewhere', why: 'test' },
];
const argBoundary = [
  { id: 'allowlist', export: 'isTrusted', module: MODULE, rule: 'min-args', minArgs: 2, why: 'test' },
];

test('a boundary that nothing references FAILS', () => {
  const root = makeRoot({
    boundaries: refBoundary,
    files: { [MODULE]: 'export function refuseIt(h) { return h; }\n' },
  });
  try {
    const { code, err } = run(root);
    assert.equal(code, 1, err);
    assert.match(err, /NOT WIRED/);
    assert.match(err, /refusal/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a boundary referenced by a CALL in another module passes', () => {
  const root = makeRoot({
    boundaries: refBoundary,
    files: {
      [MODULE]: 'export function refuseIt(h) { return h; }\n',
      'scraper/src/services/user.ts': "import { refuseIt } from './boundary.js';\nexport const x = refuseIt('a');\n",
    },
  });
  try {
    const { code, out } = run(root);
    assert.equal(code, 0, out);
    assert.match(out, /PASS/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a boundary wired by REFERENCE, with no parentheses, passes', () => {
  // `deps.resolveIsPrivate ?? isResolvedAddressPrivate` is correct wiring and
  // has no call syntax. The first version of this check reported it as unwired.
  const root = makeRoot({
    boundaries: refBoundary,
    files: {
      [MODULE]: 'export function refuseIt(h) { return h; }\n',
      'scraper/src/services/user.ts': "import { refuseIt } from './boundary.js';\nexport const check = opts.custom ?? refuseIt;\n",
    },
  });
  try {
    const { code, out } = run(root);
    assert.equal(code, 0, out);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a boundary used inside its OWN module passes', () => {
  // slotAwareFlagDefault is used by the FEATURE_FLAGS object beside it. That is
  // correct wiring; requiring another module reported it as unwired.
  const root = makeRoot({
    boundaries: refBoundary,
    files: { [MODULE]: 'export function refuseIt(h) { return h; }\nexport const FLAGS = { a: refuseIt("X") };\n' },
  });
  try {
    const { code, out } = run(root);
    assert.equal(code, 0, out);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('MUTATION: a name mentioned only in a COMMENT does not count as wiring', () => {
  const root = makeRoot({
    boundaries: refBoundary,
    files: {
      [MODULE]: 'export function refuseIt(h) { return h; }\n',
      'scraper/src/services/user.ts': '// TODO: call refuseIt(url) here one day\n/* refuseIt is the plan */\nexport const x = 1;\n',
    },
  });
  try {
    const { code, err } = run(root);
    assert.equal(code, 1, err);
    assert.match(err, /NOT WIRED/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('MUTATION: a SECOND DECLARATION in another module does not count as wiring', () => {
  // The real one: web/lib/config/feature-flags.ts holds its own copy of
  // slotAwareFlagDefault, and matching the bare name made that read as a caller.
  const root = makeRoot({
    boundaries: refBoundary,
    files: {
      [MODULE]: 'export function refuseIt(h) { return h; }\n',
      'web/lib/copy.ts': 'export function refuseIt(h) { return h; }\n',
    },
  });
  try {
    const { code, err } = run(root);
    assert.equal(code, 1, err);
    assert.match(err, /NOT WIRED/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('MUTATION: min-args FAILS when every call site under-supplies the security parameter', () => {
  const root = makeRoot({
    boundaries: argBoundary,
    files: {
      [MODULE]: 'export function isTrusted(url, hosts = new Set()) { return true; }\n',
      'scraper/src/services/user.ts': "import { isTrusted } from './boundary.js';\nexport const a = isTrusted(url);\n",
    },
  });
  try {
    const { code, err } = run(root);
    assert.equal(code, 1, err);
    assert.match(err, /only ever takes its own default/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('min-args passes as soon as ONE call site supplies it', () => {
  const root = makeRoot({
    boundaries: argBoundary,
    files: {
      [MODULE]: 'export function isTrusted(url, hosts = new Set()) { return true; }\n',
      'scraper/src/services/user.ts':
        "import { isTrusted } from './boundary.js';\nexport const a = isTrusted(url);\nexport const b = isTrusted(url, registrarHosts);\n",
    },
  });
  try {
    const { code, out } = run(root);
    assert.equal(code, 0, out);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('min-args is not fooled by a comma inside a string or a nested call', () => {
  const root = makeRoot({
    boundaries: argBoundary,
    files: {
      [MODULE]: 'export function isTrusted(url, hosts = new Set()) { return true; }\n',
      'scraper/src/services/user.ts': "export const a = isTrusted(join('a,b', x(1, 2)));\n",
    },
  });
  try {
    const { code, err } = run(root);
    // ONE argument, despite three commas inside it.
    assert.equal(code, 1, err);
    assert.match(err, /at most 1 argument/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a baselined gap is tolerated, and ONLY that one', () => {
  const root = makeRoot({
    boundaries: [...refBoundary, { id: 'other', export: 'alsoRefuse', module: MODULE, rule: 'referenced-somewhere' }],
    unwired: [{ id: 'refusal', fixedBy: 'a later slice' }],
    files: { [MODULE]: 'export function refuseIt(h) {}\nexport function alsoRefuse(h) {}\n' },
  });
  try {
    const { code, err } = run(root);
    assert.equal(code, 1, err);
    assert.match(err, /other/);
    assert.doesNotMatch(err.split('Fix by')[0], /\brefusal\b/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('MUTATION: the baseline SHRINKS — a fixed entry left listed FAILS', () => {
  // Without this the baseline silently keeps permitting a gap that no longer
  // exists, and stops being a ratchet.
  const root = makeRoot({
    boundaries: refBoundary,
    unwired: [{ id: 'refusal', fixedBy: 'already done' }],
    files: { [MODULE]: 'export function refuseIt(h) {}\nexport const use = refuseIt("x");\n' },
  });
  try {
    const { code, err } = run(root);
    assert.equal(code, 1, err);
    assert.match(err, /now WIRED and must be removed/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('MUTATION: an EMPTY registry exits 2, never PASS', () => {
  const root = makeRoot({ boundaries: [], files: { [MODULE]: 'export const a = 1;\n' } });
  try {
    const { code, err } = run(root);
    assert.equal(code, 2, err);
    assert.match(err, /lists zero boundaries/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('MUTATION: scanning zero source files exits 2, never PASS', () => {
  const root = mkdtempSync(join(tmpdir(), 'boundary-empty-'));
  mkdirSync(join(root, 'docs', 'reviews'), { recursive: true });
  mkdirSync(join(root, 'config'), { recursive: true });
  writeFileSync(join(root, 'docs/reviews/security-boundary-wiring.json'), JSON.stringify({ boundaries: refBoundary }));
  writeFileSync(join(root, 'config/security-boundary-wiring-baseline.json'), JSON.stringify({ unwired: [] }));
  try {
    const { code, err } = run(root);
    assert.equal(code, 2, err);
    assert.match(err, /scanned 0 files/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('an unknown rule is a check ERROR, not a silent pass', () => {
  const root = makeRoot({
    boundaries: [{ id: 'x', export: 'refuseIt', module: MODULE, rule: 'invented-rule' }],
    files: { [MODULE]: 'export function refuseIt(h) {}\n' },
  });
  try {
    const { code, err } = run(root);
    assert.equal(code, 2, err);
    assert.match(err, /unknown rule/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('the real repository passes, with the registrar gap baselined and named', () => {
  const { code, out, err } = run(REPO_ROOT);
  assert.equal(code, 0, err || out);
  assert.match(out, /PASS/);
  // Assert the PROPERTY, not the moment. The first version pinned
  // `unwired.length === 1` and the id of the single entry — which failed the
  // instant item 22 slice 7 wired that boundary and emptied the list, i.e. it
  // failed on the ratchet working. A baseline that shrinks to zero is the goal,
  // so the durable assertion is that whatever remains is properly justified.
  const baseline = JSON.parse(
    readFileSync(join(REPO_ROOT, 'config/security-boundary-wiring-baseline.json'), 'utf8')
  );
  assert.ok(Array.isArray(baseline.unwired), 'baseline must carry an unwired array');
  for (const entry of baseline.unwired) {
    assert.ok(entry.id, 'every baselined gap needs an id');
    assert.ok(entry.fixedBy, `baselined gap ${entry.id} must name the slice that closes it`);
  }
});
