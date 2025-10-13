'use client';

import { useRouter } from 'next/navigation';
import { ListingsPagination } from './ListingsPagination';

interface ListingsPaginationClientProps {
  currentPage: number;
  totalPages: number;
  totalRecords: number;
  recordsPerPage: number;
}

export function ListingsPaginationClient({
  currentPage,
  totalPages,
  totalRecords,
  recordsPerPage
}: ListingsPaginationClientProps) {
  const router = useRouter();

  const handlePageChange = (page: number) => {
    const url = new URL(window.location.href);
    url.searchParams.set('page', String(page));
    router.push(url.pathname + url.search);
  };

  return (
    <ListingsPagination
      currentPage={currentPage}
      totalPages={totalPages}
      totalRecords={totalRecords}
      recordsPerPage={recordsPerPage}
      onPageChange={handlePageChange}
    />
  );
}
