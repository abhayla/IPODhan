/**
 * IPO Detail Page
 *
 * Server-side rendered page displaying comprehensive IPO information
 * Features:
 * - SSR for Tier 1 data (above fold): IPOHeader, KeyMetricsCards, InfoSection
 * - Client-side tabs for Tier 2 data (below fold)
 * - Dynamic SEO metadata with Open Graph and JSON-LD
 * - 404 handling for invalid slugs
 * - Breadcrumbs navigation
 * - Error boundary wrapper
 *
 * @route /ipos/[slug]
 * @example /ipos/swiggy-ipo
 */

import { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { IPOHeader } from '@/components/ipo/IPOHeader';
import { KeyMetricsCards } from '@/components/ipo/KeyMetricsCards';
import { InfoSection } from '@/components/ipo/InfoSection';
import { IPODetailTabs } from '@/components/ipo/IPODetailTabs';
import { Breadcrumbs } from '@/components/layout/Breadcrumbs';
import type { IPODetailResponse } from '@/lib/db/types';

// ==================== TYPES ====================

interface PageProps {
  params: Promise<{
    slug: string;
  }>;
  searchParams: Promise<{
    tab?: string;
  }>;
}

// ==================== METADATA ====================

/**
 * Generate dynamic metadata for SEO
 * Includes Open Graph tags, Twitter Card, and JSON-LD structured data
 */
export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;

  try {
    // Fetch IPO data for metadata
    const baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3000/api';
    const response = await fetch(`${baseUrl}/ipos/${slug}`, {
      next: { revalidate: 900 }, // 15 minutes
    });

    if (!response.ok) {
      return {
        title: 'IPO Not Found | IPODhan',
        description: 'The requested IPO could not be found.',
      };
    }

    const data: IPODetailResponse = await response.json();
    const { ipo } = data;

    // Format price range
    const priceRange = `₹${ipo.priceRangeMin} - ₹${ipo.priceRangeMax}`;

    // Calculate GMP percentage if available
    const latestGMP = data.gmpRecords?.[0];
    const gmpPercent = latestGMP && ipo.priceRangeMax
      ? ((latestGMP.gmp / ipo.priceRangeMax) * 100).toFixed(2)
      : 'N/A';

    // Construct description
    const description = `${ipo.companyName} IPO details including subscription, GMP, financials, and documents. Issue size: ₹${ipo.issueSize} Crores, Price range: ${priceRange}, GMP: ${gmpPercent}%.`;

    return {
      title: `${ipo.companyName} IPO Details | IPODhan`,
      description,
      openGraph: {
        title: `${ipo.companyName} IPO Details`,
        description,
        type: 'website',
        url: `https://ipodhan.com/ipos/${slug}`,
        siteName: 'IPODhan',
      },
      twitter: {
        card: 'summary_large_image',
        title: `${ipo.companyName} IPO Details`,
        description,
      },
      alternates: {
        canonical: `https://ipodhan.com/ipos/${slug}`,
      },
    };
  } catch (error) {
    console.error('Error generating metadata:', error);
    return {
      title: 'IPO Details | IPODhan',
      description: 'View comprehensive IPO information on IPODhan.',
    };
  }
}

// ==================== PAGE COMPONENT ====================

/**
 * IPO Detail Page Component
 * Server-side rendered with progressive loading for tabs
 */
export default async function IPODetailPage({ params, searchParams }: PageProps) {
  const { slug } = await params;
  const { tab } = await searchParams;

  // Fetch IPO data server-side
  const baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3000/api';

  let data: IPODetailResponse;
  try {
    const response = await fetch(`${baseUrl}/ipos/${slug}`, {
      next: { revalidate: 900 }, // 15 minutes cache
    });

    if (!response.ok) {
      // Invalid slug - show 404
      notFound();
    }

    data = await response.json();
  } catch (error) {
    console.error('Error fetching IPO data:', error);
    notFound();
  }

  const { ipo, gmpRecords, subscriptions } = data;

  // Calculate metrics for KeyMetricsCards
  const latestSubscription = subscriptions?.[0];
  const latestGMP = gmpRecords?.[0];

  const subscriptionValue = latestSubscription?.totalSubscription ?? null;
  const gmpValue = latestGMP?.gmp ?? null;
  const gmpPercent = latestGMP && ipo.priceRangeMax
    ? (latestGMP.gmp / ipo.priceRangeMax) * 100
    : null;

  // Determine subscription trend (simplified - in real app, compare with previous day)
  const subscriptionTrend: 'up' | 'down' | 'neutral' =
    subscriptionValue !== null && Number(subscriptionValue) > 1 ? 'up' : 'neutral';

  // Generate JSON-LD structured data for SEO
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'FinancialProduct',
    name: `${ipo.companyName} IPO`,
    description: ipo.companyDescription || `IPO offering from ${ipo.companyName}`,
    provider: {
      '@type': 'Organization',
      name: ipo.companyName,
    },
    category: ipo.category,
    offers: {
      '@type': 'Offer',
      priceSpecification: {
        '@type': 'PriceSpecification',
        minPrice: ipo.priceRangeMin ?? 0,
        maxPrice: ipo.priceRangeMax ?? 0,
        priceCurrency: 'INR',
      },
      availability:
        ipo.status === 'OPEN'
          ? 'https://schema.org/InStock'
          : 'https://schema.org/PreOrder',
    },
    datePublished: ipo.openDate || undefined,
  };

  // Breadcrumb structured data
  const breadcrumbJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      {
        '@type': 'ListItem',
        position: 1,
        name: 'Home',
        item: 'https://ipodhan.com',
      },
      {
        '@type': 'ListItem',
        position: 2,
        name: 'IPOs',
        item: 'https://ipodhan.com/ipos',
      },
      {
        '@type': 'ListItem',
        position: 3,
        name: ipo.companyName,
        item: `https://ipodhan.com/ipos/${slug}`,
      },
    ],
  };

  return (
    <>
      {/* Structured Data */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd) }}
      />

      {/* Page Content */}
      <div className="min-h-screen bg-background">
        {/* Breadcrumbs Navigation */}
        <div className="border-b bg-muted/30">
          <div className="container mx-auto px-4 py-3">
            <Breadcrumbs
              items={[
                { label: 'Home', href: '/' },
                { label: 'IPOs', href: '/dashboard' },
                { label: ipo.companyName, href: `/ipos/${slug}` },
              ]}
            />
          </div>
        </div>

        {/* Tier 1: Above Fold Content (SSR) */}
        <IPOHeader ipo={ipo} />

        {/* Main Content */}
        <div className="container mx-auto px-4 py-8">
          <div className="space-y-8">
            {/* Key Metrics Cards */}
            <KeyMetricsCards
              issueSize={Number(ipo.issueSize)}
              subscription={subscriptionValue !== null ? Number(subscriptionValue) : null}
              subscriptionTrend={subscriptionTrend}
              gmp={gmpValue}
              gmpPercent={gmpPercent}
            />

            {/* IPO Information Section */}
            <InfoSection ipo={ipo} />

            {/* Tier 2: Below Fold Content (Client-Side Tabs) */}
            <IPODetailTabs
              slug={slug}
              ipo={ipo}
              ipoData={data}
              initialTab={tab || 'overview'}
            />
          </div>
        </div>
      </div>
    </>
  );
}
