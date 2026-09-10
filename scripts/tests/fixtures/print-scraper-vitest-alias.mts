// Fixture for scripts/tests/scraper-vitest-alias-table.test.mjs (item 1
// slice s14 CI-portability fix).
//
// Evaluates a vitest config file (given as argv[2]) under tsx instead of
// node's --experimental-strip-types, because that flag needs Node >= 22.6
// and pr-gate.yml pins Node 20 for the step this fixture runs under. tsx is
// already a scraper devDependency and works on Node 20 (the scraper's own
// production start script and the "Scraper import smoke" pr-gate step both
// run under it).
//
// The config is EVALUATED here, not pattern-matched as text, so a
// "simplification" of scraper/vitest.config.ts back to the object alias
// form -- which changes no text a grep-based check could catch -- still
// turns the caller's assertions red. Keep this file's job limited to
// "evaluate the config and print its alias table as JSON"; the test file
// owns every assertion about the shape of that table.

import { pathToFileURL } from 'node:url';

const configPath = process.argv[2];
if (!configPath) {
  console.error('USAGE: tsx print-scraper-vitest-alias.mts <path-to-vitest.config.ts>');
  process.exit(2);
}

// vitest.config.ts calls path.resolve(__dirname, ...), which vite normally
// supplies. Evaluated directly here (outside vite), that global is absent,
// so shim it exactly as the node --experimental-strip-types subprocess this
// fixture replaces did: the caller sets the spawned process's `cwd` to the
// directory the config lives in, so process.cwd() is the right value.
(globalThis as unknown as { __dirname: string }).__dirname = process.cwd();

const mod = await import(pathToFileURL(configPath).href);
const alias = mod.default?.resolve?.alias;
if (!alias) {
  console.error('NO_ALIAS');
  process.exit(2);
}

const isArray = Array.isArray(alias);
const entries = isArray
  ? alias.map((entry: { find: string | RegExp; replacement: string }) => ({
      find: String(entry.find),
      isRegExp: entry.find instanceof RegExp,
      source: entry.find instanceof RegExp ? entry.find.source : null,
      replacement: entry.replacement,
    }))
  : Object.entries(alias as Record<string, string>).map(([find, replacement]) => ({
      find,
      isRegExp: false,
      replacement,
    }));

console.log(JSON.stringify({ isArray, entries }));
