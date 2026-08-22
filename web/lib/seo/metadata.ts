import type { Metadata } from 'next';
import type { IPO } from '../db/types';

/**
 * Base URL for the application
 * In production, this should be set via environment variable
 */
const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || 'https://ipodhan.com';

/**
 * Default Open Graph image
 */
const DEFAULT_OG_IMAGE = `${BASE_URL}/og-image.jpg`;

/**
 * Metadata template types
 */
export type MetadataPageType =
  | 'homepage'
  | 'ipo-listing'
  | 'ipo-detail'
  | 'lot-calculator'
  | 'comparison-tool'
  | 'registrars'
  | 'market-holidays'
  | 'historical-ipos'
  | 'mainboard-ipo-reviews-coming-soon'
  | 'sme-ipo-reviews-coming-soon';

/**
 * IPO detail metadata params
 */
export interface IPOMetadataParams {
  companyName: string;
  slug: string;
  description?: string | null;
  priceMin?: number | null;
  priceMax?: number | null;
  openDate?: Date | string | null;
  closeDate?: Date | string | null;
  sector?: string | null;
}

/**
 * Generate metadata for homepage
 */
export function generateHomepageMetadata(): Metadata {
  const title = 'IPO Dhan - Live IPO Updates, Analysis & Application Tools';
  const description =
    'Track live IPO subscriptions, analyze financials, compare IPOs, and apply through trusted brokers. Real-time data from NSE & BSE.';

  return {
    title,
    description,
    keywords: [
      'IPO',
      'India IPO',
      'IPO subscription',
      'IPO analysis',
      'IPO GMP',
      'IPO listing',
      'NSE IPO',
      'BSE IPO',
      'mainboard IPO',
      'SME IPO',
    ],
    authors: [{ name: 'IPO Dhan' }],
    creator: 'IPO Dhan',
    publisher: 'IPO Dhan',
    alternates: {
      canonical: BASE_URL,
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
      url: BASE_URL,
      siteName: 'IPO Dhan',
      title: 'IPO Dhan - Your IPO Investment Companion',
      description:
        'Track live IPO subscriptions, analyze financials, compare IPOs, and apply through trusted brokers.',
      images: [
        {
          url: DEFAULT_OG_IMAGE,
          width: 1200,
          height: 630,
          alt: 'IPO Dhan - Live IPO Updates and Analysis',
        },
      ],
    },
    twitter: {
      card: 'summary_large_image',
      title: 'IPO Dhan - Your IPO Investment Companion',
      description:
        'Track live IPO subscriptions, analyze financials, compare IPOs, and apply through trusted brokers.',
      images: [DEFAULT_OG_IMAGE],
      creator: '@ipodhan',
    },
  };
}

/**
 * Generate metadata for IPO listing page
 */
export function generateIPOListingMetadata(): Metadata {
  const title = 'Current IPOs - Live Subscription Data | IPO Dhan';
  const description =
    'Browse all current and upcoming IPOs with live subscription data, GMP updates, and expert analysis. Updated in real-time.';

  return {
    title,
    description,
    keywords: [
      'current IPOs',
      'upcoming IPOs',
      'IPO subscription status',
      'live IPO data',
      'IPO calendar',
    ],
    alternates: {
      canonical: `${BASE_URL}/ipos`,
    },
    openGraph: {
      type: 'website',
      locale: 'en_IN',
      url: `${BASE_URL}/ipos`,
      siteName: 'IPO Dhan',
      title: 'Current IPOs - Live Subscription Data',
      description,
      images: [
        {
          url: DEFAULT_OG_IMAGE,
          width: 1200,
          height: 630,
          alt: 'Current IPOs - IPO Dhan',
        },
      ],
    },
    twitter: {
      card: 'summary_large_image',
      title: 'Current IPOs - Live Subscription Data',
      description,
      images: [DEFAULT_OG_IMAGE],
    },
  };
}

/**
 * Generate metadata for IPO detail page
 */
export function generateIPODetailMetadata(params: IPOMetadataParams): Metadata {
  const { companyName, slug, description, priceMin, priceMax, openDate } = params;

  // Format price range if available
  const priceRange =
    priceMin && priceMax ? `₹${priceMin}-${priceMax}` : 'Price TBA';

  // Format open date if available
  const openDateStr = openDate
    ? new Date(openDate).toLocaleDateString('en-IN', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      })
    : 'TBA';

  const title = `${companyName} IPO - Live Subscription, GMP, Analysis | IPO Dhan`;

  // Build meta description - include price range even when custom description is provided
  let metaDescription = description || `${companyName} IPO opens ${openDateStr}.`;

  // Append price range if available
  if (priceMin && priceMax) {
    metaDescription = `${metaDescription} Price: ₹${priceMin}-₹${priceMax}.`;
  }

  // Append call-to-action if not using custom description
  if (!description) {
    metaDescription = `${metaDescription} Track live subscription, GMP, financials. Apply now through trusted brokers.`;
  }

  return {
    title,
    description: metaDescription.slice(0, 160), // Ensure <160 chars
    keywords: [
      `${companyName} IPO`,
      `${companyName} subscription`,
      `${companyName} GMP`,
      'IPO analysis',
      'IPO subscription status',
    ],
    alternates: {
      canonical: `${BASE_URL}/ipos/${slug}`,
    },
    openGraph: {
      type: 'website',
      locale: 'en_IN',
      url: `${BASE_URL}/ipos/${slug}`,
      siteName: 'IPO Dhan',
      title: `${companyName} IPO - Live Subscription & Analysis`,
      description: metaDescription,
      images: [
        {
          url: DEFAULT_OG_IMAGE,
          width: 1200,
          height: 630,
          alt: `${companyName} IPO Analysis`,
        },
      ],
    },
    twitter: {
      card: 'summary_large_image',
      title: `${companyName} IPO - Live Subscription & Analysis`,
      description: metaDescription,
      images: [DEFAULT_OG_IMAGE],
    },
  };
}

/**
 * Generate metadata for lot calculator page
 */
export function generateLotCalculatorMetadata(): Metadata {
  const title = 'IPO Lot Size Calculator | IPO Dhan';
  const description =
    'Calculate how many lots you can apply for based on your investment amount. Instant calculations for all current IPOs.';

  return {
    title,
    description,
    keywords: [
      'IPO lot calculator',
      'lot size calculator',
      'IPO investment calculator',
      'how many lots',
    ],
    alternates: {
      canonical: `${BASE_URL}/tools/lot-calculator`,
    },
    openGraph: {
      type: 'website',
      locale: 'en_IN',
      url: `${BASE_URL}/tools/lot-calculator`,
      siteName: 'IPO Dhan',
      title,
      description,
      images: [
        {
          url: DEFAULT_OG_IMAGE,
          width: 1200,
          height: 630,
          alt: 'IPO Lot Calculator - IPO Dhan',
        },
      ],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: [DEFAULT_OG_IMAGE],
    },
  };
}

/**
 * Generate metadata for IPO comparison tool
 */
export function generateComparisonToolMetadata(): Metadata {
  const title = 'IPO Comparison Tool | IPO Dhan';
  const description =
    'Compare multiple IPOs side-by-side. Analyze financials, subscription data, GMP, and listing performance to make informed investment decisions.';

  return {
    title,
    description,
    keywords: [
      'IPO comparison',
      'compare IPOs',
      'IPO analysis tool',
      'IPO comparison tool',
    ],
    alternates: {
      canonical: `${BASE_URL}/tools/compare`,
    },
    openGraph: {
      type: 'website',
      locale: 'en_IN',
      url: `${BASE_URL}/tools/compare`,
      siteName: 'IPO Dhan',
      title,
      description,
      images: [
        {
          url: DEFAULT_OG_IMAGE,
          width: 1200,
          height: 630,
          alt: 'IPO Comparison Tool - IPO Dhan',
        },
      ],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: [DEFAULT_OG_IMAGE],
    },
  };
}

/**
 * Generate metadata for registrars directory page
 */
export function generateRegistrarsMetadata(): Metadata {
  const title = 'IPO Registrars Directory | IPO Dhan';
  const description =
    'Complete directory of IPO registrars in India. Find contact details, allotment status links, and registrar-wise IPO listings.';

  return {
    title,
    description,
    keywords: [
      'IPO registrar',
      'registrar directory',
      'allotment status',
      'Link Intime',
      'KFin Technologies',
    ],
    alternates: {
      canonical: `${BASE_URL}/registrars`,
    },
    openGraph: {
      type: 'website',
      locale: 'en_IN',
      url: `${BASE_URL}/registrars`,
      siteName: 'IPO Dhan',
      title,
      description,
      images: [
        {
          url: DEFAULT_OG_IMAGE,
          width: 1200,
          height: 630,
          alt: 'IPO Registrars Directory - IPO Dhan',
        },
      ],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: [DEFAULT_OG_IMAGE],
    },
  };
}

/**
 * Generate metadata for market holidays page
 */
export function generateMarketHolidaysMetadata(): Metadata {
  const title = 'Market Holidays Calendar | IPO Dhan';
  const description =
    'NSE and BSE market holidays calendar. Plan your IPO applications around trading holidays and market closures.';

  return {
    title,
    description,
    keywords: [
      'market holidays',
      'NSE holidays',
      'BSE holidays',
      'trading holidays',
      'stock market holidays',
    ],
    alternates: {
      canonical: `${BASE_URL}/market-holidays`,
    },
    openGraph: {
      type: 'website',
      locale: 'en_IN',
      url: `${BASE_URL}/market-holidays`,
      siteName: 'IPO Dhan',
      title,
      description,
      images: [
        {
          url: DEFAULT_OG_IMAGE,
          width: 1200,
          height: 630,
          alt: 'Market Holidays Calendar - IPO Dhan',
        },
      ],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: [DEFAULT_OG_IMAGE],
    },
  };
}

/**
 * Generate metadata for historical IPOs page
 */
export function generateHistoricalIPOsMetadata(): Metadata {
  const title = 'Historical IPOs - Past IPO Performance | IPO Dhan';
  const description =
    'Browse historical IPO data with listing performance, subscription statistics, and post-listing returns. Learn from past IPOs.';

  return {
    title,
    description,
    keywords: [
      'historical IPOs',
      'past IPOs',
      'IPO performance',
      'IPO listing gains',
      'IPO returns',
    ],
    alternates: {
      canonical: `${BASE_URL}/history`,
    },
    openGraph: {
      type: 'website',
      locale: 'en_IN',
      url: `${BASE_URL}/history`,
      siteName: 'IPO Dhan',
      title,
      description,
      images: [
        {
          url: DEFAULT_OG_IMAGE,
          width: 1200,
          height: 630,
          alt: 'Historical IPOs - IPO Dhan',
        },
      ],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: [DEFAULT_OG_IMAGE],
    },
  };
}

/**
 * Generate metadata for the Mainboard IPO Reviews "coming soon" placeholder
 * (P2-3, round-2 review: the review/score backing tables are empty with no
 * live source — this page is de-listed from nav but the route itself still
 * needs a real, page-type-specific title, not the generic homepage fallback).
 */
export function generateMainboardReviewsComingSoonMetadata(): Metadata {
  const title = 'Mainboard IPO Reviews — Coming Soon | IPO Dhan';
  const description =
    'Expert Mainboard IPO reviews and analysis are coming soon to IPO Dhan.';

  return {
    title,
    description,
    alternates: {
      canonical: `${BASE_URL}/mainboard-ipo-reviews`,
    },
    robots: {
      index: false,
      follow: true,
    },
    openGraph: {
      type: 'website',
      locale: 'en_IN',
      url: `${BASE_URL}/mainboard-ipo-reviews`,
      siteName: 'IPO Dhan',
      title,
      description,
    },
    twitter: {
      card: 'summary',
      title,
      description,
    },
  };
}

/**
 * Generate metadata for the SME IPO Reviews "coming soon" placeholder (P2-3).
 */
export function generateSmeReviewsComingSoonMetadata(): Metadata {
  const title = 'SME IPO Reviews — Coming Soon | IPO Dhan';
  const description =
    'Expert SME IPO reviews and analysis are coming soon to IPO Dhan.';

  return {
    title,
    description,
    alternates: {
      canonical: `${BASE_URL}/sme-ipo-reviews`,
    },
    robots: {
      index: false,
      follow: true,
    },
    openGraph: {
      type: 'website',
      locale: 'en_IN',
      url: `${BASE_URL}/sme-ipo-reviews`,
      siteName: 'IPO Dhan',
      title,
      description,
    },
    twitter: {
      card: 'summary',
      title,
      description,
    },
  };
}

/**
 * Generate metadata based on page type
 */
export function generateMetadata(
  pageType: MetadataPageType,
  params?: IPOMetadataParams,
): Metadata {
  switch (pageType) {
    case 'homepage':
      return generateHomepageMetadata();
    case 'ipo-listing':
      return generateIPOListingMetadata();
    case 'ipo-detail':
      if (!params) {
        throw new Error('IPO metadata params required for ipo-detail page');
      }
      return generateIPODetailMetadata(params);
    case 'lot-calculator':
      return generateLotCalculatorMetadata();
    case 'comparison-tool':
      return generateComparisonToolMetadata();
    case 'registrars':
      return generateRegistrarsMetadata();
    case 'market-holidays':
      return generateMarketHolidaysMetadata();
    case 'historical-ipos':
      return generateHistoricalIPOsMetadata();
    case 'mainboard-ipo-reviews-coming-soon':
      return generateMainboardReviewsComingSoonMetadata();
    case 'sme-ipo-reviews-coming-soon':
      return generateSmeReviewsComingSoonMetadata();
    default:
      return generateHomepageMetadata();
  }
}

/**
 * Convert IPO database model to metadata params
 */
export function ipoToMetadataParams(ipo: IPO): IPOMetadataParams {
  return {
    companyName: ipo.companyName,
    slug: ipo.slug,
    description: ipo.companyDescription,
    priceMin: ipo.priceRangeMin,
    priceMax: ipo.priceRangeMax,
    openDate: ipo.openDate,
    closeDate: ipo.closeDate,
    sector: ipo.sector,
  };
}
