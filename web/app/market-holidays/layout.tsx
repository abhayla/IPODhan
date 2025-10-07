import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Market Holidays Calendar 2024-2026 | NSE & BSE Trading Holidays | IPODhan',
  description:
    'View NSE and BSE market holidays for 2024, 2025, and 2026. Plan your IPO applications around trading holidays and market closures in India.',
  keywords: [
    'NSE market holidays',
    'BSE trading holidays',
    'stock market holidays',
    'IPO trading holidays',
    'market closure dates',
    'NSE BSE holidays 2024',
    'NSE BSE holidays 2025',
    'NSE BSE holidays 2026',
    'India stock exchange holidays',
  ],
  openGraph: {
    title: 'Market Holidays Calendar | NSE & BSE Trading Holidays',
    description:
      'Complete calendar of NSE and BSE market holidays. Never miss important trading dates for IPO applications.',
    type: 'website',
    url: '/market-holidays',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Market Holidays Calendar | NSE & BSE',
    description: 'NSE and BSE market holidays for 2024-2026. Plan your IPO applications.',
  },
};

export default function MarketHolidaysLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
