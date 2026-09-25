#!/usr/bin/env node
// #461: `node --test <glob>` exits 0 silently when the glob matches zero
// files (measured on Node v22.20.0, 2026-09-10) — a "hollow gate" that can
// never fail once its target stops matching anything. A LITERAL path is
// safe (`node --test` exits 1 with "Could not find '<path>'" when it is
// missing), so the cheapest fix that covers this repo's ACTUAL exposure
// (16/16 sites literal at the time #461 was filed) is to forbid glob
// arguments to `node --test` in every workflow file, so the first
// tidier-looking `node --test scripts/ci/tests/*.test.mjs` edit fails CI
// instead of silently becoming a gate that can never fail.
//
// Usage: node scripts/ci/check-node-test-no-globs.mjs [dir]
//   dir defaults to .github/workflows relative to the repo root.
// Exit 0: every `node --test` argument in every workflow file is a literal
//         path (no glob metacharacters).
// Exit 1: at least one `node --test` argument contains a glob metacharacter
//         (* ? [ ] { }), printed with its file and the offending token.

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const GLOB_CHARS = /[*?[\]{}]/;

/**
 * Find every `node --test <token>` invocation in a workflow file's text and
 * return the argument tokens. Handles multi-line `run: |` blocks with `\`
 * continuations (each continued line is still matched independently, since
 * the regex operates on raw text, not per-line).
 */
export function extractNodeTestArgs(ymlText) {
  const args = [];
  const re = /node\s+--test\s+([^\s\\][^\s]*)/g;
  let m;
  while ((m = re.exec(ymlText)) !== null) {
    args.push(m[1]);
  }
  return args;
}

export function findGlobViolations(ymlText, fileLabel) {
  const violations = [];
  for (const arg of extractNodeTestArgs(ymlText)) {
    if (GLOB_CHARS.test(arg)) {
      violations.push({ file: fileLabel, arg });
    }
  }
  return violations;
}

export function checkWorkflowsDir(dir) {
  const violations = [];
  let files;
  try {
    files = readdirSync(dir).filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'));
  } catch (err) {
    if (err.code === 'ENOENT') return violations; // nothing to check
    throw err;
  }
  for (const file of files) {
    const path = join(dir, file);
    const text = readFileSync(path, 'utf8');
    violations.push(...findGlobViolations(text, file));
  }
  return violations;
}

function main() {
  const dir = process.argv[2] || join(process.cwd(), '.github', 'workflows');
  const violations = checkWorkflowsDir(dir);
  if (violations.length > 0) {
    console.error(
      `[check-node-test-no-globs] ${violations.length} glob-shaped \`node --test\` argument(s) found — ` +
        `\`node --test <glob>\` exits 0 when the glob matches nothing (#461, hollow gate):`
    );
    for (const v of violations) {
      console.error(`  ${v.file}: node --test ${v.arg}`);
    }
    console.error(
      '  Fix: use a literal path (or an explicit list of literal paths) instead of a glob, ' +
        'so a stale/renamed path fails loudly instead of silently passing.'
    );
    process.exit(1);
  }
  console.log('[check-node-test-no-globs] OK — every `node --test` argument in every workflow is a literal path.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
