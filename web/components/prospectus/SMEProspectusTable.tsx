/**
 * SMEProspectusTable Component
 *
 * Table component for displaying SME IPO prospectus documents with:
 * - 4 columns (Company Name, Exchange, DRHP PDF, RHP PDF)
 * - Sortable columns (Company Name, Exchange)
 * - Pagination controls
 * - Responsive design (table on desktop, cards on mobile)
 * - Loading, empty, and error states
 *
 * Story 9.12: SME IPO Prospectus PDF Download Page
 * AC#2, AC#3, AC#5, AC#6, AC#7, AC#9, AC#10, AC#12, AC#13, AC#17, AC#18
 */

'use client';

import Link from 'next/link';
import { ExternalLink, ArrowUp, ArrowDown } from 'lucide-react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import type { SMEProspectusData } from '@/lib/services/sme-prospectus-service';
import { formatExchanges } from '@/lib/utils/prospectus-utils';

// ==================== TYPES ====================

interface SMEProspectusTableProps {
  prospectusData: SMEProspectusData[];
  loading?: boolean;
  error?: string | null;
  total: number;
  page: number;
  limit: number;
  onPageChange?: (page: number) => void;
  onSort?: (column: 'companyName' | 'exchange') => void;
  sortColumn?: string;
  sortDirection?: 'asc' | 'desc';
}

// ==================== COMPONENT ====================

export function SMEProspectusTable({
  prospectusData,
  loading = false,
  error = null,
  total,
  page,
  limit,
  onPageChange,
  onSort,
  sortColumn,
  sortDirection = 'asc',
}: SMEProspectusTableProps) {
  // Loading State (AC#10)
  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-40" />
        <div className="space-y-2">
          {[1, 2, 3, 4, 5].map((i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      </div>
    );
  }

  // Error State (AC#18)
  if (error) {
    return (
      <div className="text-center py-12">
        <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-6 max-w-md mx-auto">
          <p className="text-destructive font-medium mb-2">Error Loading Data</p>
          <p className="text-sm text-muted-foreground mb-4">{error}</p>
          <Button
            variant="outline"
            onClick={() => window.location.reload()}
            className="text-sm"
          >
            Retry
          </Button>
        </div>
      </div>
    );
  }

  // Empty State (AC#9)
  if (prospectusData.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <p>No SME prospectus documents available</p>
        <p className="text-sm mt-2">Try adjusting your search filters</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Total Records Count (AC#3) */}
      <div className="text-sm text-muted-foreground">
        Total Records: {total}
      </div>

      {/* Desktop Table Layout (AC#12 - desktop view) */}
      <div className="hidden md:block overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              {/* Company Name Column (AC#5 - sortable) */}
              <TableHead>
                <button
                  onClick={() => onSort?.('companyName')}
                  className="flex items-center gap-1 hover:underline"
                >
                  Company Name
                  {sortColumn === 'companyName' && (
                    sortDirection === 'asc' ? (
                      <ArrowUp className="h-4 w-4" />
                    ) : (
                      <ArrowDown className="h-4 w-4" />
                    )
                  )}
                </button>
              </TableHead>

              {/* Exchange Column (AC#5 - sortable) */}
              <TableHead>
                <button
                  onClick={() => onSort?.('exchange')}
                  className="flex items-center gap-1 hover:underline"
                >
                  Exchange
                  {sortColumn === 'exchange' && (
                    sortDirection === 'asc' ? (
                      <ArrowUp className="h-4 w-4" />
                    ) : (
                      <ArrowDown className="h-4 w-4" />
                    )
                  )}
                </button>
              </TableHead>

              <TableHead>DRHP PDF</TableHead>
              <TableHead>RHP PDF</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {prospectusData.map((data) => (
              <TableRow key={data.ipo.id}>
                {/* Company Name (AC#6 - link to IPO detail page) */}
                <TableCell>
                  <Link
                    href={`/ipos/${data.ipo.slug}`}
                    className="text-blue-600 hover:underline"
                  >
                    {data.ipo.companyName}
                  </Link>
                </TableCell>

                {/* Exchange */}
                <TableCell>{formatExchanges(data.ipo.listingExchanges)}</TableCell>

                {/* DRHP PDF (AC#7, AC#17 - download links with attributes) */}
                <TableCell>
                  {data.drhpDocument ? (
                    <a
                      href={data.drhpDocument.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      download
                      className="flex items-center gap-1 text-blue-600 hover:underline"
                    >
                      Download <ExternalLink className="h-4 w-4" />
                    </a>
                  ) : (
                    <span className="text-muted-foreground">Not Available</span>
                  )}
                </TableCell>

                {/* RHP PDF (AC#7, AC#17 - download links with attributes) */}
                <TableCell>
                  {data.rhpDocument ? (
                    <a
                      href={data.rhpDocument.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      download
                      className="flex items-center gap-1 text-blue-600 hover:underline"
                    >
                      Download <ExternalLink className="h-4 w-4" />
                    </a>
                  ) : (
                    <span className="text-muted-foreground">Not Available</span>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Mobile Card Layout (AC#12 - mobile view) */}
      <div className="md:hidden space-y-4">
        {prospectusData.map((data) => (
          <Card key={data.ipo.id}>
            <CardHeader>
              <CardTitle className="text-base">
                <Link
                  href={`/ipos/${data.ipo.slug}`}
                  className="text-blue-600 hover:underline"
                >
                  {data.ipo.companyName}
                </Link>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Exchange:</span>
                <span>{formatExchanges(data.ipo.listingExchanges)}</span>
              </div>
              <div className="space-y-2">
                <div className="flex justify-between items-center text-sm">
                  <span className="text-muted-foreground">DRHP PDF:</span>
                  {data.drhpDocument ? (
                    <a
                      href={data.drhpDocument.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      download
                      className="flex items-center gap-1 text-blue-600 hover:underline"
                    >
                      Download <ExternalLink className="h-3 w-3" />
                    </a>
                  ) : (
                    <span className="text-muted-foreground text-xs">Not Available</span>
                  )}
                </div>
                <div className="flex justify-between items-center text-sm">
                  <span className="text-muted-foreground">RHP PDF:</span>
                  {data.rhpDocument ? (
                    <a
                      href={data.rhpDocument.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      download
                      className="flex items-center gap-1 text-blue-600 hover:underline"
                    >
                      Download <ExternalLink className="h-3 w-3" />
                    </a>
                  ) : (
                    <span className="text-muted-foreground text-xs">Not Available</span>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Pagination (AC#13) */}
      <div className="flex items-center justify-between mt-4">
        <div className="text-sm text-muted-foreground">
          Showing {((page - 1) * limit) + 1}-{Math.min(page * limit, total)} of {total}
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onPageChange?.(page - 1)}
            disabled={page === 1 || loading}
          >
            Previous
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => onPageChange?.(page + 1)}
            disabled={page * limit >= total || loading}
          >
            Next
          </Button>
        </div>
      </div>
    </div>
  );
}
