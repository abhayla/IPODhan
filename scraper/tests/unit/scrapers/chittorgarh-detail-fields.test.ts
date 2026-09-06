import { describe, it, expect } from 'vitest';
import {
  extractLotSizeFromDetailHtml,
  extractRegistrarFromDetailHtml,
  extractAllotmentDateFromDetailHtml,
  extractIssueSizeFromDetailHtml,
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

describe('extractIssueSizeFromDetailHtml', () => {
  it('extracts a plain ₹ crore figure (anchor layout)', () => {
    const html = `<a title="Issue Size">Issue Size</a></span></td><td><span>₹757.06 Cr</span></td>`;
    expect(
      extractIssueSizeFromDetailHtml(html, { floor: 100_000_000, priceRangeMax: 429 })
    ).toBe(7570600000);
  });

  it('extracts "Rs X Crores" without the anchor wrapper', () => {
    const html = `<td>Total Issue Size</td><td>Rs 91.50 Crores</td>`;
    expect(
      extractIssueSizeFromDetailHtml(html, { floor: 100_000_000, priceRangeMax: 200 })
    ).toBe(915000000);
  });

  it('parses the combined shares+aggregating phrasing and cross-checks against price cap', () => {
    const html = `<a title="Issue Size">Issue Size</a></span></td><td><span>1,76,47,058 shares (aggregating up to ₹757.06 Cr)</span></td>`;
    // 17,647,058 shares * 429 cap = 7,570,587,882 vs 7,570,600,000 -> within 25%
    expect(
      extractIssueSizeFromDetailHtml(html, { floor: 100_000_000, priceRangeMax: 429 })
    ).toBe(7570600000);
  });

  it('returns null when the cross-checked shares figure disagrees with the stated crore total', () => {
    const html = `<a title="Issue Size">Issue Size</a></span></td><td><span>1,76,47,058 shares (aggregating up to ₹757.06 Cr)</span></td>`;
    // price cap of 5000 makes shares*cap wildly exceed the stated total
    expect(
      extractIssueSizeFromDetailHtml(html, { floor: 100_000_000, priceRangeMax: 5000 })
    ).toBeNull();
  });

  it('returns null when the label is absent', () => {
    expect(
      extractIssueSizeFromDetailHtml('<td>Registrar</td><td>Bigshare</td>', {
        floor: 100_000_000,
        priceRangeMax: 100,
      })
    ).toBeNull();
    expect(extractIssueSizeFromDetailHtml('', { floor: 100_000_000, priceRangeMax: 100 })).toBeNull();
  });

  it('returns null for a share-count-only page with no crore total at all', () => {
    const html = `<a title="Issue Size">Issue Size</a></span></td><td><span>1,76,47,058 Shares</span></td>`;
    expect(
      extractIssueSizeFromDetailHtml(html, { floor: 100_000_000, priceRangeMax: 429 })
    ).toBeNull();
  });

  it('rejects an SME figure below the SME segment floor (Rs1 Cr)', () => {
    const html = `<a title="Issue Size">Issue Size</a></span></td><td><span>₹0.50 Cr</span></td>`;
    expect(extractIssueSizeFromDetailHtml(html, { floor: 10_000_000, priceRangeMax: 90 })).toBeNull();
  });

  it('rejects a mainboard figure below the mainboard segment floor (Rs10 Cr)', () => {
    const html = `<a title="Issue Size">Issue Size</a></span></td><td><span>₹5.00 Cr</span></td>`;
    expect(
      extractIssueSizeFromDetailHtml(html, { floor: 100_000_000, priceRangeMax: 90 })
    ).toBeNull();
  });
});
