/**
 * OFS (Offer for Sale) Page
 *
 * Displays all OFS (Offer for Sale) opportunities with Non-Retail and Retail dates.
 * Features:
 * - Server-side data fetching with ISR (5-minute revalidation)
 * - DataTable with Sorting, Column Search, Year Filter, Pagination
 * - Responsive design (desktop table, mobile cards via DataTable)
 * - SEO optimized with metadata and structured data
 * - Graceful error handling
 * - Educational banner explaining OFS concept
 *
 * Story 9.5: Offer for Sale (OFS) Page
 * AC#1: Page accessible at /ofs
 * AC#2: Table displays: Issuer Company, Non Retail Date, Retail Date
 * AC#3: Page fetches OFS category IPOs correctly
 * AC#4: Educational banner explains OFS concept
 * AC#5: Page uses ISR with 5-minute revalidation
 * AC#6: Responsive: table on desktop, cards on mobile (via DataTable)
 * AC#7: Empty state shows "No OFS available" message
 * AC#8: Loading skeleton displays during data fetch
 * AC#9: SEO metadata configured
 * AC#10: Navigation link added to header/menu (implemented separately)
 * AC#11: Page renders successfully even if API call fails (graceful degradation)
 */

import type { Metadata } from 'next';
import Script from 'next/script';
import { Suspense } from 'react';
import { OFSTable } from '@/components/ofs/OFSTable';
import { getOFSIssues } from '@/lib/services/ofs-service';
import {
  generateOrganizationSchema,
  generateBreadcrumbSchema,
  toJsonLdScript,
  type BreadcrumbItem,
  generateIPOListingSchema,
} from '@/lib/seo/structured-data';

// ==================== METADATA (AC#9) ====================

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || 'https://ipodhan.com';
const DEFAULT_OG_IMAGE = `${BASE_URL}/og-image.jpg`;

export const metadata: Metadata = {
  title: 'Offer for Sale (OFS) 2025 - OFS Calendar India | IPODhan',
  description:
    'Track Offer for Sale (OFS) opportunities in India with Non-Retail and Retail dates. Stay updated on institutional and retail OFS schedules. Real-time data from NSE & BSE.',
  keywords: [
    'OFS',
    'Offer for Sale',
    'OFS calendar',
    'OFS India',
    'Non Retail Date',
    'Retail Date',
    'institutional investors OFS',
    'OFS schedule',
    'NSE OFS',
    'BSE OFS',
  ],
  authors: [{ name: 'IPODhan' }],
  creator: 'IPODhan',
  publisher: 'IPODhan',
  alternates: {
    canonical: `${BASE_URL}/ofs`,
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-video-preview': -1,
      'max-image-preview': 'large',
      'max-snippet': -1,
    },
  },
  openGraph: {
    type: 'website',
    locale: 'en_IN',
    url: `${BASE_URL}/ofs`,
    siteName: 'IPODhan',
    title: 'Offer for Sale (OFS) 2025 - OFS Calendar India | IPODhan',
    description:
      'Track Offer for Sale (OFS) opportunities in India with Non-Retail and Retail dates for institutional and retail investors.',
    images: [
      {
        url: DEFAULT_OG_IMAGE,
        width: 1200,
        height: 630,
        alt: 'Offer for Sale (OFS) - IPODhan',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Offer for Sale (OFS) 2025 - OFS Calendar India | IPODhan',
    description:
      'Track OFS opportunities in India with Non-Retail and Retail dates for institutional and retail investors.',
    images: [DEFAULT_OG_IMAGE],
    creator: '@ipodhan',
  },
};

// ==================== ISR CONFIGURATION (AC#5) ====================

// Enable ISR with 5-minute revalidation
export const revalidate = 300;

// ==================== STRUCTURED DATA ====================

const breadcrumbItems: BreadcrumbItem[] = [
  { name: 'Home', url: `${BASE_URL}/` },
  { name: 'OFS', url: `${BASE_URL}/ofs` },
];

// ==================== LOADING SKELETON (AC#8) ====================

function OFSPageSkeleton() {
  return (
    <div className="container mx-auto px-4 py-8">
      <div className="mb-8">
        <div className="h-10 w-96 bg-gray-200 rounded animate-pulse mb-4"></div>
        <div className="h-6 w-full max-w-2xl bg-gray-200 rounded animate-pulse"></div>
      </div>
      <div className="h-32 w-full bg-gray-200 rounded animate-pulse mb-8"></div>
      <div className="space-y-4">
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="h-16 w-full bg-gray-200 rounded animate-pulse"></div>
        ))}
      </div>
    </div>
  );
}

// ==================== MAIN COMPONENT ====================

/**
 * OFS Page Component (Server Component)
 *
 * Handles:
 * - Server-side data fetching with ISR (AC#3, AC#5)
 * - SEO optimization (AC#9)
 * - Graceful error handling (AC#11)
 * - Structured data for search engines
 */
export default async function OFSPage() {
  // Generate structured data schemas
  const organizationSchema = generateOrganizationSchema();
  const breadcrumbSchema = generateBreadcrumbSchema(breadcrumbItems);

  // Fetch OFS data with error handling (AC#3, AC#11)
  const ofsIssues = await getOFSIssues().catch((error) => {
    console.error('Failed to fetch OFS data:', error);
    // Return empty array on error for graceful degradation
    return [];
  });

  // Generate ItemList schema for SEO
  const ofsListingSchema = generateIPOListingSchema(
    ofsIssues.map((ofs) => ({
      companyName: ofs.companyName,
      slug: ofs.slug,
      category: 'OFS',
      companyDescription: `Offer for Sale by ${ofs.companyName}`,
    }))
  );

  return (
    <>
      {/* Organization Schema for SEO */}
      <Script
        id="organization-schema"
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: toJsonLdScript(organizationSchema),
        }}
      />

      {/* Breadcrumb Schema for SEO */}
      <Script
        id="breadcrumb-schema"
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: toJsonLdScript(breadcrumbSchema),
        }}
      />

      {/* OFS Listing Schema for SEO */}
      {ofsIssues.length > 0 && (
        <Script
          id="ofs-listing-schema"
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: toJsonLdScript(ofsListingSchema),
          }}
        />
      )}

      <div className="container mx-auto px-4 py-8 md:py-12">
        {/* Page Header (AC#1) */}
        <div className="mb-8 text-center">
          <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight mb-4 bg-gradient-to-r from-foreground to-foreground/70 bg-clip-text text-transparent">
            Offer for Sale (OFS)
          </h1>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            Track OFS opportunities for institutional and retail investors with separate bidding dates.
            Stay updated on all Offer for Sale schedules.
          </p>
        </div>

        {/* OFS Table with DataTable (AC#2, AC#3, AC#4, AC#6, AC#7) */}
        <Suspense fallback={<OFSPageSkeleton />}>
          <OFSTable ofsIssues={ofsIssues} />
        </Suspense>

        {/* Info Section */}
        <div className="mt-12 border-t pt-8">
          <h2 className="text-2xl font-bold mb-4">Understanding OFS</h2>
          <div className="prose prose-gray max-w-none">
            <p className="text-muted-foreground">
              An Offer for Sale (OFS) is a mechanism through which promoters or large shareholders
              can sell their shares to the public via stock exchanges. Key aspects of OFS:
            </p>
            <ul className="list-disc list-inside text-muted-foreground mt-4 space-y-2">
              <li>
                <strong>Day 1 (Non-Retail Date):</strong> Institutional and non-retail investors
                (investments ≥ Rs.10 lakhs) place bids
              </li>
              <li>
                <strong>Day 2 (Retail Date):</strong> Retail individual investors
                (investments &lt; Rs.10 lakhs) place bids
              </li>
              <li>
                <strong>Floor Price:</strong> Minimum price at which shares can be bid, set by the
                seller
              </li>
              <li>
                <strong>Difference from IPO:</strong> Shares are sold by existing shareholders, not
                issued by the company
              </li>
            </ul>
            <p className="text-muted-foreground mt-4">
              Stay updated with IPODhan to never miss an OFS opportunity. Apply through our trusted
              broker partners for a seamless bidding experience.
            </p>
          </div>
        </div>
      </div>
    </>
  );
}
