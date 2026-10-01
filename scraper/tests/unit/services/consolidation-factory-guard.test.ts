// implements: OD-21 (spec §5.3) wiring guard, #1370 / F-216
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import {
  createConsolidationService,
  createConsolidationOrchestrator,
} from '../../../src/services/consolidation-factory.js';

/**
 * #1370: every production consolidator is built by consolidation-factory.ts, whose deps type REQUIRES the
 * field-extraction-failures repository (without it the OD-21 gate never runs, F-216). This test is the
 * second layer behind that type: no production file other than the factory may hold a VALUE binding of
 * either class, so a new `new DataConsolidationService(...)` elsewhere cannot appear without failing here.
 *
 * Keyed by IMPORT SOURCE, not by identifier text, and fail closed: a namespace import, a default import,
 * a re-export, a dynamic `import()` or `require()` of either module counts as a value binding, because
 * the class could be reached through it. A type-only import is allowed.
 */
const REPO = path.resolve(__dirname, '../../../..');
const SCAN_ROOTS = ['scraper/src', 'scraper/scripts', 'scripts'];
const SCAN_EXT = /\.(ts|mts|cts|js|mjs|cjs)$/;
const SKIP_DIR = /(^|\/)(node_modules|tests?|__tests__|dist|fixtures)(\/|$)/;

const GUARDED: Record<string, { className: string; allowedIn: string[] }> = {
  'data-consolidation-service': {
    className: 'DataConsolidationService',
    allowedIn: ['scraper/src/services/consolidation-factory.ts', 'scraper/src/services/data-consolidation-orchestrator.ts'],
  },
  'data-consolidation-orchestrator': {
    className: 'DataConsolidationOrchestrator',
    allowedIn: ['scraper/src/services/consolidation-factory.ts'],
  },
};

function guardedModule(specifier: string): string | null {
  const base = specifier.split('/').pop()!.replace(/\.(js|ts|mjs|cjs)$/, '');
  return base in GUARDED ? base : null;
}

/** Every value binding of a guarded class in one source text, as `rel: reason` strings. */
function findValueBindings(rel: string, text: string): string[] {
  const out: string[] = [];
  const sf = ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true);
  const allowed = (mod: string) => GUARDED[mod].allowedIn.includes(rel);
  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const mod = guardedModule(node.moduleSpecifier.text);
      const clause = node.importClause;
      if (mod && clause && !clause.isTypeOnly && !allowed(mod)) {
        if (clause.name) out.push(`${rel}: default import of ${mod}`);
        const nb = clause.namedBindings;
        if (nb && ts.isNamespaceImport(nb)) out.push(`${rel}: namespace import of ${mod}`);
        if (nb && ts.isNamedImports(nb)) {
          for (const el of nb.elements) {
            const imported = (el.propertyName ?? el.name).text;
            if (!el.isTypeOnly && imported === GUARDED[mod].className) out.push(`${rel}: value import of ${imported}`);
          }
        }
      }
    }
    if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      const ex = node.moduleReference.expression;
      if (ts.isStringLiteralLike(ex)) {
        const mod = guardedModule(ex.text);
        if (mod && !node.isTypeOnly && !allowed(mod)) out.push(`${rel}: import = require of ${mod}`);
      } else {
        out.push(`${rel}: unresolvable dynamic load`);
      }
    }
    if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      const mod = guardedModule(node.moduleSpecifier.text);
      if (mod && !node.isTypeOnly && !allowed(mod)) {
        const clause = node.exportClause;
        if (!clause || !ts.isNamedExports(clause)) out.push(`${rel}: re-export * from ${mod}`);
        else for (const el of clause.elements) {
          if (!el.isTypeOnly && (el.propertyName ?? el.name).text === GUARDED[mod].className) out.push(`${rel}: re-export of ${GUARDED[mod].className}`);
        }
      }
    }
    if (ts.isCallExpression(node) && node.arguments.length > 0) {
      const isDynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
      const isRequire = ts.isIdentifier(node.expression) && node.expression.text === 'require';
      if (isDynamicImport || isRequire) {
        const arg = node.arguments[0];
        if (!ts.isStringLiteralLike(arg)) {
          // Cannot resolve the target: fail closed in scraper/ (none exist there today). Root scripts/
          // load their own helpers by computed path, so there only a text naming a guarded module fails.
          if (rel.startsWith('scraper/') || Object.keys(GUARDED).some((m) => arg.getText(sf).includes(m))) {
            out.push(`${rel}: unresolvable dynamic load`);
          }
        } else {
          const mod = guardedModule(arg.text);
          if (mod && !allowed(mod)) out.push(`${rel}: ${isRequire ? 'require' : 'dynamic import'} of ${mod}`);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

function productionFiles(): string[] {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(path.join(REPO, dir), { withFileTypes: true })) {
      const rel = `${dir}/${entry.name}`;
      if (entry.isDirectory()) {
        if (!SKIP_DIR.test(rel)) walk(rel);
      } else if (SCAN_EXT.test(entry.name) && !/\.(test|spec)\.[cm]?[jt]s$/.test(entry.name) && !entry.name.endsWith('.d.ts')) {
        files.push(rel);
      }
    }
  };
  for (const root of SCAN_ROOTS) if (fs.existsSync(path.join(REPO, root))) walk(root);
  return files;
}

describe('#1370: production consolidators are built only by consolidation-factory.ts', () => {
  it('scans a real file set (the scan can fail)', () => {
    const files = productionFiles();
    expect(files).toContain('scraper/src/services/data-persister.ts');
    expect(files).toContain('scraper/src/base/BaseScraperOrchestrator.ts');
    expect(files.length).toBeGreaterThan(200);
  });

  it('no production file outside the factory holds a value binding of either class', () => {
    const violations = productionFiles().flatMap((rel) =>
      findValueBindings(rel, fs.readFileSync(path.join(REPO, rel), 'utf8'))
    );
    expect(violations).toEqual([]);
  });

  it('the detector flags every bypass shape and passes type-only imports', () => {
    const rel = 'scraper/src/services/some-new-entrypoint.ts';
    const cases: Array<[string, number]> = [
      [`import { DataConsolidationService } from './data-consolidation-service.js';`, 1],
      [`import { DataConsolidationService as Svc } from './data-consolidation-service';`, 1],
      [`import { DataConsolidationOrchestrator } from '../services/data-consolidation-orchestrator.js';`, 1],
      [`import * as dcs from './data-consolidation-service.js';`, 1],
      [`export { DataConsolidationService } from './data-consolidation-service.js';`, 1],
      [`export * from './data-consolidation-orchestrator.js';`, 1],
      [`const m = await import('./data-consolidation-service.js');`, 1],
      [`const m = require('./data-consolidation-orchestrator');`, 1],
      [`const p = './data-consolidation-' + 'service.js'; await import(p + '');`, 1],
      [`await import(\`./data-consolidation-service.js\`);`, 1],
      [`import dcs = require('./data-consolidation-service');`, 1],
      [`import orch = require('./data-consolidation-orchestrator.js');`, 1],
      [`import type dcs = require('./data-consolidation-service');`, 0],
      [`import fs = require('node:fs');`, 0],
      [`import type { DataConsolidationService } from './data-consolidation-service.js';`, 0],
      [`import { type DataConsolidationService, runPreRankChecks } from './data-consolidation-service.js';`, 0],
      [`import { runPreRankChecks } from './data-consolidation-service.js';`, 0],
    ];
    for (const [src, n] of cases) expect(findValueBindings(rel, src).length, src).toBe(n);
    // Root scripts/ load helpers by computed path; only a computed path naming a guarded module fails there.
    expect(findValueBindings('scripts/x.mjs', `await import(pathToFileURL(abs).href);`)).toEqual([]);
    expect(findValueBindings('scripts/x.mjs', `await import(root + '/data-consolidation-service.js');`).length).toBe(1);
    // The orchestrator may build its inner service, but not another orchestrator.
    expect(findValueBindings('scraper/src/services/data-consolidation-orchestrator.ts', `import { DataConsolidationService } from './data-consolidation-service.js';`)).toEqual([]);
  });

  it('the factory gives the service AND the orchestrator\'s inner service the failures repository', () => {
    const failures = { recordFailure: async () => ({}), markResolved: async () => 0 };
    const deps = { fieldSourcesRepository: {}, dataConflictsRepository: {}, fieldExtractionFailuresRepository: failures };
    const service = createConsolidationService(deps) as unknown as Record<string, unknown>;
    expect(service.fieldExtractionFailuresRepository).toBe(failures);
    const orchestrator = createConsolidationOrchestrator({} as never, deps, null) as unknown as {
      consolidationService: Record<string, unknown>;
    };
    expect(orchestrator.consolidationService.fieldExtractionFailuresRepository).toBe(failures);
  });
});
