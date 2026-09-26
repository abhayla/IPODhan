// #640 self-test: drives the real findOffenders() from
// check-db-connection-defaults.mjs against fixture source strings, so a
// weakened or deleted rule turns this test red before the gate itself can
// silently stop catching the class.
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
  assert.equal(offenders[0].line, 2);
  assert.equal(offenders[1].variable, 'DATABASE_USER');
  assert.equal(offenders[1].line, 3);
});

test('flags the ?? form the same as ||', () => {
  const source = `const user = process.env.DATABASE_USER ?? 'ipodhan_app';`;
  const offenders = findOffenders('fixture.mjs', source);
  assert.equal(offenders.length, 1);
  assert.equal(offenders[0].variable, 'DATABASE_USER');
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
  assert.deepEqual(findOffenders('fixture.mjs', source), []);
});

test('a bare env read with no fallback is clean', () => {
  const source = `database: process.env.DATABASE_NAME,`;
  assert.deepEqual(findOffenders('fixture.mjs', source), []);
});
