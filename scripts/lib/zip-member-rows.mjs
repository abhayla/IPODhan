// Item 10 detection check `zip_member_rows` (OD-36, F-154; failure class
// container-unwrapped-to-one-member). PURE parts only: the zip central-directory
// parse, the runner's member classification, and the member-vs-rows comparison.
// The network read (one HTTP Range request per zip) is `fetchZipCentralDirectory`
// below, injected with its own fetch so the tests never touch a host.
//
// MIRROR, NOT IMPORT. `scripts/*.mjs` runs under plain `node` with no build step,
// and the runner's classifier lives in TypeScript files that import other
// runtime modules by `.js` path, which Node's type stripping cannot resolve. So
// the rules below are hand copies of:
//   - classifyByTitle            scraper/src/services/document-classifier.ts
//   - isGidMemberName            scraper/src/services/document-download-verifier.ts
//   - classifyZipMemberName      scraper/src/services/document-download-verifier.ts
//   - reportOtherMembers (dispositions, order gid -> size -> unclassified -> typed)
//                                scraper/src/services/document-download-verifier.ts
//   - selectZipMemberForType     scraper/src/services/document-download-verifier.ts
//   - same_type_as_main skip     scraper/src/services/zip-member-documents.ts
//   - MIN_DOCUMENT_BYTES / DEFAULT_MAX_DOCUMENT_MB  document-download-verifier.ts
//   - decodeZipMemberName        scraper/src/services/primary-source-discovery.ts
// scripts/tests/zip-member-rows.test.mjs holds the parity guard: classifyByTitle
// is compared against the SSOT imported directly (document-classifier.ts has
// type-only imports), and the verifier's rules are pinned by their source text.
//
// ONE KNOWN DIFFERENCE, stated rather than hidden: the runner counts a member as
// a PDF by its inflated bytes (`%PDF` magic). A central directory holds no
// bytes, so here a member is a PDF by its name ending in `.pdf` (any case).
// Measured 2026-09-25 on 4 real staging zips (NSE RATIOS_RUNWALENTR,
// RATIOS_STEAMHOUSE, RHP_HIMALAYAN; BSE FE_20260909152522): every non-folder
// member ends in .pdf/.PDF and the positions the runner wrote (part_number)
// match the positions counted this way.

/** The runner's download floor (document-download-verifier.ts MIN_DOCUMENT_BYTES). */
export const MIN_DOCUMENT_BYTES = 50 * 1024;
/** The runner's default cap (document-download-verifier.ts DEFAULT_MAX_DOCUMENT_MB). */
export const DEFAULT_MAX_DOCUMENT_MB = 100;

export function getMaxDocumentBytes(env = process.env) {
  const n = Number(env.PROSPECTUS_MAX_DOCUMENT_MB);
  return (Number.isFinite(n) && n > 0 ? n : DEFAULT_MAX_DOCUMENT_MB) * 1024 * 1024;
}

// ---- classifyByTitle (mirror of document-classifier.ts) -------------------

function normalizeTitle(t) {
  return t
    .replace(/\.[a-z0-9]{2,5}$/, '')
    .replace(/[_\-.]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
const isDraft = (t) => t.includes('draft') || /drhp/.test(t);
const isRedHerring = (t) => t.includes('red herring') || /rhp/.test(t);

export function classifyByTitle(rawTitle) {
  if (typeof rawTitle !== 'string') return null;
  const t = normalizeTitle(rawTitle.toLowerCase().trim());
  if (t === '') return null;
  if (t.includes('security parameter')) {
    return t.includes('post') ? 'SECURITY_PARAMS_POST_ANCHOR' : 'SECURITY_PARAMS_PRE_ANCHOR';
  }
  if (t.includes('price band') || t.includes('pricebandad')) return 'PRICE_BAND_AD';
  if (t.includes('basis of allot') || t.includes('allotment advert')) return 'BASIS_OF_ALLOTMENT_AD';
  if (t.includes('corrigendum')) return 'CORRIGENDUM';
  if (t.includes('addendum')) return 'ADDENDUM';
  if (isDraft(t) && t.includes('prospectus')) return 'DRHP';
  if (isDraft(t) && isRedHerring(t)) return 'DRHP';
  if (isRedHerring(t)) return 'RHP';
  if (t.includes('prospectus')) return 'PROSPECTUS';
  if (t.includes('anchor')) return 'ANCHOR_ALLOCATION_REPORT';
  if (t.includes('ratios') || t.includes('basis of issue price')) return 'RATIOS_BASIS_ISSUE_PRICE';
  if (t.includes('bidding center') || t.includes('bidding centre')) return 'BIDDING_CENTERS';
  if (t.includes('application form')) return 'SAMPLE_APPLICATION_FORMS';
  return null;
}

// ---- member-name rules (mirror of document-download-verifier.ts) ----------

const baseName = (name) => name.split(/[\/]/).pop() ?? name;

export function isGidMemberName(name) {
  const base = baseName(name).toLowerCase();
  return /(^|[^a-z0-9])gid([^a-z0-9]|$)/.test(base) || base.includes('general information document');
}

const FOLDER_TYPABLE = new Set(['CORRIGENDUM', 'ADDENDUM', 'PRICE_BAND_AD']);

export function classifyZipMemberName(name) {
  if (/abridged/i.test(baseName(name))) return null;
  const own = classifyByTitle(baseName(name));
  if (own) return { type: own, typedBy: 'name' };
  const parts = name.split(/[\/]/).filter(Boolean);
  if (parts.length >= 2) {
    const folderType = classifyByTitle(parts[parts.length - 2]);
    if (folderType && FOLDER_TYPABLE.has(folderType)) return { type: folderType, typedBy: 'folder' };
  }
  return null;
}

// ---- central directory ----------------------------------------------------

const EOCD_SIG = 0x06054b50;
const CD_SIG = 0x02014b50;
const CP437_HIGH =
  'ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ ';

export function decodeZipMemberName(bytes, flags) {
  if ((flags & 0x0800) !== 0) return bytes.toString('utf8');
  if (bytes.every((b) => b < 0x80)) return bytes.toString('latin1');
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    let out = '';
    for (const b of bytes) out += b < 0x80 ? String.fromCharCode(b) : CP437_HIGH[b - 0x80];
    return out;
  }
}

/** Bytes to request from the end of a zip: the EOCD (22) plus the largest comment (0xffff). */
export const EOCD_TAIL_BYTES = 22 + 0xffff;

/**
 * Locate the end-of-central-directory record in the last bytes of a zip.
 * `tail` is the buffer, `tailStart` the absolute offset of its first byte.
 * Returns { entryCount, cdSize, cdOffset } or throws with the reason.
 */
export function readEocd(tail) {
  for (let i = tail.length - 22; i >= 0; i--) {
    if (tail.readUInt32LE(i) !== EOCD_SIG) continue;
    const entryCount = tail.readUInt16LE(i + 10);
    const cdSize = tail.readUInt32LE(i + 12);
    const cdOffset = tail.readUInt32LE(i + 16);
    if (entryCount === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
      throw new Error('zip64 archive (EOCD fields saturated): not parsed by this check');
    }
    return { entryCount, cdSize, cdOffset };
  }
  throw new Error('no end-of-central-directory record in the last bytes: not a zip, or truncated');
}

/** Parse `entryCount` central-directory entries from `cd` (a buffer holding exactly the directory). */
export function parseCentralDirectory(cd, entryCount) {
  const entries = [];
  let p = 0;
  for (let e = 0; e < entryCount; e++) {
    if (p + 46 > cd.length || cd.readUInt32LE(p) !== CD_SIG) {
      throw new Error(`central directory entry ${e + 1} of ${entryCount} is malformed`);
    }
    const flags = cd.readUInt16LE(p + 8);
    const uncompressed = cd.readUInt32LE(p + 24);
    const nameLen = cd.readUInt16LE(p + 28);
    const extraLen = cd.readUInt16LE(p + 30);
    const commentLen = cd.readUInt16LE(p + 32);
    const name = decodeZipMemberName(cd.subarray(p + 46, p + 46 + nameLen), flags);
    entries.push({ name, bytes: uncompressed });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

/**
 * The PDF members in central-directory order, positioned 1..n the way the
 * runner numbers them (extractPdfMembersFromZip counts PDF members only).
 */
export function pdfMembers(entries) {
  const out = [];
  for (const e of entries) {
    if (e.name.endsWith('/')) continue;
    if (!/\.pdf$/i.test(e.name)) continue;
    out.push({ name: e.name, bytes: e.bytes, position: out.length + 1 });
  }
  return out;
}

/**
 * The member stored as the zip row's own document. The row's part_number names
 * it when set; otherwise the runner's selectZipMemberForType rule (one member ->
 * it; a member typed as the wanted type by its base name -> the biggest such;
 * else the biggest).
 */
export function selectMainMember(members, wantedType, partNumber) {
  if (members.length === 0) return null;
  if (partNumber != null) {
    const byPart = members.find((m) => m.position === Number(partNumber));
    if (byPart) return byPart;
  }
  if (members.length === 1) return members[0];
  const biggest = (list) => list.reduce((a, b) => (b.bytes > a.bytes ? b : a));
  if (wantedType) {
    const named = members.filter((m) => classifyByTitle(baseName(m.name)) === wantedType);
    if (named.length > 0) return biggest(named);
  }
  return biggest(members);
}

/**
 * Every member other than the main one, with the runner's disposition:
 * 'expected' (a row must exist) or the skip reason the runner logs as
 * zip_member_skipped:<reason> (gid, too_small, too_large, unclassified,
 * same_type_as_main:<type>).
 */
export function classifyOtherMembers(members, main, { mainType, maxBytes = getMaxDocumentBytes() }) {
  const out = [];
  for (const m of members) {
    if (main && m.position === main.position) continue;
    const base = { name: m.name, position: m.position, bytes: m.bytes };
    if (isGidMemberName(m.name)) { out.push({ ...base, disposition: 'gid' }); continue; }
    const typed = classifyZipMemberName(m.name);
    if (m.bytes < MIN_DOCUMENT_BYTES) { out.push({ ...base, type: typed?.type, disposition: 'too_small' }); continue; }
    if (m.bytes > maxBytes) { out.push({ ...base, type: typed?.type, disposition: 'too_large' }); continue; }
    if (!typed) { out.push({ ...base, disposition: 'unclassified' }); continue; }
    if (typed.type === mainType) { out.push({ ...base, type: typed.type, disposition: `same_type_as_main:${typed.type}` }); continue; }
    out.push({ ...base, type: typed.type, typedBy: typed.typedBy, disposition: 'expected' });
  }
  return out;
}

/** The member path a `<zip>#member=<path>` url names (zip-member-documents.ts memberNameFromUrl). */
export function memberNameFromUrl(url) {
  const at = url.indexOf('#member=');
  if (at < 0) return null;
  try { return decodeURIComponent(url.slice(at + '#member='.length)); } catch { return null; }
}

/**
 * Compare one zip's expected members with the rows written from it.
 *
 * A member the runner deduplicated by sha256 (OD-33: its bytes were already
 * stored for this IPO under another url) correctly has no member row. A
 * central directory holds no sha256, so the durable evidence used is another
 * document row of the same IPO whose file_size equals the member's size
 * exactly (measured 2026-09-25: Steamhouse's RATIOS zip member
 * 'SIL_Price Band Ad_FE.pdf' is 2,545,211 bytes, the same as the BSE
 * PriceBandAD row). A member logged as zip_member_deduped / zip_member_skipped
 * in document_fetch_state.last_attempt is also accounted for.
 *
 * Returns { expected, present, deduped, logged, missing } where each list holds
 * member objects; `missing` is what FAILs.
 */
export function compareZipToRows({ others, memberRowNames, otherDocSizes = new Map(), loggedMembers = new Set() }) {
  const expected = others.filter((m) => m.disposition === 'expected');
  const present = [], deduped = [], logged = [], missing = [];
  for (const m of expected) {
    if (memberRowNames.has(m.name)) { present.push(m); continue; }
    const same = otherDocSizes.get(Number(m.bytes));
    if (same) { deduped.push({ ...m, dedupedTo: same }); continue; }
    if (loggedMembers.has(m.name)) { logged.push(m); continue; }
    missing.push(m);
  }
  return { expected, present, deduped, logged, missing };
}

/** The line one missing member prints: identity, name and position (signal-ownership.md R1). */
export function formatMissing(slug, zipUrl, m) {
  const zipName = zipUrl.split('/').pop();
  return `${slug}: ${zipName} member ${m.position} '${m.name}' (${m.type}, ${m.bytes} bytes) has no row`;
}

// ---- network --------------------------------------------------------------

const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

function hostHeaders(url) {
  const h = { 'User-Agent': BROWSER_UA, Accept: '*/*' };
  if (/nseindia\.com/i.test(url)) h.Referer = 'https://www.nseindia.com/';
  if (/bseindia\.com/i.test(url)) h.Referer = 'https://www.bseindia.com/';
  return h;
}

async function rangeGet(url, range, { fetchImpl, timeoutMs }) {
  const res = await fetchImpl(url, {
    headers: { ...hostHeaders(url), Range: `bytes=${range}` },
    signal: AbortSignal.timeout(timeoutMs),
  });
  const body = Buffer.from(await res.arrayBuffer());
  if (res.status !== 206) {
    throw new Error(`HTTP ${res.status} to a Range request (${body.length} bytes returned)`);
  }
  const cr = res.headers.get('content-range') || '';
  const m = /bytes (\d+)-(\d+)\/(\d+)/.exec(cr);
  if (!m) throw new Error(`206 without a usable Content-Range ('${cr}')`);
  return { body, start: Number(m[1]), total: Number(m[3]) };
}

/**
 * Read a zip's member list with Range requests only: the last EOCD_TAIL_BYTES,
 * then the directory itself if it lies outside that window. Never the whole
 * archive. Throws with the reason on any refusal (the caller reports the zip
 * UNVERIFIABLE with that reason).
 */
export async function fetchZipCentralDirectory(url, { fetchImpl = fetch, timeoutMs = 15000 } = {}) {
  const tail = await rangeGet(url, `-${EOCD_TAIL_BYTES}`, { fetchImpl, timeoutMs });
  const { entryCount, cdSize, cdOffset } = readEocd(tail.body);
  let cd;
  let requests = 1;
  if (cdOffset >= tail.start && cdOffset + cdSize <= tail.start + tail.body.length) {
    cd = tail.body.subarray(cdOffset - tail.start, cdOffset - tail.start + cdSize);
  } else {
    const part = await rangeGet(url, `${cdOffset}-${cdOffset + cdSize - 1}`, { fetchImpl, timeoutMs });
    cd = part.body;
    requests = 2;
  }
  return { entries: parseCentralDirectory(cd, entryCount), totalBytes: tail.total, requests };
}
