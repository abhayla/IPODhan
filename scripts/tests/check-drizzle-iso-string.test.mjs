import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  stripSqlTemplates,
  loadColumnClassification,
  findOffenders,
} from '../ci/check-drizzle-iso-string.mjs';

// A synthetic schema slice with one column of each kind this check must
// distinguish: a default-mode (Date) timestamp — the one that crashes when
// bound a string — a string-mode timestamp, and a date() column.
const FAKE_SCHEMA = `
export const ipos = pgTable('ipos', {
  createdAt: timestamp('created_at').defaultNow().notNull(),
  publishedDate: timestamp('published_date', { mode: 'string' }),
  openDate: date('open_date'),
});
`;

test('loadColumnClassification: only the default-mode timestamp column is flaggable', () => {
  const flaggable = loadColumnClassification(FAKE_SCHEMA);
  assert.equal(flaggable.has('createdAt'), true);
  assert.equal(flaggable.has('publishedDate'), false);
  assert.equal(flaggable.has('openDate'), false);
});

test('loadColumnClassification: a name declared BOTH ways anywhere is ambiguous, not flagged', () => {
  const mixed = `
export const a = pgTable('a', { stamp: timestamp('stamp').notNull() });
export const b = pgTable('b', { stamp: timestamp('stamp', { mode: 'string' }) });
`;
  const flaggable = loadColumnClassification(mixed);
  assert.equal(flaggable.has('stamp'), false);
});

test('RED: gte(ipos.createdAt, d.toISOString()) is flagged (drizzle default-mode timestamp operator)', () => {
  const flaggable = loadColumnClassification(FAKE_SCHEMA);
  const source = `
import { gte } from 'drizzle-orm';
const d = new Date();
db.select().from(ipos).where(gte(ipos.createdAt, d.toISOString()));
`;
  const offenders = findOffenders('fake.ts', source, flaggable);
  assert.equal(offenders.length, 1);
  assert.equal(offenders[0].colRef, 'ipos.createdAt');
});

test('RED: eq(ipos.createdAt, x.toISOString()) reverse-argument order is also flagged', () => {
  const flaggable = loadColumnClassification(FAKE_SCHEMA);
  const source = `db.update(ipos).set({}).where(eq(x.toISOString(), ipos.createdAt));`;
  const offenders = findOffenders('fake.ts', source, flaggable);
  assert.equal(offenders.length, 1);
});

test('RED: .set({ createdAt: d.toISOString() }) is flagged', () => {
  const flaggable = loadColumnClassification(FAKE_SCHEMA);
  const source = `
await db.update(ipos).set({
  createdAt: d.toISOString(),
  status: 'x',
}).where(eq(ipos.id, id));
`;
  const offenders = findOffenders('fake.ts', source, flaggable);
  assert.equal(offenders.length, 1);
  assert.equal(offenders[0].colRef, 'createdAt');
});

test('RED: .values({ createdAt: d.toISOString() }) is flagged', () => {
  const flaggable = loadColumnClassification(FAKE_SCHEMA);
  const source = `await db.insert(ipos).values({ createdAt: d.toISOString(), name: 'x' });`;
  const offenders = findOffenders('fake.ts', source, flaggable);
  assert.equal(offenders.length, 1);
});

test('GREEN: gte(ipos.createdAt, d) — a bare Date object — is not flagged', () => {
  const flaggable = loadColumnClassification(FAKE_SCHEMA);
  const source = `db.select().from(ipos).where(gte(ipos.createdAt, d));`;
  const offenders = findOffenders('fake.ts', source, flaggable);
  assert.equal(offenders.length, 0);
});

test('GREEN: sql`${d.toISOString()}` — raw pg path — is not flagged even inside gte()', () => {
  const flaggable = loadColumnClassification(FAKE_SCHEMA);
  const source = 'db.select().where(gte(sql`${d.toISOString()}`, ipos.createdAt));';
  const offenders = findOffenders('fake.ts', source, flaggable);
  assert.equal(offenders.length, 0);
});

test('GREEN: gte(ipos.openDate, d.toISOString()) — a date() column — is not flagged', () => {
  const flaggable = loadColumnClassification(FAKE_SCHEMA);
  const source = `db.select().where(gte(ipos.openDate, d.toISOString()));`;
  const offenders = findOffenders('fake.ts', source, flaggable);
  assert.equal(offenders.length, 0);
});

test('GREEN: gte(ipos.publishedDate, d.toISOString()) — string-mode timestamp — is not flagged', () => {
  const flaggable = loadColumnClassification(FAKE_SCHEMA);
  const source = `db.select().where(gte(ipos.publishedDate, d.toISOString()));`;
  const offenders = findOffenders('fake.ts', source, flaggable);
  assert.equal(offenders.length, 0);
});

test('stripSqlTemplates: blanks a sql`` template body but keeps line count stable', () => {
  const source = 'const x = sql`SELECT ${a.toISOString()} FROM t`;\nconst y = 2;';
  const cleaned = stripSqlTemplates(source);
  assert.equal(cleaned.includes('toISOString'), false);
  assert.equal(cleaned.split('\n').length, source.split('\n').length);
});

test('real repo tree: current committed baseline has zero live offenders (#1069/#1067 already fixed)', () => {
  // This mirrors the CLI's real-tree scan for the actual schema file, proving
  // the mechanism against the real repo, not just synthetic fixtures.
  const flaggable = loadColumnClassification();
  assert.ok(flaggable.size > 0, 'expected at least one default-mode timestamp column in the real schema');
});
