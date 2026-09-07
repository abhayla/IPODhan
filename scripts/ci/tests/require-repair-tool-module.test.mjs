// T-490: mutation-proof self-test for the repair-tool-module lint.
//
// Imports the REAL predicates from scripts/ci/require-repair-tool-module.mjs,
// so weakening the import check or accepting an undated exemption turns a
// named test red before the lint can silently stop catching the class.
//
//   node --test scripts/ci/tests/require-repair-tool-module.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyToolFile,
  EXEMPTION_PATTERN,
  MODULE_IMPORT_PATTERN,
  stripComments,
  stripCommentsAndStrings,
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

test('MUTATION: stripCommentsAndStrings removes comments and string bodies but keeps real code', () => {
  const stripped = stripCommentsAndStrings(
    `import { openRepairDb } from './lib/repair-tool.js';\n// openRepairDb(fake);\nconst s = 'openRepairDb(';\nopenRepairDb(db);\n`
  );
  assert.match(stripped, /openRepairDb\(db\)/);
  assert.equal((stripped.match(/openRepairDb\s*\(/g) || []).length, 1);
});

// T-492 round 2 (#390): the single-pass tokenizer fix. A `//` INSIDE a
// template-literal URL used to be treated as a line-comment start by the old
// three-pass stripper (block comments, then line comments, then strings, run
// as separate sequential .replace() calls) because the line-comment pass ran
// BEFORE the string pass and had no idea it was inside a backtick. That left
// the backtick unclosed and desynced the string regex for the rest of the
// file, which is exactly what made all six #386 batch-1 tools read as
// "guard not called" even with openRepairDb() correctly wired in.
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

test('GREEN: stripCommentsAndStrings does not run away past a template-literal "//" URL', () => {
  const src = `const u = \`https://example.com/a\`;\nopenRepairDb(db);\n`;
  const stripped = stripCommentsAndStrings(src);
  assert.match(stripped, /openRepairDb\(db\)/);
});

// KNOWN LIMITATION (documented, not fixed here — fail-CLOSED, never silently
// accepting an unguarded tool): the tokenizer has no concept of a regex
// literal, so a bare `"` inside two separate `/.../ ` regex literals is read
// as two halves of one unterminated string spanning everything between them,
// swallowing a real openRepairDb() call in the middle. This is the safe
// failure direction (a false VIOLATION on a tool that IS guarded forces a
// human look — never a false OK on one that is NOT), so it is left as-is
// rather than papered over with a fragile regex-literal detector. If this
// ever fires on a real tool, fix by hand (reformat the regex or move the
// guard call before it) rather than loosening the check.
test('DOCUMENTED FALSE-POSITIVE: two regex literals each containing a bare quote can swallow a real openRepairDb() call', () => {
  const fixture = `import { openRepairDb } from './lib/repair-tool.js';
const QUOTE_A = /"/g;
async function main() {
  await openRepairDb(db, { apply: APPLY, allowProd: false, toolName: 'x' });
}
const QUOTE_B = /"/g;
`;
  const r = classifyToolFile('repair-fixture-regex-quotes.ts', fixture);
  // Fail-closed: this currently reads as a violation even though the guard
  // IS called. Asserting the CURRENT behavior here means a future tokenizer
  // improvement that fixes this has to consciously flip this assertion, not
  // silently regress the safe direction.
  assert.equal(r.verdict, 'violation');
  assert.equal(r.guardCalled, false);
});

test('MUTATION: stripComments keeps string literals, so a real import specifier still matches', () => {
  assert.match(stripComments(FIXTURE_WITH_IMPORT), /lib\/repair-tool\.js/);
  assert.doesNotMatch(stripComments(`// from './lib/repair-tool.js'`), /repair-tool/);
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

test('MUTATION: the import pattern matches a relative and a deep specifier, not an unrelated one', () => {
  assert.ok(MODULE_IMPORT_PATTERN.test(`import { openRepairDb } from './lib/repair-tool.js';`));
  assert.ok(MODULE_IMPORT_PATTERN.test(`import {\n  openRepairDb,\n} from '../../scraper/scripts/lib/repair-tool.js';`));
  assert.ok(!MODULE_IMPORT_PATTERN.test(`import { x } from './lib/chittorgarh-report82-discovery.js';`));
  // must be at statement position — a bare specifier inside an expression is not an import
  assert.ok(!MODULE_IMPORT_PATTERN.test(`const s = "from './lib/repair-tool.js'";`));
});

test('MUTATION: the exemption pattern requires a date and a 10+ char reason', () => {
  assert.ok(EXEMPTION_PATTERN.test('// repair-tool-exempt: 2026-09-07 a good long reason'));
  assert.ok(!EXEMPTION_PATTERN.test('// repair-tool-exempt: 2026-09-07 short'));
  assert.ok(!EXEMPTION_PATTERN.test('// repair-tool-exempt: no date at all here'));
});
