// implements: R-160
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import { join } from 'node:path';
import {
  DocumentDiscoveryRunner,
  zipMemberUrl,
  type DiscoveryIpo,
  type DocumentSinkInput,
  type HttpFetcher,
  type HttpResponse,
} from '../../../src/services/document-discovery-runner.js';
import { InMemoryDocumentFetchStateStore } from '../../../src/services/in-memory-document-fetch-state-store.js';
import { NetworkCounter } from '../../../src/utils/network-counter.js';
import {
  classifyZipMemberName,
  isGidMemberName,
  verifyDownload,
  MIN_DOCUMENT_BYTES,
} from '../../../src/services/document-download-verifier.js';

/**
 * Item 22 (OD-36, F-154; failure class container-unwrapped-to-one-member).
 *
 * 41 of 41 NSE offer-document zips on staging hold two or more PDFs. The unwrap
 * kept ONE member and dropped the rest, so the corrigenda and price-band notices
 * shipped inside RHP_HTEL, RHP_ABH, RHP_MADHURKNIT, RHP_MOMSBELIEF and
 * RHP_SKYWAYS never became documents. These tests drive the REAL runner path
 * (verifyDownload -> tryStoreCandidate -> upsertDocument) with a zip built from
 * REAL member names measured in F-154 and the item 22 core proof.
 *
 * The PDF bodies are synthetic `%PDF` buffers above the 50 KB floor: the repo has
 * no small real PDF fixture, and the behaviour under test is decided by member
 * NAME, position and size, never by page content.
 */

const FIXTURES = join(__dirname, '../../fixtures/documents');
const fixture = (name: string) => readFileSync(join(FIXTURES, name), 'utf8');
const json = (text: string): HttpResponse => ({
  status: 200,
  contentType: 'application/json',
  body: Buffer.from(text),
  url: 'https://fixture',
});
const pdf = (marker: string, size = 80_000) =>
  Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.from(marker.repeat(size))]);

/** A STORED zip with several named members, central-directory order = input order. */
function makeMultiZip(entries: { name: string; content: Buffer }[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const { name, content } of entries) {
    const nameBuf = Buffer.from(name, 'latin1');
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(content.length, 18);
    local.writeUInt32LE(content.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    const localPart = Buffer.concat([local, nameBuf, content]);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 6);
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

// Real member names (F-154 sample + RHP_HTEL, captured 2026-09-24).
const MEMBERS = [
  { name: 'RHP_MOMSBELIEF/Rays of Belief_Corrigendum.pdf', content: pdf('C') },
  { name: 'RHP_HTEL/Corrigendum/BS Mumbai 20-08-2026-8.pdf', content: pdf('B') },
  { name: 'RHP_HTEL/GID.pdf', content: pdf('G') },
  { name: 'RHP_MOMSBELIEF/Rays of Belief Limited_RHP.pdf', content: pdf('R', 200_000) },
  { name: 'RHP_MOMSBELIEF/Annexure.pdf', content: pdf('U') },
];

const ZIP_URL = 'https://nsearchives.nseindia.com/content/ipo/RHP_SKYWAYS.zip';

const SKYWAYS: DiscoveryIpo = {
  id: 'ipo-skyways',
  companyName: 'Skyways Air Services Ltd.',
  symbol: 'SKYWAYS',
  segment: 'MAINBOARD',
  stage: 'PRE_OPEN',
  bseIpoNo: 7903,
};

/** Every PRE_OPEN type already FOUND except the RHP, so the RHP is the only due type. */
const EXISTING = ['DRHP', 'PRICE_BAND_AD', 'CORRIGENDUM', 'RATIOS_BASIS_ISSUE_PRICE', 'ANCHOR_ALLOCATION_REPORT'].map(
  (docType) => ({
    docType,
    state: 'FOUND' as const,
    attempts: 1,
    nextRetryAt: null,
    blockedSinceAt: null,
    filingDate: null,
    extractorVersion: null,
    lastAttemptAt: null,
  })
);

/** Mirrors DocumentRepository.upsertDocument's contract: one row per URL. */
function urlKeyedSink() {
  const byUrl = new Map<string, DocumentSinkInput & { id: string }>();
  let inserts = 0;
  return {
    byUrl,
    inserts: () => inserts,
    async upsertDocument(doc: DocumentSinkInput) {
      const hit = byUrl.get(doc.url);
      if (hit) return { id: hit.id };
      inserts += 1;
      const row = { ...doc, id: `doc-${inserts}` };
      byUrl.set(doc.url, row);
      return { id: row.id };
    },
  };
}

let storeDir: string;
beforeEach(async () => {
  storeDir = await fsp.mkdtemp(join(os.tmpdir(), 'item22-zip-'));
});
afterEach(async () => {
  await fsp.rm(storeDir, { recursive: true, force: true });
});

function makeRunner(zip: Buffer, documents: ReturnType<typeof urlKeyedSink>) {
  const fetcher: HttpFetcher = async (url) => {
    if (url.includes('listing.bseindia.com')) {
      return { status: 200, contentType: 'text/html', body: Buffer.from('<html><h1>Object Moved</h1></html>'), url };
    }
    if (url.includes('RHP_SKYWAYS.zip')) return { status: 200, contentType: 'application/zip', body: zip, url: ZIP_URL };
    if (url.includes('GetMkt_ISSUE_BBS_IPO')) return json(fixture('bse-skyways-core.json'));
    if (url.includes('symbol=SKYWAYS')) return json(fixture('nse-skyways.json'));
    return { status: 404, contentType: 'text/html', body: Buffer.from('x'), url };
  };
  return new DocumentDiscoveryRunner({
    fetcher,
    store: new InMemoryDocumentFetchStateStore(),
    documents,
    counter: new NetworkCounter(),
    now: () => new Date('2026-08-28T06:00:00Z'),
    storeDir,
    extractCoverText: async () => ({ usable: true, text: 'SKYWAYS AIR SERVICES LIMITED' }),
  });
}

describe('zip member names (real, F-154)', () => {
  it('recognises every real GID name, and no offer document as a GID', () => {
    for (const n of [
      'GID.pdf',
      'German Green Steel_GID.pdf',
      'RHP_DEEPA/Deepa Jewellers_GID.pdf',
      'RHP_VARMORA/VARMORA GRANITO LIMITED - GID- 16-09-2026.pdf',
      'RHP_SKYWAYS/GID_Skyways.pdf',
    ]) {
      expect(isGidMemberName(n)).toBe(true);
    }
    for (const n of ['RHP_AUGMONT/Augmont Enterprises Ltd_RHP.pdf', 'SteamhouseRHP.pdf', 'RHP_HTEL/Corrigendum/BS Mumbai 20-08-2026-8.pdf']) {
      expect(isGidMemberName(n)).toBe(false);
    }
  });

  it('types a newspaper page by its Corrigendum/ folder, but never by the archive folder', () => {
    expect(classifyZipMemberName('RHP_HTEL/Corrigendum/BS Mumbai 20-08-2026-8.pdf')).toEqual({
      type: 'CORRIGENDUM',
      typedBy: 'folder',
    });
    // 'RHP_X/' is the archive's own folder: it must not type an unnamed member as the RHP.
    expect(classifyZipMemberName('RHP_MOMSBELIEF/Annexure.pdf')).toBeNull();
    expect(classifyZipMemberName('RHP_MOMSBELIEF/Rays of Belief_Corrigendum.pdf')).toEqual({
      type: 'CORRIGENDUM',
      typedBy: 'name',
    });
  });

  it('re-applies the size floor per member', () => {
    const zip = makeMultiZip([
      { name: 'RHP_X/X_RHP.pdf', content: pdf('R') },
      { name: 'RHP_X/X_Corrigendum.pdf', content: pdf('c', 100) },
    ]);
    const v = verifyDownload(zip, { status: 200, contentType: 'application/zip', url: ZIP_URL }, { wantedType: 'RHP' });
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.otherZipMembers).toHaveLength(1);
    expect(v.otherZipMembers![0].disposition).toBe('too_small');
    expect(v.otherZipMembers![0].bytes).toBeLessThan(MIN_DOCUMENT_BYTES);
  });
});

describe('the runner stores each non-GID zip member as its own typed document (item 22)', () => {
  it('writes exactly the RHP (part 4) and two CORRIGENDUM rows (parts 1, 2); the GID and the unnamed member write nothing', async () => {
    const sink = urlKeyedSink();
    const result = await makeRunner(makeMultiZip(MEMBERS), sink).runIpo(SKYWAYS, EXISTING as never);

    expect(result.found).toEqual(['RHP']);
    const rows = [...sink.byUrl.values()]
      .filter((r) => r.url.startsWith(ZIP_URL))
      .map((r) => ({ type: r.type, url: r.url, partNumber: r.partNumber, exchange: r.exchange }))
      .sort((a, b) => a.partNumber! - b.partNumber!);

    expect(rows).toEqual([
      { type: 'CORRIGENDUM', url: zipMemberUrl(ZIP_URL, 1), partNumber: 1, exchange: 'NSE' },
      { type: 'CORRIGENDUM', url: zipMemberUrl(ZIP_URL, 2), partNumber: 2, exchange: 'NSE' },
      { type: 'RHP', url: ZIP_URL, partNumber: 4, exchange: 'NSE' },
    ]);
    // No row for the GID (part 3) or the unclassified member (part 5).
    expect(rows.some((r) => r.partNumber === 3 || r.partNumber === 5)).toBe(false);

    const outcomes = result.attempts.map((a) => String(a.outcome));
    expect(outcomes.filter((o) => o.startsWith('zip_member_skipped:gid (member:RHP_HTEL/GID.pdf; part:3'))).toHaveLength(1);
    expect(outcomes.filter((o) => o.startsWith('zip_member_skipped:unclassified (member:RHP_MOMSBELIEF/Annexure.pdf; part:5'))).toHaveLength(1);
    expect(outcomes.filter((o) => o.startsWith('zip_member_stored_as:CORRIGENDUM'))).toHaveLength(2);
  }, 60_000);

  it('is idempotent: a second run over the same zip inserts 0 new rows', async () => {
    const sink = urlKeyedSink();
    await makeRunner(makeMultiZip(MEMBERS), sink).runIpo(SKYWAYS, EXISTING as never);
    const afterFirst = sink.inserts();
    expect(afterFirst).toBe(3);
    await makeRunner(makeMultiZip(MEMBERS), sink).runIpo(SKYWAYS, EXISTING as never);
    expect(sink.inserts() - afterFirst).toBe(0);
  }, 60_000);

  it('does not store a member twice when two members carry the same bytes (OD-33)', async () => {
    const same = pdf('S');
    const sink = urlKeyedSink();
    const zip = makeMultiZip([
      { name: 'RHP_X/X_Corrigendum.pdf', content: same },
      { name: 'RHP_X/Corrigendum/page.pdf', content: same },
      { name: 'RHP_X/X_RHP.pdf', content: pdf('R', 200_000) },
    ]);
    const result = await makeRunner(zip, sink).runIpo(SKYWAYS, EXISTING as never);
    expect([...sink.byUrl.values()].filter((r) => r.type === 'CORRIGENDUM')).toHaveLength(1);
    expect(result.attempts.some((a) => String(a.outcome).startsWith('zip_member_deduped_by_sha256_to:CORRIGENDUM'))).toBe(true);
  }, 60_000);

  it('regression: a one-member zip writes one row, with part_number unset, exactly as before', async () => {
    const sink = urlKeyedSink();
    const zip = makeMultiZip([{ name: 'RHP_SKYWAYS/RHP Skyways.pdf', content: pdf('N') }]);
    const result = await makeRunner(zip, sink).runIpo(SKYWAYS, EXISTING as never);
    expect(result.found).toEqual(['RHP']);
    const rows = [...sink.byUrl.values()];
    expect(rows).toHaveLength(1);
    expect(rows[0].type).toBe('RHP');
    expect(rows[0].url).toBe(ZIP_URL);
    expect(rows[0].partNumber).toBeUndefined();
    expect(result.attempts.some((a) => String(a.outcome).startsWith('zip_member_'))).toBe(false);
  }, 60_000);
});
