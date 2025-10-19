/**
 * Rights Issues Page
 *
 * Displays Rights Issues in two tabs: Upcoming and Live
 * Features:
 * - Server-side data fetching with ISR (5-minute revalidation)
 * - Tab state management via URL query params
 * - DataTable with Sorting, Column Search, Year Filter, Pagination
 * - Responsive design (desktop table, mobile cards)
 * - SEO optimized with metadata and structured data
 * - Graceful error handling
 *
 * Story 9.4: Rights Issue Page
 * AC#1: Page accessible at /rights-issues
 * AC#2: Two tabs with proper filtering
 * AC#3: Correct column display
 * AC#4: Tab state in URL params
 * AC#5: Navigation from home page
 * AC#6: ISR with 5-minute revalidation
 * AC#7: Responsive design
 * AC#8: Empty state handling
 * AC#9: Loading skeleton
 * AC#10: SEO metadata
 * AC#11: Graceful degradation on API failure
 */

import type { Metadata } from 'next';
import Script from 'next/script';
import { Suspense } from 'react';
import { RightsIssuesTabs } from '@/components/rights/RightsIssuesTabs';
import {
  getUpcomingRightsIssues,
  getLiveRightsIssues,
} from '@/lib/services/rights-service';
import {
  generateOrganizationSchema,
  generateBreadcrumbSchema,
  toJsonLdScript,
  type BreadcrumbItem,
  generateIPOListingSchema,
} from '@/lib/seo/structured-data';

// ==================== METADATA (AC#10) ====================

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || 'https://ipodhan.com';
const DEFAULT_OG_IMAGE = `${BASE_URL}/og-image.jpg`;

export const metadata: Metadata = {
  title: 'Rights Issues - Live and Upcoming | IPODhan',
  description:
    'Track live and upcoming Rights Issues in India. View record dates, open dates, renunciation dates, and apply through trusted brokers. Real-time data from NSE & BSE.',
  keywords: [
    'Rights Issue',
    'Rights Issue India',
    'upcoming rights issues',
    'live rights issues',
    'rights entitlement',
    'record date',
    'renunciation date',
    'NSE rights',
    'BSE rights',
  ],
  authors: [{ name: 'IPODhan' }],
  creator: 'IPODhan',
  publisher: 'IPODhan',
  alternates: {
    canonical: `${BASE_URL}/rights-issues`,
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
    url: `${BASE_URL}/rights-issues`,
    siteName: 'IPODhan',
    title: 'Rights Issues - Live and Upcoming | IPODhan',
    description:
      'Track live and upcoming Rights Issues in India. View record dates, open dates, and apply through trusted brokers.',
    images: [
      {
        url: DEFAULT_OG_IMAGE,
        width: 1200,
        height: 630,
        alt: 'Rights Issues - IPODhan',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Rights Issues - Live and Upcoming | IPODhan',
    description:
      'Track live and upcoming Rights Issues in India. View record dates, open dates, and apply through trusted brokers.',
    images: [DEFAULT_OG_IMAGE],
    creator: '@ipodhan',
  },
};

// ==================== ISR CONFIGURATION (AC#6) ====================

// Enable ISR with 5-minute revalidation
export const revalidate = 300;

// ==================== STRUCTURED DATA ====================

const breadcrumbItems: BreadcrumbItem[] = [
  { name: 'Home', url: `${BASE_URL}/` },
  { name: 'Rights Issues', url: `${BASE_URL}/rights-issues` },
];

// ==================== LOADING SKELETON (AC#9) ====================

function RightsIssuesPageSkeleton() {
  return (
    <div className="container mx-auto px-4 py-8">
      <div className="mb-8">
        <div className="h-10 w-64 bg-gray-200 rounded animate-pulse mb-4"></div>
        <div className="h-6 w-96 bg-gray-200 rounded animate-pulse"></div>
      </div>
      <div className="h-12 w-full max-w-md mx-auto bg-gray-200 rounded animate-pulse mb-8"></div>
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
 * Rights Issues Page Component (Server Component)
 *
 * Handles:
 * - Server-side data fetching with ISR
 * - SEO optimization
 * - Graceful error handling (AC#11)
 * - Tab state from URL params (AC#4)
 */
export default async function RightsIssuesPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  // Await searchParams
  const params = await searchParams;

  // Determine initial tab from URL params (AC#4)
  const initialTab = params.tab === 'live' ? 'live' : 'upcoming';

  // Generate structured data schemas
  const organizationSchema = generateOrganizationSchema();
  const breadcrumbSchema = generateBreadcrumbSchema(breadcrumbItems);

  // Fetch Rights Issues data with error handling (AC#11)
  const [upcomingRights, liveRights] = await Promise.all([
    getUpcomingRightsIssues(),
    getLiveRightsIssues(),
  ]).catch((error) => {
    console.error('Failed to fetch Rights Issues data:', error);
    // Return empty arrays on error for graceful degradation
    return [[], []];
  });

  // Generate ItemList schema for SEO
  const allRights = [...upcomingRights, ...liveRights];
  const rightsListingSchema = generateIPOListingSchema(
    allRights.map((r) => ({
      companyName: r.companyName,
      slug: r.slug,
      segment: 'MAINBOARD',
      offeringType: 'RIGHTS',
      companyDescription: `Rights Issue of ${r.companyName}`,
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

      {/* Rights Issues Listing Schema for SEO */}
      {allRights.length > 0 && (
        <Script
          id="rights-listing-schema"
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: toJsonLdScript(rightsListingSchema),
          }}
        />
      )}

      <div className="container mx-auto px-4 py-8 md:py-12">
        {/* Page Header */}
        <div className="mb-8 text-center">
          <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight mb-4 bg-gradient-to-r from-foreground to-foreground/70 bg-clip-text text-transparent">
            Rights Issues
          </h1>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            Track live and upcoming Rights Issues. View record dates, open dates, renunciation
            dates, and stay updated on all rights entitlement opportunities.
          </p>
        </div>

        {/* Rights Issues Tabs with DataTable (AC#2, AC#3, AC#6, AC#7) */}
        <Suspense fallback={<RightsIssuesPageSkeleton />}>
          <RightsIssuesTabs
            upcomingRights={upcomingRights}
            liveRights={liveRights}
            initialTab={initialTab}
          />
        </Suspense>

        {/* Empty State (AC#8) - Handled in RightsIssuesTabs via DataTable */}

        {/* Info Section */}
        <div className="mt-12 border-t pt-8">
          <h2 className="text-2xl font-bold mb-4">About Rights Issues</h2>
          <div className="prose prose-gray max-w-none">
            <p className="text-muted-foreground">
              A Rights Issue is a way for companies to raise additional capital by offering
              existing shareholders the right to purchase additional shares at a discounted
              price. Key dates to track:
            </p>
            <ul className="list-disc list-inside text-muted-foreground mt-4 space-y-2">
              <li>
                <strong>Record Date:</strong> The date on which you must be a shareholder to be
                eligible for the rights issue
              </li>
              <li>
                <strong>Open Date:</strong> The date when the rights issue application period
                begins
              </li>
              <li>
                <strong>Renunciation Date:</strong> The last date by which you can renounce
                (give up) your rights or transfer them to someone else
              </li>
            </ul>
            <p className="text-muted-foreground mt-4">
              Stay updated with IPODhan to never miss a Rights Issue opportunity. Apply through
              our trusted broker partners for a seamless experience.
            </p>
          </div>
        </div>
      </div>
    </>
  );
}
