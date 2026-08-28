import { describe, it, expect } from 'vitest';
import * as zlib from 'node:zlib';
import { createHash } from 'node:crypto';
import {
  verifyDownload,
  looksLikeHtml,
  isAcceptableContentType,
  coverNamesCompany,
  sha256Hex,
  MIN_DOCUMENT_BYTES,
  MAX_DOCUMENT_BYTES,
  selectZipMemberForType,
} from '../../../src/services/document-download-verifier.js';

/** A PDF buffer of `bytes` total, starting with the %PDF magic. */
function fakePdf(bytes = MIN_DOCUMENT_BYTES + 1024): Buffer {
  const head = Buffer.from('%PDF-1.7\n');
  return Buffer.concat([head, Buffer.alloc(Math.max(0, bytes - head.length), 0x41)]);
}

/** A single-member STORED zip (method 0) wrapping `content` as `name`. */
function makeZip(name: string, content: Buffer): Buffer {
  const nameBuf = Buffer.from(name, 'latin1');
  const crc = zlib.crc32 ? zlib.crc32(content) : 0;

  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0, 6);
  local.writeUInt16LE(0, 8); // stored
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(content.length, 18);
  local.writeUInt32LE(content.length, 22);
  local.writeUInt16LE(nameBuf.length, 26);
  local.writeUInt16LE(0, 28);

  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0, 10); // stored
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(content.length, 20);
  central.writeUInt32LE(content.length, 24);
  central.writeUInt16LE(nameBuf.length, 28);
  central.writeUInt32LE(0, 42); // local header offset

  const localPart = Buffer.concat([local, nameBuf, content]);
  const centralPart = Buffer.concat([central, nameBuf]);

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(centralPart.length, 12);
  eocd.writeUInt32LE(localPart.length, 16);

  return Buffer.concat([localPart, centralPart, eocd]);
}

const PDF_META = { status: 200, contentType: 'application/pdf', url: 'https://x/doc.pdf' };
const ZIP_META = { status: 200, contentType: 'application/zip', url: 'https://x/doc.zip' };

describe('verifyDownload — matrix §3', () => {
  it('T26 REJECTS the BSE "Object Moved" HTML body even at HTTP 200', () => {
    // Captured verbatim from listing.bseindia.com on a wrong URL, 2026-08-28.
    // With redirects followed this arrives as 200 text/html — status proves nothing.
    const body = Buffer.from(
      '<head><title>Document Moved</title></head>\n' +
        '<body><h1>Object Moved</h1>This document may be found ' +
        '<a HREF="https://listing.bseindia.com/notfound.htm">here</a></body>'
    );
    const result = verifyDownload(body, {
      status: 200,
      contentType: 'text/html; charset=UTF-8',
      url: 'https://listing.bseindia.com/Download//PreAnchor/RHPSkywaysNOPE.pdf',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('html_body');
      expect(result.detail).toContain('HTML page');
    }
  });

  it('T26b reports an HTML body as html_body, not as too_small', () => {
    // The BSE error page is 164 bytes; without the HTML check first the reason
    // recorded on the state row would be a misleading "too_small".
    const result = verifyDownload(Buffer.from('<html><body>nope</body></html>'), PDF_META);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('html_body');
  });

  it('T27 REJECTS a wrong or absent content-type', () => {
    for (const contentType of ['text/html', 'application/json', null, undefined, '']) {
      const r = verifyDownload(fakePdf(), { status: 200, contentType, url: 'https://x/a.pdf' });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(['wrong_content_type', 'html_body']).toContain(r.reason);
    }
  });

  it('T28 REJECTS a body under the 50 KB floor', () => {
    const r = verifyDownload(fakePdf(1024), PDF_META);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('too_small');
  });

  it('T28b REJECTS a non-2xx status', () => {
    const r = verifyDownload(fakePdf(), { ...PDF_META, status: 404 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('http_error');
  });

  it('T29 REJECTS a zip containing no PDF member', () => {
    const zip = makeZip('readme.txt', Buffer.alloc(MIN_DOCUMENT_BYTES + 1024, 0x42));
    const r = verifyDownload(zip, ZIP_META);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('zip_without_pdf');
  });

  it('T30 ACCEPTS a zip whose member is a PDF, and returns the unwrapped PDF', () => {
    const pdf = fakePdf();
    const r = verifyDownload(makeZip('RHP_SKYWAYS.pdf', pdf), ZIP_META);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.wasZip).toBe(true);
      expect(r.pdf.subarray(0, 4).toString()).toBe('%PDF');
      // The hash identifies the PDF, not the zip wrapper — so the same document
      // fetched as a zip from NSE and as a bare PDF from BSE dedups to one row.
      expect(r.sha256).toBe(sha256Hex(pdf));
    }
  });

  it('T30b ACCEPTS a bare PDF', () => {
    const r = verifyDownload(fakePdf(), PDF_META);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.wasZip).toBe(false);
  });

  it('T30c REJECTS bytes that are neither zip nor PDF', () => {
    const r = verifyDownload(Buffer.alloc(MIN_DOCUMENT_BYTES + 10, 0x00), PDF_META);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('not_a_pdf');
  });

  it('T31 gives the SAME sha256 for the same document from two sources (E7/R2)', () => {
    const pdf = fakePdf();
    const fromBse = verifyDownload(pdf, PDF_META);
    const fromNse = verifyDownload(makeZip('RHP.pdf', pdf), ZIP_META);
    expect(fromBse.ok && fromNse.ok).toBe(true);
    if (fromBse.ok && fromNse.ok) {
      expect(fromBse.sha256).toBe(fromNse.sha256);
      expect(fromBse.sha256).toBe(createHash('sha256').update(pdf).digest('hex'));
    }
  });

  it('T32 REJECTS a PDF whose cover names a different company (F8)', () => {
    const r = verifyDownload(fakePdf(), PDF_META, {
      expectedCompanyName: 'Skyways Air Services Limited',
      extractCoverText: () => 'RED HERRING PROSPECTUS\nMadhur Knit Crafts Limited\nDated 11 August 2026',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('wrong_company');
  });

  it('T32b ACCEPTS a cover whose tokens match despite legal-suffix variance', () => {
    const r = verifyDownload(fakePdf(), PDF_META, {
      expectedCompanyName: 'Skyways Air Services Ltd.',
      extractCoverText: () => 'RED HERRING PROSPECTUS\nSKYWAYS AIR SERVICES LIMITED\nDated 11 August 2026',
    });
    expect(r.ok).toBe(true);
  });

  it('T32c SKIPS the cover check when there is no text layer (scanned PDF, E4)', () => {
    // A scanned cover yields no text. Rejecting there would drop legitimate SME
    // price-band ads; the OCR path (WP C) handles those.
    const r = verifyDownload(fakePdf(), PDF_META, {
      expectedCompanyName: 'Skyways Air Services Limited',
      extractCoverText: () => '',
    });
    expect(r.ok).toBe(true);
  });

  it('T33 REFUSES a body over the 150 MB cap (F20, zip bomb)', () => {
    // The production cap is 150 MB; the check is exercised through the injectable
    // override so the test does not have to allocate 150 MB of real memory.
    expect(MAX_DOCUMENT_BYTES).toBe(150 * 1024 * 1024);
    const r = verifyDownload(fakePdf(100_000), PDF_META, { maxBytes: 60_000 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('too_large');
  });
});

describe('verifier predicates', () => {
  it('looksLikeHtml recognises the shapes an error page arrives in', () => {
    expect(looksLikeHtml(Buffer.from('<!DOCTYPE html><html>'))).toBe(true);
    expect(looksLikeHtml(Buffer.from('  \n<html>'))).toBe(true);
    expect(looksLikeHtml(Buffer.from('<head><title>Document Moved</title></head>'))).toBe(true);
    expect(looksLikeHtml(fakePdf())).toBe(false);
    expect(looksLikeHtml(Buffer.alloc(0))).toBe(false);
  });

  it('isAcceptableContentType allows pdf/zip/octet-stream and refuses html', () => {
    expect(isAcceptableContentType('application/pdf')).toBe(true);
    expect(isAcceptableContentType('application/zip')).toBe(true);
    expect(isAcceptableContentType('application/octet-stream')).toBe(true);
    expect(isAcceptableContentType('text/html; charset=UTF-8')).toBe(false);
    expect(isAcceptableContentType(null)).toBe(false);
  });

  it('coverNamesCompany refuses to judge when the name has no significant tokens', () => {
    // "The India Company" is all stop-words; a false reject would drop a good file.
    expect(coverNamesCompany('anything at all', 'The India Company Limited')).toBe(true);
  });
});

/** A STORED zip with several named members, mirroring NSE's real archives. */
function makeMultiZip(entries: { name: string; content: Buffer }[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const { name, content } of entries) {
    const nameBuf = Buffer.from(name, 'latin1');
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 8);
    local.writeUInt32LE(content.length, 18);
    local.writeUInt32LE(content.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    const localPart = Buffer.concat([local, nameBuf, content]);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 10);
    central.writeUInt32LE(content.length, 20);
    central.writeUInt32LE(content.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(Buffer.concat([central, nameBuf]));

    locals.push(localPart);
    offset += localPart.length;
  }
  const localAll = Buffer.concat(locals);
  const centralAll = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralAll.length, 12);
  eocd.writeUInt32LE(localAll.length, 16);
  return Buffer.concat([localAll, centralAll, eocd]);
}

describe('multi-member zips — the wrong-document defect the acceptance run caught', () => {
  // The REAL shape of NSE's RHP_SKYWAYS.zip, captured live 2026-08-28: three
  // PDFs, and the one we actually want is LAST and by far the largest.
  const corrigendum = { name: 'RHP_SKYWAYS/CorrigendumofRHPSkyways.pdf', content: fakePdf(60_000) };
  const gid = { name: 'RHP_SKYWAYS/GID_Skyways.pdf', content: fakePdf(80_000) };
  const rhp = { name: 'RHP_SKYWAYS/RHP Skyways.pdf', content: fakePdf(400_000) };
  const skywaysZip = () => makeMultiZip([corrigendum, gid, rhp]);

  it('T34 picks the RHP by member NAME, not the first member', () => {
    const r = verifyDownload(skywaysZip(), ZIP_META, { wantedType: 'RHP' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.zipMember).toBe('RHP_SKYWAYS/RHP Skyways.pdf');
      expect(r.sha256).toBe(sha256Hex(rhp.content));
      // The exact bug: the first member is the corrigendum.
      expect(r.sha256).not.toBe(sha256Hex(corrigendum.content));
    }
  });

  it('T34b picks the CORRIGENDUM out of the same archive when that is what was asked for', () => {
    const r = verifyDownload(skywaysZip(), ZIP_META, { wantedType: 'CORRIGENDUM' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.zipMember).toBe('RHP_SKYWAYS/CorrigendumofRHPSkyways.pdf');
  });

  it('T34c falls back to the LARGEST member when no name matches the wanted type', () => {
    // A prospectus-class filing dwarfs the covering letters shipped beside it,
    // so 'biggest' is a better guess than 'whichever came first'.
    const chosen = selectZipMemberForType(
      [
        { name: 'cover.pdf', content: fakePdf(60_000) },
        { name: 'main.pdf', content: fakePdf(400_000) },
      ],
      'RHP'
    );
    expect(chosen!.name).toBe('main.pdf');
  });

  it('T34d needs no choosing for a single-member zip, and reports its name', () => {
    const r = verifyDownload(makeMultiZip([rhp]), ZIP_META, { wantedType: 'RHP' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.zipMember).toBe('RHP_SKYWAYS/RHP Skyways.pdf');
    expect(selectZipMemberForType([], 'RHP')).toBeNull();
  });

  it('T34e two different types NEVER resolve to the same bytes from one archive', () => {
    // The signal that exposed the bug: distinct document types coming out with
    // an identical sha256.
    const asRhp = verifyDownload(skywaysZip(), ZIP_META, { wantedType: 'RHP' });
    const asCorr = verifyDownload(skywaysZip(), ZIP_META, { wantedType: 'CORRIGENDUM' });
    expect(asRhp.ok && asCorr.ok).toBe(true);
    if (asRhp.ok && asCorr.ok) expect(asRhp.sha256).not.toBe(asCorr.sha256);
  });
});
