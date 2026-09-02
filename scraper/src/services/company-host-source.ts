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
 */

import * as cheerio from 'cheerio';
import { classifyByTitle, fileNameFromUrl } from './document-classifier.js';
import type { DocumentType } from './document-types.js';

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
 */
export const TRUSTED_DOCUMENT_HOSTS = [
  'bseindia.com',
  'nseindia.com',
  'sebi.gov.in',
];

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
 * Is this URL on an exchange or SEBI host?
 *
 * M-1: the `host.includes(h)` arm this used to carry made the allowlist
 * meaningless — `bseindia.com.attacker.net` contains "bseindia.com" and passed.
 * Matching is now exact or a true DNS-suffix match, and the scheme must be
 * https/http, so a crafted hostname cannot smuggle a download past the verifier.
 */
export function isTrustedDocumentHost(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false;
    const host = parsed.hostname.toLowerCase();
    return TRUSTED_DOCUMENT_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
  } catch {
    return false;
  }
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
export function isStorableFromCompanyPage(url: string, companyOrigin: string): boolean {
  if (isTrustedDocumentHost(url)) return true;
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
  alreadyTried: Iterable<string>
): CompanyHostLink[] {
  const tried = new Set(alreadyTried);
  return parseCompanyHostLinks(html, pageUrl).filter(
    (link) => isTrustedDocumentHost(link.url) && !tried.has(link.url)
  );
}
