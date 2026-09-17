import { describe, it, expect } from 'vitest';
import {
  resolveIpoTypeKey,
  generateFieldPlan,
  applyWriteResult,
  type PlanIpo,
  type PlannedFieldRow,
} from '../../../src/services/field-plan-generator.js';
import { loadFieldManifest } from '../../../src/config/field-manifest-loader.js';

const MAINBOARD_IPO: PlanIpo = { id: 'ipo-mb', segment: 'MAINBOARD', listingExchanges: ['NSE', 'BSE'] };
const SME_BSE_IPO: PlanIpo = { id: 'ipo-sme-bse', segment: 'SME', listingExchanges: ['BSE'] };
const SME_NSE_IPO: PlanIpo = { id: 'ipo-sme-nse', segment: 'SME', listingExchanges: ['NSE'] };

function rowFor(rows: PlannedFieldRow[], table: string, field: string): PlannedFieldRow | undefined {
  return rows.find((r) => r.tableName === table && r.fieldName === field);
}

describe('resolveIpoTypeKey', () => {
  it('maps a MAINBOARD IPO to MAINBOARD', () => {
    expect(resolveIpoTypeKey(MAINBOARD_IPO)).toBe('MAINBOARD');
  });

  it('maps an SME IPO listing on BSE only to SME_BSE', () => {
    expect(resolveIpoTypeKey(SME_BSE_IPO)).toBe('SME_BSE');
  });

  it('maps an SME IPO listing on NSE to SME_NSE', () => {
    expect(resolveIpoTypeKey(SME_NSE_IPO)).toBe('SME_NSE');
  });

  it('treats an SME IPO with no listing exchanges as SME_BSE, not as MAINBOARD', () => {
    expect(resolveIpoTypeKey({ id: 'x', segment: 'SME', listingExchanges: null })).toBe('SME_BSE');
  });

  it('treats a null segment as MAINBOARD', () => {
    expect(resolveIpoTypeKey({ id: 'x', segment: null, listingExchanges: null })).toBe('MAINBOARD');
  });
});

describe('generateFieldPlan - over the real manifest', () => {
  const manifest = loadFieldManifest();

  it('stamps the manifest version on every row', () => {
    const rows = generateFieldPlan(MAINBOARD_IPO, manifest);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.manifestVersion === manifest.version)).toBe(true);
  });

  it('splits the manifest key into table and field', () => {
    const rows = generateFieldPlan(MAINBOARD_IPO, manifest);
    const row = rowFor(rows, 'ipos', 'issue_size');
    expect(row).toBeDefined();
    expect(row!.ipoId).toBe('ipo-mb');
  });

  it('starts every row PENDING with zero attempts and nothing chosen', () => {
    const rows = generateFieldPlan(MAINBOARD_IPO, manifest);
    for (const r of rows) {
      expect(r.state).toBe('PENDING');
      expect(r.attempts).toBe(0);
      expect(r.chosenSource).toBeNull();
      expect(r.chosenRank).toBeNull();
    }
  });

  it('fills ranks in manifest order and nulls the unused rank columns', () => {
    const rows = generateFieldPlan(MAINBOARD_IPO, manifest);
    const issueSize = rowFor(rows, 'ipos', 'issue_size')!;
    // Review round 5, item C: BSE removed from ipos.issue_size's rank
    // (capability.BSE.capable flipped to false) -- a fresh plan for a NEW
    // IPO now fills rank2 as CHITTORGARH and leaves rank3 unused, matching
    // field-manifest-loader.test.ts's same fix. This is DISTINCT from the
    // round 6 operational note (issue TBD): EXISTING plan rows persisted
    // before this manifest change keep rank2_source=BSE forever (ON
    // CONFLICT DO NOTHING, manifest_version still 1) -- that reconciliation
    // is the next slice's job, not this generator's.
    expect([issueSize.rank1Source, issueSize.rank2Source, issueSize.rank3Source]).toEqual([
      'DOC',
      'CHITTORGARH',
      null,
    ]);
    const minInvestment = rowFor(rows, 'ipo_details', 'min_investment')!;
    expect([minInvestment.rank1Source, minInvestment.rank2Source, minInvestment.rank3Source]).toEqual([
      'DOC',
      null,
      null,
    ]);
  });

  it('resolves ranks from the IPO OWN type key, not from MAINBOARD', () => {
    // Moneycontrol is retired (OD-3; field-manifest.json v2, PR #738) — the manifest's
    // financial_statements.revenue rank arrays now have only 2 entries for every IPO
    // type, so rank3Source resolves to null (field-plan-generator.ts: `ranks[2] ?? null`).
    for (const ipo of [MAINBOARD_IPO, SME_BSE_IPO, SME_NSE_IPO]) {
      const row = rowFor(generateFieldPlan(ipo, manifest), 'financial_statements', 'revenue')!;
      expect([row.rank1Source, row.rank2Source, row.rank3Source]).toEqual([
        'DOC',
        'CHITTORGARH',
        null,
      ]);
    }
  });

  it('plans NO row for a field whose rank map has no entry for this IPO type', () => {
    // A field with no rank entry for this IPO type gets no plan row.
    // field-manifest-schema.ts says MAINBOARD is the one required key and the loader does NOT
    // default a missing key to []. A generator that silently fell back to MAINBOARD would plan
    // NSE as rank 1 for an SME-on-BSE IPO - the wrong-segment bug. Built from a temp manifest
    // (same idiom as 'generateFieldPlan - refusals' below) with ONE field declaring
    // rank.MAINBOARD only, so this test does not depend on which real manifest fields happen to
    // lack an SME entry (round-3 review: subscriptions/listing_performance are spec-correct in
    // v2 and are not that fixture).
    const mainboardOnly = {
      ...manifest,
      fields: {
        'ipos.issue_size': {
          ...manifest.fields['ipos.issue_size'],
          rank: { MAINBOARD: ['DOC', 'CHITTORGARH'] },
        },
      },
    } as unknown as typeof manifest;

    const mainboard = generateFieldPlan(MAINBOARD_IPO, mainboardOnly);
    expect(rowFor(mainboard, 'ipos', 'issue_size')).toBeDefined();

    for (const ipo of [SME_BSE_IPO, SME_NSE_IPO]) {
      const rows = generateFieldPlan(ipo, mainboardOnly);
      expect(rowFor(rows, 'ipos', 'issue_size')).toBeUndefined();
    }
  });

  it('never plans NSE as a rank for an SME-on-BSE IPO', () => {
    const rows = generateFieldPlan(SME_BSE_IPO, manifest);
    const nseRanks = rows
      .flatMap((r) => [r.rank1Source, r.rank2Source, r.rank3Source])
      .filter((s) => s === 'NSE');
    expect(nseRanks).toEqual([]);
  });

  it('plans one row per manifest field that declares this type, and no duplicates', () => {
    const rows = generateFieldPlan(MAINBOARD_IPO, manifest);
    const expected = Object.entries(manifest.fields).filter(([, e]) =>
      Array.isArray(e.rank.MAINBOARD)
    ).length;
    expect(rows.length).toBe(expected);
    const keys = rows.map((r) => r.tableName + '.' + r.fieldName);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('generateFieldPlan - refusals', () => {
  const manifest = loadFieldManifest();

  it('refuses a rank list longer than the three rank columns rather than dropping a source', () => {
    const overflowing = {
      ...manifest,
      fields: {
        'ipos.issue_size': {
          ...manifest.fields['ipos.issue_size'],
          rank: { MAINBOARD: ['DOC', 'BSE', 'CHITTORGARH', 'NSE'] },
        },
      },
    } as unknown as typeof manifest;
    expect(() => generateFieldPlan(MAINBOARD_IPO, overflowing)).toThrow(/rank/i);
  });

  it('refuses a manifest key that is not table.field', () => {
    const malformed = {
      ...manifest,
      fields: { issue_size: manifest.fields['ipos.issue_size'] },
    } as unknown as typeof manifest;
    expect(() => generateFieldPlan(MAINBOARD_IPO, malformed)).toThrow(/table\.field/i);
  });
});

describe('applyWriteResult - a dropped write must never read as SUPPLIED', () => {
  const manifest = loadFieldManifest();
  const pending = () => rowFor(generateFieldPlan(MAINBOARD_IPO, manifest), 'ipos', 'issue_size')!;

  it('leaves the row PENDING with attempts UNTOUCHED when the write was skipped', () => {
    // consolidatedUpsertIPO returns { skipped: true, skipReason: 'LOCK_NOT_ACQUIRED' } silently
    // (data-consolidation-orchestrator.ts:205-207). The write did not happen, so the ask is
    // still outstanding and the attempt was never made.
    const before = pending();
    const after = applyWriteResult(before, {
      skipped: true,
      skipReason: 'LOCK_NOT_ACQUIRED',
      source: 'DOC',
      rank: 1,
      value: '1200',
    });
    expect(after.state).toBe('PENDING');
    expect(after.attempts).toBe(0);
    expect(after.chosenSource).toBeNull();
    expect(after.chosenRank).toBeNull();
    expect(after.lastAttemptAt).toBeNull();
  });

  it('leaves the row PENDING for EVERY skip reason, not only LOCK_NOT_ACQUIRED', () => {
    const reasons = [
      'LOCK_NOT_ACQUIRED',
      'CONSOLIDATION_DISABLED',
      'MISSING_ROW_KEY',
      'CHILD_TABLE_CONSOLIDATION_DISABLED',
      'ERROR: boom',
      undefined,
    ];
    for (const reason of reasons) {
      const after = applyWriteResult(pending(), {
        skipped: true,
        skipReason: reason,
        source: 'DOC',
        rank: 1,
        value: '1',
      });
      expect(after.state, 'skipReason=' + reason).toBe('PENDING');
      expect(after.attempts, 'skipReason=' + reason).toBe(0);
    }
  });

  it('marks SUPPLIED with its evidence only when the write actually landed', () => {
    const after = applyWriteResult(pending(), {
      skipped: false,
      source: 'DOC',
      rank: 1,
      value: '1200',
      documentId: 'doc-1',
      documentType: 'PRICE_BAND_AD',
      sha256: 'a'.repeat(64),
      page: 118,
      at: new Date('2026-09-11T00:00:00Z'),
    });
    expect(after.state).toBe('SUPPLIED');
    expect(after.chosenSource).toBe('DOC');
    expect(after.chosenRank).toBe(1);
    expect(after.chosenDocumentId).toBe('doc-1');
    expect(after.chosenPage).toBe(118);
    expect(after.attempts).toBe(1);
    expect(after.lastAttemptAt).toEqual(new Date('2026-09-11T00:00:00Z'));
  });

  it('counts an attempt but stays PENDING when the write landed with no value', () => {
    const after = applyWriteResult(pending(), { skipped: false, source: 'DOC', rank: 1, value: null });
    expect(after.state).toBe('PENDING');
    expect(after.attempts).toBe(1);
    expect(after.chosenSource).toBeNull();
  });

  it('does not mutate the row it was given', () => {
    const before = pending();
    applyWriteResult(before, { skipped: false, source: 'DOC', rank: 1, value: '1200' });
    expect(before.state).toBe('PENDING');
    expect(before.attempts).toBe(0);
  });
});
