/**
 * Review round 2, repair tool — the selection rule for `requeue-exhausted-plan-rows.ts`.
 *
 * RCA2: the DOC fetcher's pre-fix bug answered NOT_PRINTED (a DEFINITIVE no)
 * on mere ABSENCE of a field_sources provenance row, which is an extractor
 * gap, not evidence the field is not printed. Every rank answering a
 * definitive no on the FIRST attempt retired the plan row EXHAUSTED with no
 * chosen_source ever recorded — that is the SHAPE this tool's filter
 * targets: `state = EXHAUSTED AND chosen_source IS NULL AND attempts <= 1`.
 *
 * The risk is in WHICH rows the filter picks: a row genuinely exhausted
 * across several real CHECK_FAILED backoff cycles, or one that a rank
 * actually answered SUPPLIED for at some point (chosen_source set), must be
 * left alone — resetting either would either churn a settled fact or lose
 * the source attribution a real earlier write recorded.
 *
 * No database: `decideRequeue` is pure, so deleting or loosening a guard
 * turns a named test red rather than silently widening what the tool resets
 * (defect-fix-contract.md item 3).
 */
import { describe, expect, it } from 'vitest';
import {
  RETIRED_STATE,
  REQUEUED_STATE,
  decideRequeue,
  formatDecision,
  parseArgs,
  decideFalseSupplied,
  formatFalseSuppliedDecision,
  type ExhaustedPlanRow,
  type SuppliedPlanRow,
} from '../../../scripts/requeue-exhausted-plan-rows';

function row(over: Partial<ExhaustedPlanRow> = {}): ExhaustedPlanRow {
  return {
    id: 'plan-1',
    ipoId: 'ipo-1',
    ipoSlug: 'asset-reconstruction-company-india-limited',
    ipoName: 'Asset Reconstruction Company (India) Limited',
    tableName: 'ipo_details',
    rowKey: '',
    fieldName: 'fresh_issue',
    state: RETIRED_STATE,
    chosenSource: null,
    attempts: 1,
    ...over,
  };
}

describe('decideRequeue — the RCA2 absence-bug shape is re-queued', () => {
  it('requeues an EXHAUSTED row with no chosen_source and exactly 1 attempt', () => {
    const d = decideRequeue(row());
    expect(d.requeue).toBe(true);
    expect(d.reason).toMatch(/RCA2 absence-bug shape/);
  });

  it('requeues an EXHAUSTED row with 0 attempts (attempts <= 1, not === 1)', () => {
    const d = decideRequeue(row({ attempts: 0 }));
    expect(d.requeue).toBe(true);
  });

  it.each([
    ['fresh_issue', 'ipo_details'],
    ['ofs_issue', 'ipo_details'],
    ['min_investment', 'ipo_details'],
  ])('requeues %s on %s — the actual RCA2 staging-incident field shapes', (fieldName, tableName) => {
    const d = decideRequeue(row({ fieldName, tableName }));
    expect(d.requeue).toBe(true);
  });
});

describe('decideRequeue — a real exhaustion or an already-sourced row is HELD', () => {
  it('holds a row that is not EXHAUSTED (state PENDING)', () => {
    const d = decideRequeue(row({ state: 'PENDING' }));
    expect(d.requeue).toBe(false);
    expect(d.reason).toMatch(/state is PENDING, not EXHAUSTED/);
  });

  it('holds a row with a chosen_source recorded — not the absence-bug shape', () => {
    const d = decideRequeue(row({ chosenSource: 'CHITTORGARH' }));
    expect(d.requeue).toBe(false);
    expect(d.reason).toMatch(/chosen_source is set/);
  });

  it('holds a row with attempts > 1 — a real multi-attempt exhaustion, not the buggy first-attempt no', () => {
    const d = decideRequeue(row({ attempts: 2 }));
    expect(d.requeue).toBe(false);
    expect(d.reason).toMatch(/attempts is 2/);
  });

  it('holds a row with attempts = 5 (three definitive answers after real backoff cycles)', () => {
    const d = decideRequeue(row({ attempts: 5 }));
    expect(d.requeue).toBe(false);
  });
});

describe('formatDecision — one identity line per row, never a bare count (signal-ownership R1)', () => {
  it('prints the IPO slug, table.field, attempts and the reason', () => {
    const line = formatDecision(decideRequeue(row()));
    expect(line).toContain('asset-reconstruction-company-india-limited');
    expect(line).toContain('ipo_details.fresh_issue');
    expect(line).toContain('attempts=1');
    expect(line).toMatch(/^REQUEUE/);
  });

  it('marks a held row distinctly', () => {
    const line = formatDecision(decideRequeue(row({ chosenSource: 'BSE' })));
    expect(line).toMatch(/^HOLD/);
  });

  it('includes the row_key for a keyed row', () => {
    const line = formatDecision(
      decideRequeue(row({ tableName: 'financial_statements', rowKey: 'FY2026', fieldName: 'revenue' }))
    );
    expect(line).toContain('[FY2026]');
  });
});

describe('parseArgs', () => {
  it('reads --expect-db and --apply', () => {
    const cli = parseArgs(['--expect-db', 'ipodhan_staging', '--apply']);
    expect(cli.expectDb).toBe('ipodhan_staging');
    expect(cli.apply).toBe(true);
    expect(cli.allowProd).toBe(false);
  });

  it('defaults to dry-run with no --expect-db', () => {
    const cli = parseArgs([]);
    expect(cli.expectDb).toBeNull();
    expect(cli.apply).toBe(false);
  });

  it('reads --false-supplied', () => {
    const cli = parseArgs(['--expect-db', 'ipodhan_staging', '--false-supplied']);
    expect(cli.falseSupplied).toBe(true);
  });

  it('defaults --false-supplied to false', () => {
    const cli = parseArgs(['--expect-db', 'ipodhan_staging']);
    expect(cli.falseSupplied).toBe(false);
  });
});

/**
 * Review round 5, item B: the walk's PRE-item-A bug recorded SUPPLIED
 * whenever `consolidatedUpsertIPO` returned `skipped: false`, even when the
 * matrix kept a DIFFERENT source's value (e.g. CHITTORGARH outranking BSE
 * for issue_size, T-453). 7 rows on staging carry a `chosen_source` that
 * disagrees with the `field_sources` provenance row the consolidator
 * actually wrote. This repair mode resets exactly those.
 *
 * DOC<->DRHP is NOT a mismatch: every filing document type writes
 * `field_sources.source` as 'DRHP' (filing-persister.ts's SOURCE ENUM
 * NOTE), while the plan's `chosen_source` stores the manifest word 'DOC' —
 * the SAME mapping `field-plan-walk.ts`'s `mapManifestSourceToScraperSource`
 * uses for the walk's own agreement check (review round 5, item A) is
 * reused here, never a second, possibly-drifting copy of the mapping.
 */
function suppliedRow(over: Partial<SuppliedPlanRow> = {}): SuppliedPlanRow {
  return {
    id: 'plan-1',
    ipoId: 'ipo-1',
    ipoSlug: 'hero-motors-ltd',
    ipoName: 'Hero Motors Limited',
    tableName: 'ipos',
    rowKey: '',
    fieldName: 'issue_size',
    chosenSource: 'BSE',
    provenanceSource: 'CHITTORGARH',
    ...over,
  };
}

describe('decideFalseSupplied — chosen_source vs field_sources.source, DOC<->DRHP excepted', () => {
  it('flags a real mismatch: chosen_source BSE, provenance CHITTORGARH (the exact staging class)', () => {
    const d = decideFalseSupplied(suppliedRow());
    expect(d.requeue).toBe(true);
  });

  it('does NOT flag chosen_source DOC with provenance DRHP -- that IS agreement, not a mismatch', () => {
    const d = decideFalseSupplied(suppliedRow({ chosenSource: 'DOC', provenanceSource: 'DRHP' }));
    expect(d.requeue).toBe(false);
    expect(d.reason).toMatch(/agrees/);
  });

  it('does NOT flag a row whose chosen_source matches its provenance exactly', () => {
    const d = decideFalseSupplied(suppliedRow({ chosenSource: 'CHITTORGARH', provenanceSource: 'CHITTORGARH' }));
    expect(d.requeue).toBe(false);
  });

  it('does NOT flag a row with no provenance row at all -- nothing to compare against, never guessed as a mismatch', () => {
    const d = decideFalseSupplied(suppliedRow({ provenanceSource: null }));
    expect(d.requeue).toBe(false);
    expect(d.reason).toMatch(/no provenance row/);
  });
});

describe('formatFalseSuppliedDecision — identities, never a bare count', () => {
  it('prints the IPO slug, table.field, chosen vs provenance source', () => {
    const line = formatFalseSuppliedDecision(decideFalseSupplied(suppliedRow()));
    expect(line).toContain('hero-motors-ltd');
    expect(line).toContain('ipos.issue_size');
    expect(line).toContain('BSE');
    expect(line).toContain('CHITTORGARH');
  });
});
