/**
 * Item 20 slice 8 — a change to the documentation MUST reach a gate that reads
 * the documentation.
 *
 * WHY (#541). `pr-gate.yml` skips docs-only pull requests at the TRIGGER level:
 * its `paths` list allows everything, then negates every markdown file and
 * everything under docs, then adds three registry directories back. The design-consistency gate lives inside
 * that workflow. So a pull request that changes nothing but build cards runs
 * NO checks at all — GitHub reports "no checks reported", which is an absence
 * and not a pass — and can then break that gate on main for every other lane.
 *
 * That is not hypothetical: it happened on 2026-09-10. #537 (docs-only) cited a
 * file that did not exist yet, merged unchecked, and main went red on D16. The
 * failure surfaced on an unrelated scraper PR whose author's first instinct was
 * that their own change was at fault.
 *
 * This test asserts the PROPERTY, not the text of any one workflow: for a set of
 * representative change sets, at least one workflow that actually runs
 * `check-design-consistency.mjs` is triggered. It does not care which workflow,
 * so the fix can move between files without the test going stale.
 *
 * The matcher below implements GitHub's documented `paths` semantics — later
 * patterns win, `!` negates — which is the rule `pr-gate.yml`'s own comment
 * describes. It is a reimplementation, and that is a real limit: it proves our
 * intent is coherent, not that GitHub agrees. The cheap cross-check is that it
 * reproduces the KNOWN behaviour of the existing list (a .md-only change is
 * skipped by pr-gate; a detection-check JSON is not), and both are asserted.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'fs';
import { join } from 'path';

const WF_DIR = '.github/workflows';

/** Minimal glob -> RegExp for the shapes GitHub path filters actually use. */
/** Regex metacharacters that must be escaped when a glob char is literal. */
const SPECIAL = new Set(['.', '+', '^', '$', '{', '}', '(', ')', '|', '[', ']', '\\']);
function globToRe(glob) {
  let out = '^';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        // `**/` may match nothing at all; bare `**` matches anything.
        if (glob[i + 2] === '/') { out += '(?:.*/)?'; i += 2; } else { out += '.*'; i += 1; }
      } else out += '[^/]*';
    } else if (c === '?') out += '[^/]';
    else if (SPECIAL.has(c)) out += '\\' + c;
    else out += c;
  }
  return new RegExp(out + '$');
}

/** GitHub's rule: evaluate every pattern in order, the LAST match decides. */
function triggers(paths, file) {
  let verdict = false;
  for (const p of paths) {
    const negated = p.startsWith('!');
    if (globToRe(negated ? p.slice(1) : p).test(file)) verdict = !negated;
  }
  return verdict;
}

/** Every workflow's pull_request `paths` list, read straight out of the YAML. */
function workflows() {
  return readdirSync(WF_DIR)
    .filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
    .map((f) => {
      // Strip CR before matching. On Windows these files are checked out
      // CRLF, and a pattern ending in a bare newline silently matches NOTHING -
      // which made every coverage test below pass on a null paths list, i.e.
      // pass for the wrong reason. The cross-check test caught exactly that.
      const raw = readFileSync(join(WF_DIR, f), 'utf8');
      const text = raw.split(String.fromCharCode(13)).join('');
      // The `paths:` block under `pull_request:`, as a flat list of quoted globs.
      const m = text.match(/pull_request:[\s\S]*?\n\s*paths:\n((?:\s*-\s*'[^']*'\n)+)/);
      const paths = m ? [...m[1].matchAll(/-\s*'([^']*)'/g)].map((x) => x[1]) : null;
      return {
        file: f,
        text,
        paths,
        onPullRequest: /\n\s*pull_request:/.test(text),
        runsDesignGate: text.includes('check-design-consistency.mjs'),
      };
    });
}

const ALL = workflows();

test('the workflow directory was read at all - a zero-file scan cannot fail', () => {
  assert.ok(ALL.length >= 3, `only found ${ALL.length} workflows`);
});

test('the matcher reproduces the KNOWN behaviour of pr-gate its own comment describes', () => {
  const gate = ALL.find((w) => w.file === 'pr-gate.yml');
  assert.ok(gate && gate.paths, 'pr-gate.yml has no pull_request paths list');
  // Documented in the workflow: code runs, plain docs are skipped, the registry
  // directories are added back.
  assert.equal(triggers(gate.paths, 'scraper/src/index.ts'), true);
  assert.equal(triggers(gate.paths, 'README.md'), false);
  assert.equal(triggers(gate.paths, 'docs/design/build-cards/item-21-read-side.md'), false);
  assert.equal(triggers(gate.paths, 'docs/reviews/detection-checks/g_freshness_per_type.json'), true);
});

/** The change sets a documentation gate must not be blind to. */
const MUST_REACH_A_DOCS_GATE = [
  'docs/design/build-cards/item-21-read-side.md',
  'docs/design/data-sourcing-pull-model.md',
  'docs/design/rules.json',
  'docs/reviews/failure-classes/some-class.json',
  'docs/ops/prod-ops-recipes.md',
];

for (const file of MUST_REACH_A_DOCS_GATE) {
  test(`a change to ${file} reaches a workflow that runs the design gate`, () => {
    const reached = ALL.filter(
      (w) => w.onPullRequest && w.runsDesignGate && (w.paths === null || triggers(w.paths, file))
    );
    assert.ok(
      reached.length > 0,
      `nothing checks it. Workflows running the design gate: ` +
        ALL.filter((w) => w.runsDesignGate).map((w) => w.file).join(', ')
    );
  });
}

test('a code-only change still reaches the design gate too', () => {
  const reached = ALL.filter(
    (w) => w.onPullRequest && w.runsDesignGate && (w.paths === null || triggers(w.paths, 'scraper/src/index.ts'))
  );
  assert.ok(reached.length > 0);
});

test('the docs gate does NOT run npm ci - it exists to be cheap', () => {
  const docsOnly = ALL.filter(
    (w) => w.runsDesignGate && w.paths && !triggers(w.paths, 'scraper/src/index.ts')
  );
  for (const w of docsOnly) {
    // Strip YAML comments first. A workflow may legitimately EXPLAIN that it does
    // not install, and a raw-text match cannot tell that from a step that does -
    // the same "a name in a comment is not a use" bug the security-boundary gate
    // had to fix in itself.
    const code = w.text
      .split(String.fromCharCode(10))
      .filter((ln) => !/^[ ]*#/.test(ln))
      .join(String.fromCharCode(10));
    assert.ok(!/npm ci|npm install/.test(code), `${w.file} installs dependencies`);
  }
});

test('the gates it runs need no dependencies, so the cheapness is real', () => {
  // Asserted against the scripts themselves rather than trusted: a third-party
  // import here would make the no-install workflow fail at runtime.
  for (const f of ['docs/design/check-design-consistency.mjs', 'docs/design/check-build-cards.mjs']) {
    assert.ok(existsSync(f), `${f} missing`);
    const imports = [...readFileSync(f, 'utf8').matchAll(/^import .*? from '([^']+)'/gm)].map((m) => m[1]);
    const external = imports.filter((i) => !i.startsWith('node:') && !i.startsWith('.'));
    assert.deepEqual(external, [], `${f} imports ${external.join(', ')}`);
  }
});
