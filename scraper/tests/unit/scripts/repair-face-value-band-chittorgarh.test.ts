import { describe, it, expect, vi } from 'vitest';
import { normalizeCompanyNameForMatching } from '@ipodhan/shared/utils/company-name-normalizer';
import {
  isClassMember,
  detailUrlFromCompanyAnchor,
  plainCompanyName,
  resolveIssuePrice,
  parseStrictIssuePrice,
  decideExpectDbRefusal,
  collectReport82Candidates,
  applyRowRepair,
  type Report82Candidate,
  type ClassRow,
} from '../../../scripts/repair-face-value-band-chittorgarh.js';

// The tool matches names with the SAME normaliser used elsewhere in this
// codebase to compare a stored IPO name against a scraped source name — use
// the real one here too, not a hand-rolled fold, so this test exercises the
// actual matching behaviour (e.g. "Ltd." vs "Limited" must fold together).
const fold = normalizeCompanyNameForMatching;

describe('isClassMember — the class predicate mirrors the SQL filter', () => {
  it('matches the STANBIK shape: min = max = face_value, offering_type IPO', () => {
    expect(isClassMember({ priceRangeMin: 1000, priceRangeMax: 1000, faceValue: 1000, offeringType: 'IPO' })).toBe(true);
  });

  it('excludes a row whose band is not equal to its face value', () => {
    expect(isClassMember({ priceRangeMin: 95, priceRangeMax: 100, faceValue: 10, offeringType: 'IPO' })).toBe(false);
  });

  it('excludes a real fixed-price issue whose band equals a NON-face-value offer price', () => {
    // A real fixed-price issue: band = offer price = 55, but face value is 10 (not equal).
    expect(isClassMember({ priceRangeMin: 55, priceRangeMax: 55, faceValue: 10, offeringType: 'IPO' })).toBe(false);
  });

  it('excludes a non-IPO offering type even if the numbers coincide', () => {
    expect(isClassMember({ priceRangeMin: 10, priceRangeMax: 10, faceValue: 10, offeringType: 'RIGHTS' })).toBe(false);
  });

  it('excludes a row with any null among the three values', () => {
    expect(isClassMember({ priceRangeMin: null, priceRangeMax: 10, faceValue: 10, offeringType: 'IPO' })).toBe(false);
    expect(isClassMember({ priceRangeMin: 10, priceRangeMax: null, faceValue: 10, offeringType: 'IPO' })).toBe(false);
    expect(isClassMember({ priceRangeMin: 10, priceRangeMax: 10, faceValue: null, offeringType: 'IPO' })).toBe(false);
  });
});

describe('detailUrlFromCompanyAnchor / plainCompanyName', () => {
  const html =
    '<a href="https://www.chittorgarh.com/ipo/stanbik-agro-ipo/2602/" title="Stanbik Agro IPO Details">Stanbik Agro Ltd.</a> ';

  it('extracts the href', () => {
    expect(detailUrlFromCompanyAnchor(html)).toBe('https://www.chittorgarh.com/ipo/stanbik-agro-ipo/2602/');
  });

  it('strips markup down to the plain company name', () => {
    expect(plainCompanyName(html)).toBe('Stanbik Agro Ltd.');
  });

  it('returns null / empty string when there is no anchor', () => {
    expect(detailUrlFromCompanyAnchor('plain text')).toBeNull();
    expect(plainCompanyName('plain text')).toBe('plain text');
  });
});

describe('parseStrictIssuePrice — the whole cell must be numeric, not a prefix', () => {
  it('accepts a plain positive number, with commas stripped', () => {
    expect(parseStrictIssuePrice('30.00')).toBe(30);
    expect(parseStrictIssuePrice('1,234.50')).toBe(1234.5);
  });

  it('refuses a range cell like "30 to 32" (parseFloat would silently accept 30)', () => {
    expect(parseStrictIssuePrice('30 to 32')).toBeNull();
  });

  it('refuses a footnoted cell like "30*" (parseFloat would silently accept 30)', () => {
    expect(parseStrictIssuePrice('30*')).toBeNull();
  });

  it('refuses null/undefined/empty/zero/negative', () => {
    expect(parseStrictIssuePrice(null)).toBeNull();
    expect(parseStrictIssuePrice(undefined)).toBeNull();
    expect(parseStrictIssuePrice('')).toBeNull();
    expect(parseStrictIssuePrice('0')).toBeNull();
    expect(parseStrictIssuePrice('-5')).toBeNull();
  });
});

describe('resolveIssuePrice', () => {
  const candidate = (overrides: Partial<Report82Candidate>): Report82Candidate => ({
    companyName: 'Stanbik Agro Ltd.',
    issuePriceRaw: '30.00',
    detailUrl: 'https://www.chittorgarh.com/ipo/stanbik-agro-ipo/2602/',
    year: 2025,
    category: 'sme',
    ...overrides,
  });

  it('resolves STANBIK to 30.00 from a single matching candidate', () => {
    const outcome = resolveIssuePrice('STANBIK AGRO LIMITED', [candidate({})], fold);
    expect(outcome.status).toBe('resolved');
    if (outcome.status === 'resolved') {
      expect(outcome.issuePrice).toBe(30);
      expect(outcome.detailUrl).toBe('https://www.chittorgarh.com/ipo/stanbik-agro-ipo/2602/');
    }
  });

  it('returns no-source when nothing matches the folded name', () => {
    const outcome = resolveIssuePrice('BANGANGA PAPER INDUSTRIES LTD', [candidate({})], fold);
    expect(outcome.status).toBe('no-source');
  });

  it('refuses on non-numeric Issue Price even if the name matches', () => {
    const outcome = resolveIssuePrice('STANBIK AGRO LIMITED', [candidate({ issuePriceRaw: 'TBA' })], fold);
    expect(outcome.status).toBe('no-source');
  });

  it('refuses on zero or negative Issue Price', () => {
    const outcome = resolveIssuePrice('STANBIK AGRO LIMITED', [candidate({ issuePriceRaw: '0' })], fold);
    expect(outcome.status).toBe('no-source');
  });

  it('refuses a range Issue Price like "30 to 32" rather than resolving to 30', () => {
    const outcome = resolveIssuePrice('STANBIK AGRO LIMITED', [candidate({ issuePriceRaw: '30 to 32' })], fold);
    expect(outcome.status).toBe('no-source');
  });

  it('refuses an empty (post-fold) stored company name before matching anything', () => {
    const outcome = resolveIssuePrice('', [candidate({ companyName: '' })], fold);
    expect(outcome.status).toBe('no-source');
  });

  it('refuses as ambiguous when 2+ candidates fold to the same name, naming both', () => {
    const outcome = resolveIssuePrice(
      'STANBIK AGRO LIMITED',
      [candidate({ issuePriceRaw: '30.00', year: 2025 }), candidate({ issuePriceRaw: '35.00', year: 2026 })],
      fold
    );
    expect(outcome.status).toBe('ambiguous');
    if (outcome.status === 'ambiguous') {
      expect(outcome.candidates).toHaveLength(2);
    }
  });
});

describe('collectReport82Candidates', () => {
  it('fetches all 3 fiscal years x 2 categories and flattens rows into candidates', async () => {
    const fetchYear = vi.fn(async (category: 'mainboard' | 'sme', year: number) => [
      {
        Company: `<a href="https://example.com/ipo/x-${category}-${year}/1/">X ${category} ${year}</a>`,
        'Issue Price (Rs.)': '10.00',
      },
    ]);
    const candidates = await collectReport82Candidates(fetchYear);
    expect(fetchYear).toHaveBeenCalledTimes(6); // 3 years x 2 categories
    expect(candidates).toHaveLength(6);
    expect(candidates[0].detailUrl).toMatch(/^https:\/\/example\.com/);
  });

  it('skips a row with an empty company name', async () => {
    const fetchYear = vi.fn(async () => [{ Company: '', 'Issue Price (Rs.)': '10.00' }]);
    const candidates = await collectReport82Candidates(fetchYear);
    expect(candidates).toHaveLength(0);
  });

  it('one (year, category) bucket throwing does not abort the other 5 — reported via onFetchError, not swallowed silently', async () => {
    const goodRow = (n: string) => [{ Company: `<a href="https://example.com/ipo/${n}/1/">${n}</a>`, 'Issue Price (Rs.)': '10.00' }];
    const fetchYear = vi.fn(async (category: 'mainboard' | 'sme', year: number) => {
      if (year === 2026 && category === 'mainboard') throw new Error('hit the 200-page hard ceiling');
      return goodRow(`${category}-${year}`);
    });
    const errors: Array<{ year: number; category: string }> = [];
    const candidates = await collectReport82Candidates(fetchYear, (year, category) => errors.push({ year, category }));
    expect(errors).toEqual([{ year: 2026, category: 'mainboard' }]);
    expect(candidates).toHaveLength(5); // 6 buckets - 1 that threw
  });
});

describe('applyRowRepair — the write body', () => {
  const row: ClassRow = {
    id: 'ipo-1',
    companyName: 'STANBIK AGRO LIMITED',
    slug: 'stanbik-agro-ltd',
    priceRangeMin: 1000,
    priceRangeMax: 1000,
    faceValue: 1000,
  };

  function makeFakeExecutors() {
    const calls: Array<{ kind: 'upsert' | 'applyOfferTerms' | 'applyFaceValue'; payload: unknown }> = [];
    const executors = {
      transaction: async (fn: (tx: unknown) => Promise<void>) => {
        await fn({ calls });
      },
      makeRepo: (_tx: unknown) => ({
        applyOfferTerms: async (id: string, data: unknown) => {
          calls.push({ kind: 'applyOfferTerms', payload: { id, data } });
        },
        applyFaceValue: async (id: string, faceValue: number) => {
          calls.push({ kind: 'applyFaceValue', payload: { id, faceValue } });
        },
      }),
    };
    return { executors, calls };
  }

  const backups: Array<{ path: string; payload: unknown }> = [];
  const ledgers: Array<{ path: string; payload: unknown }> = [];
  const writeBackup = (path: string, payload: unknown) => {
    backups.push({ path, payload });
    return path;
  };
  const writeLedger = (path: string, payload: unknown) => {
    ledgers.push({ path, payload });
    return path;
  };
  const upsert = (vi.fn(async (_tx: unknown, params: Record<string, unknown>) => {
    return { previousSource: null, __calledWith: params };
  }) as unknown) as typeof import('../../../scripts/lib/repair-tool.js').upsertFieldSource;

  it('writes ONE provenance row per changed field, calls both repository methods, backs up before the transaction', async () => {
    const { executors } = makeFakeExecutors();
    const upsertSpy = vi.fn(async (_tx: unknown, params: Record<string, unknown>) => ({ previousSource: null, params }));
    const result = await applyRowRepair(executors as any, {
      row,
      issuePrice: 30,
      resolvedFaceValue: 10,
      reportUrlNote: 'https://www.chittorgarh.com/ipo/stanbik-agro-ipo/2602/ FY2025 sme',
      stamp: '2026-09-16T00:00:00.000Z',
      writeBackup,
      writeLedger,
      upsert: upsertSpy as any,
    });

    expect(result.wrote).toBe(true);
    expect(result.fieldsWritten.sort()).toEqual(['faceValue', 'priceRangeMax', 'priceRangeMin'].sort());
    expect(upsertSpy).toHaveBeenCalledTimes(3);
    expect(backups).toHaveLength(1);
    expect(backups[0].path).toBe(result.backupPath);
  });

  it('writes NO diff when the row already matches the resolved values (idempotent no-op)', async () => {
    const { executors } = makeFakeExecutors();
    const upsertSpy = vi.fn();
    const alreadyCorrectRow: ClassRow = { ...row, priceRangeMin: 30, priceRangeMax: 30, faceValue: 10 };
    const result = await applyRowRepair(executors as any, {
      row: alreadyCorrectRow,
      issuePrice: 30,
      resolvedFaceValue: 10,
      reportUrlNote: 'note',
      stamp: '2026-09-16T00:00:00.000Z',
      writeBackup,
      writeLedger,
      upsert: upsertSpy as any,
    });
    expect(result.wrote).toBe(false);
    expect(upsertSpy).not.toHaveBeenCalled();
  });

  it('leaves face_value untouched (no provenance row for it) when resolvedFaceValue is null', async () => {
    const { executors } = makeFakeExecutors();
    const upsertSpy = vi.fn(async (_tx: unknown, params: Record<string, unknown>) => ({ previousSource: null, params }));
    const result = await applyRowRepair(executors as any, {
      row,
      issuePrice: 30,
      resolvedFaceValue: null,
      reportUrlNote: 'note',
      stamp: '2026-09-16T00:00:00.000Z',
      writeBackup,
      writeLedger,
      upsert: upsertSpy as any,
    });
    expect(result.fieldsWritten).toEqual(['priceRangeMin', 'priceRangeMax']);
    expect(upsertSpy).toHaveBeenCalledTimes(2);
  });

  it('writes a faceValue provenance row (source CHITTORGARH) when face_value changed', async () => {
    const { executors } = makeFakeExecutors();
    const upsertSpy = vi.fn(async (_tx: unknown, params: Record<string, unknown>) => ({ previousSource: null, params }));
    await applyRowRepair(executors as any, {
      row,
      issuePrice: 30,
      resolvedFaceValue: 10,
      reportUrlNote: 'note',
      stamp: '2026-09-16T00:00:00.000Z',
      writeBackup,
      writeLedger,
      upsert: upsertSpy as any,
    });
    const faceValueCalls = upsertSpy.mock.calls.filter(([, params]) => (params as Record<string, unknown>).fieldName === 'faceValue');
    expect(faceValueCalls).toHaveLength(1);
    expect((faceValueCalls[0][1] as Record<string, unknown>).source).toBe('CHITTORGARH');
  });

  it('writes NO faceValue provenance row when only the band changed (resolvedFaceValue null)', async () => {
    const { executors } = makeFakeExecutors();
    const upsertSpy = vi.fn(async (_tx: unknown, params: Record<string, unknown>) => ({ previousSource: null, params }));
    await applyRowRepair(executors as any, {
      row,
      issuePrice: 30,
      resolvedFaceValue: null,
      reportUrlNote: 'note',
      stamp: '2026-09-16T00:00:00.000Z',
      writeBackup,
      writeLedger,
      upsert: upsertSpy as any,
    });
    const faceValueCalls = upsertSpy.mock.calls.filter(([, params]) => (params as Record<string, unknown>).fieldName === 'faceValue');
    expect(faceValueCalls).toHaveLength(0);
  });
});

describe('decideExpectDbRefusal', () => {
  it('a dry run never refuses regardless of --expect-db', () => {
    expect(decideExpectDbRefusal({ apply: false, expectDb: undefined, dbName: 'ipodhan' }).refuse).toBe(false);
    expect(decideExpectDbRefusal({ apply: false, expectDb: 'wrong', dbName: 'ipodhan' }).refuse).toBe(false);
  });

  it('--apply with no --expect-db is refused', () => {
    const d = decideExpectDbRefusal({ apply: true, expectDb: undefined, dbName: 'ipodhan_staging' });
    expect(d.refuse).toBe(true);
    expect(d.reason).toMatch(/requires --expect-db/);
  });

  it('--apply with a mismatched --expect-db is refused, naming both', () => {
    const d = decideExpectDbRefusal({ apply: true, expectDb: 'ipodhan', dbName: 'ipodhan_staging' });
    expect(d.refuse).toBe(true);
    expect(d.reason).toMatch(/"ipodhan"/);
    expect(d.reason).toMatch(/"ipodhan_staging"/);
  });

  it('--apply with a matching --expect-db (case-insensitive) is allowed', () => {
    expect(decideExpectDbRefusal({ apply: true, expectDb: 'IPODHAN_STAGING', dbName: 'ipodhan_staging' }).refuse).toBe(false);
  });
});
