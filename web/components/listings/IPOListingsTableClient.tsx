'use client';

import { useRouter } from 'next/navigation';
import { IPOListingsTable } from './IPOListingsTable';

interface IPOListingsTableClientProps {
  data: any[];
  sortBy: string;
  sortOrder: string;
}

export function IPOListingsTableClient({ data, sortBy, sortOrder }: IPOListingsTableClientProps) {
  const router = useRouter();

  const handleSort = (field: string, order: string) => {
    const url = new URL(window.location.href);
    url.searchParams.set('sortBy', field);
    url.searchParams.set('sortOrder', order);
    router.push(url.pathname + url.search);
  };

  return (
    <IPOListingsTable
      data={data}
      onSort={handleSort}
      currentSort={{ field: sortBy, order: sortOrder }}
    />
  );
}
