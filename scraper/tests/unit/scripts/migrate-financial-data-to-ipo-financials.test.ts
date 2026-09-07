import { describe, it, expect } from 'vitest';
import {
  mapToIpoFinancials,
  resolveDatabaseName,
  parseSlugArg,
  PRODUCTION_DATABASE_NAME,
  type FinancialDataRow,
} from '../../../scripts/migrate-financial-data-to-ipo-financials.js';

function fixture(overrides: Partial<FinancialDataRow> = {}): FinancialDataRow {
  return {
    ipoId: 'ipo-1',
    revenueFy2024: '450.50',
    revenueFy2023: '380.10',
    revenueFy2022: '300.00',
    profitFy2024: '45.20',
    profitFy2023: '30.00',
    profitFy2022: '20.00',
    peRatio: '25.50',
    roe: '18.30',
    debtToEquity: '0.45',
    ...overrides,
  };
}

describe('mapToIpoFinancials (T-477 real mapping function)', () => {
  it('maps FY2024/2023/2022 to FY1/FY2/FY3 and carries pe/roe/debtToEquity', () => {
    const { mapped, refusedFields } = mapToIpoFinancials(fixture());
    expect(mapped.revenueFy1).toBe('450.50');
    expect(mapped.revenueFy2).toBe('380.10');
    expect(mapped.revenueFy3).toBe('300.00');
    expect(mapped.profitFy1).toBe('45.20');
    expect(mapped.peRatio).toBe('25.50');
    expect(mapped.roePercentage).toBe('18.30');
    expect(mapped.debtToEquity).toBe('0.45');
    expect(refusedFields).toEqual([]);
  });

  it('does NOT throw on a NULL market-cap-adjacent field (partial extraction is normal)', () => {
    const row = fixture({ revenueFy2024: null, peRatio: null, debtToEquity: null });
    expect(() => mapToIpoFinancials(row)).not.toThrow();
    const { mapped, refusedFields } = mapToIpoFinancials(row);
    expect(mapped.revenueFy1).toBeNull();
    expect(mapped.peRatio).toBeNull();
    expect(refusedFields).toEqual([]);
  });

  it('refuses (leaves NULL) a peRatio that would overflow ipo_financials numeric(8,2)', () => {
    // financial_data.pe_ratio is numeric(10,2); ipo_financials.pe_ratio is
    // numeric(8,2) — a value >= 1,000,000 overflows the narrower column.
    const row = fixture({ peRatio: '1234567.89' });
    const { mapped, refusedFields } = mapToIpoFinancials(row);
    expect(mapped.peRatio).toBeNull();
    expect(refusedFields).toContain('peRatio');
  });

  it('refuses (leaves NULL) a debtToEquity that would overflow numeric(8,2)', () => {
    const row = fixture({ debtToEquity: '-999999.99' });
    const { refusedFields } = mapToIpoFinancials(row);
    // exactly at the boundary magnitude (>= 999999.99) is refused
    expect(refusedFields).toContain('debtToEquity');
  });

  it('does not refuse revenue/profit fields regardless of magnitude (they stay numeric(12,2) on both sides)', () => {
    const row = fixture({ revenueFy2024: '999999999.99' });
    const { mapped, refusedFields } = mapToIpoFinancials(row);
    expect(mapped.revenueFy1).toBe('999999999.99');
    expect(refusedFields).toEqual([]);
  });
});

describe('resolveDatabaseName (production-database guard)', () => {
  it('resolves from DATABASE_URL path', () => {
    expect(resolveDatabaseName({ DATABASE_URL: 'postgresql://u:p@h:5432/ipodhan_staging' })).toBe(
      'ipodhan_staging'
    );
  });

  it('flags the exact production database name', () => {
    expect(
      resolveDatabaseName({ DATABASE_URL: `postgresql://u:p@h:5432/${PRODUCTION_DATABASE_NAME}` })
    ).toBe(PRODUCTION_DATABASE_NAME);
  });
});

describe('parseSlugArg', () => {
  it('parses a comma-separated slug list', () => {
    expect(parseSlugArg(['--slug', 'a,b,c'])).toEqual({ slugs: ['a', 'b', 'c'] });
  });

  it('errors when --slug is the last argv token (T-452 class)', () => {
    const r = parseSlugArg(['--slug']);
    expect(r.slugs).toBeNull();
    expect(r.error).toMatch(/requires a comma-separated value/);
  });
});
