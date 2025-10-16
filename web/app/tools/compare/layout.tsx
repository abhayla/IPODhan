/**
 * Layout for IPO Comparison Tool
 *
 * Provides metadata and layout wrapper for the comparison page
 */

import { Metadata } from 'next';
import Script from 'next/script';
import { generateComparisonToolMetadata } from '@/lib/seo/metadata';

// ==================== METADATA ====================

export const metadata: Metadata = generateComparisonToolMetadata();

// ==================== LAYOUT COMPONENT ====================

export default function CompareLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      {/* Structured Data for Comparison Tool */}
      <Script
        id="comparison-tool-schema"
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'WebApplication',
            name: 'IPO Comparison Tool',
            description:
              'Compare 2-3 Indian IPOs side-by-side with detailed metrics including subscription, GMP, financials, and ratings',
            applicationCategory: 'FinanceApplication',
            offers: {
              '@type': 'Offer',
              price: '0',
              priceCurrency: 'INR',
            },
            featureList: [
              'Compare up to 3 IPOs simultaneously',
              'Subscription status comparison',
              'GMP and financial metrics',
              'Rating and analysis comparison',
              'Shareable comparison URLs',
            ],
          }),
        }}
      />
      {children}
    </>
  );
}
