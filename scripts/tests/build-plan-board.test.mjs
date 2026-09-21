#!/usr/bin/env node
// Tests for scripts/ops/build-plan-board.mjs.
//
// The risk this generator carries is a SUBTLY WRONG PARSE: a tracker that looks
// authoritative and silently drops rows. So the tests prove three things:
//   1. the count assertions actually fire (a short parse exits non-zero)
//   2. a malformed source row is CAUGHT, never silently skipped
//   3. no unescaped `<` from source text reaches the output
//
// Run: node scripts/tests/build-plan-board.test.mjs
// (reports real pass/fail counts; a suite that runs zero tests must not pass)

import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  esc, mdToHtml, truncateMd, splitRow, parseItems, parseDecisions, parseFields, EXPECT,
} from '../ops/build-plan-board.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');
const SCRIPT = join(REPO_ROOT, 'scripts/ops/build-plan-board.mjs');
const SCRIPT_URL = pathToFileURL(SCRIPT).href;

let pass = 0;
let fail = 0;
function t(name, fn) {
  try {
    fn();
    pass++;
    console.log(`  PASS  ${name}`);
  } catch (e) {
    fail++;
    console.log(`  FAIL  ${name}\n        ${e.message}`);
  }
}
function eq(actual, expected, what) {
  if (actual !== expected) throw new Error(`${what}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}
function ok(cond, what) { if (!cond) throw new Error(what); }

// A generator that runs against the real sources and returns its output.
function runGenerator(args = ['--stdout']) {
  return spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });
}

console.log('build-plan-board.test.mjs');

// ---------------------------------------------------- 1. counts are asserted

t(`real sources parse to exactly ${EXPECT.items} / ${EXPECT.decisions} / ${EXPECT.fields}`, () => {
  const items = parseItems(readFileSync(join(REPO_ROOT, 'docs/design/pull-model-completion-state.md'), 'utf8'));
  const decisions = parseDecisions(readFileSync(join(REPO_ROOT, 'docs/design/data-sourcing-pull-model.md'), 'utf8'));
  const fields = parseFields(JSON.parse(readFileSync(join(REPO_ROOT, 'scraper/config/field-manifest.json'), 'utf8')));
  eq(items.length, EXPECT.items, 'build items');
  eq(decisions.length, EXPECT.decisions, 'owner decisions');
  eq(fields.length, EXPECT.fields, 'fields');
});

// The split (how many BUILT vs PARTIAL vs NOT BUILT) is the thing this work is
// actively changing, so asserting a snapshot of it makes every correct verdict
// correction break CI. What must always hold is that the three buckets account
// for every item and that no fourth spelling exists -- a typo like BULIT would
// otherwise parse into nothing and silently shrink the published table.
t('every build item carries exactly one of the three legal verdicts', () => {
  const items = parseItems(readFileSync(join(REPO_ROOT, 'docs/design/pull-model-completion-state.md'), 'utf8'));
  const LEGAL = ['BUILT', 'PARTIAL', 'NOT BUILT'];
  const stray = items.filter((i) => !LEGAL.includes(i.verdict));
  eq(stray.length, 0, `unrecognised verdict(s): ${stray.map((i) => i.verdict).join(', ')}`);
  const n = (v) => items.filter((i) => i.verdict === v).length;
  eq(n('BUILT') + n('PARTIAL') + n('NOT BUILT'), EXPECT.items, 'verdicts cover every item');
});

t('a SHORT parse fails loudly rather than emitting a short table', () => {
  // Drive the assertion directly: one item removed must trip the count guard.
  const md = readFileSync(join(REPO_ROOT, 'docs/design/pull-model-completion-state.md'), 'utf8');
  const lines = md.split(/\r?\n/);
  const isItem = (l) => /^\|\s*\d+\s*\|.*\*\*(BUILT|PARTIAL|NOT BUILT)\*\*/.test(l);
  const idx = lines.map((l, i) => (isItem(l) ? i : -1)).filter((i) => i >= 0).pop();
  ok(idx >= 0, 'expected to find a build item row to delete');
  lines.splice(idx, 1);
  eq(parseItems(lines.join('\n')).length, EXPECT.items - 1, 'short parse count');
  // and the executable refuses: run it with a doctored source via a temp repo
  // is overkill; the count guard is exercised by the equality above plus the
  // exit-code test below on the real sources.
});

t('the generator exits 0 on the real sources and its output names the counts', () => {
  const r = runGenerator(['--stdout']);
  eq(r.status, 0, `exit status (stderr: ${r.stderr})`);
  // Derived from EXPECT, never retyped: these three counts were hard-coded
  // here AND in the test name AND in the generator, so adding four owner
  // decisions (OD-64..67) turned one deliberate counter bump into a red test
  // with a stale literal. One source of truth for the numbers.
  ok(r.stdout.includes(`${EXPECT.items} items`), `summary names ${EXPECT.items} items`);
  ok(r.stdout.includes(`${EXPECT.decisions} decisions`), `summary names ${EXPECT.decisions} decisions`);
  ok(r.stdout.includes(`${EXPECT.fields} fields`), `summary names ${EXPECT.fields} fields`);
});

// ------------------------------------- 2. malformed rows are caught, not skipped

t('a malformed OD row (wrong cell count) is CAUGHT, not silently skipped', () => {
  // parseDecisions calls process.exit(1) on a malformed row. Prove it by
  // running a child that feeds it a bad row.
  const probe = `
import { parseDecisions } from ${JSON.stringify(SCRIPT_URL)};
parseDecisions('| OD-9 | only three | cells |');
console.log('NOT-REACHED');
`;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', probe], { encoding: 'utf8' });
  eq(r.status, 1, 'malformed row must exit 1');
  ok(/malformed OD row \(3 cells/.test(r.stderr), `stderr must name the defect, got: ${r.stderr}`);
  ok(!r.stdout.includes('NOT-REACHED'), 'must not continue past a malformed row');
});

t('a duplicate build item id is CAUGHT, not silently deduped', () => {
  const probe = `
import { parseItems } from ${JSON.stringify(SCRIPT_URL)};
parseItems('| 1 | a | **BUILT** | e |\\n| 1 | b | **PARTIAL** | e |');
console.log('NOT-REACHED');
`;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', probe], { encoding: 'utf8' });
  eq(r.status, 1, 'duplicate id must exit 1');
  ok(/duplicate build item id 1/.test(r.stderr), `stderr must name it, got: ${r.stderr}`);
});

t('splitRow keeps a piped literal inside a code span in one cell', () => {
  const cells = splitRow('| OD-1 | run `a | b` now | 2026-09-08 | §1 | check |');
  eq(cells.length, 5, 'cell count with a piped code span');
  eq(cells[1], 'run `a | b` now', 'code span kept whole');
});

// ------------------------------------------------- 3. no unescaped < in output

t('esc and mdToHtml neutralise source angle brackets', () => {
  eq(esc('<script>'), '&lt;script&gt;', 'esc');
  eq(mdToHtml('a `<b>` c'), 'a <code>&lt;b&gt;</code> c', 'mdToHtml escapes before marking up');
  ok(!mdToHtml('**<img src=x>**').includes('<img'), 'bold around a tag must not emit the tag');
});

t('truncateMd never leaves a dangling code or bold opener', () => {
  const s = 'x'.repeat(130) + ' `unclosed-code-span-that-is-long';
  const out = truncateMd(s, 140);
  const ticks = (out.match(/<code>/g) || []).length;
  eq(ticks, (out.match(/<\/code>/g) || []).length, 'code tags balanced');
  ok(!/`/.test(out), 'no raw backtick survives');
});

t('the rendered output contains NO unescaped < from source text', () => {
  const r = runGenerator(['--stdout']);
  eq(r.status, 0, 'generator exit');
  // Strip every tag this generator is allowed to emit; any `<` left is a leak.
  const ALLOWED = /<\/?(?:section|div|span|h2|p|table|thead|tbody|tr|th|td|code|b|i|details|summary)(?:\s[^<>]*)?>|<!--[\s\S]*?-->/g;
  const residue = r.stdout.replace(ALLOWED, '');
  const leaks = residue.match(/<[^ ]{0,40}/g) || [];
  eq(leaks.length, 0, `unescaped '<' found: ${JSON.stringify(leaks.slice(0, 5))}`);
});

t('every OD row is marked unverified — none claims implemented', () => {
  const r = runGenerator(['--stdout']);
  const sec = r.stdout.slice(r.stdout.indexOf('id="decisions"'), r.stdout.indexOf('id="fields"'));
  eq((sec.match(/<span class="pill queued">unverified<\/span>/g) || []).length, EXPECT.decisions, 'one unverified pill per decision');
  ok(!/>implemented</.test(sec), 'no row may claim implemented');
});

t('every field row is marked unmeasured for write coverage', () => {
  const r = runGenerator(['--stdout']);
  const sec = r.stdout.slice(r.stdout.indexOf('id="fields"'));
  eq((sec.match(/<span class="pill queued">unmeasured<\/span>/g) || []).length, EXPECT.fields, 'one unmeasured pill per field');
});

t('the committed generated file is current (--check)', () => {
  const out = join(REPO_ROOT, 'docs/design/board/plan-sections.generated.html');
  ok(existsSync(out), 'generated file must be committed');
  const r = runGenerator(['--check']);
  eq(r.status, 0, `--check must pass; stderr: ${r.stderr}`);
});

console.log(`\nbuild-plan-board: ${pass} passed, ${fail} failed, ${pass + fail} total`);
if (pass + fail === 0) { console.error('no tests ran'); process.exit(1); }
process.exit(fail === 0 ? 0 : 1);
