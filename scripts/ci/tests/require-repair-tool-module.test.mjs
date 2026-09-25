// T-490: mutation-proof self-test for the repair-tool-module lint.
//
// Imports the REAL predicates from scripts/ci/require-repair-tool-module.mjs,
// so weakening the import check or accepting an undated exemption turns a
// named test red before the lint can silently stop catching the class.
//
// #694: rewritten for the TypeScript-AST-based classifier (ts.createSourceFile
// instead of a hand-written regex comment/string stripper). The stripper's
// internal helpers (stripComments, stripCommentsAndStrings, MODULE_IMPORT_PATTERN)
// are gone; parseSource/importsRepairToolModule/callsGuardEntryPoint replace
// them and are tested directly below, alongside classifyToolFile end-to-end.
//
//   node --test scripts/ci/tests/require-repair-tool-module.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  callsGuardEntryPoint,
  classifyToolFile,
  EXEMPTION_PATTERN,
  importsRepairToolModule,
  parseSource,
  TOOL_FILENAME_PATTERN,
} from '../require-repair-tool-module.mjs';

const FIXTURE_WITHOUT_IMPORT = `/** A brand-new repair tool that re-typed the guards. */
import { db } from '@ipodhan/shared';
const APPLY = process.argv.includes('--apply');
if (APPLY && process.env.DATABASE_NAME === 'ipodhan') process.exit(1);
`;

const FIXTURE_WITH_IMPORT = `/** A brand-new repair tool that uses the shared module. */
import { openRepairDb, upsertFieldSource } from './lib/repair-tool.js';

async function main() {
  await openRepairDb(db, { apply: APPLY, allowProd: false, toolName: 'x' });
}
`;

// Round 2 (Tier A MODERATE): importing the module is not USING it — a tool that
// pulls in only writeLedgerFile still writes prod completely unguarded.
const FIXTURE_IMPORTED_BUT_GUARD_NOT_CALLED = `import { writeLedgerFile } from './lib/repair-tool.js';
const APPLY = process.argv.includes('--apply');
if (APPLY && process.env.DATABASE_NAME === 'ipodhan') process.exit(1);
`;

test('RED: a repair-*.ts fixture that does not import the module is a violation', () => {
  const r = classifyToolFile('repair-fixture-t000.ts', FIXTURE_WITHOUT_IMPORT);
  assert.equal(r.verdict, 'violation');
  assert.match(r.message, /does not import/);
});

test('RED: a backfill-*.ts fixture that does not import the module is a violation', () => {
  const r = classifyToolFile('backfill-fixture-t000.ts', FIXTURE_WITHOUT_IMPORT);
  assert.equal(r.verdict, 'violation');
});

test('GREEN: the same fixture passes once it imports scripts/lib/repair-tool.ts', () => {
  const r = classifyToolFile('repair-fixture-t000.ts', FIXTURE_WITH_IMPORT);
  assert.equal(r.verdict, 'ok');
});

test('RED: imported but openRepairDb() never called — importing the module is not using it', () => {
  const r = classifyToolFile('repair-fixture-t000.ts', FIXTURE_IMPORTED_BUT_GUARD_NOT_CALLED);
  assert.equal(r.verdict, 'violation');
  assert.equal(r.imported, true);
  assert.equal(r.guardCalled, false);
  assert.match(r.message, /never calls openRepairDb/);
});

test('RED: an import that only appears inside a COMMENT does not satisfy the lint', () => {
  const commented = `// import { openRepairDb } from './lib/repair-tool.js';
/* import { openRepairDb } from './lib/repair-tool.js'; openRepairDb(db); */
${FIXTURE_WITHOUT_IMPORT}`;
  const r = classifyToolFile('repair-fixture-t000.ts', commented);
  assert.equal(r.verdict, 'violation');
  assert.equal(r.imported, false);
  assert.equal(r.guardCalled, false);
});

test('RED: an import and a guard call that only appear inside a STRING do not satisfy the lint', () => {
  const stringy = `const template = "import { openRepairDb } from './lib/repair-tool.js';";
const call = 'openRepairDb(db)';
${FIXTURE_WITHOUT_IMPORT}`;
  const r = classifyToolFile('repair-fixture-t000.ts', stringy);
  assert.equal(r.verdict, 'violation');
  assert.equal(r.guardCalled, false);
});

test('MUTATION: callsGuardEntryPoint finds the real call, ignores a comment and a string with the same text', () => {
  const src = `import { openRepairDb } from './lib/repair-tool.js';\n// openRepairDb(fake);\nconst s = 'openRepairDb(';\nopenRepairDb(db);\n`;
  assert.equal(callsGuardEntryPoint(parseSource('t.ts', src)), true);
});

test('MUTATION: callsGuardEntryPoint is false when the only occurrence is in a comment/string', () => {
  const src = `// openRepairDb(fake);\nconst s = 'openRepairDb(';\n`;
  assert.equal(callsGuardEntryPoint(parseSource('t.ts', src)), false);
});

// T-492 round 2 (#390): a `//` INSIDE a template-literal URL used to be
// treated as a line-comment start by the old three-pass regex stripper. The
// AST parser has no such ambiguity — a TemplateExpression is one node.
test('GREEN: a template-literal URL containing "//" no longer breaks the guard-call check', () => {
  const fixture = `import { openRepairDb } from './lib/repair-tool.js';
async function fetchReport(year) {
  const u = \`https://webnodejs.chittorgarh.com/cloud/report/data-read/118/1/10/\${year}\`;
  return fetch(u);
}
async function main() {
  await openRepairDb(db, { apply: APPLY, allowProd: false, toolName: 'x' });
}
`;
  const r = classifyToolFile('backfill-fixture-url.ts', fixture);
  assert.equal(r.verdict, 'ok');
});

// #694: the exact class this issue reports, reproduced with the PROVEN
// repro (two bare-quote regex literals sandwiching the real call — measured
// against the OLD implementation via `git show HEAD^` before this fix: it
// desyncs on the first `/"/g`'s quote, treats everything up to the SECOND
// `/"/g`'s quote as one unterminated string, and swallows the real
// openRepairDb() call in between, reading as verdict 'violation'/guardCalled
// false). A single regex literal with an even number of internal quotes
// (e.g. `/<a\s+href="([^"]+)"/i`, 3 quote chars but a trailing unmatched one
// that finds no further double-quote to pair with) does NOT reliably
// reproduce the bug — the two-regex fixture below is what #694 and the old
// test suite's "DOCUMENTED FALSE-POSITIVE" test actually proved broken.
// The AST parser recognises a RegularExpressionLiteral as its own node kind
// (never a string), so both fixtures are correctly GREEN now — flipping the
// old test's "documented false-positive" assertion is the point of #694,
// not a silent regression: this is the fix landing.
test('#694 GREEN: two bare-quote regex literals sandwiching openRepairDb() no longer swallow the real call', () => {
  const fixture = `import { openRepairDb } from './lib/repair-tool.js';
const QUOTE_A = /"/g;
async function main() {
  await openRepairDb(db, { apply: APPLY, allowProd: false, toolName: 'x' });
}
const QUOTE_B = /"/g;
`;
  const r = classifyToolFile('repair-fixture-t694.ts', fixture);
  assert.equal(r.verdict, 'ok');
});

test('#694 GREEN: an href-matching regex literal with an internal quote does not break the guard-call check', () => {
  const fixture = `import { openRepairDb } from './lib/repair-tool.js';
const HREF_PATTERN = /<a\\s+href="([^"]+)"/i;
async function main() {
  await openRepairDb(db, { apply: APPLY, allowProd: false, toolName: 'x' });
}
`;
  const r = classifyToolFile('repair-fixture-t694-href.ts', fixture);
  assert.equal(r.verdict, 'ok');
});

// #694's other direction: a real openRepairDb( call that sits ONLY inside a
// string literal (never executed) must still be a violation — the fix must
// not become MORE permissive, only correctly context-aware.
test('#694 RED: openRepairDb( written only inside a string literal (not real code) is still a violation', () => {
  const fixture = `import { openRepairDb } from './lib/repair-tool.js';
const QUOTE_A = /"/g;
const note = "call openRepairDb(db) yourself";
const QUOTE_B = /"/g;
`;
  const r = classifyToolFile('repair-fixture-t694b.ts', fixture);
  assert.equal(r.verdict, 'violation');
  assert.equal(r.imported, true);
  assert.equal(r.guardCalled, false);
});

test('importsRepairToolModule matches a relative and a deep specifier, not an unrelated one', () => {
  assert.equal(
    importsRepairToolModule(parseSource('t.ts', `import { openRepairDb } from './lib/repair-tool.js';`)),
    true
  );
  assert.equal(
    importsRepairToolModule(
      parseSource('t.ts', `import {\n  openRepairDb,\n} from '../../scraper/scripts/lib/repair-tool.js';`)
    ),
    true
  );
  assert.equal(
    importsRepairToolModule(parseSource('t.ts', `import { x } from './lib/chittorgarh-report82-discovery.js';`)),
    false
  );
  // must be a real import declaration — a bare specifier inside an expression is not an import
  assert.equal(
    importsRepairToolModule(parseSource('t.ts', `const s = "from './lib/repair-tool.js'";`)),
    false
  );
});

test('GREEN: a dated exemption with a real reason is accepted', () => {
  const r = classifyToolFile(
    'repair-fixture-t000.ts',
    `// repair-tool-exempt: 2026-09-07 read-only report, never writes to the DB\n${FIXTURE_WITHOUT_IMPORT}`
  );
  assert.equal(r.verdict, 'exempt');
  assert.equal(r.date, '2026-09-07');
});

test('an UNDATED exemption is not accepted — the marker must carry a date', () => {
  const r = classifyToolFile(
    'repair-fixture-t000.ts',
    `// repair-tool-exempt: read-only report, never writes to the DB\n${FIXTURE_WITHOUT_IMPORT}`
  );
  assert.equal(r.verdict, 'violation');
});

test('an exemption with no reason is not accepted — the marker must say why', () => {
  const r = classifyToolFile('repair-fixture-t000.ts', `// repair-tool-exempt: 2026-09-07 nope\n${FIXTURE_WITHOUT_IMPORT}`);
  assert.equal(r.verdict, 'violation');
});

test('non-tool files in the same directory are ignored', () => {
  for (const name of ['reset-document.ts', 'merge-duplicate-ipos.ts', 'audit-something.mjs', 'lib']) {
    assert.equal(classifyToolFile(name, FIXTURE_WITHOUT_IMPORT).verdict, 'not-a-tool');
  }
});

test('MUTATION: the filename pattern still matches both tool prefixes', () => {
  assert.ok(TOOL_FILENAME_PATTERN.test('repair-x.ts'));
  assert.ok(TOOL_FILENAME_PATTERN.test('backfill-x.ts'));
  assert.ok(!TOOL_FILENAME_PATTERN.test('repair-x.test.mjs'));
});

test('MUTATION: the exemption pattern requires a date and a 10+ char reason', () => {
  assert.ok(EXEMPTION_PATTERN.test('// repair-tool-exempt: 2026-09-07 a good long reason'));
  assert.ok(!EXEMPTION_PATTERN.test('// repair-tool-exempt: 2026-09-07 short'));
  assert.ok(!EXEMPTION_PATTERN.test('// repair-tool-exempt: no date at all here'));
});
