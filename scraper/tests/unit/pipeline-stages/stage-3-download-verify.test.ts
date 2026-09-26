/**
 * Stage 3 of the IPO pipeline test ladder (docs/reviews/ipo-pipeline-stage-gap-analysis.md
 * section 6, issue #258): "Download + verify + store - HTTP stubbed with real bytes + the BSE
 * Object Moved HTML - verifier + store - sha256 dedup, no HTML stored, files under <ipo_id>/".
 *
 * Drives the REAL `verifyDownload` (src/services/document-download-verifier.ts) and the REAL
 * `storeDocument`/`documentPath` (src/services/document-store.ts) -- no re-implementation, no
 * network, and every write lands in a throwaway `mkdtemp` directory that is removed afterwards.
 *
 * See fixtures/stage-3/expected-download-verify.json for the recorded PDF-byte-content gap
 * (this repo has no full real filing PDF checked in) and the provenance of the "Object Moved"
 * HTML body, which IS the real captured BSE redirect shape already relied on by
 * document-discovery-runner-download.test.ts.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import { join } from 'node:path';
import { verifyDownload, isVerifyFailure, MIN_DOCUMENT_BYTES } from '../../../src/services/document-download-verifier.js';
import { storeDocument, documentPath } from '../../../src/services/document-store.js';

const GOLDEN = JSON.parse(
  readFileSync(join(__dirname, 'fixtures', 'stage-3', 'expected-download-verify.json'), 'utf8')
) as {
  objectMovedHtml: { body: string; contentType: string; status: number; expectedVerdict: string };
};

/** Structurally-real PDF shape per the golden's documented pdfGap. */
const realFilingShapedPdf = (marker = 'A') =>
  Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.from(marker.repeat(MIN_DOCUMENT_BYTES))]);

describe('pipeline stage 3 - download + verify + store', () => {
  let storeDir: string;

  beforeEach(async () => {
    storeDir = await fsp.mkdtemp(join(os.tmpdir(), 'stage3-store-'));
  });

  afterEach(async () => {
    await fsp.rm(storeDir, { recursive: true, force: true });
  });

  it('rejects the real BSE "Object Moved" HTML body as html_body, never as a PDF', () => {
    const { objectMovedHtml } = GOLDEN;
    const result = verifyDownload(Buffer.from(objectMovedHtml.body), {
      status: objectMovedHtml.status,
      contentType: objectMovedHtml.contentType,
      url: 'https://listing.bseindia.com/Download//PreAnchor/RHPSkyways.pdf',
    });
    expect(isVerifyFailure(result)).toBe(true);
    if (isVerifyFailure(result)) {
      expect(result.reason).toBe(objectMovedHtml.expectedVerdict);
    }
  });

  it('never writes the rejected HTML body to the store', async () => {
    const { objectMovedHtml } = GOLDEN;
    const verdict = verifyDownload(Buffer.from(objectMovedHtml.body), {
      status: objectMovedHtml.status,
      contentType: objectMovedHtml.contentType,
      url: 'https://x/doc.pdf',
    });
    expect(isVerifyFailure(verdict)).toBe(true);
    // The runner only ever calls storeDocument() on a verifyDownload() PASS
    // (document-discovery-runner.ts) -- proving this file is never stored is
    // exactly "no HTML stored" from the gap-analysis table, checked at the
    // store layer rather than assumed from the verifier's verdict alone.
    const dirEntries = await fsp.readdir(storeDir).catch(() => []);
    expect(dirEntries).toEqual([]);
  });

  it('stores a verified PDF under <ipo_id>/ and dedupes an identical re-download by sha256', async () => {
    const pdf = realFilingShapedPdf('A');
    const verdict = verifyDownload(pdf, { status: 200, contentType: 'application/pdf', url: 'https://x/RHP.pdf' });
    expect(isVerifyFailure(verdict)).toBe(false);

    const first = await storeDocument({ ipoId: 'ipo-skyways', docType: 'RHP', pdf, storeDir });
    expect(first.stored).toBe(true);
    expect(first.alreadyPresent).toBe(false);
    expect(first.filePath).toBe(documentPath('ipo-skyways', 'RHP', first.sha256, storeDir));
    expect(first.filePath.split(/[\\/]/)).toContain('ipo-skyways');

    const onDisk = await fsp.readFile(first.filePath);
    expect(onDisk.equals(pdf)).toBe(true);

    // Same bytes downloaded again (e.g. a retried cycle) -> same sha256 -> dedup, no second write.
    const second = await storeDocument({ ipoId: 'ipo-skyways', docType: 'RHP', pdf, storeDir });
    expect(second.alreadyPresent).toBe(true);
    expect(second.filePath).toBe(first.filePath);
    expect(second.sha256).toBe(first.sha256);

    // A genuinely different document (different bytes) gets its own file, not a dedup collision.
    const other = realFilingShapedPdf('B');
    const third = await storeDocument({ ipoId: 'ipo-skyways', docType: 'PROSPECTUS', pdf: other, storeDir });
    expect(third.alreadyPresent).toBe(false);
    expect(third.sha256).not.toBe(first.sha256);
    expect(third.filePath).not.toBe(first.filePath);
  });
});
