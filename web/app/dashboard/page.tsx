import { Metadata } from 'next';
import { apiClient, IPO } from '@/lib/api-client';
import { DashboardContent } from '@/components/dashboard/DashboardContent';

// SEO Metadata
export const metadata: Metadata = {
  title: 'IPO Dashboard - Current IPOs | IPODhan',
  description: 'Browse current and upcoming IPO listings in India. View IPO details, subscription status, GMP, ratings, and more. Stay updated with real-time IPO information.',
  openGraph: {
    title: 'IPO Dashboard - Current IPOs | IPODhan',
    description: 'Browse current and upcoming IPO listings in India',
    url: 'https://ipodhan.com/dashboard',
    type: 'website',
    images: [
      {
        url: 'https://ipodhan.com/og-dashboard.jpg',
        width: 1200,
        height: 630,
        alt: 'IPODhan Dashboard'
      }
    ]
  },
  twitter: {
    card: 'summary_large_image',
    title: 'IPO Dashboard - Current IPOs | IPODhan',
    description: 'Browse current and upcoming IPO listings in India',
    images: ['https://ipodhan.com/og-dashboard.jpg']
  }
};

interface DashboardPageProps {
  searchParams: {
    page?: string;
    view?: string;
    status?: string;
    category?: string;
    sector?: string;
  };
}

export default async function DashboardPage({ searchParams }: DashboardPageProps) {
  const page = searchParams.page ? parseInt(searchParams.page) : 1;
  const view = searchParams.view || 'grid';
  const status = searchParams.status || 'OPEN';
  const category = searchParams.category;
  const sector = searchParams.sector;

  try {
    const response = await apiClient.getIPOs({
      status: status as 'UPCOMING' | 'OPEN' | 'CLOSED' | 'LISTED',
      category: category as 'MAINBOARD' | 'SME' | 'RIGHTS' | 'NCD' | undefined,
      sector: sector,
      page,
      limit: 12
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
        />
      </>
    );
  } catch (error) {
    // Error boundary will catch and display this
    throw error;
  }
}
