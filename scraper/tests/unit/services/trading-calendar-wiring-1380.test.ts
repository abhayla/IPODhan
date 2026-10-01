/**
 * #1380 / F-220: the OD-21 working-day rules (listing_t3 / listing_t6) judge only when a trading-holiday
 * calendar is wired. (i)-(iii) drive the REAL factory-built service and the real validation-rules.json;
 * the guard cases pin that every production construction passes the calendar (TS compiler API, keyed by
 * the factory's own function names, fail closed on shapes it cannot resolve).
 */
import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { createConsolidationService } from '../../../src/services/consolidation-factory.js';
import { TradingCalendar, buildResolvedCalendar } from '../../../src/services/trading-calendar.js';
import type { PreRankCheckInput } from '../../../src/services/data-consolidation-service.js';

vi.mock('../../../src/config/feature-flags.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/config/feature-flags.js')>();
  return {
    ...actual,
    FEATURE_FLAGS: { ...actual.FEATURE_FLAGS, ENABLE_POLICY_WRITER: true, ENABLE_CONFLICT_DETECTION: true, ENABLE_FIELD_EXTRACTION_VALIDATION: true },
  };
});

const row = (date: string, type = 'TRADING') => ({ date, type });
const year2026 = [row('2026-01-26'), row('2026-03-04'), row('2026-12-25')];

function build(rows: Array<{ date: string; type: string }>, load?: () => Promise<any>) {
  const recordFailure = vi.fn().mockResolvedValue(undefined);
  const svc = createConsolidationService({
    fieldSourcesRepository: {},
    dataConflictsRepository: { upsertConflict: vi.fn().mockResolvedValue(undefined) },
    fieldExtractionFailuresRepository: { recordFailure, markResolved: vi.fn().mockResolvedValue(0) },
    tradingHolidays: new TradingCalendar(load ?? (async () => rows)),
  });
  return { svc, recordFailure };
}

function listing(listingDate: string, closeDate: string): PreRankCheckInput {
  const at = (d: string) => new Date(`${d}T00:00:00Z`);
  return {
    ipoId: '00000000-0000-4000-8000-000000138001',
    tableName: 'ipos',
    rowKey: '',
    fieldName: 'listingDate',
    incomingValue: at(listingDate),
    incomingSource: 'NSE',
    storedValue: null,
    segment: 'MAINBOARD',
    ipoType: 'MAINBOARD',
    offeringType: 'IPO',
    documentId: null,
    documentSha256: null,
    shadowMode: false,
    incomingDates: { openDate: null, closeDate: at(closeDate), listingDate: at(listingDate), segment: 'MAINBOARD' },
  };
}

describe('#1380 working-day rules judge when the calendar is wired', () => {
  it('(i) a listing date 15 working days after close is refused (listing_t3)', async () => {
    const { svc, recordFailure } = build(year2026);
    const out = await svc.runPreRankChecks(listing('2026-03-23', '2026-03-02'));
    expect(out.status).toBe('REFUSED');
    expect(recordFailure).toHaveBeenCalledWith(expect.objectContaining({ ruleId: 'listing_t3', fieldName: 'listingDate' }));
  });

  it('(ii) a date within the limit only because of a holiday is accepted; without that holiday it is refused', async () => {
    // close Mon 2026-03-02, listing Fri 2026-03-06: Tue, Wed, Thu, Fri = 4 working days; Wed 03-04 a holiday -> 3
    expect((await build(year2026).svc.runPreRankChecks(listing('2026-03-06', '2026-03-02'))).status).toBe('PASS');
    const other = build([row('2026-01-26'), row('2026-12-25')]);
    expect((await other.svc.runPreRankChecks(listing('2026-03-06', '2026-03-02'))).status).toBe('REFUSED');
  });

  it('(iii) a year with no holiday rows is never judged: NO_RULE_APPLIES, the value is kept', async () => {
    const { svc, recordFailure } = build([row('2025-04-18'), row('2025-12-25')]);
    expect((await svc.runPreRankChecks(listing('2026-03-23', '2026-03-02'))).status).toBe('PASS');
    expect(recordFailure).not.toHaveBeenCalled();
    expect((await build([]).svc.runPreRankChecks(listing('2026-03-23', '2026-03-02'))).status).toBe('PASS');
  });

  it('a span that crosses into a year with no rows is not judged either', async () => {
    expect((await build(year2026).svc.runPreRankChecks(listing('2027-01-20', '2026-12-31'))).status).toBe('PASS');
  });

  it('the calendar is read once per build, not per field', async () => {
    const load = vi.fn().mockResolvedValue(year2026);
    const { svc } = build([], load);
    for (let i = 0; i < 5; i++) await svc.runPreRankChecks(listing('2026-03-05', '2026-03-02'));
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('a calendar that cannot be read judges nothing, and only TRADING rows count', async () => {
    const { svc } = build([], async () => {
      throw new Error('db down');
    });
    expect((await svc.runPreRankChecks(listing('2026-03-23', '2026-03-02'))).status).toBe('PASS');
    const built = buildResolvedCalendar([row('2026-03-04', 'SETTLEMENT'), row('2026-03-05')]);
    expect([...built.holidays]).toEqual(['2026-03-05']);
  });
});

// ---------------------------------------------------------------------------------------------
// Guard: every production construction passes the calendar.
const REPO = path.resolve(__dirname, '../../../..');
const FACTORY = 'scraper/src/services/consolidation-factory.ts';
const CALLEES = new Set(['createConsolidationService', 'createConsolidationOrchestrator']);

function parse(rel: string) {
  return ts.createSourceFile(rel, fs.readFileSync(path.join(REPO, rel), 'utf8'), ts.ScriptTarget.Latest, true);
}

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(path.join(REPO, dir), { withFileTypes: true })) {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) {
      if (!/^(node_modules|dist|tests?)$/.test(e.name)) walk(rel, out);
    } else if (/\.(ts|mts)$/.test(e.name)) out.push(rel);
  }
  return out;
}

/** Violations among the call sites of the two factory functions in one source text (fail closed). */
function findUnwiredCalls(rel: string, sf: ts.SourceFile): string[] {
  const out: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && CALLEES.has(node.expression.text)) {
      const arg = node.arguments.find(
        (a) =>
          ts.isObjectLiteralExpression(a) ||
          (ts.isCallExpression(a) && ts.isIdentifier(a.expression) && a.expression.text === 'buildConsolidationDeps')
      );
      const line = sf.getLineAndCharacterOfPosition(node.getStart()).line + 1;
      if (!arg) out.push(`${rel}:${line}: deps argument is not an object literal or buildConsolidationDeps(...) (cannot resolve)`);
      else if (ts.isObjectLiteralExpression(arg)) {
        const prop = arg.properties.find(
          (p) => (ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p)) && p.name.getText() === 'tradingHolidays'
        );
        const isUndefined =
          !!prop && ts.isPropertyAssignment(prop) && ts.isIdentifier(prop.initializer) && prop.initializer.text === 'undefined';
        if (!prop || isUndefined) out.push(`${rel}:${line}: deps has no tradingHolidays (or it is undefined)`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

describe('#1380 guard: every production construction passes tradingHolidays', () => {
  it('no production call site of the factory omits the calendar', () => {
    const files = [...walk('scraper/src'), ...walk('scraper/scripts')].filter((f) => f !== FACTORY);
    const calls = files.flatMap((f) => findUnwiredCalls(f, parse(f)));
    expect(calls).toEqual([]);
    const sites = files.filter((f) => /createConsolidation(Service|Orchestrator)\(/.test(fs.readFileSync(path.join(REPO, f), 'utf8')));
    expect(sites.length).toBeGreaterThanOrEqual(5);
  });

  it('the detector flags an omitted, undefined or unresolvable deps argument', () => {
    const mk = (src: string) => findUnwiredCalls('x.ts', ts.createSourceFile('x.ts', src, ts.ScriptTarget.Latest, true));
    expect(mk('createConsolidationService({ a: 1 })')).toHaveLength(1);
    expect(mk('createConsolidationService({ tradingHolidays: undefined })')).toHaveLength(1);
    expect(mk('createConsolidationOrchestrator(r, someVar, null)')).toHaveLength(1);
    expect(mk('createConsolidationService({ tradingHolidays: cal })')).toHaveLength(0);
    expect(mk('createConsolidationOrchestrator(r, buildConsolidationDeps(db, redis), null)')).toHaveLength(0);
  });

  it('the factory forwards deps.tradingHolidays to both constructors (never undefined)', () => {
    const seen: string[] = [];
    const visit = (n: ts.Node) => {
      if (ts.isNewExpression(n) && ts.isIdentifier(n.expression) && /^DataConsolidation(Service|Orchestrator)$/.test(n.expression.text)) {
        const last = n.arguments?.[n.arguments.length - 1];
        seen.push(last && last.getText() === 'deps.tradingHolidays' ? 'ok' : `bad:${last?.getText()}`);
      }
      ts.forEachChild(n, visit);
    };
    visit(parse(FACTORY));
    expect(seen).toEqual(['ok', 'ok']);
  });
});
