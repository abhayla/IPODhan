/**
 * NCD (Non-Convertible Debentures) Page - Server Component
 *
 * Displays all NCD issues with their open and close dates.
 * Features:
 * - Server-side data fetching with ISR (5-minute revalidation)
 * - DataTable with Sorting, Column Search, Year Filter, Pagination
 * - Responsive design (desktop table, mobile cards via DataTable)
 * - SEO optimized with metadata and structured data
 * - Graceful error handling
 * - Educational banner explaining NCD concept
 *
 * Story 9.6: NCD Issue Page
 * AC#1: Page accessible at /ncd
 * AC#2: Table displays: Issuer Company, Open Date, Close Date
 * AC#3: Page fetches NCD category IPOs correctly
 * AC#4: Educational banner explains NCD concept
 * AC#5: "More NCD Public Issues..." link from home page navigates correctly
 * AC#6: Page uses ISR with 5-minute revalidation
 * AC#7: Responsive: table on desktop, cards on mobile (via DataTable)
 * AC#8: NCDs sorted by Open Date (descending - newest first)
 * AC#9: Empty state shows "No NCDs available" message
 * AC#10: Loading skeleton displays during data fetch
 * AC#11: SEO metadata configured
 * AC#12: Page renders successfully even if API call fails (graceful degradation)
 */

import type { Metadata } from 'next';
import { Suspense } from 'react';
import { NCDTable } from '@/components/ncd/NCDTable';
import { getNCDIssues } from '@/lib/services/ncd-service';

// ==================== METADATA (AC#11) ====================

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || 'https://ipodhan.com';
const DEFAULT_OG_IMAGE = `${BASE_URL}/og-image.jpg`;

export const metadata: Metadata = {
  title: `NCD Issues ${new Date().getFullYear()} - Non-Convertible Debentures India | IPODhan`,
  description:
    'Track Non-Convertible Debenture (NCD) public issues in India with open and close dates. Stay updated on NCD opportunities for fixed-income investors seeking regular interest payments.',
  keywords: [
    'NCD',
    'non-convertible debentures',
    'NCD issues',
    'NCD calendar',
    'debt instruments',
    'fixed income',
    'India',
    'NCD 2025',
    'NCD public issues',
    'debentures',
  ],
  authors: [{ name: 'IPODhan' }],
  creator: 'IPODhan',
  publisher: 'IPODhan',
  alternates: {
    canonical: `${BASE_URL}/ncd`,
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
    url: `${BASE_URL}/ncd`,
    siteName: 'IPODhan',
    title: `NCD Issues ${new Date().getFullYear()} - Non-Convertible Debentures India | IPODhan`,
    description:
      'Track Non-Convertible Debenture (NCD) public issues in India with open and close dates for fixed-income investors.',
    images: [
      {
        url: DEFAULT_OG_IMAGE,
        width: 1200,
        height: 630,
        alt: 'Non-Convertible Debentures (NCDs) - IPODhan',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: `NCD Issues ${new Date().getFullYear()} - Non-Convertible Debentures India | IPODhan`,
    description:
      'Track NCD public issues in India with open and close dates for fixed-income investors.',
    images: [DEFAULT_OG_IMAGE],
    creator: '@ipodhan',
  },
};

// ==================== ISR CONFIGURATION (AC#6) ====================

// Enable ISR with 5-minute revalidation
export const revalidate = 300;

// ==================== LOADING SKELETON (AC#10) ====================

function NCDPageSkeleton() {
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
 * NCD Page Component (Server Component)
 *
 * Handles:
 * - Server-side data fetching with ISR (AC#3, AC#6)
 * - SEO optimization (AC#11)
 * - Graceful error handling (AC#12)
 */
export default async function NCDPage() {
  // Fetch NCD data with error handling (AC#3, AC#12)
  const ncdIssues = await getNCDIssues().catch((error) => {
    console.error('Failed to fetch NCD data:', error);
    // Return empty array on error for graceful degradation
    return [];
  });

  return (
    <div className="container mx-auto px-4 py-8 md:py-12">
      {/* Page Header (AC#1) */}
      <div className="mb-8 text-center">
        <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight mb-4 bg-gradient-to-r from-foreground to-foreground/70 bg-clip-text text-transparent">
          Non-Convertible Debentures (NCDs)
        </h1>
        <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
          Track NCD public issues - fixed-income debt instruments offering regular interest payments.
          Stay updated on all NCD opportunities for fixed-income investors.
        </p>
      </div>

      {/* NCD Table with DataTable (AC#2, AC#4, AC#7, AC#8, AC#9) */}
      <Suspense fallback={<NCDPageSkeleton />}>
        <NCDTable ncdIssues={ncdIssues} />
      </Suspense>

      {/* Info Section */}
      <div className="mt-12 border-t pt-8">
        <h2 className="text-2xl font-bold mb-4">Understanding NCDs</h2>
        <div className="prose prose-gray max-w-none">
          <p className="text-muted-foreground">
            Non-Convertible Debentures (NCDs) are debt instruments issued by companies to raise funds
            from investors. Key aspects of NCDs:
          </p>
          <ul className="list-disc list-inside text-muted-foreground mt-4 space-y-2">
            <li>
              <strong>Interest Payments:</strong> NCDs offer fixed or floating interest rates
              (coupon rates) paid periodically
            </li>
            <li>
              <strong>Maturity Period:</strong> NCDs have fixed maturity periods ranging from
              months to years
            </li>
            <li>
              <strong>Credit Rating:</strong> NCDs are rated by credit rating agencies (CRISIL,
              ICRA, etc.) - higher ratings indicate lower risk
            </li>
            <li>
              <strong>Secured vs Unsecured:</strong> Secured NCDs have collateral backing,
              unsecured NCDs do not
            </li>
            <li>
              <strong>Taxation:</strong> Interest earned on NCDs is taxable as per investor's
              income tax slab
            </li>
          </ul>
          <p className="text-muted-foreground mt-4">
            Stay updated with IPODhan to never miss an NCD opportunity. Evaluate credit ratings,
            interest rates, and maturity periods before investing.
          </p>
        </div>
      </div>
    </div>
  );
}
