#!/usr/bin/env node
/**
 * Detection check for the class behind PR #989's staging break (run 36024250816,
 * 2026-09-24): packages/shared/src uses NodeNext-style `.js`-suffixed relative
 * imports (tsc/tsx map .js -> .ts at compile time; webpack's default resolver
 * does not). `next build`'s webpack pass fails with "Module not found: Can't
 * resolve './foo.js'" the moment such an import becomes reachable from web —
 * and the PR gate never runs `next build`, so this was invisible to CI.
 *
 * This script is the cheap stand-in for running `next build` on every PR:
 * it finds every `.js`-suffixed relative import in packages/shared/src whose
 * literal target file does not exist (i.e. it only resolves via the .js->.ts
 * remap tsc/tsx do), and requires web/next.config.mjs to carry the matching
 * webpack `resolve.extensionAlias` fix — the one thing that makes such an
 * import resolvable under webpack too. Exits 1 naming every offending import
 * when the guard is missing; exits 0 (with a count) when it is present.
 */
import { readFileSync, existsSync } from 'node:fs';
import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');
const sharedSrc = path.join(repoRoot, 'packages', 'shared', 'src');
const nextConfigPath = path.join(repoRoot, 'web', 'next.config.mjs');

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}

const importRe = /from\s+['"](\.\.?\/[^'"]+\.js)['"]/g;
const offenders = [];

for (const file of walk(sharedSrc)) {
  const text = readFileSync(file, 'utf8');
  let m;
  while ((m = importRe.exec(text))) {
    const target = path.resolve(path.dirname(file), m[1]);
    if (!existsSync(target)) {
      offenders.push(`${path.relative(repoRoot, file)}: imports '${m[1]}' (no literal .js file — resolves only via tsc's .js->.ts remap)`);
    }
  }
}

if (offenders.length === 0) {
  console.log('check-shared-js-imports-resolve: no .js-suffixed relative imports found in packages/shared/src — nothing to guard.');
  process.exit(0);
}

const nextConfig = existsSync(nextConfigPath) ? readFileSync(nextConfigPath, 'utf8') : '';
const hasAlias = /extensionAlias/.test(nextConfig) && /'\.js'\s*:\s*\[\s*['"]\.ts['"]/.test(nextConfig);

console.log(`check-shared-js-imports-resolve: ${offenders.length} .js-suffixed import(s) in packages/shared/src resolve only via tsc's remap:`);
for (const o of offenders) console.log(`  - ${o}`);

if (!hasAlias) {
  console.error(
    `\nFAIL: web/next.config.mjs does not configure webpack resolve.extensionAlias for '.js' -> ['.ts','.tsx','.js'].\n` +
    `Without it, 'next build' fails with "Module not found: Can't resolve './...js'" the moment any of the\n` +
    `${offenders.length} import(s) above becomes reachable from web (this is exactly what broke staging run 36024250816).\n`
  );
  process.exit(1);
}

console.log(`\nPASS: web/next.config.mjs carries the extensionAlias guard, so these imports resolve under webpack too.`);
process.exit(0);
