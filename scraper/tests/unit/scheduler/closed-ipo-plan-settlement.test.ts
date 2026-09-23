/**
 * Review round 4 (M-2): the stored + unsettled plan-row read behind the closed-IPO
 * job's DONE rule lives in ONE module. These drive that module; the integration
 * test runs the same function against ipodhan_test.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sql } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import {
  FIELD_PLAN_TERMINAL_STATES,
  readPlanSettlement,
  summarisePlanSettlement,
  unsettledPlanStatePredicate,
} from '../../../src/scheduler/closed-ipo-plan-settlement.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..', '..');

describe('closed-ipo-plan-settlement (round 4 M-2)', () => {
  it('the terminal list is exactly the repository TERMINAL_STATES: SUPPLIED, NOT_PRINTED, EXHAUSTED', () => {
    expect([...FIELD_PLAN_TERMINAL_STATES]).toEqual(['SUPPLIED', 'NOT_PRINTED', 'EXHAUSTED']);
  });

  it('the predicate is NOT IN the terminal list (bound), never an IN-list of open states', () => {
    const q = new PgDialect().sqlToQuery(unsettledPlanStatePredicate(sql.raw('p.state')));
    expect(q.sql).toBe('p.state::text NOT IN ($1, $2, $3)');
    expect(q.params).toEqual([...FIELD_PLAN_TERMINAL_STATES]);
  });

  it('summarises stored and unsettled per state; an unknown state counts as unsettled when the DB says so', () => {
    const s = summarisePlanSettlement([
      { state: 'SUPPLIED', unsettled: false, n: '30' },
      { state: 'PENDING', unsettled: true, n: 5 },
      { state: 'SOME_NEW_STATE', unsettled: true, n: '2' },
    ]);
    expect(s).toEqual({ stored: 37, unsettled: 7, unsettledByState: { PENDING: 5, SOME_NEW_STATE: 2 } });
  });

  it('0 stored rows reads as stored 0 (the M-1 shape), not as "all settled" alone', () => {
    expect(summarisePlanSettlement([])).toEqual({ stored: 0, unsettled: 0, unsettledByState: {} });
  });

  it('readPlanSettlement runs ONE grouped query over ipo_field_plan for the IPO, with the shared predicate', async () => {
    const execute = vi.fn().mockResolvedValue({ rows: [{ state: 'NOT_AVAILABLE_YET', unsettled: true, n: 4 }] });
    const s = await readPlanSettlement({ execute }, 'ipo-1');
    expect(s).toEqual({ stored: 4, unsettled: 4, unsettledByState: { NOT_AVAILABLE_YET: 4 } });
    const q = new PgDialect().sqlToQuery(execute.mock.calls[0][0]);
    expect(q.sql).toMatch(/FROM ipo_field_plan p/);
    expect(q.sql).toMatch(/p\.state::text NOT IN \(\$1, \$2, \$3\) AS unsettled/);
    expect(q.sql).toMatch(/GROUP BY p\.state/);
    expect(q.params).toEqual([...FIELD_PLAN_TERMINAL_STATES, 'ipo-1']);
  });

  it('parity: no copy of the literal list survives in the job wiring, the repair tool or the integration test', () => {
    for (const rel of [
      'scraper/src/index.ts',
      'scraper/scripts/repair-closed-ipo-false-done.ts',
      'scraper/tests/integration/closed-ipo-job-plan-then-walk.integration.test.ts',
    ]) {
      const text = readFileSync(path.join(repoRoot, rel), 'utf8');
      expect(text, rel).not.toMatch(/'PENDING', 'NOT_AVAILABLE_YET', 'CHECK_FAILED'/);
      expect(text, rel).not.toMatch(/NOT IN \('SUPPLIED', 'NOT_PRINTED', 'EXHAUSTED'\)/);
    }
  });

  it('parity: the detection floor (plain Node, cannot import TS) spells the SAME terminal list', () => {
    const text = readFileSync(path.join(repoRoot, 'scripts', 'audit-detection-floor.mjs'), 'utf8');
    const literal = `NOT IN (${FIELD_PLAN_TERMINAL_STATES.map((s) => `'${s}'`).join(', ')})`;
    expect(text).toContain(`p.state::text ${literal}`);
  });
});
