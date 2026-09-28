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
    const svc = new AdminQueueService({ execute: async () => ({ rows: [] }) } as never, {} as never, [
      { name: 'missing', load: async () => b },
      { name: 'conflict', load: async () => a },
    ]);
    const r = shapeQueue(await svc.loadItems(), { page: 1, pageSize: 50 });
    expect(r.entries.map((e) => (e.type === 'item' ? e.item.id : 'ipo'))).toEqual(['conflict:c1', 'plan:p1']);
  });
});

describe('population (c): stored values the shared field check refuses (OD-62 FAILED_VALIDATION, §2.6)', () => {
  it('flags an IPO that has no plan rows at all, with the check message and the stored value', async () => {
    const { flaggedItems } = await import('@/lib/services/admin-queue-service');
    const items = flaggedItems([
      { id: 'i9', slug: 'no-plan-ltd', companyName: 'No Plan Ltd', status: 'LISTED', lotSize: 1, openDate: '2024-01-02', closeDate: null, listingDate: '2024-01-09' },
    ]);
    expect(items.map((i) => [i.kind, i.fieldName, i.reason, i.storedValue])).toEqual([['flagged', 'lotSize', 'FAILED_VALIDATION', '1']]);
    expect(items[0].messages?.[0]).toMatch(/lot_size = 1/);
    expect(items[0].ipo.listingDate).toBe('2024-01-09');
  });

  it('a NOT_AVAILABLE_YET field whose column still holds a value appears ONCE with both reasons (stanbik-like)', async () => {
    const { flaggedItems, mergeFieldItems, missingItems } = await import('@/lib/services/admin-queue-service');
    const b = missingItems([plan({ field_name: 'lot_size', state: 'NOT_AVAILABLE_YET', reason_code: 'NOT_PUBLISHED_YET' })], []);
    const c = flaggedItems([{ id: 'i1', slug: 'abc-ltd', companyName: 'ABC Ltd', status: 'UPCOMING', lotSize: 1, openDate: '2026-10-05' }]);
    const merged = mergeFieldItems([...b, ...c]);
    expect(merged.length).toBe(1);
    expect(merged[0]).toMatchObject({ kind: 'missing', fieldName: 'lotSize', reasons: ['NOT_PUBLISHED_YET', 'FAILED_VALIDATION'], storedValue: '1', planState: 'NOT_AVAILABLE_YET' });
  });

  it('missing is defined by the plan STATE, not a NULL column: a stored value does not remove the item', async () => {
    const { missingItems } = await import('@/lib/services/admin-queue-service');
    const [i] = missingItems([plan({ field_name: 'lot_size', state: 'NOT_AVAILABLE_YET' })], []);
    expect(i.kind).toBe('missing');
    expect(i.planState).toBe('NOT_AVAILABLE_YET');
  });
});

describe('entriesFromRows (A4 review item 1): the IPO comes from the row, never a cache map', () => {
  const dummyDb = { execute: async () => ({ rows: [] }) } as never;
  const dummyRedis = {} as never;

  const pageRow = (o: Partial<import('@/lib/repositories/admin-queue-page-repository').QueuePageRow> = {}) => ({
    entry: 'item' as const,
    ord: 1,
    total: 1,
    id: 'flag:i9:lotSize',
    ipo_id: 'i9',
    table_name: null,
    field_name: 'lotSize',
    row_key: null,
    cat: 'flagged',
    reason_code: null,
    has_flag: false,
    grp: 2,
    slug: 'fresh-ltd',
    company_name: 'Fresh Ltd',
    status: 'UPCOMING',
    open_date: '2026-11-01',
    close_date: '2026-11-05',
    listing_date: null,
    disagreements: null,
    missing: null,
    flagged: null,
    ruled: null,
    ...o,
  });

  it('builds the item and IPO straight from the row when the flagged value IS in the cached setup', async () => {
    const { AdminQueueService } = await import('@/lib/services/admin-queue-service');
    const svc = new AdminQueueService(dummyDb, dummyRedis, []);
    const flaggedByKey = new Map([
      ['i9|lotSize', { ...flaggedItem('lotSize'), ipo: staleIpo() }],
    ]);
    const { entries, flagMiss } = await svc.entriesFromRows([pageRow()], flaggedByKey);
    expect(flagMiss).toBe(false);
    expect(entries).toHaveLength(1);
    const [e] = entries;
    // The item's IPO is the ROW's (live) IPO, not the flagged cache entry's stale one (A4 item 1).
    expect(e.type === 'item' && e.item.ipo).toEqual({
      id: 'i9', slug: 'fresh-ltd', companyName: 'Fresh Ltd', status: 'UPCOMING',
      openDate: '2026-11-01', closeDate: '2026-11-05', listingDate: null,
    });
  });

  it('a row naming a flagged value the cached setup does not carry signals flagMiss instead of dropping it', async () => {
    const { AdminQueueService } = await import('@/lib/services/admin-queue-service');
    const svc = new AdminQueueService(dummyDb, dummyRedis, []);
    const { entries, flagMiss } = await svc.entriesFromRows([pageRow()], new Map());
    expect(flagMiss).toBe(true);
    expect(entries).toHaveLength(0); // nothing to render yet — the caller reloads and retries once
  });

  it('a brand-new IPO row (not in any cache) still yields its "ipo" summary entry, not a silent drop', async () => {
    const { AdminQueueService } = await import('@/lib/services/admin-queue-service');
    const svc = new AdminQueueService(dummyDb, dummyRedis, []);
    const row = pageRow({ entry: 'ipo', id: null, cat: null, field_name: null, grp: 3, disagreements: 0, missing: 0, flagged: 1, ruled: 0 });
    const { entries, flagMiss } = await svc.entriesFromRows([row], new Map());
    expect(flagMiss).toBe(false);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ type: 'ipo', summary: { ipo: { slug: 'fresh-ltd', companyName: 'Fresh Ltd' }, flagged: 1 } });
  });
});

function flaggedItem(fieldName: string) {
  return {
    id: `flag:i9:${fieldName}`,
    kind: 'flagged' as const,
    ipo: staleIpo(),
    tableName: 'ipos',
    fieldName,
    rowKey: '',
    ruleFilter: null,
    reason: 'FAILED_VALIDATION',
    reasons: ['FAILED_VALIDATION'],
    editorHref: '/ipos/fresh-ltd?edit=ipos.lotSize',
  };
}

/** A deliberately STALE ipo (as the cached setup could carry) — the row's own IPO must win instead. */
function staleIpo() {
  return { id: 'i9', slug: 'fresh-ltd', companyName: 'Stale Cached Name Ltd', status: 'UPCOMING', openDate: null, closeDate: null, listingDate: null };
}

describe('population (c) derived rules', () => {
  it('a check on a derived rule (not a column) opens the IPO page, with no stored value', async () => {
    const { flaggedItems } = await import('@/lib/services/admin-queue-service');
    const items = flaggedItems([
      { id: 'i8', slug: 'x-ltd', companyName: 'X Ltd', status: 'UPCOMING', segment: 'MAINBOARD', lotSize: 100, priceRangeMin: 10, priceRangeMax: 10, openDate: '2026-10-05' },
    ]);
    for (const i of items) {
      if (!(i.fieldName in { id: 1, slug: 1, companyName: 1, status: 1, segment: 1, lotSize: 1, priceRangeMin: 1, priceRangeMax: 1, openDate: 1 })) {
        expect(i.editorHref).toBe('/ipos/x-ltd');
        expect(i.storedValue).toBeUndefined();
      }
    }
    expect(items.map((i) => i.fieldName)).toContain('lotEconomics');
  });
});
