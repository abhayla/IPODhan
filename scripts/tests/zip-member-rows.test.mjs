// Item 10 check `zip_member_rows` (OD-36, F-154). Node builtins only, no DB, no
// network: the zip is built in memory and served through a fake fetch that
// honours Range, so the whole read path (EOCD tail -> central directory ->
// runner classification -> comparison with rows) runs exactly as it does
// against an exchange host.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import {
  fetchZipCentralDirectory,
  pdfMembers,
  selectMainMember,
  classifyOtherMembers,
  compareZipToRows,
  formatMissing,
  classifyByTitle,
  MIN_DOCUMENT_BYTES,
  EOCD_TAIL_BYTES,
} from '../lib/zip-member-rows.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');

/** A stored (method 0) zip whose members have the given names and sizes. */
function buildZip(members, { comment = '' } = {}) {
  const locals = [];
  const cds = [];
  let offset = 0;
  for (const { name, bytes } of members) {
    const nameBuf = Buffer.from(name, 'utf8');
    const data = Buffer.alloc(bytes, 0x25);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(0x0800, 6);
    lh.writeUInt32LE(bytes, 18);
    lh.writeUInt32LE(bytes, 22);
    lh.writeUInt16LE(nameBuf.length, 26);
    locals.push(lh, nameBuf, data);
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(0x0800, 8);
    cd.writeUInt32LE(bytes, 20);
    cd.writeUInt32LE(bytes, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt32LE(offset, 42);
    cds.push(cd, nameBuf);
    offset += 30 + nameBuf.length + bytes;
  }
  const cdBuf = Buffer.concat(cds);
  const commentBuf = Buffer.from(comment, 'latin1');
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(members.length, 8);
  eocd.writeUInt16LE(members.length, 10);
  eocd.writeUInt32LE(cdBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(commentBuf.length, 20);
  return Buffer.concat([...locals, cdBuf, eocd, commentBuf]);
}

/** A fetch that serves `zip` with Range semantics and records every Range asked for. */
function rangeFetch(zip, log = []) {
  return async (_url, { headers }) => {
    const range = headers.Range;
    log.push(range);
    let start, end;
    const suffix = /^bytes=-(\d+)$/.exec(range);
    const span = /^bytes=(\d+)-(\d+)$/.exec(range);
    if (suffix) { start = Math.max(0, zip.length - Number(suffix[1])); end = zip.length - 1; }
    else if (span) { start = Number(span[1]); end = Math.min(zip.length - 1, Number(span[2])); }
    else throw new Error(`unexpected range ${range}`);
    const body = zip.subarray(start, end + 1);
    return {
      status: 206,
      headers: { get: (h) => (h.toLowerCase() === 'content-range' ? `bytes ${start}-${end}/${zip.length}` : null) },
      arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.length),
    };
  };
}

const KB = 1024;
// Real F-154 member names (NSE RHP_HTEL.zip shape): an RHP, a GID, and three
// price-band / corrigendum members.
const ZIP_URL = 'https://nsearchives.nseindia.com/content/ipo/RHP_HTEL.zip';

async function evaluate(zip, { mainType, partNumber, memberRowNames, otherDocSizes, loggedMembers }) {
  const { entries } = await fetchZipCentralDirectory(ZIP_URL, { fetchImpl: rangeFetch(zip) });
  const members = pdfMembers(entries);
  const main = selectMainMember(members, mainType, partNumber);
  const others = classifyOtherMembers(members, main, { mainType });
  return compareZipToRows({ others, memberRowNames, otherDocSizes, loggedMembers });
}

test('RED CASE: a zip with 3 typed non-main PDF members and only 1 member row FAILs naming the 2 missing by name and position', async () => {
  const zip = buildZip([
    { name: 'RHP_HTEL/', bytes: 0 },
    { name: 'RHP_HTEL/Corrigendum/BS Mumbai 20-08-2026-8.pdf', bytes: 120 * KB },
    { name: 'RHP_HTEL/HTEL Price Band Ad FE.pdf', bytes: 130 * KB },
    { name: 'RHP_HTEL/Addendum to RHP.pdf', bytes: 140 * KB },
    { name: 'RHP_HTEL/GID.pdf', bytes: 200 * KB },
    { name: 'RHP_HTEL/HTEL Red Herring Prospectus.pdf', bytes: 900 * KB },
  ]);
  const r = await evaluate(zip, {
    mainType: 'RHP',
    partNumber: 5,
    memberRowNames: new Set(['RHP_HTEL/HTEL Price Band Ad FE.pdf']),
  });
  assert.equal(r.expected.length, 3, 'GID and the main RHP are not expected rows');
  assert.equal(r.present.length, 1);
  assert.deepEqual(
    r.missing.map((m) => [m.position, m.name, m.type]),
    [
      [1, 'RHP_HTEL/Corrigendum/BS Mumbai 20-08-2026-8.pdf', 'CORRIGENDUM'],
      [3, 'RHP_HTEL/Addendum to RHP.pdf', 'ADDENDUM'],
    ]
  );
  assert.match(formatMissing('hy-tech-engineers-ltd', ZIP_URL, r.missing[0]), /^hy-tech-engineers-ltd: RHP_HTEL\.zip member 1 'RHP_HTEL\/Corrigendum\/BS Mumbai/);
});

test('the same zip PASSes once every expected member has its row', async () => {
  const zip = buildZip([
    { name: 'RHP_HTEL/Corrigendum/BS Mumbai 20-08-2026-8.pdf', bytes: 120 * KB },
    { name: 'RHP_HTEL/HTEL Price Band Ad FE.pdf', bytes: 130 * KB },
    { name: 'RHP_HTEL/GID.pdf', bytes: 200 * KB },
    { name: 'RHP_HTEL/HTEL Red Herring Prospectus.pdf', bytes: 900 * KB },
  ]);
  const r = await evaluate(zip, {
    mainType: 'RHP',
    partNumber: 4,
    memberRowNames: new Set(['RHP_HTEL/Corrigendum/BS Mumbai 20-08-2026-8.pdf', 'RHP_HTEL/HTEL Price Band Ad FE.pdf']),
  });
  assert.equal(r.missing.length, 0);
  assert.equal(r.present.length, 2);
});

test('a GID member and every member the runner logs as zip_member_skipped are never counted missing', async () => {
  const zip = buildZip([
    { name: 'X/German Green Steel_GID.pdf', bytes: 300 * KB }, // gid
    { name: 'X/FE.pdf', bytes: 300 * KB }, // unclassified
    { name: 'X/Corrigendum tiny.pdf', bytes: MIN_DOCUMENT_BYTES - 1 }, // too_small
    { name: 'X/RHP volume 2.pdf', bytes: 400 * KB }, // same_type_as_main:RHP
    { name: 'X/Abridged Prospectus.pdf', bytes: 300 * KB }, // abridged -> unclassified
    { name: 'X/RHP volume 1.pdf', bytes: 800 * KB }, // main
  ]);
  const { entries } = await fetchZipCentralDirectory(ZIP_URL, { fetchImpl: rangeFetch(zip) });
  const members = pdfMembers(entries);
  const main = selectMainMember(members, 'RHP', 6);
  const others = classifyOtherMembers(members, main, { mainType: 'RHP' });
  assert.deepEqual(others.map((o) => o.disposition), ['gid', 'unclassified', 'too_small', 'same_type_as_main:RHP', 'unclassified']);
  const r = compareZipToRows({ others, memberRowNames: new Set() });
  assert.equal(r.missing.length, 0);
});

test('a member deduplicated by sha256 (OD-33) is accounted for by an equal-size row of the same IPO, and by a logged line', async () => {
  // Real shape, staging 2026-09-25: RATIOS_STEAMHOUSE.zip member 1 is
  // 2,545,211 bytes, the same as the BSE PriceBandAD row, so no member row.
  const zip = buildZip([
    { name: 'RATIOS_STEAMHOUSE/SIL_Price Band Ad_FE.pdf', bytes: 260 * KB },
    { name: 'RATIOS_STEAMHOUSE/SIL_Price Band Ad_Gujarat Mitra.pdf', bytes: 600 * KB },
    { name: 'RATIOS_STEAMHOUSE/SIL_Price Band Ad_Jansatta.pdf', bytes: 280 * KB },
  ]);
  const base = { mainType: 'RATIOS_BASIS_ISSUE_PRICE', partNumber: 2, memberRowNames: new Set(['RATIOS_STEAMHOUSE/SIL_Price Band Ad_Jansatta.pdf']) };
  const bare = await evaluate(zip, base);
  assert.equal(bare.missing.length, 1, 'without dedup evidence the FE member is missing');
  const bySize = await evaluate(zip, { ...base, otherDocSizes: new Map([[260 * KB, 'PRICE_BAND_AD']]) });
  assert.equal(bySize.missing.length, 0);
  assert.equal(bySize.deduped[0].dedupedTo, 'PRICE_BAND_AD');
  const byLog = await evaluate(zip, { ...base, loggedMembers: new Set(['RATIOS_STEAMHOUSE/SIL_Price Band Ad_FE.pdf']) });
  assert.equal(byLog.missing.length, 0);
});

test('with no part_number the main member is chosen the runner way (typed by wanted type, else biggest)', () => {
  const ms = [
    { name: 'R/a Price Band.pdf', bytes: 900, position: 1 },
    { name: 'R/RHP x.pdf', bytes: 100, position: 2 },
    { name: 'R/other.pdf', bytes: 500, position: 3 },
  ];
  assert.equal(selectMainMember(ms, 'RHP', null).position, 2);
  assert.equal(selectMainMember(ms, 'RATIOS_BASIS_ISSUE_PRICE', null).position, 1);
  assert.equal(selectMainMember(ms, 'RHP', 3).position, 3);
});

test('only Range requests are made; a directory outside the tail window costs a second Range, never a full GET', async () => {
  const big = 70 * KB; // members + a long comment push the directory out of the 64 KB tail
  const zip = buildZip(
    [{ name: 'A/Corrigendum.pdf', bytes: big }, { name: 'A/RHP.pdf', bytes: big }],
    { comment: 'x'.repeat(0xffff) }
  );
  const log = [];
  const { entries, requests } = await fetchZipCentralDirectory(ZIP_URL, { fetchImpl: rangeFetch(zip, log) });
  assert.equal(entries.length, 2);
  assert.equal(requests, 2);
  assert.equal(log[0], `bytes=-${EOCD_TAIL_BYTES}`);
  assert.match(log[1], /^bytes=\d+-\d+$/);
});

test('a host that ignores Range (HTTP 200) is refused, not read in full', async () => {
  const fetchImpl = async () => ({ status: 200, headers: { get: () => null }, arrayBuffer: async () => new ArrayBuffer(10) });
  await assert.rejects(fetchZipCentralDirectory(ZIP_URL, { fetchImpl }), /HTTP 200 to a Range request/);
});

// ---- parity with the runner ------------------------------------------------

const TITLES = [
  'RHP_HTEL/Corrigendum/BS Mumbai 20-08-2026-8.pdf', 'GID.pdf', 'Red_Herring_Prospectus_and_GID.zip',
  'DRHP_ACME.pdf', 'RHPSkyways_20260818181315.pdf', 'Prospectus.pdf', 'PriceBandAdvertisementSkyways_1.pdf',
  'CorrigendumofRHPSkyways.pdf', 'Addendum.pdf', 'Security Parameters ', 'Post Anchor Security Parameters.pdf',
  'Basis of Allotment Advertisement.pdf', 'Basis of Issue Price.pdf', 'RATIOS_X.pdf', 'Bidding Centres.pdf',
  'Sample Application Form.pdf', 'Anchor Allocation.pdf', 'FE.pdf', 'JANSATTA.pdf', 'DGT.PDF',
  'SIL_Price Band Ad_FE.pdf', 'Draft Red Herring Prospectus.pdf', 'Abridged Prospectus.pdf', '',
];

let ssot = null;
let ssotErr = null;
try {
  ssot = await import(pathToFileURL(join(ROOT, 'scraper', 'src', 'services', 'document-classifier.ts')).href);
} catch (e) {
  ssotErr = e;
}

test('parity: classifyByTitle mirror equals the SSOT (document-classifier.ts, imported directly)', () => {
  assert.equal(ssotErr, null, `could not import document-classifier.ts: ${ssotErr?.message}`);
  for (const t of TITLES) assert.equal(classifyByTitle(t), ssot.classifyByTitle(t), `title '${t}'`);
});

test('parity: the verifier rules this module mirrors are still the ones in the runner source', () => {
  const v = readFileSync(join(ROOT, 'scraper', 'src', 'services', 'document-download-verifier.ts'), 'utf8').replace(/\r\n/g, '\n');
  const zm = readFileSync(join(ROOT, 'scraper', 'src', 'services', 'zip-member-documents.ts'), 'utf8');
  for (const needle of [
    'export const MIN_DOCUMENT_BYTES = 50 * 1024;',
    'const DEFAULT_MAX_DOCUMENT_MB = 100;',
    "return /(^|[^a-z0-9])gid([^a-z0-9]|$)/.test(base) || base.includes('general information document');",
    "if (/abridged/i.test(baseName(name))) return null;",
    "  'CORRIGENDUM',\n  'ADDENDUM',\n  'PRICE_BAND_AD',\n]);",
    "if (isGidMemberName(m.name)) return { ...base, disposition: 'gid' as const };",
    "if (m.content.length < MIN_DOCUMENT_BYTES) return { ...base, ...typing, disposition: 'too_small' as const };",
    "if (m.content.length > maxBytes) return { ...base, ...typing, disposition: 'too_large' as const };",
    "if (!typed) return { ...base, disposition: 'unclassified' as const };",
  ]) {
    assert.ok(v.includes(needle), `document-download-verifier.ts no longer contains: ${needle}`);
  }
  assert.ok(zm.includes("reason: `same_type_as_main:${m.type}`"), 'zip-member-documents.ts same_type_as_main rule moved');
  assert.ok(zm.includes('const MEMBER_FRAGMENT = \'#member=\';'), 'zip-member-documents.ts member url shape moved');
});
