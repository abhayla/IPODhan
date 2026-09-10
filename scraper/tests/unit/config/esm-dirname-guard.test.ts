import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

/**
 * Class guard (#493): scraper/src/** and packages/shared/src/** are ESM
 * ("type": "module"), where __dirname/__filename do not exist unless a file
 * defines them itself via fileURLToPath(import.meta.url). vitest's transform
 * silently supplies __dirname for every test, so a normal unit test of the
 * loader's behavior CANNOT catch this class (RCA: field-manifest-loader.ts
 * used __dirname without defining it and threw under real Node ESM). This
 * test statically scans source files instead of importing them, so it
 * catches every member of the class, present and future, not just the one
 * instance that was reported.
 *
 * Shrink-only baseline (same shape as config/coverage-negative-grep-baseline.json
 * and config/module-boundary-baseline.json): config/esm-dirname-guard-baseline.json
 * lists KNOWN offenders (today: one file from lane B's PR #487, out of this
 * guard's own PR's scope to fix). A NEW offender not in the baseline fails the
 * gate (regression). A baseline entry that no longer offends (fixed) also
 * fails the gate until removed in the same PR — that is what makes "shrink
 * only" enforced instead of aspirational.
 */

const REPO_ROOT = path.join(__dirname, '../../../..');
const SRC_ROOTS = [
  path.join(__dirname, '../../../src'),
  path.join(__dirname, '../../../../packages/shared/src'),
];
const BASELINE_PATH = path.join(REPO_ROOT, 'config', 'esm-dirname-guard-baseline.json');

function listTsFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listTsFiles(full));
    } else if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
      out.push(full);
    }
  }
  return out;
}

function usesUndefinedDirnameOrFilename(content: string): boolean {
  const usesDirname = /\b__dirname\b/.test(content);
  const usesFilename = /\b__filename\b/.test(content);
  if (!usesDirname && !usesFilename) return false;

  const definesFilename = /const\s+__filename\s*=\s*fileURLToPath\s*\(/.test(content);
  const definesDirname = /const\s+__dirname\s*=\s*dirname\s*\(\s*__filename\s*\)/.test(content);

  if (usesFilename && !definesFilename) return true;
  if (usesDirname && !definesDirname) return true;
  return false;
}

function loadBaseline(): Set<string> {
  const raw = JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8'));
  const files = Array.isArray(raw.files) ? raw.files : [];
  for (const entry of files) {
    if (!entry || typeof entry.path !== 'string' || typeof entry.why !== 'string' || entry.why.trim().length < 1) {
      throw new Error(
        `config/esm-dirname-guard-baseline.json: entry ${JSON.stringify(entry)} must be {"path": "...", "why": "..."} with a non-empty why`
      );
    }
  }
  return new Set(files.map((e: { path: string }) => e.path));
}

describe('ESM __dirname/__filename guard (class for #493)', () => {
  const files = SRC_ROOTS.flatMap(listTsFiles);

  it('found at least one source file to scan', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it('every file referencing __dirname/__filename defines it via fileURLToPath(import.meta.url), modulo the shrink-only baseline', () => {
    const offenders = new Set(
      files
        .filter((f) => usesUndefinedDirnameOrFilename(fs.readFileSync(f, 'utf-8')))
        .map((f) => path.relative(REPO_ROOT, f).split(path.sep).join('/'))
    );
    const baseline = loadBaseline();

    const newOffenders = [...offenders].filter((f) => !baseline.has(f));
    const staleBaselineEntries = [...baseline].filter((f) => !offenders.has(f));

    const problems: string[] = [];
    if (newOffenders.length > 0) {
      problems.push(
        `${newOffenders.length} NEW file(s) reference __dirname/__filename without defining it, not in ` +
          `config/esm-dirname-guard-baseline.json (the baseline only shrinks):\n  - ${newOffenders.join('\n  - ')}`
      );
    }
    if (staleBaselineEntries.length > 0) {
      problems.push(
        `${staleBaselineEntries.length} baseline file(s) no longer offend — remove from ` +
          `config/esm-dirname-guard-baseline.json's "files" array in this PR:\n  - ${staleBaselineEntries.join('\n  - ')}`
      );
    }
    if (problems.length > 0) throw new Error(problems.join('\n\n'));
    expect(problems).toEqual([]);
  });
});
