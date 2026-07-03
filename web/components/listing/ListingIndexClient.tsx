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
import { SubscriptionBar } from '@/components/shared/SubscriptionBar';
import { MonogramChip } from '@/components/shared/MonogramChip';
import { GmpDisplay } from '@/components/shared/GmpDisplay';
import { DataFreshness } from '@/components/shared/DataFreshness';
import type { IPO } from '@/lib/db/types';
import type { ListingGainsMap } from '@/lib/services/listing-gains-service';
import type { LiveMetricsMap } from '@/lib/services/live-metrics-service';
import { formatIssueSizeCrores, formatIssueSizeCroresBare } from '@/lib/utils';
import { formatIPODate, getAccessibleDate } from '@/lib/utils/date-formatter';
import { formatPriceBand } from '@/lib/utils/kpi-formatters';
import { IpoStatusChip, StatusDot, getDisplayStatus } from './ipo-status';
import { ListingKpiRibbon, type RibbonCell } from './ListingKpiRibbon';

const PAGE_SIZE = 25;

type TabKey = 'open' | 'upcoming' | 'listed' | 'all';

interface ListingIndexClientProps {
  segmentLabel: string; // "Mainboard" | "SME"
  data: IPO[]; // year-filtered detailed list
  allTimeTotal: number; // metrics.totalIPOs (all-time, all years)
  gainsMap: ListingGainsMap;
  liveMetricsMap: LiveMetricsMap; // latest GMP + subscription for live (open) IPOs
  initialYear: number;
  asOf: string; // ISO server render/fetch time for the freshness stamp
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

/** Muted second line: "Mainboard · Technology" (segment + sector when known). */
// A always-present second line gives the mobile rows history's dense, uniform
// 2-line rhythm (R28 #4): sector when known (it varies and adds real value),
// otherwise the relevant date. Never empty → every row is the same height.
function companySubline(ipo: IPO): string {
  if (ipo.sector) return ipo.sector;
  const d = ipo.listingDate ?? ipo.openDate ?? ipo.closeDate;
  if (d) {
    try {
      return new Date(d).toLocaleDateString('en-IN', {
        month: 'short',
        year: 'numeric',
        timeZone: 'Asia/Kolkata',
      });
    } catch {
      /* fall through */
    }
  }
  return ipo.segment === 'SME' ? 'SME' : 'Mainboard';
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
        className="group flex items-center gap-2 text-gray-900 hover:text-primary"
      >
        {/* Status as a dot on mobile (the standalone Status column is hidden < md
            so a value column leads the horizontal scroll) — R27 #1 */}
        <StatusDot ipo={row} className="md:hidden" />
        {/* Monogram is desktop-only — on the narrow mobile pinned cell the status
            dot + name are the signal; the avatar just costs name width (R32 #1). */}
        <span className="hidden shrink-0 sm:inline-flex">
          <MonogramChip name={value} />
        </span>
        <span className="min-w-0">
          {/* Uniform 2-line cell (R28 #4): name (single-line truncate, full name
              via tooltip) over an always-present sub-label → dense + even rows. */}
          <span className="block max-w-[300px] truncate font-medium leading-tight group-hover:underline">
            {value}
          </span>
          <span className="block truncate text-xs leading-tight text-muted-foreground">
            {companySubline(row)}
          </span>
        </span>
      </Link>
    ),
  };
}

const statusCol: ColumnDef<IPO> = {
  key: 'status',
  header: 'Status',
  sortable: false,
  searchable: false,
  // Full chip on desktop; on mobile the dot lives in the Company cell instead so a
  // value column leads the horizontal scroll (R27 #1).
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

// Min investment (retail's real question: what does 1 lot cost) = lot × upper band.
const minInvestCol: ColumnDef<IPO> = {
  key: 'minInvest',
  header: 'Min invest',
  sortable: false,
  searchable: false,
  align: 'right',
  className: 'tabular-nums',
  render: (_v, row) => {
    const lot = row.lotSize;
    const price = row.priceRangeMax;
    if (!lot || !price) return <span className="text-gray-400">—</span>;
    return orDash(formatPriceBand(lot * price, lot * price));
  },
};

// Unit ("₹ Cr") lives in the header so the value column is a clean numeric ruler.
const issueSizeCol: ColumnDef<IPO> = {
  key: 'issueSize',
  header: 'Issue size (₹ Cr)',
  sortable: true,
  searchable: false,
  align: 'right',
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
  asOf,
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
    render: (v) => dateCell(v),
  };

  const TABS: { key: TabKey; label: string; rows: IPO[] }[] = [
    { key: 'open', label: 'Open', rows: openIpos },
    { key: 'upcoming', label: 'Upcoming', rows: upcomingIpos },
    { key: 'listed', label: 'Recently listed', rows: listedIpos },
    { key: 'all', label: 'All', rows: data },
  ];

  // Column ORDER = value-first (R22 #1): the money column the persona came for
  // sits right after Company/Status so it is visible on mobile (where the table
  // scrolls under the pinned Company column) — not buried last off-screen.
  // Open IPOs are live → GMP + subscription are the decision data.
  const openColumns: ColumnDef<IPO>[] = [
    companyCol(),
    statusCol,
    gmpColumn,
    subColumn,
    priceBandCol,
    minInvestCol,
    openCol,
    closeCol,
  ];
  // Upcoming IPOs are not open yet — the open date + price band are what matters.
  const upcomingColumns: ColumnDef<IPO>[] = [
    companyCol(),
    statusCol,
    openCol,
    priceBandCol,
    minInvestCol,
    closeCol,
    issueSizeCol,
  ];
  // Listed → the listing gain is the headline; lead with it.
  const listedColumns: ColumnDef<IPO>[] = [
    companyCol(),
    gainColumn,
    listingDateCol,
    priceBandCol,
    issueSizeCol,
  ];
  // 'All' is status-mixed → lead the mobile scroll with Price band, which is
  // ALWAYS populated (Listing gain is em-dash for every not-yet-listed row, so
  // leading with it left the first scroll column mostly empty — R34 #1).
  const allColumns: ColumnDef<IPO>[] = [
    companyCol(),
    statusCol,
    priceBandCol,
    gainColumn,
    listingDateCol,
    openCol,
    closeCol,
    issueSizeCol,
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

  const sortedRows = sortRows(active.rows);

  // Richer stat strip (R15 #20): pack 6 honest metrics vs the old 3-card row.
  const listedGains = listedIpos
    .map((i) => gainsMap[i.id]?.listingGainPercent)
    .filter((g): g is number => g !== null && g !== undefined);
  const avgGain =
    listedGains.length > 0
      ? listedGains.reduce((a, b) => a + b, 0) / listedGains.length
      : null;
  const totalRaisedCr = data.reduce((sum, ipo) => {
    const n = ipo.issueSize ? parseFloat(ipo.issueSize) : 0;
    const cr = n / 10000000;
    return sum + (Number.isFinite(cr) && cr >= 0.01 && cr <= 100000 ? cr : 0);
  }, 0);
  const ribbonCells: RibbonCell[] = [
    { label: 'Total IPOs', value: allTimeTotal },
    { label: 'Open now', value: openIpos.length },
    { label: 'Upcoming', value: upcomingIpos.length },
    { label: `Listed ${initialYear}`, value: listedIpos.length },
    {
      label: 'Avg listing gain',
      value: avgGain !== null ? `${avgGain >= 0 ? '+' : ''}${avgGain.toFixed(1)}%` : '—',
      tone: avgGain === null ? 'default' : avgGain >= 0 ? 'gain' : 'loss',
    },
    {
      label: 'Raised (₹ Cr)',
      value:
        totalRaisedCr > 0
          ? totalRaisedCr.toLocaleString('en-IN', { maximumFractionDigits: 0 })
          : '—',
    },
  ];

  return (
    <div className="space-y-5">
      <ListingKpiRibbon cells={ribbonCells} />

      <div className="flex justify-end">
        <DataFreshness asOf={asOf} />
      </div>

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

      {/* One table system at every breakpoint — on mobile it scrolls
          horizontally under a sticky company column (Levels/Screener pattern),
          NOT a stack of label:value cards that drop columns (R19 #1). */}
      <DataTable
        key={tab}
        data={sortedRows}
        columns={columnsFor[tab]}
        emptyMessage={emptyFor[tab]}
        onRowClick={(row) => router.push(`/ipos/${row.slug}`)}
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
  );
}
