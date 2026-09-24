// implements: R-160
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createHash } from 'node:crypto';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import { join } from 'node:path';
import { repairOneZip, describe as describeResult, type StoredZip } from '../../../scripts/repair-zip-member-documents.js';
import { InMemoryDocumentFetchStateStore } from '../../../src/services/in-memory-document-fetch-state-store.js';
import {
  DocumentDiscoveryRunner,
  type DocumentSinkInput,
  type HttpFetcher,
} from '../../../src/services/document-discovery-runner.js';
import { NetworkCounter } from '../../../src/utils/network-counter.js';
import { runStoredZipExpansionPass } from '../../../src/services/stored-zip-expansion-pass.js';

/**
 * Item 22 stored-zip expansion (round 3): the repair CLI and the data-slot pass
 * both call `DocumentDiscoveryRunner.expandStoredZip`. Dry run writes nothing;
 * apply stores the members and writes the durable `zip_members_checked_at`
 * marker; a zip with a stored sha256 must match it; a zip with NO sha256 is
 * expanded only after the cover-page identity check passes, and its sha256 is
 * backfilled; the pass is bounded per wake and a second wake does 0.
 */
const pdf = (m: string, size = 80_000) => Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.from(m.repeat(size))]);
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');

function zipOf(entries: { name: string; content: Buffer }[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const { name, content } of entries) {
    const n = Buffer.from(name, 'utf8');
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(content.length, 18);
    local.writeUInt32LE(content.length, 22);
    local.writeUInt16LE(n.length, 26);
    const lp = Buffer.concat([local, n, content]);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0);
    c.writeUInt32LE(content.length, 20);
    c.writeUInt32LE(content.length, 24);
    c.writeUInt16LE(n.length, 28);
    c.writeUInt32LE(offset, 42);
    centrals.push(Buffer.concat([c, n]));
    locals.push(lp);
    offset += lp.length;
  }
  const la = Buffer.concat(locals);
  const ca = Buffer.concat(centrals);
  const e = Buffer.alloc(22);
  e.writeUInt32LE(0x06054b50, 0);
  e.writeUInt16LE(entries.length, 8);
  e.writeUInt16LE(entries.length, 10);
  e.writeUInt32LE(ca.length, 12);
  e.writeUInt32LE(la.length, 16);
  return Buffer.concat([la, ca, e]);
}

const RHP = pdf('R', 200_000);
// Real member names from NSE's RHP_HTEL.zip (F-154, captured 2026-09-24).
const ZIP = zipOf([
  { name: 'RHP_HTEL/Corrigendum/BS Mumbai 20-08-2026-8.pdf', content: pdf('B') },
  { name: 'RHP_HTEL/GID.pdf', content: pdf('G') },
  { name: 'RHP_HTEL/Hy Tech Engineers Limited_RHP.pdf', content: RHP },
]);
const URL = 'https://nsearchives.nseindia.com/content/ipo/RHP_HTEL.zip';
const STORED: StoredZip = {
  documentId: 'doc-rhp',
  ipoId: 'ipo-htel',
  slug: 'hy-tech-engineers-ltd',
  companyName: 'Hy-Tech Engineers Limited',
  type: 'RHP',
  url: URL,
  title: 'RHP',
  exchange: 'NSE',
  sha256: sha(RHP),
};

const zipFetcher =
  (body: Buffer, calls: string[] = [], status = 200): HttpFetcher =>
  async (url) => {
    calls.push(url);
    return { status, contentType: 'application/zip', body, url };
  };

type Row = DocumentSinkInput & { id: string; checkedAt?: boolean };

/** A documents table: rows by url, the marker, and the one selection query the pass and the CLI share. */
function sink(preloaded: Row[] = []) {
  const rows = new Map<string, Row>(preloaded.map((r) => [r.url, { ...r }]));
  const marked: { id: string; sha256?: string | null; partNumber?: number | null }[] = [];
  return {
    rows,
    marked,
    async upsertDocument(d: DocumentSinkInput) {
      const hit = rows.get(d.url);
      if (hit) return { id: hit.id };
      const row = { ...d, id: `doc-${rows.size + 1}` };
      rows.set(d.url, row);
      return { id: row.id };
    },
    async findBySha256ForIpo(ipoId: string, s: string) {
      const hit = [...rows.values()].find((r) => r.ipoId === ipoId && r.sha256 === s);
      return hit ? { id: hit.id, type: hit.type as string } : null;
    },
    async markZipMembersChecked(id: string, patch: { sha256?: string | null; partNumber?: number | null } = {}) {
      marked.push({ id, ...patch });
      const row = [...rows.values()].find((r) => r.id === id);
      if (row) {
        row.checkedAt = true;
        if (patch.sha256 && !row.sha256) row.sha256 = patch.sha256;
        if (patch.partNumber != null) row.partNumber = patch.partNumber;
      }
    },
    async listZipsWithUncheckedMembers(o: { limit?: number } = {}) {
      const zips = [...rows.values()]
        .filter((r) => r.url.toLowerCase().endsWith('.zip') && !r.url.includes('#') && !r.checkedAt)
        .map((r) => ({
          documentId: r.id,
          ipoId: r.ipoId,
          slug: 'hy-tech-engineers-ltd',
          companyName: 'Hy-Tech Engineers Limited',
          type: String(r.type),
          url: r.url,
          title: r.title,
          exchange: r.exchange ?? 'NSE',
          sha256: r.sha256 ?? null,
        }));
      return o.limit ? zips.slice(0, o.limit) : zips;
    },
  };
}

let storeDir: string;
beforeEach(async () => {
  storeDir = await fsp.mkdtemp(join(os.tmpdir(), 'item22-repair-'));
});
afterEach(async () => {
  await fsp.rm(storeDir, { recursive: true, force: true });
});

function runnerFor(
  fetcher: HttpFetcher,
  documents: ReturnType<typeof sink>,
  cover = 'HY-TECH ENGINEERS LIMITED',
  counter = new NetworkCounter()
) {
  return new DocumentDiscoveryRunner({
    fetcher,
    store: new InMemoryDocumentFetchStateStore(),
    documents,
    counter,
    storeDir,
    extractCoverText: async () =>
      cover ? { usable: true, text: cover } : ({ usable: false, reason: 'no_text_layer' } as never),
  });
}

describe('repair-zip-member-documents (item 22)', () => {
  it('dry run -> apply -> dry run: 1 to add, 1 added + marker written, then 0', async () => {
    const documents = sink();
    const runner = runnerFor(zipFetcher(ZIP), documents);

    const dry = await repairOneZip(STORED, { runner, apply: false });
    expect(describeResult(dry).toAdd).toBe(1);
    expect(documents.rows.size).toBe(0);
    expect(dry.checked).toBe(false);
    expect(describeResult(dry).lines.some((l) => l.includes('SKIP GID "RHP_HTEL/GID.pdf"'))).toBe(true);

    const applied = await repairOneZip(STORED, { runner, apply: true });
    expect(describeResult(applied).toAdd).toBe(1);
    expect([...documents.rows.values()].map((r) => [r.type, r.partNumber])).toEqual([['CORRIGENDUM', 1]]);
    expect(applied.checked).toBe(true);
    expect(documents.marked).toEqual([{ id: 'doc-rhp', sha256: null, partNumber: 3 }]);

    const again = await repairOneZip(STORED, { runner, apply: false });
    expect(describeResult(again).toAdd).toBe(0);
  });

  it('fetches through the runner request() path: the network counter sees the call (not defaultFetcher)', async () => {
    const counter = new NetworkCounter();
    await repairOneZip(STORED, { runner: runnerFor(zipFetcher(ZIP), sink(), undefined, counter), apply: false });
    expect(counter.count('ipo-htel')).toBe(1);
  });

  it('holds a zip whose chosen member no longer matches the stored sha256', async () => {
    const documents = sink();
    const changed = await repairOneZip({ ...STORED, sha256: 'f'.repeat(64) }, { runner: runnerFor(zipFetcher(ZIP), documents), apply: true });
    expect(changed.refused).toMatch(/^archive_changed_since_stored/);
    expect(describeResult(changed).toAdd).toBe(0);
    expect(documents.rows.size).toBe(0);
  });

  it('a transient failure (HTTP 503) is not marked: the zip stays selected for the next wake', async () => {
    const documents = sink();
    const r = await repairOneZip(STORED, { runner: runnerFor(zipFetcher(Buffer.from('busy'), [], 503), documents), apply: true });
    expect(r.refused).toMatch(/refetch_rejected/);
    expect(r.checked).toBe(false);
    expect(documents.marked).toEqual([]);
  });
});

describe('round 2 review, MAJOR 2: a zip stored with NO sha256 (W-1) is verified by the cover-page check, not refused forever', () => {
  it('cover check passes -> expanded, and the sha256 is backfilled onto the stored row', async () => {
    const documents = sink();
    const r = await repairOneZip({ ...STORED, sha256: null }, { runner: runnerFor(zipFetcher(ZIP), documents), apply: true });
    expect(r.refused).toBeUndefined();
    expect(r.identity).toBe('cover_check_passed');
    expect(r.backfilledSha256).toBe(sha(RHP));
    expect([...documents.rows.values()].map((x) => x.type)).toEqual(['CORRIGENDUM']);
    expect(documents.marked).toEqual([{ id: 'doc-rhp', sha256: sha(RHP), partNumber: 3 }]);
  });

  it('cover names another company -> refused by the verifier, nothing stored', async () => {
    const documents = sink();
    const r = await repairOneZip(
      { ...STORED, sha256: null },
      { runner: runnerFor(zipFetcher(ZIP), documents, 'SOME OTHER INDUSTRIES LIMITED RED HERRING PROSPECTUS'), apply: true }
    );
    expect(r.refused).toMatch(/^refetch_rejected:/);
    expect(documents.rows.size).toBe(0);
  });

  it('no text layer -> identity unproven, held with the reason, nothing stored', async () => {
    const documents = sink();
    const r = await repairOneZip({ ...STORED, sha256: null }, { runner: runnerFor(zipFetcher(ZIP), documents, ''), apply: true });
    expect(r.refused).toMatch(/^no_stored_sha256_and_cover_check_skipped_no_text_layer/);
    expect(documents.rows.size).toBe(0);
  });
});

describe('repair-zip-member-documents dry run across two zips of one IPO', () => {
  it('counts bytes shipped in both zips once, as the apply will', async () => {
    const corr = pdf('C');
    const ratios = pdf('Q', 150_000);
    const rhpZip = zipOf([
      { name: 'RHP_M/CORRIGENDUM FINANCIAL EXPRESS.pdf', content: corr },
      { name: 'RHP_M/M_RHP.pdf', content: RHP },
    ]);
    const ratiosZip = zipOf([
      { name: 'RATIOS_M/CORRIGENDUM FINANCIAL EXPRESS.pdf', content: corr },
      { name: 'RATIOS_M/Basis of issue price.pdf', content: ratios },
    ]);
    const f: HttpFetcher = async (url) => ({
      status: 200,
      contentType: 'application/zip',
      body: url.includes('RATIOS') ? ratiosZip : rhpZip,
      url,
    });
    const runner = runnerFor(f, sink());
    const seenBySha = new Map();
    const a = await repairOneZip({ ...STORED, url: 'https://nsearchives.nseindia.com/x/RHP_M.zip' }, { runner, apply: false, seenBySha });
    const b = await repairOneZip(
      {
        ...STORED,
        documentId: 'doc-ratios',
        type: 'RATIOS_BASIS_ISSUE_PRICE',
        url: 'https://nsearchives.nseindia.com/x/RATIOS_M.zip',
        sha256: sha(ratios),
      },
      { runner, apply: false, seenBySha }
    );
    expect(describeResult(a).toAdd + describeResult(b).toAdd).toBe(1);
    expect(b.outcomes[0].action).toBe('duplicate');
  });
});

describe('the in-pipeline stored-zip expansion pass (round 3)', () => {
  const zipRow = (n: number): Row => ({
    id: `zip-${n}`,
    ipoId: 'ipo-htel',
    type: 'RHP' as never,
    title: 'RHP',
    url: `https://nsearchives.nseindia.com/content/ipo/RHP_Z${n}.zip`,
    exchange: 'NSE',
    mediaType: 'PDF',
    sha256: sha(RHP),
  });

  it('expands at most N zips per wake; the marker makes the next wake do the rest, then 0', async () => {
    const documents = sink([1, 2, 3, 4, 5].map(zipRow));
    const calls: string[] = [];
    const runner = runnerFor(zipFetcher(ZIP, calls), documents);

    const w1 = await runStoredZipExpansionPass({ selection: documents, expander: runner }, { limit: 3 });
    expect(w1).toMatchObject({ selected: 3, expanded: 3, unchecked: 0 });
    expect(calls).toHaveLength(3);
    const w2 = await runStoredZipExpansionPass({ selection: documents, expander: runner }, { limit: 3 });
    expect(w2).toMatchObject({ selected: 2, expanded: 2 });
    const w3 = await runStoredZipExpansionPass({ selection: documents, expander: runner }, { limit: 3 });
    expect(w3.selected).toBe(0);
    expect(calls).toHaveLength(5);
  });

  it('a zip whose other member is only a GID is marked and never downloaded again', async () => {
    const gidOnly = zipOf([
      { name: 'RHP_G/GID.pdf', content: pdf('G') },
      { name: 'RHP_G/G_RHP.pdf', content: RHP },
    ]);
    const documents = sink([zipRow(1)]);
    const calls: string[] = [];
    const runner = runnerFor(zipFetcher(gidOnly, calls), documents);
    const w1 = await runStoredZipExpansionPass({ selection: documents, expander: runner });
    expect(w1).toMatchObject({ selected: 1, expanded: 1, membersStored: 0 });
    const w2 = await runStoredZipExpansionPass({ selection: documents, expander: runner });
    expect(w2.selected).toBe(0);
    expect(calls).toHaveLength(1);
  });

  it('starts no download after the ceiling', async () => {
    const documents = sink([1, 2, 3].map(zipRow));
    let t = 0;
    const runner = runnerFor(zipFetcher(ZIP), documents);
    const r = await runStoredZipExpansionPass(
      { selection: documents, expander: runner, now: () => (t += 100_000) },
      { limit: 3, ceilingMs: 250_000 }
    );
    expect(r.expanded).toBeLessThan(3);
    expect(r.skippedByCeiling).toBeGreaterThan(0);
  });
});
