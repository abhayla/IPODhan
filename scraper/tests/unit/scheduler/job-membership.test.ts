import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  DOCUMENT_CYCLE_LOCK_RESOURCE,
  DEFAULT_CYCLE_LOCK_RESOURCE,
  cycleLockResourceForJob,
  JOB_STEPS,
  MARKET_HOURS_GATED_STEPS,
  SCRAPER_JOBS,
  isMarketHoursGated,
  parseJob,
  runsStep,
} from '../../../src/scheduler/job-membership.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const crontabPath = path.join(repoRoot, 'scripts/scraper-wake.crontab');

/**
 * Item 7 part B. The owner's ruling of 2026-09-11 settles the contradiction the
 * build card surfaced between OD-19's job table (GMP inside the market-hours
 * gated live job) and finding F-41 (owner-approved 2026-09-08, which took GMP
 * OUT of that gate because grey-market premium is most active exactly when the
 * gate is shut):
 *
 *   "GMP keeps the off-hours cadence plus one evening pull on Saturday and
 *    Sunday; the 09-09 in-hours rule applies to subscription and demand only;
 *    item 7 proceeds."
 *
 * F-41 wins for GMP. These tests are the guard that keeps it won.
 */
describe('job membership — which steps each wake runs', () => {
  it('the live job carries subscription and demand graph, and NOT gmp', () => {
    expect(JOB_STEPS.live).toContain('live:subscription');
    expect(JOB_STEPS.live).toContain('live:demandGraph');
    expect(JOB_STEPS.live).not.toContain('gmp');
    expect(runsStep('live', 'gmp')).toBe(false);
  });

  it('only subscription and demand graph are market-hours gated — never gmp', () => {
    expect([...MARKET_HOURS_GATED_STEPS].sort()).toEqual(['live:demandGraph', 'live:subscription']);
    expect(isMarketHoursGated('gmp')).toBe(false);
    expect(isMarketHoursGated('live:subscription')).toBe(true);
    expect(isMarketHoursGated('live:demandGraph')).toBe(true);
  });

  it('the document pass is its own job, on its own lock, and is not part of data (owner 2026-09-11)', () => {
    expect([...JOB_STEPS.documents]).toEqual(['documents']);
    expect(JOB_STEPS.data).not.toContain('documents');
    expect(JOB_STEPS.live).not.toContain('documents');
    expect(runsStep('gmp', 'documents')).toBe(false);
    // Its own lock is the whole point: on the shared `scraper:cycle` resource a
    // document pass would hold the live-figures job out for as long as it ran.
    expect(cycleLockResourceForJob('documents')).toBe(DOCUMENT_CYCLE_LOCK_RESOURCE);
    expect(DOCUMENT_CYCLE_LOCK_RESOURCE).not.toBe(DEFAULT_CYCLE_LOCK_RESOURCE);
    for (const other of ['data', 'live', 'closed', 'gmp'] as const) {
      expect(cycleLockResourceForJob(other)).toBe(DEFAULT_CYCLE_LOCK_RESOURCE);
    }
    expect(cycleLockResourceForJob(undefined)).toBe(DEFAULT_CYCLE_LOCK_RESOURCE);
  });

  it('gmp runs on the off-hours wakes: the data job, the closed job, and its own weekend job', () => {
    expect(runsStep('data', 'gmp')).toBe(true);
    expect(runsStep('closed', 'gmp')).toBe(true);
    expect(runsStep('gmp', 'gmp')).toBe(true);
  });

  it('the gmp job carries ONLY gmp — it must not drag discovery or documents onto a weekend evening', () => {
    expect([...JOB_STEPS.gmp]).toEqual(['gmp']);
  });

  it('an absent job runs every step (fail open — local dev and every existing caller)', () => {
    for (const step of ['discovery', 'documents', 'aggregators', 'gmp', 'live:subscription', 'live:demandGraph'] as const) {
      expect(runsStep(undefined, step)).toBe(true);
    }
  });

  it('parseJob accepts the known jobs from argv or env and refuses anything else', () => {
    expect(parseJob(['--source=all', '--job=live'], {})).toBe('live');
    expect(parseJob([], { SCRAPER_JOB: 'gmp' })).toBe('gmp');
    expect(parseJob(['--job=data'], { SCRAPER_JOB: 'live' })).toBe('data'); // argv wins
    expect(parseJob(['--source=all'], {})).toBeUndefined();
    expect(parseJob([], { SCRAPER_JOB: '' })).toBeUndefined();
    // A typo must be loud. Silently falling back to "run everything" would turn
    // a misspelled weekend GMP wake into a full discovery+document cycle.
    expect(() => parseJob(['--job=lively'], {})).toThrow(/unknown --job/i);
  });
});

describe('the installed crontab set (scripts/scraper-wake.crontab)', () => {
  const lines = readFileSync(crontabPath, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('#'));

  const parsed = lines.map((line) => {
    const fields = line.split(/\s+/);
    return {
      schedule: fields.slice(0, 5).join(' '),
      job: fields[fields.length - 1],
      line,
    };
  });

  it('every cron line names a known job', () => {
    expect(parsed.length).toBeGreaterThan(0);
    for (const { job } of parsed) {
      expect(SCRAPER_JOBS).toContain(job as (typeof SCRAPER_JOBS)[number]);
    }
  });

  it('carries the weekend evening GMP pull the owner asked for (20:00 IST, Sat and Sun)', () => {
    const weekend = parsed.filter((p) => p.job === 'gmp');
    expect(weekend).toHaveLength(1);
    expect(weekend[0].schedule).toBe('0 20 * * 6,0');
  });

  it('the live lines cover 10:00-18:30 and the data lines 00:00/08:00/14:00', () => {
    const live = parsed.filter((p) => p.job === 'live').map((p) => p.schedule).sort();
    expect(live).toEqual(['*/30 10-18 * * *', '30 18 * * *']);
    expect(parsed.filter((p) => p.job === 'data').map((p) => p.schedule)).toEqual(['0 0,8,14 * * *']);
    expect(parsed.filter((p) => p.job === 'closed').map((p) => p.schedule)).toEqual(['0 22 * * *']);
  });

  it('the document job runs outside market hours (owner 2026-09-11)', () => {
    const docs = parsed.filter((p) => p.job === 'documents');
    expect(docs).toHaveLength(1);
    const [, hourField] = docs[0].schedule.split(' ');
    const hours = hourField.split(',').map(Number);
    expect(hours.length).toBeGreaterThan(0);
    for (const hour of hours) {
      // The market-hours gate the live job runs under is 10:00-18:30 IST.
      expect(Number.isFinite(hour)).toBe(true);
      expect(hour < 10 || hour >= 19).toBe(true);
    }
  });

  it('every line invokes scraper-wake.sh — never the scraper, and never a kill', () => {
    for (const { line } of parsed) {
      expect(line).toContain('scripts/scraper-wake.sh');
      expect(line).not.toMatch(/kill|pm2 (restart|delete|stop)/);
    }
  });
});

describe('the wiring in index.ts — where the GMP call actually sits', () => {
  // The membership table above is only a claim until the cycle body honours it.
  // This reads the real file, because the regression this guards against is
  // someone moving one line back inside the `isMarketHoursIST(now)` block.
  const indexSrc = readFileSync(path.join(repoRoot, 'scraper/src/index.ts'), 'utf8');
  const liveBlockStart = indexSrc.indexOf('// (c) live figures');
  const gmpBlockStart = indexSrc.indexOf('// (c2) grey-market premium');
  const aggregatorStart = indexSrc.indexOf('// (d) aggregators');

  it('the three blocks are still there and in order', () => {
    expect(liveBlockStart).toBeGreaterThan(-1);
    expect(gmpBlockStart).toBeGreaterThan(liveBlockStart);
    expect(aggregatorStart).toBeGreaterThan(gmpBlockStart);
  });

  it('the document pass is gated on its own job membership, not run on every wake', () => {
    expect(indexSrc).toContain("runsStep(job, 'documents')");
    expect(indexSrc).toContain('cycleLockResourceForJob(job)');
  });

  it('the market-hours-gated block does NOT call the GMP scraper', () => {
    const liveBlock = indexSrc.slice(liveBlockStart, gmpBlockStart);
    expect(liveBlock).toContain('isMarketHoursIST(now)');
    expect(liveBlock).not.toContain('live:GMP');
    expect(liveBlock).not.toContain('runInvestorgainGMPScraper');
  });

  it('the GMP block calls it, and is not gated on market hours', () => {
    const gmpBlock = indexSrc.slice(gmpBlockStart, aggregatorStart);
    expect(gmpBlock).toContain('runInvestorgainGMPScraper');
    expect(gmpBlock).not.toContain('isMarketHoursIST');
  });
});
