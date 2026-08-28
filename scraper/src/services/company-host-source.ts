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
    const host = raw.replace(/^https?:\/\//i, '').split('/')[0].toLowerCase();
    if (!host.includes('.')) continue;
    if (NON_ISSUER_DOMAINS.some((d) => host.includes(d))) continue;
    return `https://${host}`;
  }
  return null;
}

/** Normalise a stored website value into an origin we can fetch. */
export function normalizeCompanyUrl(value: string | null | undefined): string | null {
  if (typeof value !== 'string' || value.trim() === '') return null;
  const host = value.trim().replace(/^https?:\/\//i, '').split('/')[0].toLowerCase();
  if (!host.includes('.')) return null;
  if (NON_ISSUER_DOMAINS.some((d) => host.includes(d))) return null;
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

/** Hosts a verified document may legitimately come from. */
export const TRUSTED_DOCUMENT_HOSTS = [
  'bseindia.com',
  'nseindia.com',
  'nsearchives.nseindia.com',
  'listing.bseindia.com',
  'sebi.gov.in',
];

export function isTrustedDocumentHost(url: string): boolean {
  try {
    const host = new URL(url).host.toLowerCase();
    return TRUSTED_DOCUMENT_HOSTS.some((h) => host === h || host.endsWith(`.${h}`) || host.includes(h));
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
