/**
 * Resolve an IPO's BOARD (MAINBOARD | SME) from the exchanges' own listed-security
 * masters — item 2, slice 3b2.
 *
 * WHY THIS EXISTS. `scraper/scripts/repair-segment-provenance.ts` (slice 3b, merged)
 * can only source an IPO row's segment from `VERIFIED_IPO_SEGMENT_SOURCES`, a map an
 * operator fills in BY HAND, one slug at a time. It is empty by default, and its
 * header explains why: no automated source was known, and `listing_exchanges` cannot
 * substitute because it names the EXCHANGE (BSE/NSE), not the BOARD — BSE runs both a
 * mainboard and BSE SME.
 *
 * Measured confirmation of that, on production: `["BSE"]` covers 112 SME rows and 12
 * MAINBOARD rows, so the exchange list genuinely cannot decide the board.
 *
 * WHAT CAN. Both exchanges publish their CURRENT listed securities, and those name the
 * board directly:
 *   - NSE: EQUITY_L.csv (mainboard) and SME_EQUITY_L.csv (NSE Emerge) — two separate
 *     files, so membership IS the answer. `nse-equity-master.ts` already fetches both.
 *   - BSE: the active-scrip list carries a GROUP per scrip, and SME scrips sit in their
 *     own groups.
 *
 * THE LIMIT THIS CANNOT PASS, stated plainly because it is the reason item 14 stays
 * blocked: a listed-security master only knows companies that LISTED. An offer that
 * closed and never listed is in neither file. NIRBHAY COLOURS and PIYUSH are exactly
 * that, and no amount of work here reaches them.
 */

export type Segment = 'MAINBOARD' | 'SME';

/** What the oracle concluded, and — always — how. */
export interface SegmentResolution {
  segment: Segment | null;
  /** Machine-readable outcome. `unresolved` is NOT `no-source`: see below. */
  outcome: 'resolved' | 'unresolved-group' | 'no-source';
  /** Provenance string for the field_sources row; null when nothing was found. */
  via: string | null;
  /** Human-readable reason, always populated. */
  reason: string;
}

export interface MasterEntry {
  isin?: string | null;
  name?: string | null;
}
export interface NseMasters {
  mainboard: MasterEntry[];
  sme: MasterEntry[];
}
export interface BseScrip {
  isin?: string | null;
  name?: string | null;
  group?: string | null;
}

/**
 * BSE group -> board, DERIVED FROM OUR OWN DATA, not from a third-party gloss.
 *
 * BSE's group-definition page is JavaScript-rendered (a fetch returns a ~112-byte
 * shell), so it cannot be cited mechanically. Instead the mapping was tallied against
 * 187 production rows whose segment ALREADY carries independent provenance
 * (CHITTORGARH / MONEYCONTROL / NSE / BSE):
 *
 *     M   79 rows   79 SME        0 MAINBOARD
 *     MT  22 rows   22 SME        0 MAINBOARD
 *     B   71 rows    0 SME       71 MAINBOARD
 *     T    7 rows    0 SME        7 MAINBOARD
 *     XT   4 rows    0 SME        4 MAINBOARD
 *     A    3 rows    0 SME        3 MAINBOARD
 *     Z    1 row     0 SME        1 MAINBOARD
 *
 * Zero contradictions. Groups NOT in that evidence — notably 'X' and 'TS' — are
 * deliberately absent and resolve to `unresolved-group`, NOT to a guess. An earlier
 * draft of this work assumed X meant MAINBOARD and inflated the sourceable count by
 * three rows; a sourced-but-wrong value is worse than an unsourced one.
 */
export const BSE_GROUP_SME: ReadonlySet<string> = new Set(['M', 'MT']);
export const BSE_GROUP_MAINBOARD: ReadonlySet<string> = new Set(['A', 'B', 'T', 'XT', 'Z']);

/**
 * Normalise a company name for comparison.
 *
 * Two rules here are load-bearing and were each found by a failed match:
 *
 * 1. STRIP '&' AND 'AND' ON BOTH SIDES. Our stored names have had '&' REMOVED —
 *    "SI CAPITAL  FINANCIAL SERVICES" carries a double space where the ampersand was —
 *    while the masters spell it "SI Capital & Financial Services Ltd". Expanding '&' to
 *    ' AND ' on one side only made four rows read as unsourceable when they were not.
 * 2. STRIP PARENTHETICAL SUFFIXES. "Power Finance Corporation Limited (Zero Coupon NCD)"
 *    is the issue's name, not the company's, and never matches a securities master.
 */
export function normalizeCompanyName(raw: string | null | undefined): string {
  return (raw ?? '')
    .toUpperCase()
    .replace(/&/g, ' ')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\b(LIMITED|LTD|PVT|PRIVATE|THE|CO|COMPANY|CORP|CORPORATION|AND|INDIA)\b/g, ' ')
    .replace(/[^A-Z0-9]/g, '');
}

export function bseGroupToSegment(group: string | null | undefined): Segment | null {
  const g = (group ?? '').trim().toUpperCase();
  if (BSE_GROUP_SME.has(g)) return 'SME';
  if (BSE_GROUP_MAINBOARD.has(g)) return 'MAINBOARD';
  return null;
}

function indexBy(entries: MasterEntry[]): { byIsin: Map<string, true>; byName: Map<string, true> } {
  const byIsin = new Map<string, true>();
  const byName = new Map<string, true>();
  for (const e of entries) {
    const isin = (e.isin ?? '').trim().toUpperCase();
    if (isin) byIsin.set(isin, true);
    const name = normalizeCompanyName(e.name);
    if (name) byName.set(name, true);
  }
  return { byIsin, byName };
}

/**
 * Resolve one company's board.
 *
 * ISIN FIRST, NAME SECOND, SYMBOL NEVER. A symbol is not a stable join key across our
 * data and the masters: Maruti Interior Products trades on BSE under the scrip id
 * SPITZE, which our row does not carry, so a symbol join would silently miss it while
 * looking like an honest "not listed".
 *
 * NSE is consulted before BSE only because its two files answer the board directly with
 * no group mapping in between; where both answer they have never disagreed in the data
 * measured so far, and a disagreement would be a finding, not a tie to break silently.
 */
export function resolveSegmentFromMasters(
  company: { isin?: string | null; companyName?: string | null },
  masters: { nse: NseMasters; bse: BseScrip[] },
): SegmentResolution {
  const isin = (company.isin ?? '').trim().toUpperCase();
  const name = normalizeCompanyName(company.companyName);

  const nseMain = indexBy(masters.nse.mainboard);
  const nseSme = indexBy(masters.nse.sme);

  if (isin && nseMain.byIsin.has(isin)) {
    return { segment: 'MAINBOARD', outcome: 'resolved', via: 'NSE/EQUITY_L/isin', reason: 'ISIN is in NSE mainboard master' };
  }
  if (isin && nseSme.byIsin.has(isin)) {
    return { segment: 'SME', outcome: 'resolved', via: 'NSE/SME_EQUITY_L/isin', reason: 'ISIN is in NSE SME master' };
  }
  if (name && nseMain.byName.has(name)) {
    return { segment: 'MAINBOARD', outcome: 'resolved', via: 'NSE/EQUITY_L/name', reason: 'name is in NSE mainboard master' };
  }
  if (name && nseSme.byName.has(name)) {
    return { segment: 'SME', outcome: 'resolved', via: 'NSE/SME_EQUITY_L/name', reason: 'name is in NSE SME master' };
  }

  for (const keyKind of ['isin', 'name'] as const) {
    for (const scrip of masters.bse) {
      const hit =
        keyKind === 'isin'
          ? isin && (scrip.isin ?? '').trim().toUpperCase() === isin
          : name && normalizeCompanyName(scrip.name) === name;
      if (!hit) continue;
      const group = (scrip.group ?? '').trim().toUpperCase();
      const segment = bseGroupToSegment(group);
      if (segment) {
        return { segment, outcome: 'resolved', via: `BSE/${keyKind}/group=${group}`, reason: `BSE group ${group} is an evidenced ${segment} group` };
      }
      // Found the company, but its group is outside the evidenced mapping. This is a
      // DIFFERENT state from "not listed anywhere" and must not collapse into it: we
      // know where the scrip is, we just have no sourced meaning for that group.
      return {
        segment: null,
        outcome: 'unresolved-group',
        via: `BSE/${keyKind}/group=${group}`,
        reason: `BSE group ${group || '(blank)'} is not in the evidenced mapping — not guessed`,
      };
    }
  }

  return {
    segment: null,
    outcome: 'no-source',
    via: null,
    reason: 'company is in neither exchange master — consistent with an offer that closed without listing',
  };
}
