import type { Metadata } from 'next';
import Link from 'next/link';
import { generateMetadata as generatePageMetadata } from '@/lib/seo/metadata';

/**
 * SME IPO Reviews — Coming Soon
 *
 * P2-3 (round-2 review, T-277): same empty-data-source condition as
 * `/mainboard-ipo-reviews` — see that page for the full rationale.
 */

export const metadata: Metadata = generatePageMetadata('sme-ipo-reviews-coming-soon');

export default function SmeIPOReviewsPage() {
  return (
    <div className="container mx-auto py-16 px-4 text-center">
      <h1 className="text-3xl font-bold mb-4">SME IPO Reviews</h1>
      <p className="text-gray-600 max-w-xl mx-auto mb-8">
        Expert SME IPO reviews and analysis are coming soon. In the meantime, check the current
        SME IPOs below.
      </p>
      <Link
        href="/sme-ipos"
        className="inline-flex items-center px-5 py-2.5 rounded-lg bg-blue-600 text-white font-medium hover:bg-blue-700"
      >
        View SME IPOs
      </Link>
    </div>
  );
}
