/**
 * Company-host rung — the FOURTH source in the decision tree (T-403 G2, matrix §1),
 * plus the Chittorgarh link VERIFIER (never a document source).
 *
 * Consulted only after BSE, NSE and SEBI have all failed for a type. It is the
 * only source that had everything for Skyways in the original probe, and it is
 * also the least structured: every issuer lays its investor page out differently,
 * so this rung reads links and classifies their text rather than assuming a shape.
 *
 * Two hard limits, both deliberate:
 *   - At most 3 GETs per IPO per cycle (`/investors`, `/investor-relations`,
 *     `/ipo`). An unbounded crawl of an unknown host inside the 30-minute scrape
 *     is how discovery starves the cycle it shares a process with (R12).
 *   - Chittorgarh is a VERIFIER ONLY (owner rule, 2026-08-28). We read the links
 *     it displays, and follow one only when it points at BSE / NSE / SEBI and we
 *     have not already tried that exact URL. A file is never stored from
 *     Chittorgarh's own host.
 *
 * Pure: every function takes already-fetched HTML. Fetching is the runner's.
 * Two exceptions, both item 22 (OD-37): `isResolvedAddressPrivate` does its
 * own DNS lookup (a resolved-address check cannot be pure — the whole point
 * is to see what the name ACTUALLY resolves to, not trust the string), and
 * `loadRegistrarDocumentHosts` does its own DB read (cached per cycle, the
 * same pattern `document-discovery-runner.ts`'s `boardCache` uses).
 */

import * as cheerio from 'cheerio';
import { lookup } from 'node:dns/promises';
import { eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '@ipodhan/shared/db/schema';
import { registrars } from '@ipodhan/shared/db/schema';
import { classifyByTitle, fileNameFromUrl } from './document-classifier.js';
import type { DocumentType } from './document-types.js';
import { loadDownloadAllowlist } from '../config/download-allowlist-loader.js';

/** Investor-page paths to try, in order. Capped at 3 GETs (R12). */
export const COMPANY_INVESTOR_PATHS = ['/investors', '/investor-relations', '/ipo'] as const;

export const MAX_COMPANY_HOST_FETCHES = COMPANY_INVESTOR_PATHS.length;

/**
 * Pull the issuer's website off a filing cover page.
 *
 * Every RHP/DRHP cover carries a "Website: www.example.com" line in the company
 * block. We now extract cover text for the company-name check (M1), so the URL
 * is already in hand and costs nothing extra.
 *
 * Rejects the intermediaries' own domains: a cover also lists the BRLM's and the
 * registrar's websites, and following those would crawl a merchant bank looking
 * for an issuer's prospectus.
 */
export const NON_ISSUER_DOMAINS = [
  'sebi.gov.in',
  'bseindia.com',
  'nseindia.com',
  'linkintime',
  'bigshareonline',
  'kfintech',
  'skylinerta',
  'cameoindia',
  'maashitla',
  'purvashare',
  'chittorgarh',
];

/**
 * Words that mark a "Website:" line as belonging to an INTERMEDIARY rather than
 * the issuer. Context, not a domain list: merchant-bank domains cannot be
 * enumerated (holaniconsultants.co.in, shannon.co.in, dolatfinserv.com ... a new
 * one appears with every issue), but the cover always labels whose website it is.
 */
const INTERMEDIARY_CONTEXT = [
  'lead manager',
  'book running',
  'brlm',
  'registrar',
  'banker',
  'syndicate',
  'sponsor bank',
  'merchant bank',
  'advisor',
  'adviser',
  'legal counsel',
  'auditor',
];

/** How far back to look for the label that says whose website this is. */
const CONTEXT_WINDOW = 120;

export function extractWebsiteFromCoverText(coverText: string): string | null {
  if (typeof coverText !== 'string' || coverText.trim() === '') return null;

  const matches = [
    ...coverText.matchAll(/website\s*[:\-]?\s*((?:https?:\/\/)?[\w.-]+\.[a-z]{2,}[^\s,;)]*)/gi),
  ];
  let previousMatchEnd = 0;
  for (const m of matches) {
    const start = m.index ?? 0;
    // Whose website is this? Look only at the text between the PREVIOUS website
    // mention and this one, so each match sees its OWN label. A fixed-width
    // window would drag in the preceding party's label — on a cover reading
    // "Registrar Website: ... Company Website: ..." that rejects the issuer.
    const before = coverText
      .slice(Math.max(previousMatchEnd, start - CONTEXT_WINDOW), start)
      .toLowerCase();
    previousMatchEnd = start + m[0].length;
    if (INTERMEDIARY_CONTEXT.some((w) => before.includes(w))) continue;

    const raw = m[1].trim().replace(/[.,;]+$/, '');
    // M-a: the SSRF guard belongs HERE, at the point of extraction, not at each
    // use site. This value is read off a scraped PDF cover and was previously
    // returned raw: the runner stored it, fetched it on the company rung, and
    // persisted it — three uses, one of which (the fetch) never called
    // `normalizeCompanyUrl`. A cover reading "Website: metadata.google.internal"
    // was therefore fetchable. Normalising at extraction makes the guard
    // unforgettable, which is the only version of it worth having.
    const normalized = normalizeCompanyUrl(raw);
    if (!normalized) continue;
    if (NON_ISSUER_DOMAINS.some((d) => new URL(normalized).hostname.includes(d))) continue;
    return normalized;
  }
  return extractWebsiteFromTableLayout(coverText);
}

/**
 * How far past a bare `WEBSITE` column header to look for its value.
 *
 * W-31. A mainboard RHP cover is a TABLE: a header row reading
 * "REGISTERED OFFICE | CONTACT PERSON | TELEPHONE AND E-MAIL | WEBSITE", then
 * the cells underneath. Extracted linearly that puts the word WEBSITE hundreds
 * of characters before its own value, with the whole registered-office address
 * in between — so the label-then-url regex above matched nothing and the DEEPA
 * walk skipped the company rung with `no_company_url` on every document type,
 * for want of a website printed on page 1 of a filing we already held. Measured
 * on the DEEPA RHP cover the gap is ~330 characters; 900 leaves room for a
 * longer address without reaching the next section of the page.
 */
const TABLE_HEADER_WINDOW = 900;

/**
 * Where the issuer's own block on a cover page ENDS.
 *
 * A cover reads: issuer name / CIN / registered office / contact / website,
 * THEN the intermediaries — "BOOK RUNNING LEAD MANAGER", "REGISTRAR TO THE
 * OFFER" — each with their own address and website. The first of these headings
 * is the boundary: anything past it belongs to somebody else.
 */
const ISSUER_BLOCK_TERMINATORS =
  /\b(book\s+running\s+lead\s+manager|lead\s+manager|brlm|registrar\s+to\s+the|registrar|banker[s]?\s+to\s+the|syndicate\s+member|sponsor\s+bank|merchant\s+bank)\b/i;

/** Domains a cover prints NEXT TO an intermediary label, anywhere on the page. */
function intermediaryDomains(coverText: string): Set<string> {
  const out = new Set<string>();
  for (const m of coverText.matchAll(
    /((?:https?:\/\/)?(?:www\.)?[\w.-]+\.[a-z]{2,}[^\s,;)]*)/gi
  )) {
    const normalized = normalizeCompanyUrl(m[1].trim().replace(/[.,;]+$/, ''));
    if (!normalized) continue;
    const before = coverText
      .slice(Math.max(0, (m.index ?? 0) - CONTEXT_WINDOW), m.index ?? 0)
      .toLowerCase();
    if (INTERMEDIARY_CONTEXT.some((w) => before.includes(w))) {
      out.add(new URL(normalized).hostname.toLowerCase());
    }
  }
  return out;
}

/**
 * Fallback for the table-layout cover: a bare `WEBSITE` COLUMN HEADER whose
 * value sits in a cell further down (the DEEPA RHP puts ~330 characters of
 * registered-office address in between, which is why the labelled form above
 * cannot see it).
 *
 * W-31 regression, found by `company-host-source.test.ts`: the first cut looked
 * only at the text AFTER the header, so on
 * "Book Running Lead Manager Website: www.holaniconsultants.co.in" it read the
 * BRLM's site as the issuer's — the label that disowns it sits BEFORE the word
 * "Website", exactly where the fallback was not looking. Three guards now, each
 * closing one route in:
 *
 *  1. the header itself must not be labelled with an intermediary (look BEHIND it);
 *  2. the search window stops at the first BRLM/registrar/banker heading — the
 *     end of the issuer's own block;
 *  3. a domain the cover prints next to an intermediary label ANYWHERE is
 *     rejected, however it is reached.
 */
function extractWebsiteFromTableLayout(coverText: string): string | null {
  const disowned = intermediaryDomains(coverText);

  for (const header of coverText.matchAll(/\bwebsite\b/gi)) {
    const headerAt = header.index ?? 0;
    // 1. Whose website column is this? The label precedes the header.
    const labelContext = coverText
      .slice(Math.max(0, headerAt - CONTEXT_WINDOW), headerAt)
      .toLowerCase();
    if (INTERMEDIARY_CONTEXT.some((w) => labelContext.includes(w))) continue;

    // 2. The issuer's block ends at the first intermediary heading after it.
    const start = headerAt + header[0].length;
    let window = coverText.slice(start, start + TABLE_HEADER_WINDOW);
    const boundary = window.search(ISSUER_BLOCK_TERMINATORS);
    if (boundary >= 0) window = window.slice(0, boundary);

    for (const m of window.matchAll(
      /(?:^|[\s(])((?:https?:\/\/)?www\.[\w.-]+\.[a-z]{2,}[^\s,;)]*)/gi
    )) {
      // An e-mail's domain is not a website; `www.` is required above precisely
      // so `cs@deepajewel.com` on the same cover cannot be mistaken for one.
      const raw = m[1].trim().replace(/[.,;]+$/, '');
      const normalized = normalizeCompanyUrl(raw);
      if (!normalized) continue;
      const host = new URL(normalized).hostname.toLowerCase();
      if (NON_ISSUER_DOMAINS.some((d) => host.includes(d))) continue;
      // 3. Named as an intermediary's site anywhere on this cover.
      if (disowned.has(host)) continue;
      const at = m.index ?? 0;
      const before = window.slice(Math.max(0, at - CONTEXT_WINDOW), at).toLowerCase();
      if (INTERMEDIARY_CONTEXT.some((w) => before.includes(w))) continue;
      return normalized;
    }
  }
  return null;
}

/**
 * Hosts that must never be fetched, whatever a database row says (MIN-8).
 *
 * The company URL comes from a scraped PDF cover or a scraped field, so it is
 * attacker-influenceable input that this process then fetches. Loopback,
 * private and link-local addresses would turn that into a request against our
 * own infrastructure (169.254.169.254 is the cloud metadata endpoint), so they
 * are refused outright rather than trusted.
 */
const PRIVATE_HOST_PATTERNS = [
  /^localhost$/i,
  /^127\./,
  /^0\./,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^169\.254\./,
  /^\[?::1\]?$/,
  /^\[?f[cd][0-9a-f]{2}:/i,
  /\.local$/i,
  /\.internal$/i,
];

/**
 * IPv4 address in a private/loopback/link-local/unspecified range.
 * Mirrors `PRIVATE_HOST_PATTERNS`' ranges but against a resolved octet
 * quad, not a hostname string. A quad that fails to parse is treated as
 * private (fail closed — item 22, OD-37).
 */
function isPrivateIPv4Address(ip: string): boolean {
  const octets = ip.split('.').map((p) => Number(p));
  if (octets.length !== 4 || octets.some((o) => !Number.isInteger(o) || o < 0 || o > 255)) {
    return true;
  }
  const [a, b] = octets;
  if (a === 0) return true; // 0.0.0.0/8
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 127) return true; // 127.0.0.0/8 loopback
  if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  return false;
}

/**
 * Parse any textual IPv6 form (expanded, `::`-compressed, with a trailing
 * dotted-decimal IPv4 tail, any casing, an optional zone id or brackets)
 * into its 8 canonical 16-bit groups. Returns null on anything that does
 * not parse — the caller fails closed on null, never on a thrown error.
 *
 * This is the fix for the class the reviewer found (item 22 round 2):
 * the old check matched ONE textual spelling of IPv4-mapped
 * (`::ffff:a.b.c.d`) via regex, so the same address written in expanded
 * hex form (`0:0:0:0:0:ffff:7f00:1`, which some resolvers/stacks emit)
 * read as public. Parsing to groups first means every spelling of the
 * same bits is classified identically.
 */
function parseIPv6Groups(raw: string): number[] | null {
  let s = raw.trim().toLowerCase();
  s = s.replace(/^\[/, '').replace(/\]$/, '');
  const zoneIdx = s.indexOf('%');
  if (zoneIdx >= 0) s = s.slice(0, zoneIdx);
  if (s === '') return null;

  // A trailing dotted-decimal IPv4 tail (IPv4-mapped/-compatible/NAT64,
  // written in dotted form rather than hex) — fold it into two hex groups
  // before the generic `::`-expansion below, so every embedding form
  // reduces to the same 8-group shape.
  const lastColon = s.lastIndexOf(':');
  const tail = lastColon >= 0 ? s.slice(lastColon + 1) : s;
  if (tail.includes('.')) {
    const octetStrs = tail.split('.');
    if (octetStrs.length !== 4 || octetStrs.some((o) => !/^\d{1,3}$/.test(o))) return null;
    const octets = octetStrs.map(Number);
    if (octets.some((o) => o > 255)) return null;
    const g6 = ((octets[0] << 8) | octets[1]).toString(16);
    const g7 = ((octets[2] << 8) | octets[3]).toString(16);
    s = lastColon >= 0 ? `${s.slice(0, lastColon + 1)}${g6}:${g7}` : `${g6}:${g7}`;
  }

  if ((s.match(/::/g) ?? []).length > 1) return null;

  let groups: string[];
  if (s.includes('::')) {
    const [headStr, tailStr] = s.split('::');
    const head = headStr === '' ? [] : headStr.split(':');
    const tailGroups = tailStr === '' ? [] : tailStr.split(':');
    const missing = 8 - head.length - tailGroups.length;
    if (missing < 0) return null;
    groups = [...head, ...Array(missing).fill('0'), ...tailGroups];
  } else {
    groups = s.split(':');
  }
  if (groups.length !== 8) return null;

  const values: number[] = [];
  for (const g of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
    values.push(parseInt(g, 16));
  }
  return values;
}

/** Reassemble two 16-bit groups (the low 32 bits of an IPv6 address) as a dotted IPv4 string. */
function ipv4FromGroups(g6: number, g7: number): string {
  return [(g6 >> 8) & 0xff, g6 & 0xff, (g7 >> 8) & 0xff, g7 & 0xff].join('.');
}

/**
 * IPv6 address in a loopback/link-local/unique-local range, OR one that
 * EMBEDS an IPv4 address in a private range, for the specific embedding
 * forms listed below — not every spelling of an embedded address, only
 * these three prefixes, however THEY are spelled. Parses to 8 canonical
 * groups first (see `parseIPv6Groups`), so expanded hex, `::`-compressed,
 * and dotted-tail forms of a COVERED embedding are all classified
 * identically.
 *
 * Embeddings checked, each by testing the embedded IPv4 with
 * `isPrivateIPv4Address` (item 22 round 2, MAJOR-1):
 *   - IPv4-mapped `::ffff:a.b.c.d` (groups 0-4 zero, group 5 = 0xffff) —
 *     RFC 4291 §2.5.5.2, the form a dual-stack resolver hands back for an
 *     IPv4-only name; this is the class the reviewer's mutation proved has
 *     no test at all (now covered by the metadata-address tests below).
 *   - IPv4-compatible `::a.b.c.d` (groups 0-5 zero, deprecated by RFC 4291
 *     but still parsed by Node's resolver) — same embedding, no `ffff`
 *     marker; refused on the same embedded-address check. `::` itself
 *     (all-zero, the unspecified address) refuses too — never a valid
 *     fetch target.
 *   - NAT64 `64:ff9b::/96` (groups 0-1 = `64:ff9b`, groups 2-5 zero) — a
 *     stateless IPv4/IPv6 translator prefix; the last 32 bits are the real
 *     IPv4 destination, so a translated request to a private address is
 *     refused the same as a direct one. A NAT64-embedded PUBLIC address is
 *     allowed, matching how the translator would actually route it.
 *
 * NOT covered (item 22 round 3, reviewer MINOR — deliberately, not an
 * oversight; each needs an intermediary this process does not have to turn
 * into an actual loopback hit, so the risk is judged lower than the three
 * above):
 *   - `::ffff:0:a.b.c.d` — the IPv4-translated prefix `64:ff9b:1::/48`'s
 *     sibling, `::ffff:0:0:0/96` (SIIT, RFC 6052 §2.1's 5-group variant);
 *     only reachable if a SIIT box is translating for this resolver.
 *   - `64:ff9b:1::/48` — RFC 8215 LOCAL-USE NAT64; only `64:ff9b::/96`
 *     (the well-known prefix above) is handled, not an operator-chosen
 *     local one, since without knowing the operator's prefix this process
 *     cannot tell a local-use NAT64 address from an ordinary public one.
 *   - `2002::/16` — 6to4; only reachable through a 6to4 relay/tunnel this
 *     host would have to be configured to use.
 *
 * An address this cannot parse is treated as private (fail closed).
 */
function isPrivateIPv6Address(ip: string): boolean {
  const groups = parseIPv6Groups(ip);
  if (!groups) return true;

  const [g0, g1, g2, g3, g4, g5, g6, g7] = groups;

  // ::1 loopback (groups 0-6 zero, group 7 === 1), any spelling.
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0 && g6 === 0 && g7 === 1) {
    return true;
  }

  // IPv4-mapped ::ffff:a.b.c.d
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0xffff) {
    return isPrivateIPv4Address(ipv4FromGroups(g6, g7));
  }

  // IPv4-compatible ::a.b.c.d (deprecated form, still emitted by some stacks).
  // :: (all-zero, unspecified) also lands here and is refused — never fetchable.
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0) {
    if (g6 === 0 && g7 === 0) return true; // :: unspecified
    return isPrivateIPv4Address(ipv4FromGroups(g6, g7));
  }

  // NAT64 well-known prefix 64:ff9b::/96 — check the embedded IPv4 destination.
  if (g0 === 0x64 && g1 === 0xff9b && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0) {
    return isPrivateIPv4Address(ipv4FromGroups(g6, g7));
  }

  if (g0 >= 0xfe80 && g0 <= 0xfebf) return true; // fe80::/10 link-local
  if (g0 >= 0xfc00 && g0 <= 0xfdff) return true; // fc00::/7 unique-local
  return false;
}

/**
 * NEW (item 22, OD-37) — closes the DNS-rebinding gap `PRIVATE_HOST_PATTERNS`
 * leaves open: a hostname whose NAME looks public but RESOLVES to a private
 * address. Resolves every A/AAAA record (`{ all: true }` — a rebinding attack
 * can hide the malicious address behind a legitimate first answer) and
 * refuses if ANY resolved address is private/loopback/link-local/unique-local.
 *
 * Fails CLOSED on every edge, not just a thrown lookup (item 22 round 2,
 * MAJOR-3/MINOR-1):
 *   - a lookup that throws (NXDOMAIN, timeout, a malformed hostname);
 *   - a resolved entry with a non-string/missing `address` field, so a
 *     malformed DNS answer refuses the caller instead of throwing a
 *     TypeError out of this function (the docblock's "fail closed" promise
 *     previously held only for the whole-lookup failure, not a per-entry one);
 *   - a lookup that never settles — raced against `DNS_LOOKUP_TIMEOUT_MS`.
 */
const DNS_LOOKUP_TIMEOUT_MS = 5_000;

/**
 * Why a host was refused, and the evidence for it.
 *
 * #582. `isResolvedAddressPrivate` returned a bare boolean, so FIVE different
 * outcomes - a genuinely private address, a hostname that does not resolve at
 * all, a lookup that timed out, an empty answer, and a malformed DNS entry -
 * all arrived at the caller as `true`, and the caller logged every one of them
 * as "resolves to a private, loopback, link-local or metadata address".
 *
 * That is a message asserting a cause it never established. Measured on staging
 * 2026-09-11: host `www.hy{echengineers.com` (a stored URL corrupted by one
 * character) was reported as a private-address refusal. It does not resolve at
 * all - ENOTFOUND - and the real host `www.hytechengineers.com` resolves to two
 * public Cloudflare addresses. A data-corruption bug was wearing a security
 * refusal's clothes, and nothing in the log could tell them apart.
 *
 * The caller already HAD a separate `resolver_error` branch for a throwing
 * resolver. It was dead code: this function's own `catch` swallowed the throw
 * and returned `true`, so a DNS failure could never reach it.
 *
 * `addresses` carries what the lookup actually returned, so a refusal can be
 * audited after the fact instead of taken on trust (signal-ownership R6).
 */
export type HostResolutionReason =
  | 'private_address'
  | 'dns_unresolvable'
  | 'dns_timeout'
  | 'no_addresses'
  | 'malformed_dns_answer'
  | 'public_address';

export interface HostResolutionVerdict {
  refused: boolean;
  reason: HostResolutionReason;
  /** Addresses the lookup returned. Empty when it failed or answered empty. */
  addresses: string[];
  /** The resolver's own error code/message, when it failed. */
  cause?: string;
}

/**
 * Resolve a hostname and say, with evidence, whether it may be fetched.
 *
 * Fails CLOSED on every edge - the refusal behaviour is byte-for-byte what it
 * was; only the REASON is now truthful.
 */
export async function resolveHostVerdict(hostname: string): Promise<HostResolutionVerdict> {
  let addresses: Array<{ address: string; family: number }>;
  let timer: ReturnType<typeof setTimeout>;
  try {
    addresses = await Promise.race([
      lookup(hostname, { all: true }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('dns lookup timed out')), DNS_LOOKUP_TIMEOUT_MS);
      }),
    ]);
  } catch (err) {
    const cause = err instanceof Error ? err.message : String(err);
    const code = (err as { code?: string } | null)?.code;
    // A timeout and a name that does not exist are different failures with
    // different owners: one is the network, the other is our stored data.
    const timedOut = cause === 'dns lookup timed out';
    return {
      refused: true,
      reason: timedOut ? 'dns_timeout' : 'dns_unresolvable',
      addresses: [],
      cause: code ? `${code}: ${cause}` : cause,
    };
  } finally {
    // Both outcomes race the same timer; a won lookup otherwise leaves it
    // pending and holds the event loop open for up to DNS_LOOKUP_TIMEOUT_MS
    // after this function has already returned (a one-shot scraper run
    // would idle at exit rather than exiting immediately).
    clearTimeout(timer!);
  }

  if (addresses.length === 0) {
    return { refused: true, reason: 'no_addresses', addresses: [] };
  }

  const seen: string[] = [];
  let malformed = false;
  let priv = false;
  for (const entry of addresses) {
    const { address, family } = entry ?? {};
    if (typeof address !== 'string' || address.length === 0) {
      malformed = true;
      continue;
    }
    seen.push(address);
    if (family === 6 ? isPrivateIPv6Address(address) : isPrivateIPv4Address(address)) priv = true;
  }

  // Order matters and is deliberate: a malformed entry is reported as such only
  // when nothing else already refuses, so a genuinely private answer is never
  // relabelled as a parsing problem.
  if (priv) return { refused: true, reason: 'private_address', addresses: seen };
  if (malformed) return { refused: true, reason: 'malformed_dns_answer', addresses: seen };
  return { refused: false, reason: 'public_address', addresses: seen };
}

export async function isResolvedAddressPrivate(hostname: string): Promise<boolean> {
  // Kept as the boolean face of the same decision so existing callers and
  // their tests are untouched. New callers should use resolveHostVerdict and
  // log its reason - a refusal that cannot say why is the defect in #582.
  return (await resolveHostVerdict(hostname)).refused;
}

/**
 * Normalise a stored website value into an origin we can safely fetch.
 *
 * Refuses anything that is not plain http(s), any private/loopback/link-local
 * address, and any non-standard port — a URL from scraped data must not be able
 * to point this process at an internal service.
 */
export function normalizeCompanyUrl(value: string | null | undefined): string | null {
  if (typeof value !== 'string' || value.trim() === '') return null;

  const raw = value.trim();
  let parsed: URL;
  try {
    parsed = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return null;
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
  // Only the default ports. An issuer serving its investor page on :8080 is not
  // a case worth opening this up for.
  if (parsed.port !== '') return null;

  const host = parsed.hostname.toLowerCase();
  if (!host.includes('.')) return null;
  if (PRIVATE_HOST_PATTERNS.some((re) => re.test(host))) return null;
  if (NON_ISSUER_DOMAINS.some((d) => host === d || host.endsWith(`.${d}`) || host.includes(d))) {
    return null;
  }
  return `https://${host}`;
}

/** The pages this rung will try for one company, in order. */
export function companyInvestorUrls(companyUrl: string): string[] {
  const origin = companyUrl.replace(/\/+$/, '');
  return COMPANY_INVESTOR_PATHS.map((p) => `${origin}${p}`);
}

export interface CompanyHostLink {
  url: string;
  text: string;
  docType: DocumentType;
}

/**
 * Collect classifiable PDF links from an investor page.
 *
 * A link qualifies only when its ANCHOR TEXT or its FILE NAME classifies to a
 * tracked type — an investor page is mostly annual reports, policies and
 * governance PDFs, and storing those as filings would be worse than finding
 * nothing. Relative hrefs are resolved against the page they came from.
 */
export function parseCompanyHostLinks(html: string, pageUrl: string): CompanyHostLink[] {
  if (!html || typeof html !== 'string') return [];
  const $ = cheerio.load(html);

  const out: CompanyHostLink[] = [];
  const seen = new Set<string>();

  $('a[href]').each((_, a) => {
    const href = ($(a).attr('href') ?? '').trim();
    if (href === '') return;

    let url: string;
    try {
      url = new URL(href, pageUrl).toString();
    } catch {
      return;
    }
    if (!/\.(pdf|zip)(\?|#|$)/i.test(url)) return;
    if (seen.has(url)) return;

    const text = ($(a).text() ?? '').replace(/\s+/g, ' ').trim();
    // Anchor text first — it is what a human reads; the file name is the fallback.
    const docType = classifyByTitle(text) ?? classifyByTitle(fileNameFromUrl(url));
    if (!docType) return;

    seen.add(url);
    out.push({ url, text: text || fileNameFromUrl(url), docType });
  });

  return out;
}

// ---------------------------------------------------------------------------
// Chittorgarh — VERIFIER ONLY
// ---------------------------------------------------------------------------

/**
 * Hosts a verified document may legitimately come from.
 *
 * NIT-6: `listing.bseindia.com` and `nsearchives.nseindia.com` used to be listed
 * here too. Since M-1 made matching exact-or-DNS-suffix, both are already
 * covered by their parent domains, and a redundant entry in an allowlist is
 * worse than no entry: it invites the reader to believe the list is exhaustive
 * and to add a subdomain rather than trust the suffix rule.
 *
 * Item 22 (OD-37): this is now DATA, `scraper/config/download-allowlist.json`,
 * read once through `loadValidatedConfig` (OD-51) — not a literal array in
 * code. The registrars are layered on top separately at call time
 * (`loadRegistrarDocumentHosts`, below) because they are a DB table, not a
 * file this loader owns.
 */
export const TRUSTED_DOCUMENT_HOSTS: readonly string[] = loadDownloadAllowlist().hosts;

/**
 * Hosts the link VERIFIER may be pointed at (M-b).
 *
 * `ipos.verifier_url` is scraped data that this process later FETCHES, so the
 * host is validated on the way in (the persister, the schema) and again on the
 * way out (the runner reads it back from a database another process can write).
 * One-sided validation is how a value that was legitimate when written becomes a
 * request to somewhere else after an edit.
 */
export const VERIFIER_HOSTS = ['chittorgarh.com'];

/** Is this a usable Chittorgarh verifier page URL? https only, host-checked. */
export function isVerifierUrl(value: string | null | undefined): boolean {
  if (typeof value !== 'string' || value.trim() === '') return false;
  try {
    const parsed = new URL(value.trim());
    if (parsed.protocol !== 'https:') return false;
    if (parsed.port !== '') return false;
    const host = parsed.hostname.toLowerCase();
    return VERIFIER_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
  } catch {
    return false;
  }
}

/**
 * Is this URL on an exchange, SEBI, or a registrar's own host?
 *
 * M-1: the `host.includes(h)` arm this used to carry made the allowlist
 * meaningless — `bseindia.com.attacker.net` contains "bseindia.com" and passed.
 * Matching is now exact or a true DNS-suffix match, and the scheme must be
 * https/http, so a crafted hostname cannot smuggle a download past the verifier.
 *
 * Item 22 (OD-37): `registrarHosts` is the injected registrar-host set
 * (`loadRegistrarDocumentHosts`, below), kept as a caller-supplied argument
 * so this stays a pure, synchronous, unit-testable check rather than doing
 * its own DB read. Defaults to empty so every existing caller (the
 * Chittorgarh verifier, the company-host store check) keeps working
 * unchanged until it is updated to pass a real registrar set.
 */
export function isTrustedDocumentHost(
  url: string,
  registrarHosts: ReadonlySet<string> = new Set()
): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false;
    const host = parsed.hostname.toLowerCase();
    const matchesSuffix = (h: string) => host === h || host.endsWith(`.${h}`);
    if (TRUSTED_DOCUMENT_HOSTS.some(matchesSuffix)) return true;
    for (const h of registrarHosts) {
      if (matchesSuffix(h)) return true;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * A registrar website, parsed the same reject-non-http(s)/reject-private-
 * string-host way `normalizeCompanyUrl` parses a company website — but
 * WITHOUT `normalizeCompanyUrl`'s `NON_ISSUER_DOMAINS` rejection, because
 * that list names exactly the RTA domains (linkintime, bigshareonline,
 * kfintech, ...) a registrar row's `website` legitimately points at. Reusing
 * `normalizeCompanyUrl` here would exclude every real registrar host.
 */
function parseRegistrarWebsiteHost(value: string | null | undefined): string | null {
  if (typeof value !== 'string' || value.trim() === '') return null;
  const raw = value.trim();
  // A scheme prefix (letters/digits/+/- only, no dot — a real bare hostname
  // never has a colon this early since a dot always precedes it, e.g.
  // "linkintime.co.in:8080"). A value that already names a scheme other than
  // http(s) (mailto:, ftp:, javascript:, ...) is rejected OUTRIGHT here,
  // before it ever reaches `new URL()`. Blindly prepending "https://" in
  // front of an unrecognised scheme (the naive approach) does not make the
  // protocol check below meaningful —
  // `new URL("https://" + "mailto:x@linkintime.co.in")` parses to protocol
  // https, hostname "linkintime.co.in" (the scheme+user became userinfo), so
  // a non-http(s) value can slip through disguised as a legitimate host.
  const hasScheme = /^[a-z][a-z0-9+-]*:/i.test(raw);
  if (hasScheme && !/^https?:\/\//i.test(raw)) return null;

  let parsed: URL;
  try {
    parsed = new URL(hasScheme ? raw : `https://${raw}`);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
  const host = parsed.hostname.toLowerCase();
  if (!host.includes('.')) return null;
  if (PRIVATE_HOST_PATTERNS.some((re) => re.test(host))) return null;
  return host;
}

interface RegistrarHostsCacheEntry {
  hosts: Set<string>;
}

/**
 * Cached across calls within one cycle — the registrar list changes rarely,
 * so a DB read per document fetch is the wrong cost. Same cache-per-cycle
 * shape `document-discovery-runner.ts`'s `boardCache` uses; a fresh cycle
 * calls `resetRegistrarDocumentHostsCache()` first (the runner's own
 * per-cycle reset point — not wired here, item 22 is this function only).
 */
let registrarHostsCache: RegistrarHostsCacheEntry | null = null;

/** Cycle boundary: drop the cached registrar-host set so the next call re-reads it. */
export function resetRegistrarDocumentHostsCache(): void {
  registrarHostsCache = null;
}

/**
 * NEW (item 22, OD-37). Reads `registrars` where `active = true`, parses
 * each `website` through `parseRegistrarWebsiteHost` (rejects non-http(s)
 * and private-string hosts — a bad data-entry row cannot smuggle a private
 * host into the download allow-list), and returns the resulting hostname
 * set. Cached until `resetRegistrarDocumentHostsCache()` is called.
 */
export async function loadRegistrarDocumentHosts(
  db: NodePgDatabase<typeof schema>
): Promise<Set<string>> {
  if (registrarHostsCache) return registrarHostsCache.hosts;

  const rows = await db
    .select({ website: registrars.website })
    .from(registrars)
    .where(eq(registrars.active, true));

  const hosts = new Set<string>();
  for (const row of rows) {
    const host = parseRegistrarWebsiteHost(row.website);
    if (host) hosts.add(host);
  }

  registrarHostsCache = { hosts };
  return hosts;
}

/**
 * MIN-6: may a document found on the COMPANY rung be stored from this URL?
 *
 * Only when it is served by the issuer's OWN host, or by an exchange/SEBI. An
 * investor page routinely links documents parked on a third party — a CDN, a
 * merchant bank, a document-hosting service — and the owner's rule is that we
 * never store a filing from a third party, on ANY rung. Without this the
 * company rung was the one hole in that rule.
 */
export function isStorableFromCompanyPage(
  url: string,
  companyOrigin: string,
  // OD-37: the registrar host set. Defaulted so existing callers keep their
  // exact behaviour, but the RUNNER now supplies it — until slice 22-7 nothing
  // did, so a filing served by a legitimate registrar was refused here even
  // though `isTrustedDocumentHost` had been able to accept one since 22-1.
  registrarHosts: ReadonlySet<string> = new Set()
): boolean {
  if (isTrustedDocumentHost(url, registrarHosts)) return true;
  try {
    const link = new URL(url);
    if (link.protocol !== 'https:' && link.protocol !== 'http:') return false;
    const issuer = new URL(companyOrigin).hostname.toLowerCase();
    const host = link.hostname.toLowerCase();
    // The issuer's own host, or a subdomain of it (investors.example.com).
    const root = issuer.replace(/^www\./, '');
    return host === issuer || host === root || host.endsWith(`.${root}`);
  } catch {
    return false;
  }
}

/**
 * Read the document links a Chittorgarh IPO page displays, and return only those
 * that (a) point at an exchange or SEBI and (b) we have not already tried.
 *
 * This is the owner's rule made mechanical: Chittorgarh tells us WHICH exchange
 * URL is the right one when ours was wrong, and nothing else. A link on its own
 * host is dropped here, so no later code has to remember not to store it.
 */
export function extractVerifierLinks(
  html: string,
  pageUrl: string,
  alreadyTried: Iterable<string>,
  /** OD-37 registrar host set; see isStorableFromCompanyPage. */
  registrarHosts: ReadonlySet<string> = new Set()
): CompanyHostLink[] {
  const tried = new Set(alreadyTried);
  return parseCompanyHostLinks(html, pageUrl).filter(
    (link) => isTrustedDocumentHost(link.url, registrarHosts) && !tried.has(link.url)
  );
}
