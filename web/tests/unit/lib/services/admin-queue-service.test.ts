/** Admin queue assembly (OD-63, §9.4): both populations, holds as handled, NULL code shown. */
import { describe, it, expect } from 'vitest';
import { buildQueueItems, shapeQueue, snakeToCamel } from '@/lib/services/admin-queue-service';
import type { ConflictRow, PlanRow } from '@/lib/repositories/admin-queue-repository';

const ipoCols = { ipo_id: 'i1', slug: 'abc-ltd', company_name: 'ABC Ltd', status: 'UPCOMING', open_date: '2026-10-05', close_date: null, listing_date: null };

const conflict = (o: Partial<ConflictRow> = {}): ConflictRow => ({
  ...ipoCols,
  id: 'c1',
  table_name: 'ipos',
  row_key: '',
  field_name: 'issueSize',
  source1: 'CHITTORGARH',
  value1: '3000000000',
  source2: 'BSE',
  value2: '2600624600',
  resolution_reason: 'DEFAULT_KEEP_EXISTING',
  document_id: null,
  ...o,
});

const plan = (o: Partial<PlanRow> = {}): PlanRow => ({
  ...ipoCols,
  id: 'p1',
  table_name: 'ipos',
  row_key: '',
  field_name: 'price_range_max',
  state: 'NOT_AVAILABLE_YET',
  reason_code: null,
  ...o,
});

describe('buildQueueItems', () => {
  it('turns plan field names into the editor/camelCase names', () => {
    expect(snakeToCamel('price_range_max')).toBe('priceRangeMax');
    expect(snakeToCamel('issues_3y')).toBe('issues3y');
  });

  it('keeps both populations, shows a NULL reason code as "no reason recorded", links to the editor', () => {
    const items = buildQueueItems([conflict()], [plan(), plan({ id: 'p2', field_name: 'lot_size', reason_code: 'NOT_PUBLISHED_YET' })], []);
    expect(items.map((i) => [i.kind, i.fieldName, i.reason, i.editorHref])).toEqual([
      ['conflict', 'issueSize', 'disagreement', '/ipos/abc-ltd?edit=ipos.issueSize'],
      ['missing', 'priceRangeMax', 'no reason recorded', '/ipos/abc-ltd?edit=ipos.priceRangeMax'],
      ['missing', 'lotSize', 'NOT_PUBLISHED_YET', '/ipos/abc-ltd?edit=ipos.lotSize'],
    ]);
  });

  it('a missing value the admin already holds (value or delete) is handled, not listed', () => {
    const items = buildQueueItems(
      [],
      [plan(), plan({ id: 'p3', table_name: 'peer_companies', row_key: 'xyz', field_name: 'pe_ratio' })],
      [
        { ipo_id: 'i1', table_name: 'ipos', field_name: 'priceRangeMax' },
        { ipo_id: 'i1', table_name: 'peer_companies:xyz', field_name: 'peRatio' },
      ]
    );
    expect(items).toEqual([]);
  });

  it('a hold on another IPO or row does not hide the item', () => {
    const items = buildQueueItems([], [plan()], [{ ipo_id: 'other', table_name: 'ipos', field_name: 'priceRangeMax' }]);
    expect(items.length).toBe(1);
  });

  it('a ruled conflict stays with its rule label (not deleted)', () => {
    const [i] = buildQueueItems([conflict({ source2: 'CHITTORGARH' })], [], []);
    expect(i.ruleFilter).toBe('OD-75');
    expect(i.reason).toMatch(/OD-75/);
  });
});

describe('shapeQueue', () => {
  it('counts the whole queue but pages the view; an IPO view lists its items', () => {
    const items = buildQueueItems([conflict()], [plan()], []);
    const r = shapeQueue(items, { page: 1, pageSize: 1, kind: 'missing' });
    expect(r.counts.total).toBe(2);
    expect(r.totalEntries).toBe(1);
    const byIpo = shapeQueue(items, { page: 1, pageSize: 50, ipo: 'abc-ltd' });
    expect(byIpo.entries.map((e) => (e.type === 'item' ? e.item.kind : 'ipo'))).toEqual(['conflict', 'missing']);
  });
});

describe('AdminQueueService population sources', () => {
  it('merges every source through the one ordering function (a further population plugs in as a source)', async () => {
    const { AdminQueueService } = await import('@/lib/services/admin-queue-service');
    const a = buildQueueItems([conflict()], [], []);
    const b = buildQueueItems([], [plan()], []);
    const svc = new AdminQueueService({} as never, {} as never, [
      { name: 'missing', load: async () => b },
      { name: 'conflict', load: async () => a },
    ]);
    const r = await svc.getQueue({ page: 1, pageSize: 50 });
    expect(r.entries.map((e) => (e.type === 'item' ? e.item.id : 'ipo'))).toEqual(['conflict:c1', 'plan:p1']);
  });
});
