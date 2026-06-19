import { describe, it, expect } from 'vitest';
import { mapDemandPointsToRows, type ScrapedDemandPoint } from '../../../src/services/data-persister';

// Stage D: the NSE ipo-detail demand block (extractDemandGraphData) was fetched but
// never persisted (no writer → ipo_demand_graph 0%). mapDemandPointsToRows is the pure
// mapping that createDemandGraphSnapshot inserts; this guards its substance.

describe('mapDemandPointsToRows', () => {
  it('maps NSE points, stringifies pricePoint, keeps the Cut-Off (null price) row', () => {
    const points: ScrapedDemandPoint[] = [
      { pricePoint: 695, isCutOff: false, cumulativeQuantity: 1000, exchange: 'NSE' },
      { pricePoint: null, isCutOff: true, cumulativeQuantity: 5000, exchange: 'NSE' },
    ];
    const rows = mapDemandPointsToRows('ipo-1', points);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ ipoId: 'ipo-1', pricePoint: '695', isCutOff: false, cumulativeQuantity: 1000, exchange: 'NSE' });
    expect(rows[1]).toMatchObject({ pricePoint: null, isCutOff: true, cumulativeQuantity: 5000 });
    expect(rows[0].timestamp).toBeInstanceOf(Date);
  });

  it('drops points with non-positive / non-finite cumulative quantity (no fabricated demand)', () => {
    const points: ScrapedDemandPoint[] = [
      { pricePoint: 100, isCutOff: false, cumulativeQuantity: 0 },
      { pricePoint: 101, isCutOff: false, cumulativeQuantity: NaN as unknown as number },
      { pricePoint: 102, isCutOff: false, cumulativeQuantity: -5 },
      { pricePoint: 103, isCutOff: false, cumulativeQuantity: 200 },
    ];
    const rows = mapDemandPointsToRows('ipo-2', points);
    expect(rows).toHaveLength(1);
    expect(rows[0].cumulativeQuantity).toBe(200);
  });

  it('defaults exchange to NSE and returns [] for empty/garbage input', () => {
    expect(mapDemandPointsToRows('x', [{ pricePoint: 1, isCutOff: false, cumulativeQuantity: 10 }])[0].exchange).toBe('NSE');
    expect(mapDemandPointsToRows('x', [])).toEqual([]);
    expect(mapDemandPointsToRows('x', null as unknown as ScrapedDemandPoint[])).toEqual([]);
  });
});
