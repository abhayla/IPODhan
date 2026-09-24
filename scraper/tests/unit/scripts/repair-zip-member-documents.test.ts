// implements: R-160
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createHash } from 'node:crypto';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import { join } from 'node:path';
import { repairOneZip, describe as describeResult, type StoredZip } from '../../../scripts/repair-zip-member-documents.js';
import { InMemoryDocumentFetchStateStore } from '../../../src/services/in-memory-document-fetch-state-store.js';
import type { DocumentSinkInput, HttpFetcher } from '../../../src/services/document-discovery-runner.js';

/**
 * Item 22 repair tool: the one-path contract. Dry run writes nothing; apply
 * stores through storeZipMemberDocuments and marks the type FOUND; a second
 * dry run after the apply reports 0 to add; a zip whose chosen member no
 * longer matches the stored sha256 is held.
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
  type: 'RHP',
  url: URL,
  title: 'RHP',
  exchange: 'NSE',
  sha256: sha(RHP),
};
const fetcher: HttpFetcher = async (url) => ({ status: 200, contentType: 'application/zip', body: ZIP, url });

function sink() {
  const rows = new Map<string, DocumentSinkInput & { id: string }>();
  return {
    rows,
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
  };
}

let storeDir: string;
beforeEach(async () => {
  storeDir = await fsp.mkdtemp(join(os.tmpdir(), 'item22-repair-'));
});
afterEach(async () => {
  await fsp.rm(storeDir, { recursive: true, force: true });
});

describe('repair-zip-member-documents (item 22)', () => {
  it('dry run -> apply -> dry run: 1 to add, 1 added + FOUND, then 0', async () => {
    const documents = sink();
    const store = new InMemoryDocumentFetchStateStore();

    const dry = await repairOneZip(STORED, { fetcher, documents, store, apply: false, storeDir });
    expect(describeResult(dry).toAdd).toBe(1);
    expect(documents.rows.size).toBe(0);
    expect(describeResult(dry).lines.some((l) => l.includes('SKIP GID "RHP_HTEL/GID.pdf"'))).toBe(true);

    const applied = await repairOneZip(STORED, { fetcher, documents, store, apply: true, storeDir });
    expect(describeResult(applied).toAdd).toBe(1);
    expect([...documents.rows.values()].map((r) => [r.type, r.partNumber])).toEqual([['CORRIGENDUM', 1]]);
    expect(applied.foundMarked).toEqual(['CORRIGENDUM']);
    expect((await store.listForIpo('ipo-htel')).find((r) => r.docType === 'CORRIGENDUM')?.state).toBe('FOUND');

    const again = await repairOneZip(STORED, { fetcher, documents, store, apply: false, storeDir });
    expect(describeResult(again).toAdd).toBe(0);
  });

  it('holds a zip whose chosen member no longer matches the stored sha256, and one with no stored sha256', async () => {
    const documents = sink();
    const changed = await repairOneZip({ ...STORED, sha256: 'f'.repeat(64) }, { fetcher, documents, apply: false, storeDir });
    expect(changed.refused).toMatch(/^archive_changed_since_stored/);
    const legacy = await repairOneZip({ ...STORED, sha256: null }, { fetcher, documents, apply: false, storeDir });
    expect(legacy.refused).toMatch(/^no_stored_sha256/);
    expect(describeResult(changed).toAdd + describeResult(legacy).toAdd).toBe(0);
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
    const f: HttpFetcher = async (url) => ({ status: 200, contentType: 'application/zip', body: url.includes('RATIOS') ? ratiosZip : rhpZip, url });
    const documents = sink();
    const seenBySha = new Map();
    const a = await repairOneZip({ ...STORED, url: 'https://x/RHP_M.zip' }, { fetcher: f, documents, apply: false, storeDir, seenBySha });
    const b = await repairOneZip(
      { ...STORED, documentId: 'doc-ratios', type: 'RATIOS_BASIS_ISSUE_PRICE', url: 'https://x/RATIOS_M.zip', sha256: sha(ratios) },
      { fetcher: f, documents, apply: false, storeDir, seenBySha }
    );
    expect(describeResult(a).toAdd + describeResult(b).toAdd).toBe(1);
    expect(b.outcomes[0].action).toBe('duplicate');
  });
});
