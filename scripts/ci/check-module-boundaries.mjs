#!/usr/bin/env node
// §7.6 (OD-51) module-boundary import check: a lower layer never imports a
// higher one. See docs/design/data-sourcing-pull-model.md §7.6 and
// docs/design/build-cards/item-20-design-traceability-check.md.
//
// Usage:
//   node scripts/ci/check-module-boundaries.mjs [--root <repoRoot>] [--map <mapPath>]
// Exit codes:
//   0  clean — no upward-pointing import edge found
//   1  an import edge points up the layer order (a real finding)
//   2  the check itself failed (bad/missing map, zero files scanned, coverage
//      below the committed floor) — never a silent pass
//
// The module map is DATA (scripts/ci/module-map.json), never code — see that
// file's `_why`. First glob to match a file wins.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const SCAN_ROOTS = ['scraper/src', 'packages/shared/src', 'web'];
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);
const RESOLVE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];
const EXCLUDED_DIR_NAMES = new Set([
  'node_modules',
  '.next',
  'dist',
  'build',
  'coverage',
  '.git',
]);

function parseArgs(argv) {
  const args = { root: process.cwd(), map: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--root') args.root = argv[++i];
    else if (argv[i] === '--map') args.map = argv[++i];
  }
  return args;
}

// --- glob matching -------------------------------------------------------
// Minimal glob->regex: `**` matches any number of path segments (incl.
// zero), `*` matches within one segment, everything else is literal.
function globToRegExp(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*' && glob[i + 1] === '*') {
      // `**/` -> zero-or-more segments; bare `**` -> anything
      if (glob[i + 2] === '/') {
        re += '(?:.*/)?';
        i += 2;
      } else {
        re += '.*';
        i += 1;
      }
    } else if (c === '*') {
      re += '[^/]*';
    } else if ('.+^${}()|[]\\'.includes(c)) {
      re += '\\' + c;
    } else {
      re += c;
    }
  }
  return new RegExp('^' + re + '$');
}

function loadModuleMap(mapPath) {
  let raw;
  try {
    raw = readFileSync(mapPath, 'utf8');
  } catch (e) {
    return { error: `module map not found at ${mapPath} (${e.code || e.message})` };
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    return { error: `module map at ${mapPath} is not valid JSON: ${e.message}` };
  }
  if (!Array.isArray(parsed.layerOrder) || parsed.layerOrder.length === 0) {
    return { error: `module map at ${mapPath} has no non-empty "layerOrder" array` };
  }
  if (!Array.isArray(parsed.entries) || parsed.entries.length === 0) {
    return { error: `module map at ${mapPath} has zero glob entries (empty "entries" array)` };
  }
  if (!Number.isInteger(parsed.coverageFloor) || parsed.coverageFloor < 0) {
    return { error: `module map at ${mapPath} has no valid integer "coverageFloor"` };
  }
  for (const entry of parsed.entries) {
    if (typeof entry.glob !== 'string' || typeof entry.module !== 'string') {
      return { error: `module map at ${mapPath} has a malformed entry: ${JSON.stringify(entry)}` };
    }
    if (!parsed.layerOrder.includes(entry.module)) {
      return {
        error: `module map at ${mapPath} maps glob "${entry.glob}" to unknown module "${entry.module}" (not in layerOrder)`,
      };
    }
  }
  const compiled = parsed.entries.map((e) => ({ ...e, re: globToRegExp(e.glob) }));
  return {
    layerOrder: parsed.layerOrder,
    layerIndex: new Map(parsed.layerOrder.map((m, i) => [m, i])),
    entries: compiled,
    coverageFloor: parsed.coverageFloor,
  };
}

function resolveModule(map, relPath) {
  for (const entry of map.entries) {
    if (entry.re.test(relPath)) return entry.module;
  }
  return null;
}

// --- filesystem walk -------------------------------------------------------
function walk(root, absDir, out) {
  let entries;
  try {
    entries = readdirSync(absDir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const ent of entries) {
    if (ent.isDirectory()) {
      if (EXCLUDED_DIR_NAMES.has(ent.name)) continue;
      walk(root, join(absDir, ent.name), out);
    } else if (ent.isFile()) {
      const ext = extname(ent.name);
      if (!SOURCE_EXTENSIONS.has(ext)) continue;
      if (ent.name.endsWith('.d.ts')) continue;
      const abs = join(absDir, ent.name);
      out.push({ abs, rel: relative(root, abs).split('\\').join('/') });
    }
  }
}

function collectSourceFiles(root) {
  const files = [];
  for (const scanRoot of SCAN_ROOTS) {
    const abs = join(root, scanRoot);
    try {
      statSync(abs);
    } catch {
      continue;
    }
    walk(root, abs, files);
  }
  return files;
}

// --- import extraction -----------------------------------------------------
// Static, regex-based (not a full parser) — matches:
//   import ... from '<spec>'
//   export ... from '<spec>'
//   import '<spec>'
//   require('<spec>')
//   import('<spec>')
const IMPORT_RE =
  /(?:\bimport\b[^'"()]*?\bfrom\s*|\bexport\b[^'"()]*?\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|\bimport\s+)['"]([^'"]+)['"]/g;

function extractSpecifiers(source) {
  const specs = [];
  let m;
  IMPORT_RE.lastIndex = 0;
  while ((m = IMPORT_RE.exec(source)) !== null) {
    specs.push(m[1]);
  }
  return specs;
}

const ALIASES = [
  { prefix: '@ipodhan/shared/', target: 'packages/shared/src/' },
  { prefix: '@shared/', target: 'packages/shared/src/' },
  { prefix: '@web/', target: 'web/' },
  { prefix: '@scraper/', target: 'scraper/src/' },
  { prefix: '@/', target: 'web/' },
];

function resolveAlias(spec) {
  if (spec === '@ipodhan/shared') return 'packages/shared/src/index';
  for (const { prefix, target } of ALIASES) {
    if (spec.startsWith(prefix)) return target + spec.slice(prefix.length);
  }
  return null;
}

// Try to resolve a (possibly extension-less / directory-index) candidate
// path against the real files on disk (by relPath, using the fileSet index).
function resolveToFile(candidateRelPath, fileSet) {
  const normalized = candidateRelPath.split('\\').join('/');
  if (fileSet.has(normalized)) return normalized;
  for (const ext of RESOLVE_EXTENSIONS) {
    if (fileSet.has(normalized + ext)) return normalized + ext;
  }
  for (const ext of RESOLVE_EXTENSIONS) {
    const idx = `${normalized}/index${ext}`;
    if (fileSet.has(idx)) return idx;
  }
  return null;
}

function posixJoin(...parts) {
  return parts
    .join('/')
    .split('/')
    .reduce((stack, seg) => {
      if (seg === '' || seg === '.') return stack;
      if (seg === '..') stack.pop();
      else stack.push(seg);
      return stack;
    }, [])
    .join('/');
}

function buildGraph(files, root, fileSet) {
  const edges = []; // { fromRel, toRel }
  const unresolved = { relative: 0, aliasNoMap: 0, bareIgnored: 0 };
  for (const f of files) {
    let source;
    try {
      source = readFileSync(f.abs, 'utf8');
    } catch {
      continue;
    }
    const specs = extractSpecifiers(source);
    const fromDir = dirname(f.rel);
    for (const spec of specs) {
      let candidate = null;
      if (spec.startsWith('.')) {
        candidate = posixJoin(fromDir, spec);
      } else {
        const aliasTarget = resolveAlias(spec);
        if (aliasTarget) candidate = aliasTarget;
        else {
          unresolved.bareIgnored++;
          continue;
        }
      }
      const resolved = resolveToFile(candidate, fileSet);
      if (!resolved) {
        unresolved.relative++;
        continue;
      }
      edges.push({ fromRel: f.rel, toRel: resolved });
    }
  }
  return { edges, unresolved };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const root = resolve(args.root);
  const mapPath = args.map ? resolve(args.map) : join(root, 'scripts/ci/module-map.json');

  const map = loadModuleMap(mapPath);
  if (map.error) {
    console.error('check-module-boundaries: FAIL (exit 2) — module map problem');
    console.error(`  ${map.error}`);
    process.exit(2);
  }

  const files = collectSourceFiles(root);
  if (files.length === 0) {
    console.error('check-module-boundaries: FAIL (exit 2) — zero source files scanned');
    console.error(`  scan roots checked: ${SCAN_ROOTS.map((r) => join(root, r)).join(', ')}`);
    process.exit(2);
  }

  const fileSet = new Set(files.map((f) => f.rel));
  const mapped = new Map(); // rel -> module
  const perModule = new Map(map.layerOrder.map((m) => [m, 0]));
  for (const f of files) {
    const mod = resolveModule(map, f.rel);
    if (mod) {
      mapped.set(f.rel, mod);
      perModule.set(mod, (perModule.get(mod) || 0) + 1);
    }
  }

  if (mapped.size < map.coverageFloor) {
    console.error('check-module-boundaries: FAIL (exit 2) — coverage below the committed floor');
    console.error(
      `  mapped ${mapped.size} files, required at least coverageFloor=${map.coverageFloor} (from ${mapPath})`
    );
    console.error(
      '  a path that used to match a glob no longer exists or moved — update scripts/ci/module-map.json'
    );
    process.exit(2);
  }

  const { edges, unresolved } = buildGraph(files, root, fileSet);

  const violations = [];
  for (const { fromRel, toRel } of edges) {
    const fromMod = mapped.get(fromRel);
    const toMod = mapped.get(toRel);
    if (!fromMod || !toMod) continue; // unmapped endpoint — ignored per contract
    const fromIdx = map.layerIndex.get(fromMod);
    const toIdx = map.layerIndex.get(toMod);
    if (toIdx > fromIdx) {
      violations.push({ fromRel, toRel, fromMod, toMod });
    }
  }

  console.log('check-module-boundaries: coverage summary');
  console.log(`  scanned:  ${files.length} source files under ${SCAN_ROOTS.join(', ')}`);
  console.log(`  mapped:   ${mapped.size}`);
  console.log(`  unmapped: ${files.length - mapped.size}`);
  console.log(`  coverageFloor: ${map.coverageFloor}`);
  console.log('  per-module counts:');
  for (const mod of map.layerOrder) {
    console.log(`    ${mod}: ${perModule.get(mod) || 0}`);
  }
  console.log(
    `  import edges resolved: ${edges.length} (bare/unaliased specifiers ignored: ${unresolved.bareIgnored}, unresolved relative/alias specifiers ignored: ${unresolved.relative})`
  );

  if (violations.length > 0) {
    console.error('');
    console.error(`check-module-boundaries: FAIL (exit 1) — ${violations.length} upward import edge(s)`);
    for (const v of violations) {
      console.error(
        `  ${v.fromRel} (${v.fromMod}) imports ${v.toRel} (${v.toMod}) — ${v.fromMod} is below ${v.toMod} in the layer order`
      );
    }
    process.exit(1);
  }

  console.log('');
  console.log('check-module-boundaries: PASS (exit 0) — no upward-pointing import edge found');
  process.exit(0);
}

main();
