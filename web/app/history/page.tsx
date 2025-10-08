import { Metadata } from 'next';
import { HistoricalIPOsPageClient } from './page-client';
import type { HistoricalIPO } from '@/lib/repositories/types';

// Revalidate every hour (3600 seconds)
export const revalidate = 3600;

interface HistoricalIPOResponse {
  data: HistoricalIPO[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    hasMore: boolean;
  };
}

// Generate metadata for SEO
export async function generateMetadata(): Promise<Metadata> {
  return {
    title: 'Historical IPOs - Past Performance & Analysis | IPODhan',
    description:
      'Browse historical IPO data with comprehensive performance metrics. Filter by year, sector, and listing performance. Analyze past IPO trends to make informed investment decisions.',
    keywords: [
      'historical IPOs',
      'past IPO performance',
      'IPO listing gains',
      'IPO returns',
      'IPO database India',
      'stock market history',
    ],
    openGraph: {
      title: 'Historical IPOs - Past Performance & Analysis',
      description:
        'Complete database of historical IPOs with listing performance, subscription data, and sector-wise analysis.',
      type: 'website',
      url: 'https://ipodhan.com/history',
    },
    twitter: {
      card: 'summary_large_image',
      title: 'Historical IPOs - Past Performance & Analysis',
      description:
        'Browse historical IPO data with comprehensive performance metrics and filters.',
    },
  };
}

async function fetchHistoricalIPOs(searchParams: {
  [key: string]: string | string[] | undefined;
}): Promise<HistoricalIPOResponse> {
  const baseUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

  // Build query string from search params
  const params = new URLSearchParams();

  if (searchParams.year) params.set('year', String(searchParams.year));
  if (searchParams.sector) params.set('sector', String(searchParams.sector));
  if (searchParams.performance) params.set('performance', String(searchParams.performance));
  if (searchParams.search) params.set('search', String(searchParams.search));
  if (searchParams.sort) params.set('sort', String(searchParams.sort));
  if (searchParams.sortOrder) params.set('sortOrder', String(searchParams.sortOrder));
  if (searchParams.page) params.set('page', String(searchParams.page));
  if (searchParams.limit) params.set('limit', String(searchParams.limit));

  const queryString = params.toString();
  const url = `${baseUrl}/api/ipos/history${queryString ? `?${queryString}` : ''}`;

  try {
    const response = await fetch(url, {
      cache: 'no-store', // Server-side fetching with ISR
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch historical IPOs: ${response.statusText}`);
    }

    return await response.json();
  } catch (error) {
    console.error('Error fetching historical IPOs:', error);
    // Return empty data on error
    return {
      data: [],
      pagination: {
        page: 1,
        limit: 20,
        total: 0,
        hasMore: false,
      },
    };
  }
}

async function fetchFilterOptions(): Promise<{
  sectors: string[];
  years: string[];
}> {
  const baseUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

  try {
    // Fetch all listed IPOs to extract unique sectors and years
    const response = await fetch(`${baseUrl}/api/ipos/history?limit=1000`, {
      cache: 'no-store',
    });

    if (!response.ok) {
      return { sectors: [], years: [] };
    }

    const data: HistoricalIPOResponse = await response.json();

    // Extract unique sectors and years
    const sectorsSet = new Set<string>();
    const yearsSet = new Set<number>();

    data.data.forEach((ipo) => {
      if (ipo.sector) sectorsSet.add(ipo.sector);
      if (ipo.year) yearsSet.add(ipo.year);
    });

    const sectors = Array.from(sectorsSet).sort();
    const years = Array.from(yearsSet)
      .sort((a, b) => b - a)
      .map(String);

    return { sectors, years };
  } catch (error) {
    console.error('Error fetching filter options:', error);
    return { sectors: [], years: [] };
  }
}

export default async function HistoricalIPOsPage({
  searchParams,
}: {
  searchParams: { [key: string]: string | string[] | undefined };
}) {
  // Fetch data in parallel
  const [ipoData, filterOptions] = await Promise.all([
    fetchHistoricalIPOs(searchParams),
    fetchFilterOptions(),
  ]);

  // Pass data to client component
  return (
    <HistoricalIPOsPageClient
      initialData={ipoData}
      availableSectors={filterOptions.sectors}
      availableYears={filterOptions.years}
      searchParams={searchParams}
    />
  );
}
