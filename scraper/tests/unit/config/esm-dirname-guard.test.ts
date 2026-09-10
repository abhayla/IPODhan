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
 */

const SRC_ROOTS = [
  path.join(__dirname, '../../../src'),
  path.join(__dirname, '../../../../packages/shared/src'),
];

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

describe('ESM __dirname/__filename guard (class for #493)', () => {
  const files = SRC_ROOTS.flatMap(listTsFiles);

  it('found at least one source file to scan', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it('every file referencing __dirname/__filename defines it via fileURLToPath(import.meta.url)', () => {
    const offenders = files
      .filter((f) => usesUndefinedDirnameOrFilename(fs.readFileSync(f, 'utf-8')))
      .map((f) => path.relative(path.join(__dirname, '../../../..'), f));

    expect(offenders).toEqual([]);
  });
});
