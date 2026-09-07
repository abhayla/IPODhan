/**
 * Coverage negative grep, scraper twin (T-470, issue #197, "G-L").
 *
 * T-272 P1-1: PRICE_BAND appeared zero times in
 * scraper/tests/unit/utils/data-validation.test.ts, and the price band was
 * wrong on 82% of the database. Aggregate coverage percentage did not flag
 * it; the named untested rule would have. This test asserts:
 *
 *   L2 — every validation rule name (`rule: 'X_Y'` literal) declared in
 *        scraper/src/utils/data-validation.ts appears in >=1 file under
 *        scraper/tests/**.
 *   L3 — every field key registered in
 *        scraper/src/config/field-priority-matrix.ts's FIELD_PRIORITY_MATRIX
 *        appears in >=1 file under scraper/tests/**.
 *
 * A rule/field that genuinely needs no direct test goes in
 * config/coverage-negative-grep-allowlist.json's `scraper.validationRules`
 * or `scraper.priorityMatrixFields` array with a one-line reason — never a
 * silent skip.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const SCRAPER_ROOT = join(__dirname, '..', '..', '..');
const REPO_ROOT = join(SCRAPER_ROOT, '..');
const VALIDATION_FILE = join(SCRAPER_ROOT, 'src', 'utils', 'data-validation.ts');
const MATRIX_FILE = join(SCRAPER_ROOT, 'src', 'config', 'field-priority-matrix.ts');
const TESTS_DIR = join(SCRAPER_ROOT, 'tests');
const ALLOWLIST_PATH = join(REPO_ROOT, 'config', 'coverage-negative-grep-allowlist.json');
const BASELINE_PATH = join(REPO_ROOT, 'config', 'coverage-negative-grep-baseline.json');

const EXCLUDED_DIR_NAMES = new Set(['node_modules']);

function walk(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (EXCLUDED_DIR_NAMES.has(entry)) continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

function loadAllowlist(): { rules: Set<string>; fields: Set<string> } {
  const raw = JSON.parse(readFileSync(ALLOWLIST_PATH, 'utf8'));
  const scraper = raw.scraper && typeof raw.scraper === 'object' ? raw.scraper : {};
  const rules = Array.isArray(scraper.validationRules) ? scraper.validationRules : [];
  const fields = Array.isArray(scraper.priorityMatrixFields) ? scraper.priorityMatrixFields : [];
  for (const entry of [...rules, ...fields]) {
    if (!entry || typeof entry.name !== 'string' || typeof entry.reason !== 'string' || entry.reason.trim().length < 1) {
      throw new Error(
        `config/coverage-negative-grep-allowlist.json: scraper entry ${JSON.stringify(entry)} must be {"name": "...", "reason": "..."} with a non-empty reason`
      );
    }
  }
  return {
    rules: new Set(rules.map((e: { name: string }) => e.name)),
    fields: new Set(fields.map((e: { name: string }) => e.name)),
  };
}

function loadBaseline(): { rules: Set<string>; fields: Set<string> } {
  const raw = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));
  const rules = Array.isArray(raw.scraperValidationRules) ? raw.scraperValidationRules : [];
  const fields = Array.isArray(raw.scraperPriorityMatrixFields) ? raw.scraperPriorityMatrixFields : [];
  return { rules: new Set(rules), fields: new Set(fields) };
}

/** `rule: 'SOME_RULE_NAME'` literals — the identifiers validateIPOData() actually emits. */
function extractRuleNames(source: string): string[] {
  const matches = source.matchAll(/rule:\s*'([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)'/g);
  return [...new Set([...matches].map((m) => m[1]))];
}

/** Top-level keys of `export const FIELD_PRIORITY_MATRIX: Record<string, FieldRules> = { ... }`. */
function extractMatrixFieldKeys(source: string): string[] {
  const start = source.indexOf('export const FIELD_PRIORITY_MATRIX');
  if (start === -1) throw new Error('FIELD_PRIORITY_MATRIX not found in field-priority-matrix.ts — extraction regex is stale');
  const openBrace = source.indexOf('{', start);
  let depth = 0;
  let end = openBrace;
  for (let i = openBrace; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  const body = source.slice(openBrace + 1, end);
  const matches = body.matchAll(/^\s{2}([a-zA-Z_][a-zA-Z0-9_]*):\s*\{/gm);
  return [...new Set([...matches].map((m) => m[1]))];
}

describe('coverage negative grep — scraper validation rules and priority-matrix fields (L2/L3)', () => {
  const validationSource = readFileSync(VALIDATION_FILE, 'utf8');
  const matrixSource = readFileSync(MATRIX_FILE, 'utf8');
  const ruleNames = extractRuleNames(validationSource);
  const fieldKeys = extractMatrixFieldKeys(matrixSource);
  const testFiles = walk(TESTS_DIR).filter((f) => /\.(test|spec)\.ts$/.test(f));
  const testFileContents = testFiles.map((f) => readFileSync(f, 'utf8'));
  const allowlist = loadAllowlist();

  it('extracted a non-trivial number of rule names and field keys (sanity — a 0-length list would be a false green)', () => {
    expect(ruleNames.length).toBeGreaterThan(5);
    expect(fieldKeys.length).toBeGreaterThan(5);
  });

  it('no NEW untested validation rule beyond the committed baseline, and no stale baseline entry (ratchet, L2)', () => {
    const baseline = loadBaseline();
    const currentGaps = new Set(ruleNames.filter((name) => !allowlist.rules.has(name) && !testFileContents.some((c) => c.includes(name))));

    const newGaps = [...currentGaps].filter((name) => !baseline.rules.has(name));
    const staleBaselineEntries = [...baseline.rules].filter((name) => !currentGaps.has(name));

    const problems: string[] = [];
    if (newGaps.length > 0) {
      problems.push(
        `${newGaps.length} NEW untested validation rule(s) not in config/coverage-negative-grep-baseline.json ` +
          `(the baseline only shrinks):\n  - ${newGaps.join('\n  - ')}`
      );
    }
    if (staleBaselineEntries.length > 0) {
      problems.push(
        `${staleBaselineEntries.length} baseline rule(s) no longer match a real gap — remove from ` +
          `config/coverage-negative-grep-baseline.json's "scraperValidationRules" array in this PR:\n  - ${staleBaselineEntries.join('\n  - ')}`
      );
    }
    if (problems.length > 0) throw new Error(problems.join('\n\n'));
    expect(problems).toEqual([]);
  });

  it('no NEW untested priority-matrix field beyond the committed baseline, and no stale baseline entry (ratchet, L3)', () => {
    const baseline = loadBaseline();
    const currentGaps = new Set(fieldKeys.filter((key) => !allowlist.fields.has(key) && !testFileContents.some((c) => c.includes(key))));

    const newGaps = [...currentGaps].filter((name) => !baseline.fields.has(name));
    const staleBaselineEntries = [...baseline.fields].filter((name) => !currentGaps.has(name));

    const problems: string[] = [];
    if (newGaps.length > 0) {
      problems.push(
        `${newGaps.length} NEW untested priority-matrix field(s) not in config/coverage-negative-grep-baseline.json ` +
          `(the baseline only shrinks):\n  - ${newGaps.join('\n  - ')}`
      );
    }
    if (staleBaselineEntries.length > 0) {
      problems.push(
        `${staleBaselineEntries.length} baseline field(s) no longer match a real gap — remove from ` +
          `config/coverage-negative-grep-baseline.json's "scraperPriorityMatrixFields" array in this PR:\n  - ${staleBaselineEntries.join('\n  - ')}`
      );
    }
    if (problems.length > 0) throw new Error(problems.join('\n\n'));
    expect(problems).toEqual([]);
  });
});
