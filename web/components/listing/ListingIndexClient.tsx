'use client';

/**
 * Listing Index Client (spec L1 — status-tabbed single table).
 *
 * Replaces the card-grid landing composition (summary cards + 6 content-section
 * grids + nav cards + a separate detailed table) with:
 *   - a KPI ribbon (Total / Open / Upcoming)
 *   - status TABS (Open · Upcoming · Recently listed · All), each rendering ONE
 *     table via the shared DataTable
 *
 * Shared by /mainboard-ipos and /sme-ipos (segment differs only in labels).
 *
 * Listing-gain data comes from the REAL listing_performance table (gainsMap);
 * a missing id renders an em dash (data gap #89/#98) — never a fabricated value.
 */

import { useMemo, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import {
  DataTable,
  type ColumnDef,
  DEFAULT_IPO_YEARS_EXPORT,
} from '@/components/shared/DataTable';
import { MobileMetricCard, type CardField } from '@/components/shared/MobileMetricCard';
import { SubscriptionBar } from '@/components/shared/SubscriptionBar';
import { MonogramChip } from '@/components/shared/MonogramChip';
import { GmpDisplay } from '@/components/shared/GmpDisplay';
import { Button } from '@/components/ui/button';
import type { IPO } from '@/lib/db/types';
import type { ListingGainsMap } from '@/lib/services/listing-gains-service';
import type { LiveMetricsMap } from '@/lib/services/live-metrics-service';
import { formatIssueSizeCrores, formatIssueSizeCroresBare } from '@/lib/utils';
import { formatIPODate, getAccessibleDate } from '@/lib/utils/date-formatter';
import { formatPriceBand } from '@/lib/utils/kpi-formatters';
import { IpoStatusChip, getDisplayStatus } from './ipo-status';
import { ListingKpiRibbon } from './ListingKpiRibbon';

const PAGE_SIZE = 25;

type TabKey = 'open' | 'upcoming' | 'listed' | 'all';

interface ListingIndexClientProps {
  segmentLabel: string; // "Mainboard" | "SME"
  data: IPO[]; // year-filtered detailed list
  allTimeTotal: number; // metrics.totalIPOs (all-time, all years)
  gainsMap: ListingGainsMap;
  liveMetricsMap: LiveMetricsMap; // latest GMP + subscription for live (open) IPOs
  initialYear: number;
}

/** Colored, signed listing-gain cell — real value or an honest em dash. */
function gainCell(gain: number | null | undefined) {
  if (gain === null || gain === undefined) {
    return <span className="text-gray-400">—</span>;
  }
  const positive = gain >= 0;
  return (
    <span className={positive ? 'font-semibold text-green-600' : 'font-semibold text-red-600'}>
      {positive ? '+' : ''}
      {gain.toFixed(2)}%
    </span>
  );
}

/** Subscription heat-bar + multiple (x) — real value or an honest em dash. */
function subCell(sub: number | null | undefined) {
  return <SubscriptionBar value={sub} />;
}


function dateCell(value: string | null) {
  if (!value) return <span className="text-gray-400">TBA</span>;
  return <time dateTime={value} title={getAccessibleDate(value)}>{formatIPODate(value)}</time>;
}

/** One empty token across the grid: map the formatters' 'N/A' to an em dash. */
function orDash(value: string) {
  return value === 'N/A' ? <span className="text-gray-400">—</span> : value;
}

function companyCol(): ColumnDef<IPO> {
  return {
    key: 'companyName',
    header: 'Company',
    sortable: false,
    searchable: false,
    render: (value, row) => (
      <Link
        href={`/ipos/${row.slug}`}
        title={value}
        className="flex items-center gap-2 font-medium text-gray-900 hover:text-primary"
      >
        <MonogramChip name={value} />
        <span className="max-w-[300px] truncate hover:underline">{value}</span>
      </Link>
    ),
  };
}

const statusCol: ColumnDef<IPO> = {
  key: 'status',
  header: 'Status',
  sortable: false,
  searchable: false,
  mobileHidden: true,
  render: (_v, row) => <IpoStatusChip ipo={row} />,
};

const openCol: ColumnDef<IPO> = {
  key: 'openDate',
  header: 'Open',
  sortable: true,
  searchable: false,
  align: 'right',
    className: 'tabular-nums',
  render: (v) => dateCell(v),
};

const closeCol: ColumnDef<IPO> = {
  key: 'closeDate',
  header: 'Close',
  sortable: true,
  searchable: false,
  align: 'right',
    className: 'tabular-nums',
  render: (v) => dateCell(v),
};

const priceBandCol: ColumnDef<IPO> = {
  key: 'priceRangeMax',
  header: 'Price band',
  sortable: true,
  searchable: false,
  align: 'right',
  className: 'tabular-nums',
  render: (_v, row) => orDash(formatPriceBand(row.priceRangeMin, row.priceRangeMax)),
};

// Unit ("₹ Cr") lives in the header so the value column is a clean numeric ruler.
const issueSizeCol: ColumnDef<IPO> = {
  key: 'issueSize',
  header: 'Issue size (₹ Cr)',
  sortable: true,
  searchable: false,
  align: 'right',
  mobileHidden: true,
  className: 'tabular-nums',
  render: (v) => orDash(formatIssueSizeCroresBare(v)),
};

export function ListingIndexClient({
  segmentLabel,
  data,
  allTimeTotal,
  gainsMap,
  liveMetricsMap,
  initialYear,
}: ListingIndexClientProps) {
  const router = useRouter();
  const pathname = usePathname();
  // Default to "All" — the data-dense full table (Screener/Levels.fyi parity) is
  // the strongest first impression and surfaces the real listing-gain column;
  // Open/Upcoming are one click away with count badges.
  const [tab, setTab] = useState<TabKey>('all');
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<{ field: string; order: 'asc' | 'desc' } | null>(null);

  // Sort value for a row+field — resolves the derived columns (gain/GMP/sub live
  // in the maps, not on the row) so click-to-sort works on every column.
  const sortValue = (ipo: IPO, field: string): number | string | null => {
    switch (field) {
      case 'listingGainPercent':
        return gainsMap[ipo.id]?.listingGainPercent ?? null;
      case 'gmp':
        return liveMetricsMap[ipo.id]?.gmp ?? null;
      case 'subscription':
        return liveMetricsMap[ipo.id]?.totalSubscription ?? null;
      case 'priceRangeMax':
        return ipo.priceRangeMax ?? null;
      case 'issueSize':
        return ipo.issueSize ? parseFloat(ipo.issueSize) : null;
      case 'openDate':
      case 'closeDate':
      case 'listingDate': {
        const v = ipo[field];
        return v ? new Date(v).getTime() : null;
      }
      default:
        return (ipo[field as keyof IPO] as string | number | null) ?? null;
    }
  };

  const handleSort = (field: string, order: 'asc' | 'desc') => {
    setSort({ field, order });
    setPage(1);
  };

  const sortRows = (rows: IPO[]): IPO[] => {
    if (!sort) return rows;
    const dir = sort.order === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      const va = sortValue(a, sort.field);
      const vb = sortValue(b, sort.field);
      if (va === null && vb === null) return 0;
      if (va === null) return 1; // nulls always last
      if (vb === null) return -1;
      if (va < vb) return -1 * dir;
      if (va > vb) return 1 * dir;
      return 0;
    });
  };

  const { openIpos, upcomingIpos, listedIpos } = useMemo(() => {
    const openIpos: IPO[] = [];
    const upcomingIpos: IPO[] = [];
    const listedIpos: IPO[] = [];
    for (const ipo of data) {
      const s = getDisplayStatus(ipo).status;
      if (s === 'open' || s === 'closingSoon') openIpos.push(ipo);
      else if (s === 'upcoming') upcomingIpos.push(ipo);
      else if (s === 'listed') listedIpos.push(ipo);
    }
    // Recently listed: newest listing first
    listedIpos.sort((a, b) => {
      if (!a.listingDate) return 1;
      if (!b.listingDate) return -1;
      return new Date(b.listingDate).getTime() - new Date(a.listingDate).getTime();
    });
    return { openIpos, upcomingIpos, listedIpos };
  }, [data]);

  const gainColumn: ColumnDef<IPO> = {
    key: 'listingGainPercent',
    header: 'Listing gain',
    sortable: true,
    searchable: false,
    align: 'right',
    className: 'tabular-nums',
    render: (_v, row) => gainCell(gainsMap[row.id]?.listingGainPercent),
  };

  // Live decision columns — only on the Open tab, where GMP + subscription are
  // actually populated (adding them to the mostly-listed All tab would create
  // empty columns).
  const subColumn: ColumnDef<IPO> = {
    key: 'subscription',
    header: 'Sub.',
    sortable: true,
    searchable: false,
    align: 'right',
    render: (_v, row) => subCell(liveMetricsMap[row.id]?.totalSubscription),
  };
  const gmpColumn: ColumnDef<IPO> = {
    key: 'gmp',
    header: 'GMP',
    sortable: true,
    searchable: false,
    align: 'right',
    render: (_v, row) => {
      const m = liveMetricsMap[row.id];
      return (
        <GmpDisplay
          gmp={m?.gmp}
          gmpPercent={m?.gmpPercent}
          gmpUpdatedAt={m?.gmpUpdatedAt}
          gmpTrend={m?.gmpTrend}
          gmpSeries={m?.gmpSeries}
        />
      );
    },
  };

  const listingDateCol: ColumnDef<IPO> = {
    key: 'listingDate',
    header: 'Listing',
    sortable: true,
    searchable: false,
    align: 'right',
    className: 'tabular-nums',
    mobileHidden: true,
    render: (v) => dateCell(v),
  };

  const TABS: { key: TabKey; label: string; rows: IPO[] }[] = [
    { key: 'open', label: 'Open', rows: openIpos },
    { key: 'upcoming', label: 'Upcoming', rows: upcomingIpos },
    { key: 'listed', label: 'Recently listed', rows: listedIpos },
    { key: 'all', label: 'All', rows: data },
  ];

  // Open IPOs are live — surface GMP + subscription (the persona's decision data).
  const openColumns: ColumnDef<IPO>[] = [
    companyCol(),
    statusCol,
    openCol,
    closeCol,
    priceBandCol,
    subColumn,
    gmpColumn,
  ];
  // Upcoming IPOs are not open yet — no live subscription; keep issue size.
  const upcomingColumns: ColumnDef<IPO>[] = [
    companyCol(),
    statusCol,
    openCol,
    closeCol,
    priceBandCol,
    issueSizeCol,
  ];
  const listedColumns: ColumnDef<IPO>[] = [
    companyCol(),
    listingDateCol,
    priceBandCol,
    issueSizeCol,
    gainColumn,
  ];
  const allColumns: ColumnDef<IPO>[] = [
    companyCol(),
    statusCol,
    openCol,
    closeCol,
    listingDateCol,
    priceBandCol,
    issueSizeCol,
    gainColumn,
  ];

  const columnsFor: Record<TabKey, ColumnDef<IPO>[]> = {
    open: openColumns,
    upcoming: upcomingColumns,
    listed: listedColumns,
    all: allColumns,
  };

  const active = TABS.find((t) => t.key === tab) ?? TABS[0];

  const handleTab = (key: TabKey) => {
    setTab(key);
    setPage(1);
  };

  const handleYearChange = (newYear: string) => {
    setPage(1);
    const params = new URLSearchParams(window.location.search);
    params.set('year', newYear);
    router.push(`${pathname}?${params.toString()}`);
  };

  const emptyFor: Record<TabKey, string> = {
    open: `No ${segmentLabel} IPOs are open right now.`,
    upcoming: `No upcoming ${segmentLabel} IPOs announced yet.`,
    listed: `No recently listed ${segmentLabel} IPOs for ${initialYear}.`,
    all: `No ${segmentLabel} IPOs found for ${initialYear}.`,
  };

  // Mobile card fields per tab — keep the persona's decision data (gain, price
  // band, dates) visible without the horizontal-scroll clipping a table causes.
  const mobileFields = (ipo: IPO): CardField[] => {
    const band = orDash(formatPriceBand(ipo.priceRangeMin, ipo.priceRangeMax));
    const size = orDash(formatIssueSizeCrores(ipo.issueSize));
    if (tab === 'listed') {
      return [
        { label: 'Listing gain', value: gainCell(gainsMap[ipo.id]?.listingGainPercent) },
        { label: 'Price band', value: band },
        { label: 'Listed', value: dateCell(ipo.listingDate) },
        { label: 'Issue size', value: size },
      ];
    }
    if (tab === 'all') {
      return [
        { label: 'Listing gain', value: gainCell(gainsMap[ipo.id]?.listingGainPercent) },
        { label: 'Price band', value: band },
        { label: 'Open', value: dateCell(ipo.openDate) },
        { label: 'Close', value: dateCell(ipo.closeDate) },
      ];
    }
    if (tab === 'open') {
      return [
        { label: 'Price band', value: band },
        { label: 'Open – Close', value: <>{dateCell(ipo.openDate)} – {dateCell(ipo.closeDate)}</> },
        { label: 'Subscription', value: subCell(liveMetricsMap[ipo.id]?.totalSubscription) },
        {
          label: 'GMP',
          value: (
            <GmpDisplay
              gmp={liveMetricsMap[ipo.id]?.gmp}
              gmpPercent={liveMetricsMap[ipo.id]?.gmpPercent}
              gmpUpdatedAt={liveMetricsMap[ipo.id]?.gmpUpdatedAt}
              gmpTrend={liveMetricsMap[ipo.id]?.gmpTrend}
              gmpSeries={liveMetricsMap[ipo.id]?.gmpSeries}
            />
          ),
        },
      ];
    }
    return [
      { label: 'Price band', value: band },
      { label: 'Issue size', value: size },
      { label: 'Open', value: dateCell(ipo.openDate) },
      { label: 'Close', value: dateCell(ipo.closeDate) },
    ];
  };

  const sortedRows = sortRows(active.rows);
  const totalPages = Math.max(1, Math.ceil(sortedRows.length / PAGE_SIZE));
  const pageRows = sortedRows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <div className="space-y-5">
      <ListingKpiRibbon
        total={allTimeTotal}
        open={openIpos.length}
        upcoming={upcomingIpos.length}
      />

      {/* Status tabs */}
      <div
        role="tablist"
        aria-label={`${segmentLabel} IPO status`}
        className="flex flex-wrap gap-1 border-b border-border"
      >
        {TABS.map((t) => {
          const activeTab = t.key === tab;
          return (
            <button
              key={t.key}
              role="tab"
              aria-selected={activeTab}
              onClick={() => handleTab(t.key)}
              className={`-mb-px border-b-2 px-3 py-2 text-sm transition-colors ${
                activeTab
                  ? 'border-primary font-semibold text-primary'
                  : 'border-transparent text-gray-500 hover:text-gray-900'
              }`}
            >
              {t.label}
              <span className="ml-1.5 text-xs text-gray-400">{t.rows.length}</span>
            </button>
          );
        })}
      </div>

      {/* Year selector (All tab) — outside the table so it shows on mobile too */}
      {tab === 'all' && (
        <div className="flex items-center gap-2">
          <label htmlFor="listing-year" className="text-sm font-medium text-gray-600">
            Year
          </label>
          <select
            id="listing-year"
            value={String(initialYear)}
            onChange={(e) => handleYearChange(e.target.value)}
            className="h-9 rounded-md border border-border bg-white px-2 text-sm"
          >
            {DEFAULT_IPO_YEARS_EXPORT.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Desktop: dense table with click-to-sort headers */}
      <div className="hidden md:block">
        <DataTable
          key={tab}
          data={sortedRows}
          columns={columnsFor[tab]}
          emptyMessage={emptyFor[tab]}
          onSort={handleSort}
          currentSort={sort ?? undefined}
          enablePagination
          paginationConfig={{
            pageSize: PAGE_SIZE,
            currentPage: page,
            totalRecords: sortedRows.length,
            onPageChange: setPage,
          }}
          keyExtractor={(row) => row.id}
        />
      </div>

      {/* Mobile: row-cards (no horizontal clipping) */}
      <div className="md:hidden">
        {active.rows.length === 0 ? (
          <p className="py-8 text-center text-sm text-gray-500">{emptyFor[tab]}</p>
        ) : (
          <>
            <div className="space-y-2">
              {pageRows.map((ipo) => (
                <MobileMetricCard
                  key={ipo.id}
                  href={`/ipos/${ipo.slug}`}
                  title={ipo.companyName}
                  status={<IpoStatusChip ipo={ipo} />}
                  fields={mobileFields(ipo)}
                />
              ))}
            </div>
            {totalPages > 1 && (
              <div className="mt-4 flex items-center justify-between">
                <span className="text-xs text-gray-500">
                  Page {page} of {totalPages}
                </span>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page === 1}
                    onClick={() => setPage(page - 1)}
                  >
                    Previous
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page === totalPages}
                    onClick={() => setPage(page + 1)}
                  >
                    Next
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
