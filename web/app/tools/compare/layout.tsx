/**
 * Layout for IPO Comparison Tool
 *
 * Provides metadata and layout wrapper for the comparison page
 */

import { Metadata } from 'next';

// ==================== METADATA ====================

export const metadata: Metadata = {
  title: 'IPO Comparison Tool | IPODhan - Compare IPOs Side-by-Side',
  description:
    'Compare 2-3 Indian IPOs side-by-side with detailed metrics. Analyze subscription status, GMP, financial ratios, and ratings to make informed investment decisions.',
  keywords: [
    'IPO comparison',
    'compare IPOs',
    'IPO analysis',
    'IPO metrics',
    'subscription comparison',
    'GMP comparison',
    'financial ratio comparison',
    'India IPO comparison',
  ],
  openGraph: {
    title: 'IPO Comparison Tool | IPODhan',
    description:
      'Compare multiple Indian IPOs side-by-side with detailed metrics including subscription, GMP, financials, and ratings.',
    type: 'website',
    url: 'https://ipodhan.com/tools/compare',
    siteName: 'IPODhan',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'IPO Comparison Tool | IPODhan',
    description:
      'Compare IPOs side-by-side with detailed metrics. Make informed investment decisions.',
    creator: '@ipodhan',
  },
  alternates: {
    canonical: 'https://ipodhan.com/tools/compare',
  },
};

// ==================== LAYOUT COMPONENT ====================

export default function CompareLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
