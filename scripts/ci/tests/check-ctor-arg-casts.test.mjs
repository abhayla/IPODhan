// Self-test for scripts/ci/check-ctor-arg-casts.mjs (#1187, class of #635).
// Each bypass shape must be flagged; each legitimate shape must pass.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { findOffenders, run, BASELINE_REL } from '../check-ctor-arg-casts.mjs';

const kinds = (src) => findOffenders('x.ts', src).map((o) => o.kind);

const FLAGGED = {
  'as never': 'new R(db as never, redis);',
  'as any': 'new R(db as any);',
  'as unknown': 'new R(redis as unknown);',
  'as unknown as T (double cast)': 'new R(db as unknown as Db);',
  'angle-bracket any': 'new R(<any>db);',
  'angle-bracket double': 'new R(<Db><unknown>db);',
  'parenthesised cast': 'new R((db as never));',
  'non-null wrapping a cast': 'new R((db as never)!);',
  'call result cast': 'new R(getRedisClient() as never);',
  'renamed handle (name is not the guard)': 'new R(tx as never, dbx as never);',
  'object-literal property': 'new R({ db: db as never });',
  'intermediate const': 'const d = db as never;\nnew R(d);',
  'chained copy of an erased const': 'const a = db as any;\nconst b = a;\nnew R(b);',
  'erased branch of ??': 'const r = (opt ?? getRedisClient()) as never;\nconst s = opt2 ?? (x as never);\nnew R(s);',
  'shorthand property of erased const': 'const db2 = db as never;\nnew R({ db2 });',
  'spread argument (unresolvable, fail closed)': 'new R(...args);',
  'destructured from erased initializer': 'const { a } = deps as any;\nnew R(a);',
};

for (const [name, src] of Object.entries(FLAGGED)) {
  test(`flags: ${name}`, () => {
    assert.ok(kinds(src).length >= 1, `expected an offender for: ${src}`);
  });
}

const CLEAN = {
  'typed handles': 'new R(db, redis);',
  'checked cast to a real type': 'new R(db as Db);',
  'cast of the constructed result, not an argument': 'const r = new R(db) as never;',
  'satisfies is checked, not erased': 'new R(db satisfies Db);',
  'non-null only': 'new R(db!);',
  'erasing cast outside a constructor call': 'fn(db as never);',
  'shadowed name: inner binding is typed': 'const redis = x as never;\nfunction f(redis: Redis) { return new R(redis); }',
  'object literal with typed values': 'new R({ db, redis: getRedisClient() });',
};

for (const [name, src] of Object.entries(CLEAN)) {
  test(`passes: ${name}`, () => {
    assert.deepEqual(kinds(src), [], `unexpected offender for: ${src}`);
  });
}

test('counts every cast argument separately', () => {
  assert.equal(findOffenders('x.ts', 'new R(db as never, redis as never);').length, 2);
});

function tree(files, baseline) {
  const root = mkdtempSync(path.join(tmpdir(), 'ctor-casts-'));
  for (const [rel, src] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    writeFileSync(path.join(root, rel), src);
  }
  if (baseline) {
    mkdirSync(path.dirname(path.join(root, BASELINE_REL)), { recursive: true });
    writeFileSync(path.join(root, BASELINE_REL), JSON.stringify({ entries: baseline }));
  }
  return root;
}

test('run: a new offender in a scanned dir is reported; tests are not scanned', () => {
  const root = tree({
    'scraper/src/a.ts': 'new R(db as never);',
    'scraper/src/a.test.ts': 'new R(db as never);',
    'scraper/src/tests/b.ts': 'new R(db as never);',
  });
  try {
    const { fresh } = run(root);
    assert.deepEqual(fresh.map((o) => o.file), ['scraper/src/a.ts']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('run: a baselined offender passes; a stale baseline entry is reported', () => {
  const root = tree({ 'web/lib/a.ts': 'new R(db as never);' }, [
    { file: 'web/lib/a.ts', text: 'db as never', reason: 'kept erased because of reason X here' },
    { file: 'web/lib/gone.ts', text: 'db as never', reason: 'kept erased because of reason Y here' },
  ]);
  try {
    const { fresh, stale } = run(root);
    assert.equal(fresh.length, 0);
    assert.deepEqual(stale.map((s) => s.file), ['web/lib/gone.ts']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('run: a baseline entry without a real reason is refused', () => {
  const root = tree({ 'web/lib/a.ts': 'new R(db as never);' }, [{ file: 'web/lib/a.ts', text: 'db as never', reason: 'x' }]);
  try {
    assert.throws(() => run(root), /reason/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('flags: erased module-level const declared after an import', () => {
  const src = "import { db } from './db';\nconst noRedis = {} as unknown as Redis;\nnew R(db, noRedis);";
  assert.equal(findOffenders('x.ts', src).length, 1);
});

test('passes: an imported binding of the same name as nothing erased', () => {
  assert.deepEqual(kinds("import { db } from './db';\nnew R(db);"), []);
});

test('flags: erased operand of ?? / || / ternary at the call site', () => {
  assert.ok(kinds('new R(redis ?? (stub as never));').length === 1);
  assert.ok(kinds('const s = {} as never;\nnew R(redis || s);').length === 1);
  assert.ok(kinds('new R(ok ? db : (db as any));').length === 1);
});

test('passes: typed operands of ?? at the call site', () => {
  assert.deepEqual(kinds('new R(redis ?? getRedisClient());'), []);
});

test('run: a second identical cast in a baselined file is new (multiset baseline)', () => {
  const root = tree({ 'web/lib/a.ts': 'new R(tx as never);\nnew Q(tx as never);' }, [
    { file: 'web/lib/a.ts', text: 'tx as never', reason: 'kept erased because of reason X here' },
  ]);
  try {
    assert.equal(run(root).fresh.length, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
