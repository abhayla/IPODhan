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
