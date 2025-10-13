'use client';

import { useRouter } from 'next/navigation';
import { YearFilter } from './YearFilter';

interface YearFilterClientProps {
  availableYears: string[];
  selectedYear: string;
}

export function YearFilterClient({ availableYears, selectedYear }: YearFilterClientProps) {
  const router = useRouter();

  const handleYearChange = (year: string) => {
    const url = new URL(window.location.href);
    url.searchParams.set('year', year);
    url.searchParams.delete('page'); // Reset to page 1
    router.push(url.pathname + url.search);
  };

  return (
    <YearFilter
      availableYears={availableYears}
      selectedYear={selectedYear}
      onYearChange={handleYearChange}
    />
  );
}
