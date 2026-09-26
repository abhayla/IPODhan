/**
 * #671 — every data tool that used to carry a `repair-tool-exempt` comment
 * while writing a database now opens its connection through openRepairDb().
 *
 * This drives each tool's REAL main() (not openRepairDb in isolation) against
 * a mocked pool whose current_database() is the production name `ipodhan`,
 * with `--apply` and no `--allow-prod`, and asserts:
 *   1. the tool exits 1 with the prod-refusal reason, and
 *   2. the ONLY call that reached any mocked database/repository/scraper/job
 *      module was the current_database() probe — i.e. the guard ran before
 *      any read or write.
 * The six tools that wrote unconditionally before #671 also get a dry-run
 * test: without --apply they must stop after the probe and exit 0.
 *
 * Every mocked module is a recording Proxy, so no DB, network or Redis call
 * can happen here — a call that is not the probe is recorded and fails (1/2).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const h = vi.hoisted(() => {
  const calls: string[] = [];
  const PROD = [{ name: 'ipodhan' }];
  // record=false only for the static table description (schema): reading an
  // enum's values is not a database call.
  const stub = (p: string, record = true): any =>
    new Proxy(function () {}, {
      get(_t, prop) {
        if (prop === 'then' || typeof prop === 'symbol') return undefined;
        return stub(`${p}.${String(prop)}`, record);
      },
      apply() {
        if (record) calls.push(p);
        return stub(`${p}()`, record);
      },
      construct() {
        if (record) calls.push(`new ${p}`);
        return stub(`new ${p}`, record);
      },
    });
  const db = new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === 'then' || typeof prop === 'symbol') return undefined;
        if (prop === 'execute') {
          return async () => {
            calls.push('db.execute');
            return { rows: PROD };
          };
        }
        return stub(`db.${String(prop)}`);
      },
    }
  );
  const mod = (name: string, extra: Record<string, unknown> = {}, record = true) =>
    new Proxy(extra, {
      has: () => true,
      get(t, prop) {
        if (prop === 'then' || typeof prop === 'symbol') return undefined;
        if (prop === '__esModule') return true;
        if (prop in t) return (t as any)[prop];
        return stub(`${name}.${String(prop)}`, record);
      },
    });
  class Pool {
    async query(text: string) {
      calls.push(`pg.query`);
      return /current_database/i.test(String(text)) ? { rows: PROD } : { rows: [] };
    }
    on() {}
    async end() {}
  }
  const noop = () => {};
  const logger = { info: noop, warn: noop, error: noop, debug: noop, child: () => logger };
  return { calls, mod, db, Pool, logger };
});

vi.mock('@ipodhan/shared', () => h.mod('@ipodhan/shared', { db: h.db }));
vi.mock('@ipodhan/shared/db', () =>
  h.mod('@ipodhan/shared/db', {
    db: h.db,
    // pool configuration only — no connection is opened by either
    configureUtcTimestampParsing: () => {},
    resolveDiscreteDbParams: () => ({}),
  })
);
vi.mock('@ipodhan/shared/db/schema', () => h.mod('schema', {}, false));
vi.mock('@ipodhan/shared/repositories', () => h.mod('@ipodhan/shared/repositories'));
vi.mock('@ipodhan/shared/cache/redis-client', () => h.mod('redis-client'));
vi.mock('pg', () => ({ Pool: h.Pool, default: { Pool: h.Pool } }));
vi.mock('../../../src/utils/logger.js', () => ({ default: h.logger, logger: h.logger }));
vi.mock('../../../src/utils/validators.js', () => h.mod('validators'));
vi.mock('../../../src/services/data-persister.js', () => h.mod('data-persister'));
vi.mock('../../../src/jobs/peer-companies-job.js', () => h.mod('peer-companies-job'));
vi.mock('../../../src/repositories/anchor-investor-repository.js', () => h.mod('anchor-investor-repository'));
vi.mock('../../../src/repositories/peer-company-repository.js', () => h.mod('peer-company-repository'));
vi.mock('../../../src/scrapers/anchor-investors-scraper.js', () => h.mod('anchor-investors-scraper'));
vi.mock('../../../src/scrapers/bse-api-scraper.js', () => h.mod('bse-api-scraper'));
vi.mock('../../../src/scrapers/chittorgarh-detail-fields.js', () => h.mod('chittorgarh-detail-fields'));
vi.mock('../../../src/scrapers/chittorgarh-document-scraper.js', () => h.mod('chittorgarh-document-scraper'));
vi.mock('../../../src/scrapers/chittorgarh-listing-scraper.js', () => h.mod('chittorgarh-listing-scraper'));
vi.mock('../../../src/scrapers/financial-data-scraper.js', () => h.mod('financial-data-scraper'));
vi.mock('../../../src/scrapers/objectives-scraper.js', () => h.mod('objectives-scraper'));
vi.mock('../../../src/scrapers/peer-companies-scraper.js', () => h.mod('peer-companies-scraper'));

class ExitError extends Error {
  constructor(public code: number | undefined) {
    super(`process.exit(${code})`);
  }
}

interface ToolCase {
  file: string;
  extraArgs?: string[];
  probe: 'db.execute' | 'pg.query';
  /** Wrote unconditionally before #671; --apply is new and dry-run is now the default. */
  applyIsNew?: boolean;
}

const TOOLS: ToolCase[] = [
  { file: 'backfill-anchor-investor-list-json', probe: 'db.execute' },
  { file: 'backfill-anchor-investors', probe: 'db.execute', applyIsNew: true },
  { file: 'backfill-bse-historical', probe: 'db.execute' },
  { file: 'backfill-chittorgarh-documents', probe: 'db.execute' },
  { file: 'backfill-financial-data', probe: 'db.execute', applyIsNew: true },
  { file: 'backfill-financials-chittorgarh-detail', probe: 'db.execute' },
  { file: 'backfill-financials-pdf', probe: 'db.execute' },
  { file: 'backfill-listing-performance-chittorgarh', probe: 'db.execute' },
  { file: 'backfill-objectives', probe: 'db.execute', applyIsNew: true },
  { file: 'backfill-peer-companies', probe: 'db.execute', applyIsNew: true },
  {
    file: 'backfill-step-ledger',
    probe: 'db.execute',
    applyIsNew: true,
    extraArgs: ['--ipo-id', '00000000-0000-4000-8000-000000000001', '--set', 'B1=DONE'],
  },
  { file: 'refresh-registrar-urls-t300', probe: 'db.execute' },
  { file: 'repair-field-sources-price-band-t276', probe: 'db.execute', extraArgs: ['--csv', 'does-not-exist.csv'] },
  { file: 'repair-subscription-regressions-t299', probe: 'pg.query' },
];

const ORIGINAL_ARGV = process.argv;
const ORIGINAL_ENV = { ...process.env };
let exitSpy: ReturnType<typeof vi.spyOn>;
let errSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  h.calls.length = 0;
  vi.resetModules();
  // An env that SAYS test while the pool is prod: the guard must read the pool.
  process.env.DATABASE_URL = 'postgresql://u:p@localhost:5432/ipodhan_test'; // secret-scan:allow (dummy fixture)
  process.env.DATABASE_NAME = 'ipodhan_test';
  process.env.DATABASE_USER = 'ipodhan_app';
  exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
    throw new ExitError(code);
  }) as never);
  errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  process.argv = ORIGINAL_ARGV;
  process.env = { ...ORIGINAL_ENV };
  vi.restoreAllMocks();
});

async function runTool(t: ToolCase, args: string[]): Promise<unknown> {
  process.argv = ['node', `/not-main/${t.file}.harness.ts`, ...args, ...(t.extraArgs ?? [])];
  const mod = (await import(`../../../scripts/${t.file}.ts`)) as { main?: () => Promise<unknown> };
  expect(h.calls, 'importing the tool must not touch any mocked module').toEqual([]);
  expect(typeof mod.main, `${t.file} must export main() and run it only when invoked directly`).toBe('function');
  return mod.main!();
}

describe('#671 — formerly exempt DB writers refuse a prod --apply before any query', () => {
  it.each(TOOLS)('$file: --apply on "ipodhan" without --allow-prod exits 1 after only the probe', async (t) => {
    await expect(runTool(t, ['--apply'])).rejects.toBeInstanceOf(ExitError);
    expect(exitSpy.mock.calls[0]?.[0]).toBe(1);
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('refusing to APPLY writes against the production database'));
    expect(h.calls).toEqual([t.probe]);
  });

  it.each(TOOLS)('$file: --expect-db naming another database refuses after only the probe', async (t) => {
    await expect(runTool(t, ['--expect-db', 'ipodhan_staging'])).rejects.toBeInstanceOf(ExitError);
    expect(exitSpy.mock.calls[0]?.[0]).toBe(1);
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('--expect-db said "ipodhan_staging"'));
    expect(h.calls).toEqual([t.probe]);
  });

  it.each(TOOLS.filter((t) => t.applyIsNew))('$file: without --apply it is a dry run — exits 0 after only the probe', async (t) => {
    await expect(runTool(t, [])).rejects.toBeInstanceOf(ExitError);
    expect(exitSpy.mock.calls[0]?.[0]).toBe(0);
    expect(h.calls).toEqual([t.probe]);
  });
});
