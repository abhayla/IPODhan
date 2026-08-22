import { describe, it, expect } from 'vitest';
import {
  extractLotSizeFromDetailHtml,
  extractRegistrarFromDetailHtml,
  extractAllotmentDateFromDetailHtml,
} from '../../../src/scrapers/chittorgarh-detail-fields.js';

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

describe('extractRegistrarFromDetailHtml', () => {
  it('extracts the registrar from the registrar-name anchor (real page shape)', () => {
    const html = `<h2>IPO<!-- --> Registrar</h2><p><a title="Kfin Technologies Ltd. IPO Registrar Review" class="registrar-name" href="/report/ipo-registrar-review/114/2/">Kfin Technologies Ltd.</a></p>`;
    expect(extractRegistrarFromDetailHtml(html)).toBe('Kfin Technologies Ltd.');
  });

  it('normalizes internal whitespace', () => {
    const html = `<a class="registrar-name" href="#">Bigshare   Services\n  Pvt Ltd</a>`;
    expect(extractRegistrarFromDetailHtml(html)).toBe('Bigshare Services Pvt Ltd');
  });

  it('fixes the missing-space "Pvt.Ltd." smell', () => {
    const html = `<a class="registrar-name" href="#">Skyline Financial Services Pvt.Ltd.</a>`;
    expect(extractRegistrarFromDetailHtml(html)).toBe('Skyline Financial Services Pvt. Ltd.');
  });

  it('does NOT match the registrar report links (not the value)', () => {
    const html = `<a class="btn-link text-reset" title="Registrar- List of Issues Managed" href="/report/ipo-registrar-review/114/">Registrar- List of Issues Managed</a>`;
    expect(extractRegistrarFromDetailHtml(html)).toBeNull();
  });

  it('rejects placeholders and empty input', () => {
    expect(extractRegistrarFromDetailHtml('<a class="registrar-name" href="#">-</a>')).toBeNull();
    expect(extractRegistrarFromDetailHtml('<a class="registrar-name" href="#">N/A</a>')).toBeNull();
    expect(extractRegistrarFromDetailHtml('')).toBeNull();
  });
});

describe('extractAllotmentDateFromDetailHtml', () => {
  it('extracts the allotment date from the Tentative Allotment timeline entry (real page shape)', () => {
    const html = `<li class="d-flex justify-content-between ms-2"><span data-component="keyword-popup" data-record-id="118"><a title="Tentative Allotment" href="/keyword/tentative-allotment/118/">Allotment</a></span><span class="text-end">Thu, Dec 26, 2024</span></li>`;
    expect(extractAllotmentDateFromDetailHtml(html)).toBe('2024-12-26');
  });

  it('does NOT match the RSC-stream escaped JSON variant (different quoting)', () => {
    const html = `{\\"title\\":\\"Tentative Allotment\\",\\"children\\":\\"Allotment\\"}],[\\"$\\",\\"span\\",null,{\\"className\\":\\"text-end\\",\\"children\\":\\"Thu, Dec 26, 2024\\"}]`;
    expect(extractAllotmentDateFromDetailHtml(html)).toBeNull();
  });

  it('rejects placeholders and empty/unparsable input', () => {
    expect(
      extractAllotmentDateFromDetailHtml(
        '<a title="Tentative Allotment">Allotment</a></span><span class="text-end">TBA</span>'
      )
    ).toBeNull();
    expect(
      extractAllotmentDateFromDetailHtml(
        '<a title="Tentative Allotment">Allotment</a></span><span class="text-end">-</span>'
      )
    ).toBeNull();
    expect(extractAllotmentDateFromDetailHtml('')).toBeNull();
  });
});
