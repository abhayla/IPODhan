/**
 * OD-136 order of the admin queue, asserted as EXACT sequences (spec §9.4, OD-63, OD-136).
 * Mutation-checked: swapping the group-1/group-2 rule, the live/listed rule, the within-IPO kind
 * order or the listed newest-first order each turns a case here red.
 */
import { describe, it, expect } from 'vitest';
import {
  orderQueue,
  orderIpoItems,
  countQueue,
  applyView,
  paginate,
  editorHref,
  groupOf,
  NO_REASON_RECORDED,
  type QueueIpo,
  type QueueItem,
  type QueueEntry,
} from '@/lib/admin/queue/queue-order';

const ipo = (slug: string, status: string, d: Partial<QueueIpo> = {}): QueueIpo => ({
  id: `id-${slug}`,
  slug,
  companyName: slug,
  status,
  openDate: null,
  closeDate: null,
  listingDate: null,
  ...d,
});

let n = 0;
const item = (i: QueueIpo, fieldName: string, kind: 'conflict' | 'missing', o: Partial<QueueItem> = {}): QueueItem => withReasons({
  id: `x${String(++n).padStart(3, '0')}`,
  kind,
  ipo: i,
  tableName: 'ipos',
  fieldName,
  rowKey: '',
  ruleFilter: null,
  reason: kind === 'missing' ? NO_REASON_RECORDED : 'disagreement',
  editorHref: editorHref(i.slug, 'ipos', fieldName, ''),
  ...o,
});

function withReasons(x: Omit<QueueItem, 'reasons'> & { reasons?: string[] }): QueueItem {
  return { ...x, reasons: x.reasons ?? [x.reason] };
}

const label = (e: QueueEntry) =>
  e.type === 'item' ? `${e.group}:${e.item.ipo.slug}:${e.item.kind}:${e.item.fieldName}` : `3:${e.summary.ipo.slug}`;

describe('admin queue order (OD-136)', () => {
  const upcoming = ipo('upc', 'UPCOMING', { openDate: '2026-10-05' });
  const open = ipo('opn', 'OPEN', { openDate: '2026-09-26', closeDate: '2026-09-30' });
  const closed = ipo('cls', 'CLOSED', { closeDate: '2026-09-25', listingDate: '2026-10-01' });
  const listedOld = ipo('old', 'LISTED', { listingDate: '2025-01-10' });
  const listedNew = ipo('new', 'LISTED', { listingDate: '2026-09-20' });
  const withdrawn = ipo('wdn', 'WITHDRAWN');

  const items = [
    item(listedOld, 'issueSize', 'conflict'),
    item(upcoming, 'companyEmail', 'missing', { tableName: 'ipo_details' }), // ipo_details.companyEmail is shown (CompanyContactSection)
    item(upcoming, 'priceRangeMax', 'missing', { reason: 'NOT_PUBLISHED_YET' }),
    item(upcoming, 'issueSize', 'conflict'),
    item(open, 'lotSize', 'missing'),
    item(open, 'faceValue', 'conflict', { ruleFilter: 'OD-75', reason: 'ruled' }),
    item(open, 'companyWebsite', 'missing'),
    item(closed, 'listingDate', 'missing'),
    item(listedNew, 'symbol', 'missing'),
    item(withdrawn, 'isin', 'missing'),
    item(listedNew, 'cin', 'conflict', { ruleFilter: 'OD-60', reason: 'ruled' }),
  ];

  it('orders group 1 (live, shown fields), then group 2 (live, other fields), then group 3 collapsed newest listing first', () => {
    expect(orderQueue(items).map(label)).toEqual([
      // live IPOs by nearest date: OPEN closes 09-30, CLOSED lists 10-01, UPCOMING opens 10-05
      '1:opn:missing:lotSize',
      '1:opn:conflict:faceValue', // ruled off the disagreement list: after missing, still shown
      '1:cls:missing:listingDate',
      '1:upc:conflict:issueSize', // disagreement before missing
      '1:upc:missing:companyEmail',
      '1:upc:missing:priceRangeMax',
      '2:opn:missing:companyWebsite', // ipos.companyWebsite is not rendered by the public page
      '3:new',
      '3:old',
      '3:wdn', // no listing date: last
    ]);
  });

  it('shows every item exactly once (nothing hidden): group-3 lines count their IPO items', () => {
    const entries = orderQueue(items);
    const inline = entries.filter((e) => e.type === 'item').length;
    const collapsed = entries
      .filter((e) => e.type === 'ipo')
      .reduce((s, e) => s + (e.type === 'ipo' ? e.summary.conflicts + e.summary.missing + e.summary.ruled : 0), 0);
    expect(inline + collapsed).toBe(items.length);
    const newLine = entries.find((e) => e.type === 'ipo' && e.summary.ipo.slug === 'new');
    expect(newLine && newLine.type === 'ipo' ? newLine.summary : null).toMatchObject({ conflicts: 0, missing: 1, ruled: 1 });
  });

  it('expands one listed IPO item by item: disagreement, missing, ruled, then field name', () => {
    const l = ipo('lst', 'LISTED', { listingDate: '2026-01-01' });
    const got = orderIpoItems([
      item(l, 'zeta', 'conflict', { ruleFilter: 'OD-59', reason: 'r' }),
      item(l, 'beta', 'missing'),
      item(l, 'alpha', 'missing'),
      item(l, 'omega', 'conflict'),
    ]).map((i) => `${i.kind}:${i.fieldName}`);
    expect(got).toEqual(['conflict:omega', 'missing:alpha', 'missing:beta', 'conflict:zeta']);
  });

  it('assigns groups by status and public-page field', () => {
    expect(groupOf(item(upcoming, 'priceRangeMin', 'missing'))).toBe(1);
    expect(groupOf(item(closed, 'companyWebsite', 'missing'))).toBe(2);
    expect(groupOf(item(listedNew, 'priceRangeMin', 'missing'))).toBe(3);
    expect(groupOf(item(ipo('dl', 'DELISTED'), 'priceRangeMin', 'missing'))).toBe(3);
  });

  it('counts per group and per reason over the whole queue', () => {
    const c = countQueue(items);
    expect(c.total).toBe(11);
    expect(c.byGroup).toEqual({ 1: { items: 6, ipos: 3 }, 2: { items: 1, ipos: 1 }, 3: { items: 4, ipos: 3 } });
    expect(c.byKind).toEqual({ disagreement: 2, missing: 7, flagged: 0, ruled: 2 });
    expect(c.byReason[NO_REASON_RECORDED]).toBe(6);
    expect(c.byReason.NOT_PUBLISHED_YET).toBe(1);
  });

  it('view filters narrow the list only', () => {
    expect(applyView(items, {}).length).toBe(items.length);
    expect(applyView(items, { group: 2 }).map((i) => i.fieldName)).toEqual(['companyWebsite']);
    expect(applyView(items, { kind: 'ruled' }).map((i) => i.fieldName)).toEqual(['faceValue', 'cin']);
    expect(applyView(items, { reason: 'NOT_PUBLISHED_YET' }).map((i) => i.fieldName)).toEqual(['priceRangeMax']);
    expect(applyView(items, { ipo: 'old' }).map((i) => i.fieldName)).toEqual(['issueSize']);
  });

  it('paginates server-side and clamps the page', () => {
    const e = Array.from({ length: 101 }, (_, i) => i);
    expect(paginate(e, 3, 50)).toMatchObject({ entries: [100], page: 3, totalPages: 3, totalEntries: 101 });
    expect(paginate(e, 99, 50).page).toBe(3);
    expect(paginate([], 1, 50)).toMatchObject({ entries: [], page: 1, totalPages: 1 });
  });

  it('links straight to the field in the IPO-page editor (+ row for row tables)', () => {
    expect(editorHref('abc-ltd', 'ipos', 'priceRangeMax', '')).toBe('/ipos/abc-ltd?edit=ipos.priceRangeMax');
    expect(editorHref('abc-ltd', 'peer_companies', 'peRatio', 'xyz ltd')).toBe(
      '/ipos/abc-ltd?edit=peer_companies.peRatio&row=xyz%20ltd'
    );
  });
});
