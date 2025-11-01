import { Metadata } from 'next';
import type { IPO } from '@/lib/api-client';
import { DashboardContent } from '@/components/dashboard/DashboardContent';
import { generateIPOListingMetadata } from '@/lib/seo/metadata';
import { db } from '@/lib/db/index';
import { getRedisClient } from '@/lib/cache/redis-client';
import { IPORepository } from '@/lib/repositories/ipo-repository';

// SEO Metadata - Using centralized SEO utilities
export const metadata: Metadata = generateIPOListingMetadata();

interface DashboardPageProps {
  searchParams: Promise<{
    page?: string;
    view?: string;
    status?: string;
    segment?: string;
    sector?: string;
    search?: string;
    scoreRange?: string;
  }>;
}

export default async function DashboardPage({ searchParams }: DashboardPageProps) {
  const params = await searchParams;
  const page = params.page ? parseInt(params.page) : 1;
  const view = params.view || 'grid';
  const status = params.status || 'OPEN';
  const segment = params.segment;
  const sector = params.sector;
  const search = params.search;
  const scoreRange = params.scoreRange;

  try {
    // Server Components should use repositories directly, not HTTP API calls
    const redis = getRedisClient();
    const ipoRepository = new IPORepository(db, redis);

    // Build filters for repository
    const filters = {
      status: status ? [status as 'UPCOMING' | 'OPEN' | 'CLOSED' | 'LISTED'] : undefined,
      segment: segment === 'MAINBOARD' || segment === 'SME' ? [segment] : undefined,
      sector,
      search,
      scoreRange,
      page,
      limit: 12,
      sortBy: 'createdAt' as const,
      sortOrder: 'desc' as const,
    };

    // Fetch data from repository (includes Redis caching)
    const result = await ipoRepository.findAll(filters);

    // Transform repository response to API format
    const response = {
      data: result.data as IPO[],
      pagination: {
        page: result.meta.page,
        limit: result.meta.limit,
        total: result.meta.total,
        hasMore: result.meta.hasNext,
      },
    };

    // Generate JSON-LD structured data
    const structuredData = {
      '@context': 'https://schema.org',
      '@type': 'CollectionPage',
      name: 'IPO Dashboard',
      description: 'Browse current and upcoming IPO listings in India',
      url: 'https://ipodhan.com/dashboard',
      mainEntity: {
        '@type': 'ItemList',
        itemListElement: response.data.map((ipo: IPO, index: number) => ({
          '@type': 'ListItem',
          position: index + 1,
          item: {
            '@type': 'FinancialProduct',
            name: ipo.companyName,
            url: `https://ipodhan.com/ipos/${ipo.slug}`
          }
        }))
      }
    };

    return (
      <>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
        />
        <DashboardContent
          initialIPOs={response.data}
          initialPagination={response.pagination}
          initialView={view}
          initialStatus={status}
          initialSegment={segment}
          initialSearch={search}
        />
      </>
    );
  } catch (error) {
    // Error boundary will catch and display this
    throw error;
  }
}
