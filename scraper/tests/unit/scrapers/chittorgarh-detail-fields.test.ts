import { describe, it, expect } from 'vitest';
import { extractLotSizeFromDetailHtml } from '../../../src/scrapers/chittorgarh-detail-fields.js';

describe('extractLotSizeFromDetailHtml', () => {
  it('extracts lot size from the keyword-popup anchor layout (real SME page shape)', () => {
    const html = `<span data-component="keyword-popup" data-record-id="1"><a title="Lot Size" href="/keyword/lot-size/213/">Lot Size</a></span></td><td class="text-end"><span class="text-end">400 Shares</span></td>`;
    expect(extractLotSizeFromDetailHtml(html)).toBe(400);
  });

  it('extracts a comma-formatted lot size', () => {
    const html = `<a title="Lot Size">Lot Size</a></span></td><td><span>1,200 Shares</span></td>`;
    expect(extractLotSizeFromDetailHtml(html)).toBe(1200);
  });

  it('extracts a mainboard lot without the anchor wrapper', () => {
    const html = `<td>Lot Size</td><td>15 Shares</td>`;
    expect(extractLotSizeFromDetailHtml(html)).toBe(15);
  });

  it('rejects a placeholder lot of 1', () => {
    const html = `<a title="Lot Size">Lot Size</a></span></td><td><span>1 Shares</span></td>`;
    expect(extractLotSizeFromDetailHtml(html)).toBeNull();
  });

  it('rejects an absurd lot value (plausibility gate)', () => {
    const html = `<a title="Lot Size">Lot Size</a></span></td><td><span>9999999 Shares</span></td>`;
    expect(extractLotSizeFromDetailHtml(html)).toBeNull();
  });

  it('returns null when the page has no lot size', () => {
    expect(extractLotSizeFromDetailHtml('<td>Registrar</td><td>Bigshare</td>')).toBeNull();
    expect(extractLotSizeFromDetailHtml('')).toBeNull();
  });
});
