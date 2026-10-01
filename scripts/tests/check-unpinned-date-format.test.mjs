import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { scanSource, scanTree, compareToBaseline } from '../ci/check-unpinned-date-format.mjs';

const kinds = (src, name = 'x.tsx') => scanSource(src, name).map((v) => v.kind);

test('red: date-fns format by named import', () => {
  assert.deepEqual(kinds(`import { format } from 'date-fns'; export const a = format(d, 'MMM dd');`), ['date-fns-format']);
});
test('red: aliased import is named by import source, not identifier text', () => {
  assert.deepEqual(kinds(`import { format as fmt } from 'date-fns'; export const a = fmt(d, 'MMM dd');`), ['date-fns-format']);
});
test('red: namespace import, subpath import, and passing the formatter by reference', () => {
  assert.deepEqual(kinds(`import * as df from 'date-fns'; df.format(d, 'x');`), ['date-fns-format']);
  assert.deepEqual(kinds(`import fmt from 'date-fns/format'; fmt(d, 'x');`), ['date-fns-format']);
  assert.deepEqual(kinds(`import { format } from 'date-fns'; ds.map(format);`), ['date-fns-format']);
});
test('red (fail closed): re-export, require, dynamic import, namespace escape, element access', () => {
  assert.deepEqual(kinds(`export { format } from 'date-fns';`), ['date-fns-unresolved']);
  assert.deepEqual(kinds(`export * from 'date-fns';`), ['date-fns-unresolved']);
  assert.deepEqual(kinds(`const { format } = require('date-fns');`), ['date-fns-unresolved']);
  assert.deepEqual(kinds(`const m = await import('date-fns');`), ['date-fns-unresolved']);
  assert.deepEqual(kinds(`import * as df from 'date-fns'; use(df);`), ['date-fns-unresolved']);
  assert.deepEqual(kinds(`import * as df from 'date-fns'; df['format'](d, 'x');`), ['date-fns-unresolved']);
});
test('red: Intl.DateTimeFormat and toLocale*String without timeZone', () => {
  assert.deepEqual(kinds(`new Intl.DateTimeFormat('en-IN', { day: '2-digit' }).format(d);`), ['intl-datetimeformat']);
  assert.deepEqual(kinds(`new Intl.DateTimeFormat('en-IN').format(d);`), ['intl-datetimeformat']);
  assert.deepEqual(kinds(`d.toLocaleDateString('en-IN', { month: 'short' });`), ['locale-string']);
  assert.deepEqual(kinds(`d.toLocaleTimeString();`), ['locale-string']);
  assert.deepEqual(kinds(`x.toLocaleString('en-IN', { hour: '2-digit' });`), ['locale-string']);
  assert.deepEqual(kinds(`closeDate.toLocaleString();`), ['locale-string']);
});
test('red (fail closed): options that cannot be resolved', () => {
  assert.deepEqual(kinds(`new Intl.DateTimeFormat('en-IN', opts).format(d);`), ['intl-datetimeformat']);
  assert.deepEqual(kinds(`new Intl.DateTimeFormat('en-IN', { ...base }).format(d);`), ['intl-datetimeformat']);
  assert.deepEqual(kinds(`d.toLocaleDateString('en-IN', opts);`), ['locale-string']);
  assert.deepEqual(kinds(`const I = Intl; new I.DateTimeFormat();`), ['intl-datetimeformat']);
  assert.deepEqual(kinds(`const { DateTimeFormat } = Intl;`), ['intl-datetimeformat']);
});
test('green: pinned zones, non-zone date-fns, number formatting, comments and strings', () => {
  assert.deepEqual(kinds(`new Intl.DateTimeFormat('en-IN', { day: '2-digit', timeZone: 'Asia/Kolkata' }).format(d);`), []);
  assert.deepEqual(kinds(`d.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' });`), []);
  assert.deepEqual(kinds(`import { parseISO, isBefore } from 'date-fns'; parseISO(s);`), []);
  assert.deepEqual(kinds(`n.toLocaleString('en-IN', { maximumFractionDigits: 2 }); total.toLocaleString();`), []);
  assert.deepEqual(kinds(`// format(d, 'x') toLocaleDateString()\nconst s = "new Intl.DateTimeFormat()";`), []);
  assert.deepEqual(kinds(`import { formatInIst } from '@/lib/utils/date-formatter'; formatInIst(d, 'MMM dd'); const o = { format: 1 }; o.format;`), []);
  assert.deepEqual(kinds(`const t: Intl.DateTimeFormatOptions = {};`), []);
});

test('baseline compare: new, over-count, stale and reasonless entries all fail', () => {
  const cur = [{ file: 'a.ts', kind: 'locale-string', count: 2, lines: ['1: x'] }];
  const ok = [{ file: 'a.ts', kind: 'locale-string', count: 2, reason: 'a deliberate reason of enough length' }];
  assert.deepEqual(compareToBaseline(cur, ok), []);
  assert.equal(compareToBaseline(cur, []).length, 1);
  assert.equal(compareToBaseline(cur, [{ ...ok[0], count: 1 }]).length, 1);
  assert.equal(compareToBaseline(cur, [{ ...ok[0], count: 3 }]).length, 1);
  assert.equal(compareToBaseline(cur, [{ ...ok[0], reason: 'short' }]).length, 1);
  assert.equal(compareToBaseline([], ok).length, 1);
});

test('the real tree matches the committed baseline', () => {
  const baseline = JSON.parse(readFileSync(new URL('../ci/unpinned-date-format-baseline.json', import.meta.url), 'utf8'));
  assert.deepEqual(compareToBaseline(scanTree(), baseline), []);
});

test('the three charts fixed in #1347 round 2 carry no unpinned formatting', () => {
  const offenders = scanTree().map((e) => e.file);
  for (const f of [
    'web/components/ipo/charts/SubscriptionDashboard/OverallSubscriptionChart.tsx',
    'web/components/ipo/charts/SubscriptionDashboard/utils.ts',
    'web/components/ipo/charts/GMPHistoryChart/utils.ts',
  ]) assert.ok(!offenders.includes(f), `${f} must stay clean`);
});
