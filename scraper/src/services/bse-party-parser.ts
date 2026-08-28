/**
 * BSE packed-entity parser — the SINGLE place a BSE core-API party field is
 * turned into a list of names (T-403 RC1; matrix F17, lifecycle-plan WP A).
 *
 * ROOT CAUSE this fixes. BSE's `GetMkt_ISSUE_BBS_IPO` packs each party as
 *
 *     Name^address|||||||email|contact person
 *
 * and packs MULTIPLE parties into one field with a literal `#` separator.
 * Verified live 2026-08-28 on IPO_NO=7903 (Skyways):
 *
 *     Book_Running_Lead_Manager:
 *       "Holani Consultants Private Limited^||||||||ipo@holaniconsultants.co.in|Payal Jain"
 *     Co_Book_Running_Lead_Manager:
 *       "Shannon Advisors Private Limited^||||||||pavan@shannon.co.in
 *        #Dolat Finserv Private Limited^||||||||skyways.ipo@dolatfinserv.com"
 *
 * `bse-api-scraper.ts`'s `parseLeadManagers` split on `^`/`|` FIRST and never on
 * `#`, so the second co-BRLM was swallowed into the first entry's discarded tail:
 * the live parser returned 2 names where the payload carries 3 — exactly the
 * "Skyways shows 2 of 3" finding. `Sponsor_Bank` has the same `#` shape (Axis +
 * HDFC) and the same defect.
 *
 * Splitting on `#` BEFORE `^` is the whole fix, and it lives here so every BSE
 * consumer inherits it instead of each re-deriving the format.
 *
 * Pure: no network, no logging.
 */

/** One party as BSE packs it. `email`/`contact` are '' when BSE left them blank. */
export interface BseParty {
  name: string;
  email: string;
  contact: string;
}

/** BSE's multi-party separator. A literal '#' between packed entities. */
const PARTY_SEPARATOR = '#';

/** Separates the NAME from the packed address/email/contact tail. */
const NAME_TAIL_SEPARATOR = '^';

/** Looks like an email address — used to pick the email out of the packed tail. */
const EMAIL_RE = /[^\s|,;]+@[^\s|,;]+\.[^\s|,;]+/;

/**
 * Split ONE packed entity ("Name^||...|email|contact") into its parts.
 * Returns null when there is no usable name.
 */
function parseOneParty(raw: string): BseParty | null {
  const trimmed = String(raw ?? '').trim();
  if (trimmed === '') return null;

  const [namePart, ...tailParts] = trimmed.split(NAME_TAIL_SEPARATOR);
  // A name may still carry a newline (BSE occasionally wraps); keep the first line.
  const name = namePart.split('\n')[0].trim();
  if (name === '') return null;

  const tail = tailParts.join(NAME_TAIL_SEPARATOR);
  const segments = tail.split('|').map((s) => s.trim());
  const emailMatch = tail.match(EMAIL_RE);
  const email = emailMatch ? emailMatch[0] : '';

  // The contact person is the last non-empty segment that is not the email.
  let contact = '';
  for (let i = segments.length - 1; i >= 0; i--) {
    const seg = segments[i];
    if (seg === '' || seg === email) continue;
    if (EMAIL_RE.test(seg)) continue;
    contact = seg;
    break;
  }

  return { name, email, contact };
}

/**
 * Parse ONE BSE party field into every party it packs, in payload order.
 * Splits on `#` first (multi-party), then `^` (name vs tail). Never drops a
 * party. Returns [] for null/empty/whitespace.
 */
export function parseBsePartyField(raw: string | null | undefined): BseParty[] {
  if (typeof raw !== 'string' || raw.trim() === '') return [];
  const parties: BseParty[] = [];
  for (const chunk of raw.split(PARTY_SEPARATOR)) {
    const party = parseOneParty(chunk);
    if (party) parties.push(party);
  }
  return parties;
}

/** Just the names from `parseBsePartyField`, order preserved. */
export function parseBsePartyNames(raw: string | null | undefined): string[] {
  return parseBsePartyField(raw).map((p) => p.name);
}

/** The party sets a BSE core-API detail row carries. */
export interface BseParties {
  /** BRLM first, then every co-BRLM, in payload order, de-duplicated. */
  leadManagers: string[];
  /** Registrar name, or null when BSE left the field blank. */
  registrar: string | null;
  sponsorBanks: string[];
}

/** The subset of a BSE core-API detail row this parser reads. */
export interface BsePartyRow {
  Book_Running_Lead_Manager?: string | null;
  Co_Book_Running_Lead_Manager?: string | null;
  Registrar?: string | null;
  Sponsor_Bank?: string | null;
}

/**
 * Parse every party off a BSE core-API detail row (`IPONO_0[0]`).
 * Lead managers keep BRLM-then-co-BRLM order and are de-duplicated
 * case-insensitively (BSE sometimes repeats the BRLM in the co field).
 */
export function parseBseParties(row: BsePartyRow | null | undefined): BseParties {
  if (!row || typeof row !== 'object') {
    return { leadManagers: [], registrar: null, sponsorBanks: [] };
  }

  const leadManagers: string[] = [];
  const seen = new Set<string>();
  for (const field of [row.Book_Running_Lead_Manager, row.Co_Book_Running_Lead_Manager]) {
    for (const name of parseBsePartyNames(field)) {
      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      leadManagers.push(name);
    }
  }

  const registrarNames = parseBsePartyNames(row.Registrar);
  return {
    leadManagers,
    registrar: registrarNames.length > 0 ? registrarNames[0] : null,
    sponsorBanks: parseBsePartyNames(row.Sponsor_Bank),
  };
}
