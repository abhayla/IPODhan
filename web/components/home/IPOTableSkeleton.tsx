/**
 * IPO Table Skeleton Component
 *
 * Loading state skeleton for IPO tables on home page
 * Displays 5 skeleton rows with 3 columns each
 *
 * Story 9.2: Home Page IPO Tables - UI Components
 */

import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

/**
 * Skeleton component for IPO tables loading state
 * Shows 5 rows with 3 columns matching table structure
 */
export function IPOTableSkeleton() {
  return (
    <div className="rounded-md border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-[40%]">
              <Skeleton className="h-4 w-32" />
            </TableHead>
            <TableHead className="w-[30%]">
              <Skeleton className="h-4 w-16" />
            </TableHead>
            <TableHead className="w-[30%]">
              <Skeleton className="h-4 w-16" />
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {Array.from({ length: 5 }).map((_, index) => (
            <TableRow key={index}>
              <TableCell>
                <Skeleton className="h-5 w-full max-w-[200px]" />
              </TableCell>
              <TableCell>
                <Skeleton className="h-5 w-20" />
              </TableCell>
              <TableCell>
                <Skeleton className="h-5 w-20" />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
