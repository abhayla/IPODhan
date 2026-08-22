import type { Metadata } from 'next';
import Link from 'next/link';
import { generateMetadata as generatePageMetadata } from '@/lib/seo/metadata';

/**
 * Mainboard IPO Reviews — Coming Soon
 *
 * P2-3 (round-2 review, T-277): `ipo_reviews`/`ipo_scores` have zero rows in
 * production with no live scraper source wired into the one-shot prod
 * entrypoint (`scraper/src/index.ts` — see `pm2-scheduled-one-shot-scraper.md`),
 * so the previous data-table page rendered "Total Records: 0" for every
 * visitor. De-listed from nav (Header/HeaderNew/MobileMenu) until the feature
 * has real data; tracked in GitHub issue for future population.
 */

export const metadata: Metadata = generatePageMetadata('mainboard-ipo-reviews-coming-soon');

export default function MainboardIPOReviewsPage() {
  return (
    <div className="container mx-auto py-16 px-4 text-center">
      <h1 className="text-3xl font-bold mb-4">Mainboard IPO Reviews</h1>
      <p className="text-gray-600 max-w-xl mx-auto mb-8">
        Expert Mainboard IPO reviews and analysis are coming soon. In the meantime, check the
        current Mainboard IPOs below.
      </p>
      <Link
        href="/mainboard-ipos"
        className="inline-flex items-center px-5 py-2.5 rounded-lg bg-blue-600 text-white font-medium hover:bg-blue-700"
      >
        View Mainboard IPOs
      </Link>
    </div>
  );
}
