import { NextRequest, NextResponse } from 'next/server';
import { getSMEIPOReviews } from '@/lib/services/sme-reviews-service';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;

    const year = Number(searchParams.get('year')) || new Date().getFullYear();
    const page = Number(searchParams.get('page')) || 1;
    const reviewTitle = searchParams.get('reviewTitle') || undefined;
    const author = searchParams.get('author') || undefined;
    const recommendation = searchParams.get('recommendation') || undefined;
    const ipoName = searchParams.get('ipoName') || undefined;

    const result = await getSMEIPOReviews(year, {
      reviewTitle,
      author,
      recommendation,
      ipoName,
      page,
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error('API Error - SME Reviews:', error);
    return NextResponse.json(
      { error: 'Failed to fetch reviews' },
      { status: 500 }
    );
  }
}
