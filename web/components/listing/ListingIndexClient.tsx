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
import type { IPO } from '@/lib/db/types';
import type { ListingGainsMap } from '@/lib/services/listing-gains-service';
import { formatIssueSizeCrores } from '@/lib/utils';
import { formatIPODate, getAccessibleDate } from '@/lib/utils/date-formatter';
import { formatPriceBand } from '@/lib/utils/kpi-formatters';
import { IpoStatusChip, getDisplayStatus } from './ipo-status';
import { ListingKpiRibbon } from './ListingKpiRibbon';

type TabKey = 'open' | 'upcoming' | 'listed' | 'all';

interface ListingIndexClientProps {
  segmentLabel: string; // "Mainboard" | "SME"
  data: IPO[]; // year-filtered detailed list
  allTimeTotal: number; // metrics.totalIPOs (all-time, all years)
  gainsMap: ListingGainsMap;
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

function dateCell(value: string | null) {
  if (!value) return <span className="text-gray-400">TBA</span>;
  return <time dateTime={value} title={getAccessibleDate(value)}>{formatIPODate(value)}</time>;
}

function companyCol(): ColumnDef<IPO> {
  return {
    key: 'companyName',
    header: 'Company',
    sortable: false,
    searchable: false,
    render: (value, row) => (
      <div className="flex flex-col gap-1">
        <Link
          href={`/ipos/${row.slug}`}
          className="font-medium text-gray-900 hover:text-primary hover:underline"
        >
          {value}
        </Link>
        <div className="md:hidden">
          <IpoStatusChip ipo={row} />
        </div>
      </div>
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
  sortable: false,
  searchable: false,
  align: 'right',
  render: (v) => dateCell(v),
};

const closeCol: ColumnDef<IPO> = {
  key: 'closeDate',
  header: 'Close',
  sortable: false,
  searchable: false,
  align: 'right',
  render: (v) => dateCell(v),
};

const priceBandCol: ColumnDef<IPO> = {
  key: 'priceRangeMax',
  header: 'Price band',
  sortable: false,
  searchable: false,
  align: 'right',
  render: (_v, row) => formatPriceBand(row.priceRangeMin, row.priceRangeMax),
};

const issueSizeCol: ColumnDef<IPO> = {
  key: 'issueSize',
  header: 'Issue size',
  sortable: false,
  searchable: false,
  align: 'right',
  mobileHidden: true,
  render: (v) => formatIssueSizeCrores(v),
};

export function ListingIndexClient({
  segmentLabel,
  data,
  allTimeTotal,
  gainsMap,
  initialYear,
}: ListingIndexClientProps) {
  const router = useRouter();
  const pathname = usePathname();
  // Default to "All" — the data-dense full table (Screener/Levels.fyi parity) is
  // the strongest first impression and surfaces the real listing-gain column;
  // Open/Upcoming are one click away with count badges.
  const [tab, setTab] = useState<TabKey>('all');
  const [page, setPage] = useState(1);

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
    sortable: false,
    searchable: false,
    align: 'right',
    render: (_v, row) => gainCell(gainsMap[row.id]?.listingGainPercent),
  };

  const listingDateCol: ColumnDef<IPO> = {
    key: 'listingDate',
    header: 'Listing',
    sortable: false,
    searchable: false,
    align: 'right',
    mobileHidden: true,
    render: (v) => dateCell(v),
  };

  const TABS: { key: TabKey; label: string; rows: IPO[] }[] = [
    { key: 'open', label: 'Open', rows: openIpos },
    { key: 'upcoming', label: 'Upcoming', rows: upcomingIpos },
    { key: 'listed', label: 'Recently listed', rows: listedIpos },
    { key: 'all', label: 'All', rows: data },
  ];

  const openColumns: ColumnDef<IPO>[] = [
    companyCol(),
    statusCol,
    openCol,
    closeCol,
    priceBandCol,
    issueSizeCol,
  ];
  const upcomingColumns = openColumns;
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

      <DataTable
        key={tab}
        data={active.rows}
        columns={columnsFor[tab]}
        emptyMessage={emptyFor[tab]}
        enablePagination
        enableYearFilter={tab === 'all'}
        yearFilterConfig={{
          availableYears: DEFAULT_IPO_YEARS_EXPORT,
          selectedYear: String(initialYear),
          onYearChange: handleYearChange,
        }}
        paginationConfig={{
          pageSize: 25,
          currentPage: page,
          totalRecords: active.rows.length,
          onPageChange: setPage,
        }}
        keyExtractor={(row) => row.id}
      />
    </div>
  );
}
