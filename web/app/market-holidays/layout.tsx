import { Metadata } from 'next';
import { generateMarketHolidaysMetadata } from '@/lib/seo/metadata';

export const metadata: Metadata = generateMarketHolidaysMetadata();

export default function MarketHolidaysLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
