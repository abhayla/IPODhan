import { Metadata } from 'next';
import Script from 'next/script';
import { generateMarketHolidaysMetadata } from '@/lib/seo/metadata';

export const metadata: Metadata = generateMarketHolidaysMetadata();

export default function MarketHolidaysLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      {/* Structured Data for Market Holidays Calendar */}
      <Script
        id="market-holidays-schema"
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'CollectionPage',
            name: 'Market Holidays Calendar',
            description:
              'NSE and BSE market holidays calendar for planning IPO applications',
            url: 'https://ipodhan.com/market-holidays',
            mainEntity: {
              '@type': 'ItemList',
              name: 'Market Holidays',
              description: 'Trading holidays for NSE and BSE',
            },
          }),
        }}
      />
      {children}
    </>
  );
}
