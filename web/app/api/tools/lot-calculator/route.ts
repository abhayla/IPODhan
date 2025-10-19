/**
 * Lot Calculator API Endpoint
 *
 * Provides IPO data for lot size calculations
 * Returns list of active IPOs with pricing and lot size information
 *
 * @route GET /api/tools/lot-calculator
 * @query search - Optional search term to filter IPOs
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/index';
import { ipos } from '@/lib/db';
import { eq, or, ilike, desc } from 'drizzle-orm';

// ==================== TYPES ====================

interface LotCalculatorIPO {
  id: string;
  companyName: string;
  slug: string;
  segment: 'MAINBOARD' | 'SME';
  offeringType: string;
  status: string;
  priceRangeMin: number | null;
  priceRangeMax: number | null;
  lotSize: number | null;
  openDate: string | null;
  closeDate: string | null;
}

interface LotCalculatorResponse {
  ipos: LotCalculatorIPO[];
  count: number;
}

// ==================== GET HANDLER ====================

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const search = searchParams.get('search');

    // Build query to fetch IPOs with lot size information
    let query = db
      .select({
        id: ipos.id,
        companyName: ipos.companyName,
        slug: ipos.slug,
        segment: ipos.segment,
        offeringType: ipos.offeringType,
        status: ipos.status,
        priceRangeMin: ipos.priceRangeMin,
        priceRangeMax: ipos.priceRangeMax,
        lotSize: ipos.lotSize,
        openDate: ipos.openDate,
        closeDate: ipos.closeDate,
      })
      .from(ipos)
      .$dynamic();

    // Apply search filter if provided
    if (search && search.trim() !== '') {
      query = query.where(
        or(
          ilike(ipos.companyName, `%${search}%`),
          ilike(ipos.slug, `%${search}%`)
        )
      );
    } else {
      // If no search, only return active IPOs (OPEN, UPCOMING, CLOSED)
      query = query.where(
        or(
          eq(ipos.status, 'OPEN'),
          eq(ipos.status, 'UPCOMING'),
          eq(ipos.status, 'CLOSED')
        )
      );
    }

    // Order by status priority and close date
    const results = await query
      .orderBy(desc(ipos.closeDate))
      .limit(100);

    // Filter out IPOs with missing critical data
    const validIPOs = results.filter(
      (ipo: LotCalculatorIPO) =>
        ipo.priceRangeMax !== null &&
        ipo.lotSize !== null &&
        ipo.lotSize > 0
    );

    const response: LotCalculatorResponse = {
      ipos: validIPOs,
      count: validIPOs.length,
    };

    return NextResponse.json(response, {
      status: 200,
      headers: {
        'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600', // 5 min cache
      },
    });
  } catch (error) {
    console.error('Lot Calculator API Error:', error);
    return NextResponse.json(
      {
        error: 'Failed to fetch IPO data',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
