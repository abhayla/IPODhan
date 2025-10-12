/**
 * IPO Review Detail Page (Placeholder)
 *
 * Displays detailed review and analysis for a specific IPO.
 * Full implementation will be added in future stories.
 *
 * Future implementation will include:
 * - Company Background
 * - Offer Details
 * - Company Valuation
 * - Capital Structure
 * - Financial Performance
 * - Strengths & Risks
 * - Peer Comparison
 * - Analyst Recommendation
 */

import { notFound } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, FileText, TrendingUp, Building2, DollarSign, BarChart3, AlertTriangle, Users } from 'lucide-react';
import { getReviewById } from '@/lib/services/mainboard-reviews-service';

interface Props {
  params: { reviewId: string };
}

export default async function ReviewDetailPage({ params }: Props) {
  // Fetch review data
  const review = await getReviewById(params.reviewId);

  // Show 404 if review not found
  if (!review) {
    notFound();
  }

  return (
    <div className="container mx-auto py-8 px-4 max-w-4xl">
      {/* Back Navigation */}
      <Link
        href="/mainboard-ipo-reviews"
        className="inline-flex items-center gap-2 text-primary hover:underline mb-6"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Reviews
      </Link>

      {/* Review Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-3">{review.reviewTitle}</h1>
        <div className="flex items-center gap-4 text-sm text-gray-600">
          <span>
            <strong>IPO:</strong>{' '}
            <Link href={`/ipos/${review.ipoSlug}`} className="text-primary hover:underline">
              {review.ipoName}
            </Link>
          </span>
          <span>•</span>
          <span>
            <strong>Author:</strong> {review.author}
          </span>
          <span>•</span>
          <span>
            <strong>Published:</strong>{' '}
            {new Date(review.publishedDate).toLocaleDateString('en-IN', {
              year: 'numeric',
              month: 'long',
              day: 'numeric',
            })}
          </span>
        </div>
        <div className="mt-3">
          <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-blue-100 text-blue-800">
            Recommendation: {review.recommendation}
          </span>
        </div>
      </div>

      {/* Placeholder Content */}
      <div className="bg-white shadow rounded-lg p-6 mb-6">
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-6">
          <p className="text-sm text-yellow-800">
            <strong>Note:</strong> Full review implementation is coming in future
            stories. This page will display comprehensive IPO analysis including
            all sections listed below.
          </p>
        </div>

        <h2 className="text-xl font-semibold mb-4">Review Sections</h2>
        <p className="text-gray-700 mb-6">
          This review will contain detailed analysis across the following
          sections:
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Company Background */}
          <div className="border rounded-lg p-4 bg-gray-50">
            <div className="flex items-start gap-3">
              <Building2 className="h-5 w-5 text-blue-600 mt-1" />
              <div>
                <h3 className="font-semibold mb-1">Company Background</h3>
                <p className="text-sm text-gray-600">
                  History, operations, business model, and market position
                </p>
              </div>
            </div>
          </div>

          {/* Offer Details */}
          <div className="border rounded-lg p-4 bg-gray-50">
            <div className="flex items-start gap-3">
              <FileText className="h-5 w-5 text-green-600 mt-1" />
              <div>
                <h3 className="font-semibold mb-1">Offer Details</h3>
                <p className="text-sm text-gray-600">
                  Issue size, price band, lot size, and key dates
                </p>
              </div>
            </div>
          </div>

          {/* Company Valuation */}
          <div className="border rounded-lg p-4 bg-gray-50">
            <div className="flex items-start gap-3">
              <DollarSign className="h-5 w-5 text-purple-600 mt-1" />
              <div>
                <h3 className="font-semibold mb-1">Company Valuation</h3>
                <p className="text-sm text-gray-600">
                  P/E ratio, market cap, valuation metrics analysis
                </p>
              </div>
            </div>
          </div>

          {/* Capital Structure */}
          <div className="border rounded-lg p-4 bg-gray-50">
            <div className="flex items-start gap-3">
              <BarChart3 className="h-5 w-5 text-indigo-600 mt-1" />
              <div>
                <h3 className="font-semibold mb-1">Capital Structure</h3>
                <p className="text-sm text-gray-600">
                  Pre and post-issue shareholding patterns
                </p>
              </div>
            </div>
          </div>

          {/* Financial Performance */}
          <div className="border rounded-lg p-4 bg-gray-50">
            <div className="flex items-start gap-3">
              <TrendingUp className="h-5 w-5 text-emerald-600 mt-1" />
              <div>
                <h3 className="font-semibold mb-1">Financial Performance</h3>
                <p className="text-sm text-gray-600">
                  Revenue, profit trends, margins, and key ratios
                </p>
              </div>
            </div>
          </div>

          {/* Strengths & Risks */}
          <div className="border rounded-lg p-4 bg-gray-50">
            <div className="flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 text-orange-600 mt-1" />
              <div>
                <h3 className="font-semibold mb-1">Strengths & Risks</h3>
                <p className="text-sm text-gray-600">
                  Key advantages and potential risk factors
                </p>
              </div>
            </div>
          </div>

          {/* Peer Comparison */}
          <div className="border rounded-lg p-4 bg-gray-50">
            <div className="flex items-start gap-3">
              <Users className="h-5 w-5 text-cyan-600 mt-1" />
              <div>
                <h3 className="font-semibold mb-1">Peer Comparison</h3>
                <p className="text-sm text-gray-600">
                  Comparison with industry peers and competitors
                </p>
              </div>
            </div>
          </div>

          {/* Analyst Recommendation */}
          <div className="border rounded-lg p-4 bg-gray-50">
            <div className="flex items-start gap-3">
              <FileText className="h-5 w-5 text-blue-600 mt-1" />
              <div>
                <h3 className="font-semibold mb-1">Analyst Recommendation</h3>
                <p className="text-sm text-gray-600">
                  Final verdict for short and long-term investors
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* External Review Link (if available) */}
        {review.reviewUrl && (
          <div className="mt-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
            <p className="text-sm text-gray-700 mb-2">
              View the full review on the analyst's website:
            </p>
            <a
              href={review.reviewUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline font-medium"
            >
              {review.reviewUrl}
            </a>
          </div>
        )}
      </div>

      {/* Footer CTA */}
      <div className="text-center">
        <Link
          href="/mainboard-ipo-reviews"
          className="inline-flex items-center gap-2 px-6 py-3 bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Browse More Reviews
        </Link>
      </div>
    </div>
  );
}

// SEO metadata
export async function generateMetadata({ params }: Props) {
  const review = await getReviewById(params.reviewId);

  if (!review) {
    return {
      title: 'Review Not Found',
      description: 'The requested IPO review could not be found.',
    };
  }

  return {
    title: `${review.reviewTitle} | IPO Review`,
    description: `Expert IPO review and analysis for ${review.ipoName} by ${review.author}. Recommendation: ${review.recommendation}`,
    keywords: `${review.ipoName} IPO review, ${review.author}, IPO analysis, ${review.recommendation}`,
  };
}
