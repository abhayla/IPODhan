// #640 self-test: drives the real findOffenders() (AST-based, TypeScript
// compiler API) against fixture source strings for every defaulting shape
// the round-2 review named, so a weakened or deleted rule turns this test
// red before the gate itself can silently stop catching the class.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findOffenders } from '../check-db-connection-defaults.mjs';

test('flags the pre-fix shape (DATABASE_NAME defaults to the production db name)', () => {
  const source = `
    database: process.env.DATABASE_NAME || 'ipodhan',
    user: process.env.DATABASE_USER || 'postgres',
  `;
  const offenders = findOffenders('fixture.mjs', source);
  assert.equal(offenders.length, 2);
  assert.equal(offenders[0].variable, 'DATABASE_NAME');
  assert.equal(offenders[1].variable, 'DATABASE_USER');
});

test('flags the ?? form the same as ||', () => {
  const source = `const user = process.env.DATABASE_USER ?? 'ipodhan_app';`;
  const offenders = findOffenders('fixture.mjs', source);
  assert.equal(offenders.length, 1);
  assert.equal(offenders[0].variable, 'DATABASE_USER');
});

test('flags a default split across lines', () => {
  const source = `
    database:
      process.env.DATABASE_NAME
      ||
      'ipodhan',
  `;
  const offenders = findOffenders('fixture.mjs', source);
  assert.equal(offenders.length, 1);
  assert.equal(offenders[0].variable, 'DATABASE_NAME');
});

test('flags a backtick (no-substitution template) default', () => {
  const source = 'const database = process.env.DATABASE_NAME || `ipodhan`;';
  const offenders = findOffenders('fixture.mjs', source);
  assert.equal(offenders.length, 1);
  assert.equal(offenders[0].variable, 'DATABASE_NAME');
});

test('flags a plain destructuring default off process.env', () => {
  const source = `const { DATABASE_NAME = 'ipodhan' } = process.env;`;
  const offenders = findOffenders('fixture.ts', source);
  assert.equal(offenders.length, 1);
  assert.equal(offenders[0].variable, 'DATABASE_NAME');
});

test('flags an aliased destructuring default off process.env', () => {
  const source = `const { DATABASE_NAME: db = 'ipodhan' } = process.env;`;
  const offenders = findOffenders('fixture.ts', source);
  assert.equal(offenders.length, 1);
  assert.equal(offenders[0].variable, 'DATABASE_NAME');
});

test('flags process.env[\'DATABASE_NAME\'] element access', () => {
  const source = `const database = process.env['DATABASE_NAME'] || 'ipodhan';`;
  const offenders = findOffenders('fixture.ts', source);
  assert.equal(offenders.length, 1);
  assert.equal(offenders[0].variable, 'DATABASE_NAME');
});

test('flags a named constant used as the default', () => {
  const source = `
    const PRODUCTION_DATABASE_NAME = 'ipodhan';
    const database = process.env.DATABASE_NAME || PRODUCTION_DATABASE_NAME;
  `;
  const offenders = findOffenders('fixture.ts', source);
  assert.equal(offenders.length, 1);
  assert.equal(offenders[0].variable, 'DATABASE_NAME');
});

test('flags a ternary fallback (direct condition)', () => {
  const source = `const database = process.env.DATABASE_NAME ? process.env.DATABASE_NAME : 'ipodhan';`;
  const offenders = findOffenders('fixture.ts', source);
  assert.equal(offenders.length, 1);
  assert.equal(offenders[0].variable, 'DATABASE_NAME');
});

test('flags a ternary fallback (negated condition)', () => {
  const source = `const database = !process.env.DATABASE_NAME ? 'ipodhan' : process.env.DATABASE_NAME;`;
  const offenders = findOffenders('fixture.ts', source);
  assert.equal(offenders.length, 1);
  assert.equal(offenders[0].variable, 'DATABASE_NAME');
});

test('a comparison against a named constant is NOT flagged (repair-tool.ts shape)', () => {
  const source = `
    export const PRODUCTION_DATABASE_NAME = 'ipodhan';
    const isProd = dbName.toLowerCase() === PRODUCTION_DATABASE_NAME;
  `;
  assert.deepEqual(findOffenders('fixture.ts', source), []);
});

test('the fixed form (resolveDiscreteDbParams spread) is clean', () => {
  const source = `
    const pool = new Pool({
      ...resolveDiscreteDbParams(),
      options: '-c timezone=UTC',
    });
  `;
  assert.deepEqual(findOffenders('fixture.mjs', source), []);
});

test('a fallback to another env var (never a string literal) is clean', () => {
  const source = `return fromUrl || env.DATABASE_NAME || env.PGDATABASE || '';`;
  assert.deepEqual(findOffenders('fixture.ts', source), []);
});

test('an empty-string default is clean (falls through, never a named target)', () => {
  const source = `const user = env.DATABASE_USER || '';`;
  assert.deepEqual(findOffenders('fixture.mjs', source), []);
});

test('a bare env read with no fallback is clean', () => {
  const source = `database: process.env.DATABASE_NAME,`;
  assert.deepEqual(findOffenders('fixture.mjs', source), []);
});

// #640 round 2: the reviewer found the round-1 gate's SCAN_DIRS did not
// cover packages/shared/src, so a regression re-adding the default there
// would not have been caught. This proves the DETECTOR itself would catch
// it (findOffenders is dir-agnostic; scan-dir coverage is asserted by
// running the real CLI in check-db-connection-defaults.mjs's own test via
// the package.json-relative file list, exercised in the manual run below).
test('would catch a regression in the exact packages/shared/src/db/index.ts shape', () => {
  const source = `
    _pool = new Pool(
      process.env.DATABASE_HOST && process.env.DATABASE_PASSWORD
        ? {
            host: process.env.DATABASE_HOST,
            port: parseInt(process.env.DATABASE_PORT || '5432'),
            database: process.env.DATABASE_NAME || 'ipodhan',
            user: process.env.DATABASE_USER || 'postgres',
            password: process.env.DATABASE_PASSWORD,
          }
        : { connectionString: process.env.DATABASE_URL }
    );
  `;
  const offenders = findOffenders('packages/shared/src/db/index.ts', source);
  assert.equal(offenders.length, 2);
  assert.deepEqual(offenders.map((o) => o.variable).sort(), ['DATABASE_NAME', 'DATABASE_USER']);
});

// #1142: bypass shapes the #640 round-2 reviewer probed. Each returned no
// offender against the pre-#1142 detector while the control was flagged.
import { keyOf, compareToBaseline, scanSource } from '../check-db-connection-defaults.mjs';

const BYPASSES = [
  ['TS as-cast', `const d = (process.env.DATABASE_NAME as string) || 'ipodhan';`, 'fixture.ts'],
  ['non-null assertion', `const d = process.env.DATABASE_NAME! || 'ipodhan';`, 'fixture.ts'],
  ['satisfies', `const d = (process.env.DATABASE_NAME satisfies string | undefined) || 'ipodhan';`, 'fixture.ts'],
  ['angle-bracket assertion', `const d = (<string>process.env.DATABASE_NAME) || 'ipodhan';`, 'fixture.ts'],
  ['parentheses', `const d = (process.env.DATABASE_NAME) || 'ipodhan';`, 'fixture.mjs'],
  ['intermediate const', `const n = process.env.DATABASE_NAME;\nconst d = n || 'ipodhan';`, 'fixture.mjs'],
  ['intermediate let via destructure without default', `const { DATABASE_NAME } = process.env;\nconst d = DATABASE_NAME ?? 'ipodhan';`, 'fixture.mjs'],
  ['process.env alias not named env', `const e = process.env;\nconst d = e.DATABASE_NAME || 'ipodhan';`, 'fixture.mjs'],
  ['alias via destructure of process', `const { env: vars } = process;\nconst d = vars.DATABASE_NAME || 'ipodhan';`, 'fixture.mjs'],
  ['||= on an env-read variable', `let d = process.env.DATABASE_NAME;\nd ||= 'ipodhan';`, 'fixture.mjs'],
  ['??= directly on process.env', `process.env.DATABASE_USER ??= 'postgres';`, 'fixture.mjs'],
  ['optional chaining', `const d = process?.env?.DATABASE_NAME || 'ipodhan';`, 'fixture.mjs'],
  ['PGDATABASE', `const d = process.env.PGDATABASE || 'ipodhan';`, 'fixture.mjs'],
  ['PGUSER', `const u = process.env.PGUSER || 'postgres';`, 'fixture.mjs'],
  ['function-parameter destructuring default', `function connect({ DATABASE_NAME = 'ipodhan' } = process.env) { return DATABASE_NAME; }`, 'fixture.mjs'],
  ['function-parameter env alias', `function connect(vars = process.env) { return vars.DATABASE_NAME || 'ipodhan'; }`, 'fixture.mjs'],
  ['nested destructure off process', `const { env: { DATABASE_NAME = 'ipodhan' } } = process;`, 'fixture.mjs'],
  ['env helper called with a literal default', `const d = getEnv('DATABASE_NAME', 'ipodhan');`, 'fixture.mjs'],
];

for (const [name, source, file] of BYPASSES) {
  test(`#1142 bypass is flagged: ${name}`, () => {
    const offenders = findOffenders(file, source);
    assert.ok(offenders.length >= 1, `expected an offender for ${name}, got none`);
  });
}

test('#1142 hard-coded connection target in a pg config object is flagged', () => {
  const source = `
    const client = new Client({
      host: '103.118.16.189', port: 5432, user: 'postgres',
      password: process.env.DB_PASSWORD, database: 'ipodhan',
    });
  `;
  const offenders = findOffenders('legacy/connect.js', source);
  assert.deepEqual(offenders.map((o) => o.variable).sort(), ['database', 'user']);
  assert.ok(offenders.every((o) => o.kind === 'hardcoded-target'));
});

test('#1142 hard-coded database in a connection-string literal is flagged', () => {
  const offenders = findOffenders('x.mjs', "const url = 'postgres://app:pw@127.0.0.1:15432/ipodhan';");
  assert.equal(offenders.length, 1);
  assert.equal(offenders[0].kind, 'hardcoded-target');
  const tmpl = findOffenders('x.mjs', 'const url = `postgresql://${u}:${p}@${h}:5432/ipodhan_staging`;');
  assert.equal(tmpl.length, 1);
});

test('#1142 a non-db object with a user/database key is not flagged (no connection keys)', () => {
  const source = `const row = { user: 'alice', role: 'admin' }; const meta = { database: 'docs' };`;
  assert.deepEqual(findOffenders('x.mjs', source), []);
});

test('#1142 an unresolvable fallback fails closed (imported identifier / call)', () => {
  const imported = findOffenders('x.mjs', `import { DEFAULT_DB } from './c.mjs';\nconst d = process.env.DATABASE_NAME || DEFAULT_DB;`);
  assert.equal(imported.length, 1);
  assert.equal(imported[0].kind, 'unresolved');
  const called = findOffenders('x.mjs', `const d = process.env.DATABASE_NAME || pickDefault();`);
  assert.equal(called.length, 1);
  assert.equal(called[0].kind, 'unresolved');
});

test('#1142 a fallback to another env read, undefined, or a throw helper is clean', () => {
  const source = `
    const a = process.env.DATABASE_NAME || process.env.PGDATABASE;
    const b = process.env.DATABASE_NAME ?? undefined;
    const c = (process.env.DATABASE_USER as string) || '';
  `;
  assert.deepEqual(findOffenders('x.ts', source), []);
});

test('#1142 a file that cannot be parsed fails closed (offender, not skip)', () => {
  const offenders = scanSource('broken.ts', 'const d = process.env.DATABASE_NAME || ;;; }}}', () => {
    throw new Error('boom');
  });
  assert.equal(offenders.length, 1);
  assert.equal(offenders[0].kind, 'parse-error');
});

test('#1142 baseline key is file + normalised expression, not the line number', () => {
  const before = findOffenders('s.mjs', `const u = process.env.DATABASE_USER || 'postgres';`);
  const after = findOffenders('s.mjs', `\n\n\nconst u =\n  process.env.DATABASE_USER   ||   'postgres';`);
  assert.equal(keyOf(before[0]), keyOf(after[0]));
  assert.notEqual(before[0].line, after[0].line);
});

test('#1142 baseline compare counts occurrences: a second identical offender is new', () => {
  const src = `const u = process.env.DATABASE_USER || 'postgres';\nconst v = process.env.DATABASE_USER || 'postgres';`;
  const offenders = findOffenders('s.mjs', src);
  const baseline = [{ file: 's.mjs', variable: 'DATABASE_USER', text: offenders[0].text, reason: 'r' }];
  const { newOffenders, gone } = compareToBaseline(offenders, baseline);
  assert.equal(newOffenders.length, 1);
  assert.equal(gone.length, 0);
});

test('#1142 a baseline entry without a reason is refused', () => {
  const offenders = findOffenders('s.mjs', `const u = process.env.DATABASE_USER || 'postgres';`);
  assert.throws(() => compareToBaseline(offenders, [{ file: 's.mjs', variable: 'DATABASE_USER', text: offenders[0].text }]), /reason/);
});
