/**
 * Mainboard IPO Prospectus PDF Download Page
 *
 * Story 9.8a: Mainboard IPO Prospectus PDF Download Page
 *
 * Provides access to DRHP and RHP documents for Mainboard IPOs with:
 * - Column-level search (company name + exchange filter)
 * - Sortable columns (Company Name, Exchange)
 * - PDF download links with external icon
 * - Pagination (50 records per page)
 * - Responsive design (table on desktop, cards on mobile)
 * - ISR with 10-minute revalidation
 * - Comprehensive SEO optimization
 */

import type { Metadata } from 'next';
import Script from 'next/script';
import { Suspense } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import {
  generateOrganizationSchema,
  generateBreadcrumbSchema,
  toJsonLdScript,
  type BreadcrumbItem,
} from '@/lib/seo/structured-data';

import { MainboardProspectusClient } from '@/components/prospectus/MainboardProspectusClient';

// ==================== METADATA (AC#14) ====================

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || 'https://ipodhan.com';
const DEFAULT_OG_IMAGE = `${BASE_URL}/og-image.jpg`;

export const metadata: Metadata = {
  title: 'Mainboard IPO Prospectus Download - DRHP & RHP Documents | IPODhan',
  description:
    'Download Mainboard IPO prospectus documents (DRHP and RHP) for due diligence. Access official IPO documents with column-level search and exchange filtering.',
  keywords: [
    'mainboard ipo prospectus',
    'drhp download',
    'rhp pdf',
    'ipo documents',
    'mainboard ipo documents',
    'India',
    'draft prospectus',
    'red herring prospectus',
    'ipo due diligence',
  ],
  authors: [{ name: 'IPODhan' }],
  creator: 'IPODhan',
  publisher: 'IPODhan',
  alternates: {
    canonical: `${BASE_URL}/mainboard-ipo-prospectus`,
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
    url: `${BASE_URL}/mainboard-ipo-prospectus`,
    siteName: 'IPODhan',
    title: 'Mainboard IPO Prospectus Download - DRHP & RHP Documents | IPODhan',
    description:
      'Download Mainboard IPO prospectus documents for due diligence. Access DRHP and RHP PDFs with search and filtering.',
    images: [
      {
        url: DEFAULT_OG_IMAGE,
        width: 1200,
        height: 630,
        alt: 'Mainboard IPO Prospectus - IPODhan',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Mainboard IPO Prospectus Download - DRHP & RHP Documents',
    description:
      'Download Mainboard IPO prospectus documents (DRHP and RHP) for due diligence and research.',
    images: [DEFAULT_OG_IMAGE],
    creator: '@ipodhan',
  },
};

// ==================== ISR CONFIGURATION (AC#11) ====================

// Enable ISR with 10-minute revalidation
export const revalidate = 600;

// ==================== STRUCTURED DATA ====================

const breadcrumbItems: BreadcrumbItem[] = [
  { name: 'Home', url: `${BASE_URL}/` },
  {
    name: 'Mainboard IPO Prospectus',
    url: `${BASE_URL}/mainboard-ipo-prospectus`,
  },
];

// ==================== LOADING SKELETON (AC#10) ====================

function ProspectusSkeleton() {
  return (
    <div className="container mx-auto px-4 py-8">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header skeleton */}
        <div className="space-y-2">
          <Skeleton className="h-10 w-96" />
          <Skeleton className="h-6 w-full max-w-2xl" />
        </div>

        {/* Filters skeleton */}
        <div className="flex flex-col md:flex-row gap-4">
          <Skeleton className="h-10 flex-1" />
          <Skeleton className="h-10 w-full md:w-48" />
        </div>

        {/* Table skeleton */}
        <div className="space-y-2">
          <Skeleton className="h-8 w-40" />
          {[1, 2, 3, 4, 5].map((i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      </div>
    </div>
  );
}

// ==================== MAIN COMPONENT ====================

/**
 * Mainboard Prospectus Page Component (Server Component)
 *
 * Handles:
 * - Server-side rendering with ISR
 * - SEO optimization
 * - Client component delegation for interactivity
 */
export default async function MainboardProspectusPage() {
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

      {/* Main Content */}
      <main className="container mx-auto px-4 py-8">
        <div className="max-w-7xl mx-auto space-y-6">
          {/* Header */}
          <div className="space-y-2">
            <h1 className="text-3xl font-bold">Mainboard IPO Prospectus</h1>
            <p className="text-muted-foreground">
              Download official DRHP (Draft Red Herring Prospectus) and RHP (Red Herring
              Prospectus) documents for Mainboard IPOs. These documents contain detailed
              information about the company&apos;s financials, business model, risk factors, and
              offer details.
            </p>
          </div>

          {/* Client Component for Interactivity */}
          <Suspense fallback={<ProspectusSkeleton />}>
            <MainboardProspectusClient />
          </Suspense>

          {/* Educational Note */}
          <div className="text-sm text-muted-foreground bg-muted p-4 rounded-lg">
            <p className="font-medium mb-2">About IPO Prospectus Documents:</p>
            <ul className="list-disc list-inside space-y-1">
              <li>
                <strong>DRHP:</strong> Draft Red Herring Prospectus - Filed with SEBI for
                review
              </li>
              <li>
                <strong>RHP:</strong> Red Herring Prospectus - Final document with SEBI
                approval (price band included)
              </li>
            </ul>
          </div>
        </div>
      </main>
    </>
  );
}
