import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseDiagnostics,
  normalizeMessage,
  keyOf,
  toMultiset,
  diffMultisets,
} from '../ci/check-scraper-src-types.mjs';

// A realistic slice of `tsc --noEmit` output, in the non-pretty format tsc
// emits by default (no `--pretty`), as produced when run with cwd=scraper/.
const SAMPLE_TSC_OUTPUT = `
src/jobs/anchor-investors-job.ts(42,10): error TS2339: Property 'documentType' does not exist on type 'Foo'.
src/services/filing-persister.ts(10,5): error TS2345: Argument of type 'string' is not assignable to parameter of type 'number'.
`;

test('parseDiagnostics: extracts file, code and message, repo-root-relative', () => {
  const entries = parseDiagnostics(SAMPLE_TSC_OUTPUT, {
    repoRoot: '/repo',
    cwd: '/repo/scraper',
  });
  assert.equal(entries.length, 2);
  assert.deepEqual(entries[0], {
    file: 'scraper/src/jobs/anchor-investors-job.ts',
    code: 'TS2339',
    message: "Property 'documentType' does not exist on type 'Foo'.",
  });
  assert.equal(entries[1].code, 'TS2345');
});

test('parseDiagnostics: ignores non-diagnostic lines (blank, summary, npx noise)', () => {
  const noisy = `\nnpm warn using --force\nFound 2 errors.\n${SAMPLE_TSC_OUTPUT}`;
  const entries = parseDiagnostics(noisy, { repoRoot: '/repo', cwd: '/repo/scraper' });
  assert.equal(entries.length, 2);
});

test('normalizeMessage: collapses whitespace but preserves distinct messages', () => {
  assert.equal(normalizeMessage('  foo   bar  '), 'foo bar');
  assert.notEqual(normalizeMessage('Property a'), normalizeMessage('Property b'));
});

test('keyOf: never includes line/column (must survive unrelated edits above the error)', () => {
  const a = { file: 'x.ts', code: 'TS2339', message: 'm' };
  assert.equal(keyOf(a), 'x.ts::TS2339::m');
});

test('RED: a NEW error (not in baseline) is reported by diffMultisets', () => {
  const baseline = toMultiset([{ file: 'a.ts', code: 'TS2339', message: 'existing' }]);
  const current = toMultiset([
    { file: 'a.ts', code: 'TS2339', message: 'existing' },
    { file: 'b.ts', code: 'TS2345', message: 'brand new regression' },
  ]);
  const { newOffenders, shrinkable } = diffMultisets(current, baseline);
  assert.equal(newOffenders.length, 1);
  assert.equal(newOffenders[0].key, 'b.ts::TS2345::brand new regression');
  assert.equal(shrinkable.length, 0);
});

test('GREEN: a baselined error that still occurs produces no offenders', () => {
  const baseline = toMultiset([{ file: 'a.ts', code: 'TS2339', message: 'existing' }]);
  const current = toMultiset([{ file: 'a.ts', code: 'TS2339', message: 'existing' }]);
  const { newOffenders, shrinkable } = diffMultisets(current, baseline);
  assert.equal(newOffenders.length, 0);
  assert.equal(shrinkable.length, 0);
});

test('RED: a FIXED error still in the baseline must be shrunk (fails, not silently accepted)', () => {
  const baseline = toMultiset([
    { file: 'a.ts', code: 'TS2339', message: 'existing' },
    { file: 'c.ts', code: 'TS2554', message: 'now fixed, stale baseline entry' },
  ]);
  const current = toMultiset([{ file: 'a.ts', code: 'TS2339', message: 'existing' }]);
  const { newOffenders, shrinkable } = diffMultisets(current, baseline);
  assert.equal(newOffenders.length, 0);
  assert.equal(shrinkable.length, 1);
  assert.equal(shrinkable[0].key, 'c.ts::TS2554::now fixed, stale baseline entry');
});

test('diffMultisets: duplicate identical errors are counted (multiset), not deduplicated to one', () => {
  const baseline = toMultiset([{ file: 'a.ts', code: 'TS2339', message: 'dup' }]);
  const current = toMultiset([
    { file: 'a.ts', code: 'TS2339', message: 'dup' },
    { file: 'a.ts', code: 'TS2339', message: 'dup' },
  ]);
  const { newOffenders } = diffMultisets(current, baseline);
  assert.equal(newOffenders.length, 1);
  assert.equal(newOffenders[0].current, 2);
  assert.equal(newOffenders[0].baseline, 1);
});
