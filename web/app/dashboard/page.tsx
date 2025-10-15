import { Metadata } from 'next';
import { apiClient, IPO } from '@/lib/api-client';
import { DashboardContent } from '@/components/dashboard/DashboardContent';
import { generateIPOListingMetadata } from '@/lib/seo/metadata';

// SEO Metadata - Using centralized SEO utilities
export const metadata: Metadata = generateIPOListingMetadata();

interface DashboardPageProps {
  searchParams: Promise<{
    page?: string;
    view?: string;
    status?: string;
    category?: string;
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
  const category = params.category;
  const sector = params.sector;
  const search = params.search;
  const scoreRange = params.scoreRange;

  try {
    const response = await apiClient.getIPOs({
      status: status as 'UPCOMING' | 'OPEN' | 'CLOSED' | 'LISTED',
      category: category as 'MAINBOARD' | 'SME' | 'RIGHTS' | 'NCD' | undefined,
      sector: sector,
      search: search,
      page,
      limit: 12,
      scoreRange: scoreRange
    });

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
          initialCategory={category}
          initialSearch={search}
        />
      </>
    );
  } catch (error) {
    // Error boundary will catch and display this
    throw error;
  }
}
