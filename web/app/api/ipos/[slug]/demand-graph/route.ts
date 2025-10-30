/**
 * GET /api/ipos/[slug]/demand-graph
 * Returns price-wise demand data for IPO visualization
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getRedisClient } from '@/lib/cache/redis-client';
import { IPORepository } from '@/lib/repositories/ipo-repository';
import { logger } from '@/lib/logger';

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await context.params;
    const { searchParams } = new URL(request.url);
    const exchange = searchParams.get('exchange') as 'NSE' | 'BSE' | 'BOTH' | null;

    const db = await getDb();
    const redis = getRedisClient();
    const ipoRepository = new IPORepository(db, redis);

    // Find IPO by slug
    const ipo = await ipoRepository.findBySlug(slug);
    if (!ipo) {
      return NextResponse.json(
        { error: 'IPO not found' },
        { status: 404 }
      );
    }

    // Check if demand graph data exists
    const hasData = await ipoRepository.hasDemandGraphData(ipo.id);
    if (!hasData) {
      return NextResponse.json({
        success: true,
        data: {
          slug,
          companyName: ipo.companyName,
          exchange: exchange || 'ALL',
          demandGraph: [],
          snapshot: null,
          message: 'No demand graph data available for this IPO',
        },
      });
    }

    // Fetch demand graph data
    const demandGraph = await ipoRepository.getDemandGraph(
      ipo.id,
      exchange || undefined
    );

    // Get latest snapshot
    const snapshot = await ipoRepository.getLatestDemandSnapshot(ipo.id);

    // Transform data for frontend consumption
    const chartData = demandGraph.map(entry => ({
      pricePoint: entry.isCutOff ? 'Cut-Off' : (entry.pricePoint || ''),
      price: entry.pricePoint ? parseFloat(entry.pricePoint) : null,
      isCutOff: entry.isCutOff,
      quantity: Number(entry.cumulativeQuantity),
      exchange: entry.exchange,
      timestamp: entry.timestamp,
    }));

    // Group by exchange for multi-series chart
    const dataByExchange = {
      NSE: chartData.filter(d => d.exchange === 'NSE'),
      BSE: chartData.filter(d => d.exchange === 'BSE'),
      BOTH: chartData.filter(d => d.exchange === 'BOTH'),
    };

    // Calculate aggregated stats
    const stats = {
      totalDataPoints: chartData.length,
      exchanges: [...new Set(chartData.map(d => d.exchange))],
      priceRange: {
        min: Math.min(...chartData.filter(d => d.price).map(d => d.price!)),
        max: Math.max(...chartData.filter(d => d.price).map(d => d.price!)),
      },
      cutOffBids: chartData
        .filter(d => d.isCutOff)
        .reduce((sum, d) => sum + d.quantity, 0),
      totalBids: chartData
        .filter(d => d.exchange === (exchange || 'BOTH'))
        .reduce((sum, d) => sum + d.quantity, 0),
    };

    logger.info({
      slug,
      exchange,
      dataPoints: chartData.length,
      hasSnapshot: !!snapshot,
    }, 'Demand graph data fetched successfully');

    return NextResponse.json({
      success: true,
      data: {
        slug,
        companyName: ipo.companyName,
        exchange: exchange || 'ALL',
        demandGraph: chartData,
        dataByExchange,
        snapshot,
        stats,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    logger.error({
      error,
      slug: (await context.params).slug,
    }, 'Failed to fetch demand graph data');

    return NextResponse.json(
      { error: 'Failed to fetch demand graph data' },
      { status: 500 }
    );
  }
}