/**
 * Stage 7 of the IPO pipeline test ladder (docs/reviews/ipo-pipeline-stage-gap-analysis.md
 * section 6 row 7): "Supersede | Prospectus after RHP | `decideSupersession`/`markSuperseded` |
 * old row is_active=false, only carried fields overwritten | functions exist, unwired".
 *
 * FIXTURE IN / EXPECTED-OUTPUT-FILE OUT. fixtures/stage-7/expected-supersession.json holds one
 * scenario per contract line from the DEEPA walk step I3 plus the ordering rules R3/R4/E1 in the
 * function's own doc comment, each with an explicit `input` block and its `expected` decision.
 * It was written from that spec BEFORE this file ran (README rule 1) and drives the REAL
 * `decideSupersession` (README rule 3). No DB, no network - the decision function is pure.
 *
 * The WIRING half of row 7 is RED BY DESIGN: the row's own "Exists today?" cell says the
 * functions are unwired, and issue #258 is the harness, not the wiring. The two `test.fails`
 * cases below assert, against the real source tree, that a production caller exists; they report
 * green while the pipeline is unwired and turn RED the day someone wires it - the signal to drop
 * the `.fails` and keep the assertion.
 *
 * Relationship to tests/unit/services/document-state-machine.test.ts: that suite is the state
 * machine's own unit suite. This is the ladder's stage-level harness - one golden scenario table
 * in the same shape as every other stage. Extends, does not duplicate.
 */
import { describe, it, expect, test } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { decideSupersession } from '../../../src/services/document-state-machine';

const SCRAPER_ROOT = resolve(__dirname, '..', '..', '..');
const GOLDEN = JSON.parse(
  readFileSync(join(__dirname, 'fixtures', 'stage-7', 'expected-supersession.json'), 'utf8'),
) as {
  scenarios: Record<
    string,
    {
      spec: string;
      input: { existing: any; incoming: any; alsoHeld: any[] };
      expected: { action: string; supersededTypes?: string[] };
    }
  >;
  redByDesign: { id: string; claim: string; spec: string; observedToday: string }[];
};

/** Every .ts file under src/, excluding the two modules that DEFINE the functions. */
function productionSources(exclude: string[]): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const p = join(dir, entry);
      if (statSync(p).isDirectory()) walk(p);
      else if (p.endsWith('.ts') && !exclude.some((e) => p.endsWith(e))) out.push(p);
    }
  };
  walk(join(SCRAPER_ROOT, 'src'));
  return out;
}

function callersOf(symbol: string, exclude: string[]): string[] {
  const re = new RegExp(`\\b${symbol}\\s*\\(`);
  return productionSources(exclude).filter((p) => re.test(readFileSync(p, 'utf8')));
}

describe('stage 7 / the supersession decision (the half that exists)', () => {
  for (const [name, s] of Object.entries(GOLDEN.scenarios)) {
    it(`${name} - ${s.spec}`, () => {
      const got = decideSupersession(s.input.existing, s.input.incoming, s.input.alsoHeld);
      expect(got.action, got.reason).toBe(s.expected.action);
      if (s.expected.supersededTypes) {
        expect(got.action).toBe('supersede');
        expect(
          [...(got as { supersededTypes: string[] }).supersededTypes].sort(),
          got.reason,
        ).toEqual([...s.expected.supersededTypes].sort());
      }
      expect(typeof got.reason).toBe('string');
      expect(got.reason.length).toBeGreaterThan(0);
    });
  }

  it('every decision carries a human-readable reason (audit trail, not a bare enum)', () => {
    for (const s of Object.values(GOLDEN.scenarios)) {
      const got = decideSupersession(s.input.existing, s.input.incoming, s.input.alsoHeld);
      expect(got.reason.length).toBeGreaterThan(10);
    }
  });
});

// ---------------------------------------------------------------------------
// RED BY DESIGN - row 7's "functions exist, unwired".
// ---------------------------------------------------------------------------
describe('stage 7 / RED BY DESIGN - the supersession path is not wired to production', () => {
  test.fails('S7-R1: a production module calls decideSupersession', () => {
    expect(callersOf('decideSupersession', ['document-state-machine.ts'])).not.toHaveLength(0);
  });

  test.fails('S7-R2: a production module calls markSuperseded', () => {
    const callers = callersOf('markSuperseded', [
      'document-fetch-state-repository.ts',
      'in-memory-document-fetch-state-store.ts',
    ]);
    expect(callers).not.toHaveLength(0);
  });

  it('the golden names both wiring gaps with their spec line', () => {
    expect(GOLDEN.redByDesign.map((r) => r.id)).toEqual(['S7-R1', 'S7-R2']);
    for (const r of GOLDEN.redByDesign) {
      expect(r.spec.length).toBeGreaterThan(20);
      expect(r.observedToday.length).toBeGreaterThan(20);
    }
  });
});
