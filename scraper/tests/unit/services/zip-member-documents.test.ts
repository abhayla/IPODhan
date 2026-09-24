// implements: R-160, R-229
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
import { extractPdfMembersFromZip } from '../../../src/services/primary-source-discovery.js';
import { markTypeFoundFromZip, memberNameFromUrl } from '../../../src/services/zip-member-documents.js';
import { planRetype } from '../../../src/scripts/retype-misclassified-documents.js';

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

/**
 * A STORED zip with several named members, central-directory order = input order.
 * A string name is written as UTF-8 bytes WITHOUT the UTF-8 flag (bit 11), the
 * way the exchange's archiver writes RHP_HTEL.zip; `flags` sets it explicitly.
 */
function makeMultiZip(entries: { name: string | Buffer; content: Buffer; flags?: number }[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const { name, content, flags = 0 } of entries) {
    const nameBuf = Buffer.isBuffer(name) ? name : Buffer.from(name, 'utf8');
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt32LE(content.length, 18);
    local.writeUInt32LE(content.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    const localPart = Buffer.concat([local, nameBuf, content]);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(flags, 8);
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

/**
 * Mirrors DocumentRepository: one row per URL; a URL hit refreshes sha256 and
 * part_number (upsertDocument), and findBySha256ForIpo answers from every row
 * ever stored for the IPO (the DB, not a per-run map).
 */
function urlKeyedSink(preloaded: (DocumentSinkInput & { id: string })[] = []) {
  const byUrl = new Map<string, DocumentSinkInput & { id: string }>(preloaded.map((r) => [r.url, { ...r }]));
  let inserts = 0;
  return {
    byUrl,
    inserts: () => inserts,
    async upsertDocument(doc: DocumentSinkInput) {
      const hit = byUrl.get(doc.url);
      if (hit) {
        if (doc.sha256) hit.sha256 = doc.sha256;
        if (doc.partNumber != null) hit.partNumber = doc.partNumber;
        return { id: hit.id };
      }
      inserts += 1;
      const row = { ...doc, id: `doc-${inserts}` };
      byUrl.set(doc.url, row);
      return { id: row.id };
    },
    async findBySha256ForIpo(ipoId: string, sha256: string) {
      const hit = [...byUrl.values()].find((r) => r.ipoId === ipoId && r.sha256 === sha256);
      return hit ? { id: hit.id, type: hit.type as string } : null;
    },
  };
}

/** A fetch-state store holding the given rows (the persisted twin of `existingRows`). */
async function seededStore(rows: { docType: string; state: string }[], ipoId = 'ipo-skyways') {
  const store = new InMemoryDocumentFetchStateStore();
  for (const r of rows) {
    const row = await store.ensureRow(ipoId, r.docType);
    await store.update(row.id, { state: r.state as never });
  }
  return store;
}

let storeDir: string;
beforeEach(async () => {
  storeDir = await fsp.mkdtemp(join(os.tmpdir(), 'item22-zip-'));
});
afterEach(async () => {
  await fsp.rm(storeDir, { recursive: true, force: true });
});

/** The real Skyways BSE payload with its Corrigendum link removed (the exchanges list none). */
const BSE_CORE_NO_CORRIGENDUM = (() => {
  const core = JSON.parse(fixture('bse-skyways-core.json'));
  core.IPONO_0[0].Corrigendum = '';
  return JSON.stringify(core);
})();

function makeRunnerWith(opts: {
  zip: Buffer;
  sink: ReturnType<typeof urlKeyedSink>;
  store: InMemoryDocumentFetchStateStore;
  bseCore?: string;
  /** BSE consult answers 500 (http_error) on every attempt: an exchange the runner asked that could not answer. */
  bseFail?: boolean;
  /** url substring -> PDF body served for it. */
  extra?: Record<string, Buffer>;
  requested?: string[];
}) {
  const fetcher: HttpFetcher = async (url) => {
    opts.requested?.push(url);
    for (const [needle, body] of Object.entries(opts.extra ?? {})) {
      if (url.includes(needle)) return { status: 200, contentType: 'application/pdf', body, url };
    }
    if (url.includes('listing.bseindia.com')) {
      return { status: 200, contentType: 'text/html', body: Buffer.from('<html><h1>Object Moved</h1></html>'), url };
    }
    if (url.includes('RHP_SKYWAYS.zip')) return { status: 200, contentType: 'application/zip', body: opts.zip, url: ZIP_URL };
    if (url.includes('GetMkt_ISSUE_BBS_IPO')) {
      if (opts.bseFail) return { status: 500, contentType: 'text/html', body: Buffer.from('err'), url };
      return json(opts.bseCore ?? fixture('bse-skyways-core.json'));
    }
    if (url.includes('symbol=SKYWAYS')) return json(fixture('nse-skyways.json'));
    return { status: 404, contentType: 'text/html', body: Buffer.from('x'), url };
  };
  return new DocumentDiscoveryRunner({
    fetcher,
    store: opts.store,
    documents: opts.sink,
    counter: new NetworkCounter(),
    now: () => new Date('2026-08-28T06:00:00Z'),
    storeDir,
    extractCoverText: async () => ({ usable: true, text: 'SKYWAYS AIR SERVICES LIMITED' }),
    sleep: async () => undefined,
  });
}

function makeRunner(
  zip: Buffer,
  documents: ReturnType<typeof urlKeyedSink>,
  store: InMemoryDocumentFetchStateStore = new InMemoryDocumentFetchStateStore()
) {
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
    store,
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
    // A FOLDER named like a GID never makes its members GIDs: only the base name counts.
    for (const n of [
      'RHP_AUGMONT/Augmont Enterprises Ltd_RHP.pdf',
      'SteamhouseRHP.pdf',
      'RHP_HTEL/Corrigendum/BS Mumbai 20-08-2026-8.pdf',
      'Prospectus_GID/x.pdf',
      'RHP_X/GID/X_Corrigendum.pdf',
    ]) {
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

  it('never types an ABRIDGED prospectus as the Prospectus (real FORMS_CLAYCRAFT member, staging 2026-09-24)', () => {
    expect(classifyZipMemberName('FORMS_CLAYCRAFT/Abridged Prospectus.pdf')).toBeNull();
    expect(classifyZipMemberName('PROSPECTUS_X/X Limited_Prospectus.pdf')?.type).toBe('PROSPECTUS');
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
    const result = await makeRunner(makeMultiZip(MEMBERS), sink, await seededStore(EXISTING)).runIpo(SKYWAYS, EXISTING as never);

    expect(result.found).toEqual(['RHP']);
    const rows = [...sink.byUrl.values()]
      .filter((r) => r.url.startsWith(ZIP_URL))
      .map((r) => ({ type: r.type, url: r.url, partNumber: r.partNumber, exchange: r.exchange }))
      .sort((a, b) => a.partNumber! - b.partNumber!);

    expect(rows).toEqual([
      { type: 'CORRIGENDUM', url: zipMemberUrl(ZIP_URL, MEMBERS[0].name), partNumber: 1, exchange: 'NSE' },
      { type: 'CORRIGENDUM', url: zipMemberUrl(ZIP_URL, MEMBERS[1].name), partNumber: 2, exchange: 'NSE' },
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
    await makeRunner(makeMultiZip(MEMBERS), sink, await seededStore(EXISTING)).runIpo(SKYWAYS, EXISTING as never);
    const afterFirst = sink.inserts();
    expect(afterFirst).toBe(3);
    await makeRunner(makeMultiZip(MEMBERS), sink, await seededStore(EXISTING)).runIpo(SKYWAYS, EXISTING as never);
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
    const result = await makeRunner(zip, sink, await seededStore(EXISTING)).runIpo(SKYWAYS, EXISTING as never);
    expect([...sink.byUrl.values()].filter((r) => r.type === 'CORRIGENDUM')).toHaveLength(1);
    expect(result.attempts.some((a) => String(a.outcome).startsWith('zip_member_deduped_by_sha256_to:CORRIGENDUM'))).toBe(true);
  }, 60_000);

  it('regression: a one-member zip writes one row, with part_number unset, exactly as before', async () => {
    const sink = urlKeyedSink();
    const zip = makeMultiZip([{ name: 'RHP_SKYWAYS/RHP Skyways.pdf', content: pdf('N') }]);
    const result = await makeRunner(zip, sink, await seededStore(EXISTING)).runIpo(SKYWAYS, EXISTING as never);
    expect(result.found).toEqual(['RHP']);
    const rows = [...sink.byUrl.values()];
    expect(rows).toHaveLength(1);
    expect(rows[0].type).toBe('RHP');
    expect(rows[0].url).toBe(ZIP_URL);
    expect(rows[0].partNumber).toBeUndefined();
    expect(result.attempts.some((a) => String(a.outcome).startsWith('zip_member_'))).toBe(false);
  }, 60_000);
});

describe('Tier A round 1 fixes (item 22)', () => {
  const C1 = 'RHP_X/X_Corrigendum.pdf';
  const C2 = 'RHP_X/Corrigendum/BS Mumbai 20-08-2026-8.pdf';

  it('MAJOR 3: a re-fetch whose members are REORDERED never writes one member\'s bytes onto another member\'s row', async () => {
    const a = pdf('a');
    const b = pdf('b');
    const bRepublished = pdf('B');
    const sink = urlKeyedSink();
    await makeRunner(
      makeMultiZip([
        { name: C1, content: a },
        { name: C2, content: b },
        { name: 'RHP_X/X_RHP.pdf', content: pdf('R', 200_000) },
      ]),
      sink,
      await seededStore(EXISTING)
    ).runIpo(SKYWAYS, EXISTING as never);
    // The exchange re-publishes: C2 changed and now comes FIRST.
    await makeRunner(
      makeMultiZip([
        { name: C2, content: bRepublished },
        { name: C1, content: a },
        { name: 'RHP_X/X_RHP.pdf', content: pdf('R', 200_000) },
      ]),
      sink,
      await seededStore(EXISTING)
    ).runIpo(SKYWAYS, EXISTING as never);

    const sha = (buf: Buffer) => require('node:crypto').createHash('sha256').update(buf).digest('hex');
    // Found by TITLE (what a reader sees), not by the key under test.
    const rows = [...sink.byUrl.values()].filter((r) => r.type === 'CORRIGENDUM');
    expect(rows).toHaveLength(2);
    const c1Row = rows.find((r) => r.title.endsWith('| X_Corrigendum.pdf'))!;
    const c2Row = rows.find((r) => r.title.endsWith('| BS Mumbai 20-08-2026-8.pdf'))!;
    expect(c1Row.sha256).toBe(sha(a));
    expect(c2Row.sha256).toBe(sha(bRepublished));
    expect(memberNameFromUrl(c2Row.url)).toBe(C2);
  }, 60_000);

  it('MAJOR 2a: bytes already stored for the IPO in an EARLIER run (a company-site copy) are not stored again', async () => {
    const corr = pdf('K');
    const shaCorr = require('node:crypto').createHash('sha256').update(corr).digest('hex');
    const sink = urlKeyedSink([
      {
        id: 'doc-company',
        ipoId: 'ipo-skyways',
        type: 'CORRIGENDUM',
        title: 'Corrigendum (company site)',
        url: 'https://www.skyways.example/investors/corrigendum.pdf',
        exchange: 'COMPANY',
        mediaType: 'PDF',
        extractionStatus: 'PENDING',
        isActive: true,
        sha256: shaCorr,
      },
    ]);
    const result = await makeRunner(
      makeMultiZip([
        { name: C1, content: corr },
        { name: 'RHP_X/X_RHP.pdf', content: pdf('R', 200_000) },
      ]),
      sink,
      await seededStore(EXISTING)
    ).runIpo(SKYWAYS, EXISTING as never);

    expect([...sink.byUrl.values()].filter((r) => r.type === 'CORRIGENDUM').map((r) => r.id)).toEqual(['doc-company']);
    expect(sink.byUrl.has(zipMemberUrl(ZIP_URL, C1))).toBe(false);
    expect(result.attempts.some((a) => String(a.outcome).startsWith('zip_member_deduped_by_sha256_to:CORRIGENDUM'))).toBe(true);
  }, 60_000);

  it('MAJOR 2b: with NO exchange corrigendum link, a type the zip supplied is FOUND (with the member row id) and its fallback chain is not run', async () => {
    const sink = urlKeyedSink();
    // CORRIGENDUM is still wanted: no FOUND row for it.
    const existing = EXISTING.filter((r) => r.docType !== 'CORRIGENDUM');
    const store = await seededStore(existing);
    const result = await makeRunnerWith({ zip: makeMultiZip(MEMBERS), sink, store, bseCore: BSE_CORE_NO_CORRIGENDUM }).runIpo(
      SKYWAYS,
      existing as never
    );

    const memberRow = sink.byUrl.get(zipMemberUrl(ZIP_URL, MEMBERS[0].name))!;
    const corrState = (await store.listForIpo('ipo-skyways')).find((r) => r.docType === 'CORRIGENDUM')!;
    expect(corrState.state).toBe('FOUND');
    expect([memberRow.id, sink.byUrl.get(zipMemberUrl(ZIP_URL, MEMBERS[1].name))!.id]).toContain(corrState.documentId);
    expect(result.found).toContain('CORRIGENDUM');
    expect(result.notFound).not.toContain('CORRIGENDUM');
    expect(result.blocked).not.toContain('CORRIGENDUM');
    expect(result.attempts.some((a) => String(a.outcome).startsWith('rungs[CORRIGENDUM]: EXCHANGES:found_in_zip'))).toBe(true);
    // No SEBI / company / verifier rung ran for it.
    expect(result.attempts.some((a) => String(a.outcome).startsWith('rungs[CORRIGENDUM]') && /SEBI:(?!skipped)/.test(String(a.outcome)))).toBe(false);
  }, 60_000);
});

describe('round 2 review, MAJOR 1: an exchange-listed link is fetched even when the zip held that type (OD-33, OD-66)', () => {
  const EXCHANGE_CORR = 'CorrigendumofRHPSkyways';
  const existing = EXISTING.filter((r) => r.docType !== 'CORRIGENDUM');

  it('a zip corrigendum AND a different exchange corrigendum: both are stored, the exchange one is what FOUND points at', async () => {
    const sink = urlKeyedSink();
    const store = await seededStore(existing);
    const requested: string[] = [];
    const result = await makeRunnerWith({
      zip: makeMultiZip(MEMBERS),
      sink,
      store,
      extra: { [EXCHANGE_CORR]: pdf('N', 90_000) },
      requested,
    }).runIpo(SKYWAYS, existing as never);

    expect(requested.some((u) => u.includes(EXCHANGE_CORR))).toBe(true);
    const exchangeRow = [...sink.byUrl.values()].find((r) => r.url.includes(EXCHANGE_CORR));
    expect(exchangeRow?.type).toBe('CORRIGENDUM');
    expect(sink.byUrl.get(zipMemberUrl(ZIP_URL, MEMBERS[0].name))?.type).toBe('CORRIGENDUM');
    const corrState = (await store.listForIpo('ipo-skyways')).find((r) => r.docType === 'CORRIGENDUM')!;
    expect(corrState).toMatchObject({ state: 'FOUND', documentId: exchangeRow!.id });
    expect(result.attempts.some((a) => String(a.outcome).includes('found_in_zip'))).toBe(false);
  }, 60_000);

  it('the same bytes from the zip and from the exchange link: ONE row (sha256 dedupe), type FOUND', async () => {
    const sink = urlKeyedSink();
    const store = await seededStore(existing);
    const result = await makeRunnerWith({
      zip: makeMultiZip(MEMBERS),
      sink,
      store,
      extra: { [EXCHANGE_CORR]: MEMBERS[0].content },
    }).runIpo(SKYWAYS, existing as never);

    const shaRows = [...sink.byUrl.values()].filter((r) => r.type === 'CORRIGENDUM');
    // The zip's two corrigendum members, and nothing for the identical exchange copy.
    expect(shaRows).toHaveLength(2);
    expect([...sink.byUrl.keys()].some((u) => u.includes(EXCHANGE_CORR))).toBe(false);
    expect(result.found).toContain('CORRIGENDUM');
  }, 60_000);

  it('the exchange link FAILS: the type stays open for the next slot, never closed as FOUND on the zip copy', async () => {
    const sink = urlKeyedSink();
    const store = await seededStore(existing);
    const result = await makeRunnerWith({ zip: makeMultiZip(MEMBERS), sink, store }).runIpo(SKYWAYS, existing as never);

    // The zip member is still stored as a document of the IPO ...
    expect(sink.byUrl.get(zipMemberUrl(ZIP_URL, MEMBERS[0].name))?.type).toBe('CORRIGENDUM');
    // ... but the listed (possibly newer) corrigendum is not given up on.
    const corrState = (await store.listForIpo('ipo-skyways')).find((r) => r.docType === 'CORRIGENDUM')!;
    expect(corrState.state).not.toBe('FOUND');
    expect(result.found).not.toContain('CORRIGENDUM');
  }, 60_000);
});

describe('round 3: stored zip members close their type on the next cycle; a fetched zip is marked examined', () => {
  it('a member row stored earlier (e.g. by the expansion pass) makes CORRIGENDUM FOUND when the exchanges list none', async () => {
    const sink = urlKeyedSink([
      {
        id: 'doc-member',
        ipoId: 'ipo-skyways',
        type: 'CORRIGENDUM' as never,
        title: 'RHP | Rays of Belief_Corrigendum.pdf',
        url: zipMemberUrl(ZIP_URL, MEMBERS[0].name),
        exchange: 'NSE',
        mediaType: 'PDF',
      },
    ]);
    const withMembers = Object.assign(sink, {
      async findZipMemberDocuments(ipoId: string) {
        return [...sink.byUrl.values()]
          .filter((r) => r.ipoId === ipoId && r.url.includes('#member='))
          .map((r) => ({ id: r.id, type: String(r.type), url: r.url }));
      },
    });
    const existing = [
      ...EXISTING.filter((r) => r.docType !== 'CORRIGENDUM'),
      { ...EXISTING[0], docType: 'RHP' },
    ];
    const store = await seededStore(existing);
    const requested: string[] = [];
    const result = await makeRunnerWith({
      zip: makeMultiZip(MEMBERS),
      sink: withMembers,
      store,
      bseCore: BSE_CORE_NO_CORRIGENDUM,
      requested,
    }).runIpo(SKYWAYS, existing as never);

    const corrState = (await store.listForIpo('ipo-skyways')).find((r) => r.docType === 'CORRIGENDUM')!;
    expect(corrState).toMatchObject({ state: 'FOUND', documentId: 'doc-member' });
    expect(result.found).toContain('CORRIGENDUM');
    expect(requested.some((u) => u.includes('RHP_SKYWAYS.zip'))).toBe(false);
  }, 60_000);

  it('round 4 Tier A MAJOR (M2): a stored zip member does NOT close its type when an exchange TIMED OUT — only "answered, no link" may close it from the zip', async () => {
    // Same shape as the previous test (a CORRIGENDUM member row is already
    // stored), except BSE answers 500 on every retry instead of "no link".
    // `exchangesAnswered` must be false, so neither guard
    // (`candidates.length === 0 && exchangesAnswered` in the loop, and
    // `!exchangesAnswered` after it) may treat "no candidates this cycle" as
    // "the exchanges said there is no such filing" and close CORRIGENDUM FOUND
    // on the zip's older copy. Dropping `exchangesAnswered` from either guard
    // (the reviewer's round-3 mutation M2) makes this red: BSE's failure to
    // answer would be silently read the same as BSE answering "no link".
    const sink = urlKeyedSink([
      {
        id: 'doc-member',
        ipoId: 'ipo-skyways',
        type: 'CORRIGENDUM' as never,
        title: 'RHP | Rays of Belief_Corrigendum.pdf',
        url: zipMemberUrl(ZIP_URL, MEMBERS[0].name),
        exchange: 'NSE',
        mediaType: 'PDF',
      },
    ]);
    const withMembers = Object.assign(sink, {
      async findZipMemberDocuments(ipoId: string) {
        return [...sink.byUrl.values()]
          .filter((r) => r.ipoId === ipoId && r.url.includes('#member='))
          .map((r) => ({ id: r.id, type: String(r.type), url: r.url }));
      },
    });
    const existing = [
      ...EXISTING.filter((r) => r.docType !== 'CORRIGENDUM'),
      { ...EXISTING[0], docType: 'RHP' },
    ];
    const store = await seededStore(existing);
    const result = await makeRunnerWith({
      zip: makeMultiZip(MEMBERS),
      sink: withMembers,
      store,
      bseFail: true,
    }).runIpo(SKYWAYS, existing as never);

    const corrState = (await store.listForIpo('ipo-skyways')).find((r) => r.docType === 'CORRIGENDUM')!;
    expect(corrState.state).not.toBe('FOUND');
    expect(result.found).not.toContain('CORRIGENDUM');
  }, 60_000);

  it('a zip the runner fetches now is marked examined (after its members), so the expansion pass never re-downloads it', async () => {
    const sink = urlKeyedSink();
    const marked: string[] = [];
    const withMarker = Object.assign(sink, {
      async markZipMembersChecked(id: string) {
        expect(sink.byUrl.get(zipMemberUrl(ZIP_URL, MEMBERS[0].name))).toBeDefined();
        marked.push(id);
      },
    });
    await makeRunner(makeMultiZip(MEMBERS), withMarker, await seededStore(EXISTING)).runIpo(SKYWAYS, EXISTING as never);
    expect(marked).toEqual([sink.byUrl.get(ZIP_URL)!.id]);
  }, 60_000);
});

describe('zip-supplied types (continued)', () => {
  it('markTypeFoundFromZip moves only an open row, never a FOUND or SUPERSEDED one', async () => {
    const store = await seededStore([
      { docType: 'CORRIGENDUM', state: 'WANTED' },
      { docType: 'ADDENDUM', state: 'FOUND' },
      { docType: 'PRICE_BAND_AD', state: 'SUPERSEDED' },
    ]);
    expect(await markTypeFoundFromZip(store, 'ipo-skyways', 'CORRIGENDUM', 'doc-9', ZIP_URL)).toBe(true);
    expect(await markTypeFoundFromZip(store, 'ipo-skyways', 'ADDENDUM', 'doc-9', ZIP_URL)).toBe(false);
    expect(await markTypeFoundFromZip(store, 'ipo-skyways', 'PRICE_BAND_AD', 'doc-9', ZIP_URL)).toBe(false);
    const rows = await store.listForIpo('ipo-skyways');
    expect(rows.find((r) => r.docType === 'CORRIGENDUM')).toMatchObject({ state: 'FOUND', documentId: 'doc-9' });
    expect(rows.find((r) => r.docType === 'ADDENDUM')!.documentId).toBeNull();
  });
});

describe('zip member names are decoded as their bytes say (item 22 MINOR)', () => {
  // The real name from NSE's RHP_HTEL.zip (captured 2026-09-24): UTF-8 bytes, UTF-8 flag NOT set.
  const DEVANAGARI = 'RHP_HTEL/Corrigendum/बिज़नेस_स्टैंडर्ड_●_मुंबई_●_20‹08‹2026_-11.pdf';

  it('reads valid UTF-8 as UTF-8 even without the flag, and cp437 otherwise', () => {
    const zip = makeMultiZip([
      { name: DEVANAGARI, content: pdf('D') },
      { name: Buffer.from([0x52, 0x2f, 0x81, 0x2e, 0x70, 0x64, 0x66]), content: pdf('E') }, // 'R/' + cp437 0x81 'ü' + '.pdf'
      { name: 'RHP_HTEL/Ünicode.pdf', content: pdf('F'), flags: 0x0800 },
    ]);
    expect(extractPdfMembersFromZip(zip).map((m) => m.name)).toEqual([DEVANAGARI, 'R/ü.pdf', 'RHP_HTEL/Ünicode.pdf']);
  });
});

describe('retype-misclassified-documents reads a member row by its member name (item 22 MINOR)', () => {
  it('a CORRIGENDUM member of an RHP zip is not flagged for review', () => {
    const url = zipMemberUrl(ZIP_URL, 'RHP_HTEL/Corrigendum/BS Mumbai 20-08-2026-8.pdf');
    expect(planRetype({ id: 'd1', url, title: 'RHP | BS Mumbai 20-08-2026-8.pdf', type: 'CORRIGENDUM' })).toBeNull();
    // The bare zip still classifies by its own name.
    expect(planRetype({ id: 'd2', url: 'https://x/RHP_HTEL.zip', title: 'RHP', type: 'CORRIGENDUM' })?.suggestedType).toBe('RHP');
  });
});
