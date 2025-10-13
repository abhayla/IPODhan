import { NextRequest, NextResponse } from 'next/server';
import { getSMEProspectusDocuments } from '@/lib/services/sme-prospectus-service';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;

    const companyName = searchParams.get('companyName') || undefined;
    const exchange = (searchParams.get('exchange') as 'All' | 'BSE' | 'NSE' | 'Both') || 'All';
    const page = Number(searchParams.get('page')) || 1;
    const limit = Number(searchParams.get('limit')) || 50;

    const result = await getSMEProspectusDocuments({
      companyName,
      exchange,
      page,
      limit,
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error('API Error - SME Prospectus:', error);
    return NextResponse.json(
      { error: 'Failed to fetch prospectus documents' },
      { status: 500 }
    );
  }
}
