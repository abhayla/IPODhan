// #457 round 2 (proof d): each of the three measured holes is refused, and the
// compliant shapes pass. Imports the real predicate, so weakening a rule turns
// this red.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkSource, run } from '../check-repair-ledger-calls.mjs';

const rules = (src, opts) => checkSource('x.ts', src, opts).map((v) => v.rule);

test('R3: an old-shape call in a file EXCLUDED from tsconfig.scripts.json is refused', () => {
  const oldShape = `writeLedgerFile(P, { apply: APPLY, dbName, generatedAt: 'x', ledger });`;
  assert.deepEqual(rules(oldShape, { excludedFromTsc: true }), ['R3']);
  const typed = `writeLedgerFile(P, { tool: 't', mode: 'apply', generatedAt: 'x', changes, ledger });`;
  assert.deepEqual(rules(typed, { excludedFromTsc: true }), []);
  // the same old shape in an INCLUDED file is left to tsc
  assert.deepEqual(rules(oldShape, { excludedFromTsc: false }), []);
});

test('R2: a passthrough slot typed `payload: unknown` is refused', () => {
  const src = `import { writeLedgerFile } from './lib/repair-tool.js';
    interface I { writeLedger: (path: string, payload: unknown) => string; }
    const deps: I = { writeLedger: writeLedgerFile };`;
  assert.deepEqual(rules(src), ['R2']);
  const typed = src.replace('payload: unknown', 'payload: RepairLedgerPayload');
  assert.deepEqual(rules(typed), []);
});

test('R1: an `as unknown as` cast inside the call is refused', () => {
  assert.deepEqual(rules(`writeLedgerFile(p, ledger as unknown as RepairLedgerPayload);`), ['R1']);
  assert.deepEqual(rules(`writeLedgerFile(p, ledger as any);`), ['R1']);
  assert.deepEqual(rules(`writeLedgerFile(p, ledger);`), []);
});

test('the repository as it stands has zero violations', () => {
  assert.deepEqual(run(process.cwd()), []);
});
