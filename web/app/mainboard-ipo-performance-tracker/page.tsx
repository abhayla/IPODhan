/**
 * Mainboard IPO Performance Tracker Page
 *
 * Displays comprehensive performance tracking for Mainboard IPOs:
 * - Listing day gains (Issue Price vs Listing Day Close)
 * - Current profit/loss (Issue Price vs Current Price)
 * - Sortable columns with year filtering
 * - Pagination for better performance
 * - Expandable links (IPO Detail + Stock Quotes)
 *
 * Story 9.7a: Mainboard IPO Performance Tracker Page
 * Features:
 * - DataTable with Sorting, Year Filter, Pagination (NO Column Search)
 * - 7 columns with color-coded gains/losses
 * - Server-side data fetching with ISR (5-minute revalidation)
 * - Responsive design (desktop table, mobile cards via DataTable)
 * - SEO optimized with metadata and structured data
 * - Graceful error handling
 *
 * Acceptance Criteria (AC):
 * AC#1: Page accessible at /mainboard-ipo-performance-tracker
 * AC#2: Table displays all 7 columns with correct Mainboard IPO data only
 * AC#3: Year filter works correctly (default: current year)
 * AC#4: Year filter updates URL query params
 * AC#5: Only Mainboard IPOs displayed (category=MAINBOARD filter applied)
 * AC#6: Color coding applied correctly (Green for positive, Red for negative percentages)
 * AC#7: "IPO Detail" links navigate to respective IPO detail pages
 * AC#8: "Stock Quotes" links functional (external or internal)
 * AC#9: Calculations are accurate (Listing Day Gain and Profit/Loss formulas)
 * AC#10: IPOs sorted by listing date (descending)
 * AC#11: Page uses ISR with 5-minute revalidation
 * AC#12: Responsive: table on desktop, compact cards on mobile
 * AC#13: Empty state shows "No Mainboard IPOs listed in [year]" message
 * AC#14: Loading skeleton displays during data fetch
 * AC#15: SEO metadata configured (title, description, keywords)
 * AC#16: Navigation link added to "Mainboard IPOs" submenu
 * AC#17: Performance data displays with 2 decimal precision for percentages
 * AC#18: Rupee symbol (₹) displayed correctly for prices
 */

import type { Metadata } from 'next';
import Script from 'next/script';
import { Suspense } from 'react';
import { MainboardPerformanceTrackerClient } from '@/components/performance/MainboardPerformanceTrackerClient';
import {
  generateOrganizationSchema,
  generateBreadcrumbSchema,
  toJsonLdScript,
  type BreadcrumbItem,
} from '@/lib/seo/structured-data';

// ==================== METADATA (AC#15) ====================

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || 'https://ipodhan.com';
const DEFAULT_OG_IMAGE = `${BASE_URL}/og-image.jpg`;

export const metadata: Metadata = {
  title: 'Mainboard IPO Performance Tracker 2025 - Post-Listing Analysis | IPODhan',
  description:
    'Track Mainboard IPO post-listing performance with listing day gains and current profit/loss percentages. Analyze how Mainboard IPOs have performed since listing in India.',
  keywords: [
    'mainboard ipo performance',
    'listing gains',
    'ipo profit loss',
    'post listing performance',
    'mainboard ipo tracker',
    'India',
    'listing day gain',
    'current gain',
    'ipo returns',
    'mainboard ipo analysis',
  ],
  authors: [{ name: 'IPODhan' }],
  creator: 'IPODhan',
  publisher: 'IPODhan',
  alternates: {
    canonical: `${BASE_URL}/mainboard-ipo-performance-tracker`,
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
    url: `${BASE_URL}/mainboard-ipo-performance-tracker`,
    siteName: 'IPODhan',
    title: 'Mainboard IPO Performance Tracker 2025 - Post-Listing Analysis | IPODhan',
    description:
      'Track Mainboard IPO performance with listing day gains and current profit/loss. Analyze how Mainboard IPOs have performed since listing.',
    images: [
      {
        url: DEFAULT_OG_IMAGE,
        width: 1200,
        height: 630,
        alt: 'Mainboard IPO Performance Tracker - IPODhan',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Mainboard IPO Performance Tracker 2025 - Post-Listing Analysis | IPODhan',
    description:
      'Track Mainboard IPO performance with listing day gains and current profit/loss percentages.',
    images: [DEFAULT_OG_IMAGE],
    creator: '@ipodhan',
  },
};

// ==================== ISR CONFIGURATION (AC#11) ====================

// Enable ISR with 5-minute revalidation
export const revalidate = 300;

// ==================== STRUCTURED DATA ====================

const breadcrumbItems: BreadcrumbItem[] = [
  { name: 'Home', url: `${BASE_URL}/` },
  { name: 'Mainboard IPO Performance Tracker', url: `${BASE_URL}/mainboard-ipo-performance-tracker` },
];

// ==================== LOADING SKELETON (AC#14) ====================

function PerformanceTrackerSkeleton() {
  return (
    <div className="container mx-auto px-4 py-8">
      <div className="mb-8">
        <div className="h-10 w-96 bg-gray-200 rounded animate-pulse mb-4"></div>
        <div className="h-6 w-full max-w-2xl bg-gray-200 rounded animate-pulse"></div>
      </div>
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
 * Mainboard Performance Tracker Page Component (Server Component)
 *
 * Handles:
 * - Server-side rendering with ISR
 * - SEO optimization
 * - Initial data structure setup
 * - Client component delegation for interactivity
 */
export default async function MainboardPerformanceTrackerPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string }>;
}) {
  // Await searchParams
  const params = await searchParams;

  // AC#3: Determine year from URL params with default to current year
  const currentYear = new Date().getFullYear().toString();
  const year = params.year || currentYear;

  // Generate structured data schemas
  const organizationSchema = generateOrganizationSchema();
  const breadcrumbSchema = generateBreadcrumbSchema(breadcrumbItems);

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

      {/* Main Content - Delegated to Client Component for interactivity */}
      {/* AC#2, AC#3, AC#4, AC#5, AC#6, AC#7, AC#8, AC#9, AC#10, AC#12, AC#13, AC#17, AC#18 */}
      <Suspense fallback={<PerformanceTrackerSkeleton />}>
        <MainboardPerformanceTrackerClient initialYear={year} />
      </Suspense>
    </>
  );
}
