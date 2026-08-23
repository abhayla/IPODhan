/**
 * Unit tests for DataTable — T-286 round-3 P1 batch.
 *
 * Covers the two mechanisms fixed in this PR:
 * - the empty-state-before-controls bug (P1-1/P2-1: DataTable.tsx:202 used to
 *   `return` before the year filter ever rendered, so a user landing on an
 *   empty-for-this-year result had NO way to change the year)
 * - DEFAULT_IPO_YEARS being DERIVED from the current date rather than a
 *   hardcoded literal that stops covering new years (P3-5: the "2027 time
 *   bomb")
 * - getLatestYearWithData deriving a sane default from the data itself
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  DataTable,
  type ColumnDef,
  getLatestYearWithData,
  generateYearRange,
  getAvailableYears,
} from '@/components/shared/DataTable';

interface Row {
  id: string;
  name: string;
  date: string | null;
}

const columns: ColumnDef<Row>[] = [
  { key: 'name', header: 'Name', sortable: true },
];

describe('DataTable', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  describe('Empty state renders WITH the year filter control (T-286 P1-1/P2-1)', () => {
    it('still renders the year Select when the (already-filtered) data array is empty', () => {
      render(
        <DataTable
          data={[]}
          columns={columns}
          emptyMessage="No rows for this year"
          enableYearFilter={true}
          yearFilterConfig={{
            availableYears: ['2025', '2026'],
            selectedYear: '2025',
            onYearChange: vi.fn(),
          }}
        />
      );

      // The empty message shows...
      expect(screen.getByText('No rows for this year')).toBeInTheDocument();
      // ...AND the year control is still there, so the user can recover.
      expect(screen.getByLabelText('Year:')).toBeInTheDocument();
      expect(screen.getByRole('combobox')).toBeInTheDocument();
    });

    it('lets the user pick a different year from the empty state', async () => {
      const user = userEvent.setup();
      const onYearChange = vi.fn();

      render(
        <DataTable
          data={[]}
          columns={columns}
          emptyMessage="No rows for 2026"
          enableYearFilter={true}
          yearFilterConfig={{
            availableYears: ['2025', '2026'],
            selectedYear: '2026',
            onYearChange,
          }}
        />
      );

      await user.click(screen.getByRole('combobox'));
      await user.click(screen.getByRole('option', { name: '2025' }));

      expect(onYearChange).toHaveBeenCalledWith('2025');
    });

    it('renders the normal table (not the empty message) when data is non-empty', () => {
      render(
        <DataTable
          data={[{ id: '1', name: 'Acme', date: '2026-01-01' }]}
          columns={columns}
          emptyMessage="No rows"
          keyExtractor={(row) => row.id}
        />
      );

      expect(screen.getByText('Acme')).toBeInTheDocument();
      expect(screen.queryByText('No rows')).not.toBeInTheDocument();
    });
  });

  describe('generateYearRange / DEFAULT_IPO_YEARS derivation (T-286 P3-5)', () => {
    it('generateYearRange produces an inclusive year list', () => {
      expect(generateYearRange(2024, 2026)).toEqual(['2024', '2025', '2026']);
    });

    it('a future system clock still gets a year range that reaches the current year (no hardcoded ceiling)', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2027-03-15T00:00:00Z'));

      // Re-derive the same way DataTable.tsx does internally.
      const years = generateYearRange(2020, new Date().getFullYear());

      expect(years[years.length - 1]).toBe('2027');
      expect(years).not.toContain('2028');
    });
  });

  describe('getLatestYearWithData (T-286 P1-1/P2-1)', () => {
    it('returns the latest year that actually has a row, not the current year', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-08-23T00:00:00Z'));

      const rows: Row[] = [
        { id: '1', name: 'A', date: '2025-05-01' },
        { id: '2', name: 'B', date: '2026-01-10' },
      ];

      expect(getLatestYearWithData(rows, (r) => r.date)).toBe('2026');
    });

    it('falls back to the current year when there is no data', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-08-23T00:00:00Z'));

      expect(getLatestYearWithData<Row>([], (r) => r.date)).toBe('2026');
    });

    it('falls back to the current year when every row has a null date', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-08-23T00:00:00Z'));

      const rows: Row[] = [{ id: '1', name: 'A', date: null }];

      expect(getLatestYearWithData(rows, (r) => r.date)).toBe('2026');
    });

    it('picks up a year AHEAD of the current year when the data has one (currently-open future-dated issue)', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-08-23T00:00:00Z'));

      const rows: Row[] = [
        { id: '1', name: 'A', date: '2025-01-01' },
        { id: '2', name: 'B', date: '2027-02-01' },
      ];

      expect(getLatestYearWithData(rows, (r) => r.date)).toBe('2027');
    });
  });

  describe('getAvailableYears (T-286F, checker finding F1)', () => {
    it('PROBE-C: a future-dated row selects a year that IS present in availableYears', () => {
      // checker's exact adversarial scenario: clock 2026-12-20, an upcoming
      // issue announced in December that opens 2027-01-15. Before the fix,
      // getLatestYearWithData() picked "2027" but DEFAULT_IPO_YEARS_EXPORT
      // (capped at new Date().getFullYear() = 2026) did not contain it, so
      // the Select control silently fell back to its placeholder with no way
      // back to 2027.
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-12-20T06:00:00+05:30'));

      const rows: Row[] = [
        { id: '1', name: 'A', date: '2026-12-01' },
        { id: '2', name: 'B', date: '2027-01-15' },
      ];
      const selected = getLatestYearWithData(rows, (r) => r.date);
      expect(selected).toBe('2027');

      const availableYears = getAvailableYears(selected);
      expect(availableYears.includes(selected)).toBe(true);
      expect(availableYears[availableYears.length - 1]).toBe('2027');
    });

    it('upper bound is max(currentYear, latestDataYear) -- does not shrink below the current year', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-08-23T00:00:00Z'));

      // Selected year older than current year (e.g. viewing a past-only table).
      const years = getAvailableYears('2024');
      expect(years[years.length - 1]).toBe('2026');
    });

    it('upper bound tracks a selected year further ahead than one year', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-08-23T00:00:00Z'));

      const years = getAvailableYears('2029');
      expect(years[years.length - 1]).toBe('2029');
      expect(years.includes('2029')).toBe(true);
    });
  });
});
