/**
 * Coverage negative grep (T-470, issue #197, "G-L").
 *
 * Aggregate coverage percentage does not tell you WHICH surface is untested
 * — a named gap does. T-285 P1-1: NCDTable/OFSTable/RightsIssuesTabs had
 * zero tests, and that is exactly where the eight-month blank-page bug
 * lived. This test lists every shipped data-shaped component
 * (`*{Table,Tabs,List,Grid,Chart}.tsx`) and fails, naming the file, if its
 * basename appears in zero files under web/tests/**.
 *
 * A component that genuinely needs no test goes in
 * config/coverage-negative-grep-allowlist.json's `web` array with a
 * one-line reason — never a silent skip.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname, relative } from 'node:path';

// vitest's jsdom environment does not reliably expose `import.meta.url` as a
// file:// URL; process.cwd() is vitest's configured root (web/) for every
// run (npx vitest from web/, or `cd web && npm run test:unit`).
const WEB_ROOT = process.cwd();
const REPO_ROOT = join(WEB_ROOT, '..');
const COMPONENTS_DIR = join(WEB_ROOT, 'components');
const TESTS_DIR = join(WEB_ROOT, 'tests');
const ALLOWLIST_PATH = join(REPO_ROOT, 'config', 'coverage-negative-grep-allowlist.json');
const BASELINE_PATH = join(REPO_ROOT, 'config', 'coverage-negative-grep-baseline.json');

const DATA_COMPONENT_SUFFIX = /(Table|Tabs|List|Grid|Chart)\.tsx$/;
const EXCLUDED_DIR_NAMES = new Set(['node_modules', '.next', 'coverage']);

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

function loadAllowlist(): Set<string> {
  const raw = JSON.parse(readFileSync(ALLOWLIST_PATH, 'utf8'));
  const web = Array.isArray(raw.web) ? raw.web : [];
  for (const entry of web) {
    if (!entry || typeof entry.name !== 'string' || typeof entry.reason !== 'string' || entry.reason.trim().length < 1) {
      throw new Error(
        `config/coverage-negative-grep-allowlist.json: web entry ${JSON.stringify(entry)} must be {"name": "...", "reason": "..."} with a non-empty reason`
      );
    }
  }
  return new Set(web.map((e: { name: string }) => e.name));
}

function loadBaseline(): Set<string> {
  const raw = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));
  const web = Array.isArray(raw.web) ? raw.web : [];
  return new Set(web);
}

describe('coverage negative grep — web data components (L1)', () => {
  const componentFiles = walk(COMPONENTS_DIR).filter((f) => DATA_COMPONENT_SUFFIX.test(f) && extname(f) === '.tsx');
  const testFiles = walk(TESTS_DIR).filter((f) => /\.(test|spec)\.tsx?$/.test(f));
  const testFileContents = testFiles.map((f) => readFileSync(f, 'utf8'));
  const allowlist = loadAllowlist();

  it('found at least one data component and one test file (sanity — a 0/0 pass here would be a false green)', () => {
    expect(componentFiles.length).toBeGreaterThan(0);
    expect(testFiles.length).toBeGreaterThan(0);
  });

  it('no NEW untested data component beyond the committed baseline, and no stale baseline entry (ratchet)', () => {
    const baseline = loadBaseline();
    const currentGaps = new Set<string>();
    for (const file of componentFiles) {
      const basename = file.split(/[\\/]/).pop()!.replace(/\.tsx$/, '');
      if (allowlist.has(basename)) continue;
      const covered = testFileContents.some((content) => content.includes(basename));
      if (!covered) currentGaps.add(basename);
    }

    const newGaps = [...currentGaps].filter((name) => !baseline.has(name));
    const staleBaselineEntries = [...baseline].filter((name) => !currentGaps.has(name));

    const problems: string[] = [];
    if (newGaps.length > 0) {
      problems.push(
        `${newGaps.length} NEW untested data component(s) not in config/coverage-negative-grep-baseline.json ` +
          `(the baseline only shrinks — a new gap is a regression, not free debt):\n  - ${newGaps.join('\n  - ')}`
      );
    }
    if (staleBaselineEntries.length > 0) {
      problems.push(
        `${staleBaselineEntries.length} baseline entr(y/ies) no longer match a real gap (now tested, or moved to ` +
          `the allowlist) — remove from config/coverage-negative-grep-baseline.json's "web" array in this PR:\n  - ${staleBaselineEntries.join('\n  - ')}`
      );
    }
    if (problems.length > 0) throw new Error(problems.join('\n\n'));
    expect(problems).toEqual([]);
  });
});
