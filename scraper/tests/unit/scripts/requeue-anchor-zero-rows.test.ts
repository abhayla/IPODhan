/**
 * #437 slice 2 — the re-queue tool's selection rule.
 *
 * The tool resets blocked anchor documents back to PENDING so the repaired
 * extractor gets another pass at them. The whole risk is in WHICH documents it
 * picks: 24 documents sit in MANUAL_REVIEW and only the #437 ones deserve a
 * retry. Six of them are CORRECT refusals — a wrong document type, a printed
 * total that contradicts the rows — and reviving those would turn "we retried
 * it" into a claim that it was fixed.
 *
 * Every error string below is the wording the parser actually emits
 * (`src/scrapers/anchor-report-parser.ts`), not a paraphrase — a test built on
 * invented wording would pass while the tool matched nothing in production.
 *
 * No database: `decideRequeue` is pure, so a deleted guard turns a named test
 * red rather than silently widening what the tool resets.
 */
import { describe, expect, it } from 'vitest';
import {
  ANCHOR_DOCUMENT_TYPE,
  BLOCKED_STATUS,
  REQUEUED_STATUS,
  decideRequeue,
  formatDecision,
  parseArgs,
  type BlockedDocument,
} from '../../../scripts/requeue-anchor-zero-rows';

function doc(over: Partial<BlockedDocument> = {}): BlockedDocument {
  return {
    id: 'doc-1',
    ipoId: 'ipo-1',
    ipoName: 'Hero Motors Limited',
    ipoSlug: 'hero-motors-limited',
    type: ANCHOR_DOCUMENT_TYPE,
    extractionStatus: BLOCKED_STATUS,
    extractionError: 'zero_rows',
    ...over,
  };
}

describe('decideRequeue — the #437 classes are re-queued', () => {
  const requeued = [
    ['zero_rows', 'zero_rows'],
    [
      'no rows at all',
      'no investor rows could be read from the anchor report',
    ],
    [
      'the candidate stage',
      'only 0 investor rows could be read from the anchor report (candidate stage)',
    ],
    [
      'the reconciliation stage',
      'only 3 investor rows survived reconciliation of the anchor report (4 failed)',
    ],
    [
      'a per-row price disagreement',
      '4 of 12 investor rows disagreed with the derived bid price 84, at or over the 30% floor - first: row "KOTAK MAHINDRA TRUSTEE CO LTD A/C KOTAK MULTI ASSET ALLOCATION FUND" has no amount consistent with the derived bid price 84',
    ],
    [
      'the shrunken-denominator percentage shape',
      'row "LC Pharos Multi Strategy Fund VCC LC Pharos Multi Strategy" prints 18.10% but holds 22.16% of the anchor portion',
    ],
    [
      'percentages that do not sum',
      'investor percentages add up to 88.31%, not 100%',
    ],
  ] as const;

  for (const [label, error] of requeued) {
    it(`re-queues ${label}`, () => {
      const d = decideRequeue(doc({ extractionError: error }));
      expect(d.requeue, `${error} should be re-queued`).toBe(true);
      expect(d.reason).toContain('#437 class');
    });
  }
});

describe('decideRequeue — correct refusals stay in MANUAL_REVIEW', () => {
  const held = [
    ['a wrong document type', 'this document is not an anchor allocation report'],
    [
      'two independent printed figures contradicting each other',
      'the investor amounts do not add up to the total allocation',
    ],
    ['a letter for another IPO', 'this letter belongs to a different IPO'],
    ['an error outside every known class', 'pdftotext exited 1: damaged file'],
  ] as const;

  for (const [label, error] of held) {
    it(`holds ${label}`, () => {
      const d = decideRequeue(doc({ extractionError: error }));
      expect(d.requeue, `${error} must NOT be re-queued`).toBe(false);
    });
  }

  it('holds a document with no recorded error — absence is not evidence', () => {
    expect(decideRequeue(doc({ extractionError: null })).requeue).toBe(false);
    expect(decideRequeue(doc({ extractionError: '   ' })).requeue).toBe(false);
  });

  it('holds a hold-pattern error even when a #437 phrase also appears', () => {
    // The hold list is checked FIRST on purpose: a refusal that names a real
    // contradiction is never overridden by a co-occurring #437 phrase.
    const d = decideRequeue(
      doc({
        extractionError:
          'zero_rows; the investor amounts do not add up to the total allocation',
      })
    );
    expect(d.requeue).toBe(false);
    expect(d.reason).toContain('held');
  });
});

describe('decideRequeue — the blast radius is bounded by type and status', () => {
  it('never touches a document of another type', () => {
    const d = decideRequeue(doc({ type: 'RHP' }));
    expect(d.requeue).toBe(false);
    expect(d.reason).toContain(ANCHOR_DOCUMENT_TYPE);
  });

  it('never touches a document that is not in MANUAL_REVIEW', () => {
    for (const status of ['COMPLETED', 'PENDING', 'FAILED', 'IN_PROGRESS', null]) {
      const d = decideRequeue(doc({ extractionStatus: status }));
      expect(d.requeue, `status ${status} must not be re-queued`).toBe(false);
    }
  });

  it('resets to PENDING, which is what the extractor picks up', () => {
    expect(REQUEUED_STATUS).toBe('PENDING');
  });
});

describe('formatDecision — identities, never a bare count (signal-ownership R1)', () => {
  it('names the IPO and the document id on every line', () => {
    const line = formatDecision(decideRequeue(doc()));
    expect(line).toContain('Hero Motors Limited');
    expect(line).toContain('doc-1');
    expect(line).toContain('REQUEUE');
  });

  it('falls back to the slug, then the ipo id, when the name is missing', () => {
    expect(formatDecision(decideRequeue(doc({ ipoName: null })))).toContain(
      'hero-motors-limited'
    );
    expect(
      formatDecision(decideRequeue(doc({ ipoName: null, ipoSlug: null })))
    ).toContain('ipo-1');
  });

  it('marks a held document distinctly from a re-queued one', () => {
    const line = formatDecision(
      decideRequeue(doc({ extractionError: 'not an anchor allocation report' }))
    );
    expect(line).toContain('HOLD');
    expect(line).not.toContain('REQUEUE');
  });
});

describe('parseArgs — dry run is the default and --expect-db is read', () => {
  it('defaults to a dry run with no prod allowance', () => {
    const cli = parseArgs(['--expect-db', 'ipodhan_staging']);
    expect(cli.apply).toBe(false);
    expect(cli.allowProd).toBe(false);
    expect(cli.expectDb).toBe('ipodhan_staging');
  });

  it('reads --apply and --allow-prod', () => {
    const cli = parseArgs(['--expect-db', 'ipodhan', '--apply', '--allow-prod']);
    expect(cli.apply).toBe(true);
    expect(cli.allowProd).toBe(true);
  });

  it('treats a following flag as a missing --expect-db value', () => {
    expect(parseArgs(['--expect-db', '--apply']).expectDb).toBeNull();
    expect(parseArgs(['--apply']).expectDb).toBeNull();
  });
});
