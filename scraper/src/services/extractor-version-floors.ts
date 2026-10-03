/**
 * Pure extractor-version floors (no DB, no I/O). Moved out of `filing-auto-persist.ts` (F-240 round 3)
 * so a reader of the re-read floor -- the DOC fetcher -- does not import the DB writer module.
 * `filing-auto-persist.ts` re-exports every name, so existing callers are unchanged.
 */

/**
 * The extractor build that produced a stored extraction.
 *
 * ONE constant, written to `document_fetch_state.extractor_version` and to every
 * E/G ledger row's `version`. Bumping it is what makes every already-extracted
 * document eligible again — which is the only re-extraction trigger, so a bump
 * is a deliberate act, not a side effect of an unrelated change.
 *
 * #771 bumped '@2026-09-26' to '@2026-09-26b': staging had already re-read 9
 * prospectus-family documents at '@2026-09-26' with the OLD ratio reader, so
 * that string cannot mean "ratios read by the fixed reader". The ratio
 * verdict (scripts/lib/ratio-yield-verdict.mjs RATIO_FIXED_EXTRACTOR_VERSION)
 * judges only documents stored at or after this value; a test pins the two.
 *
 * #771 round 3 bumped it to '@2026-09-27': the reader now writes the column
 * whose period heading equals the statement period and records that period
 * (E9 ratioRead); '@2026-09-26b' documents were read by position and are
 * pending re-read.
 *
 * #1420 bumped it to '@2026-10-02': #1429 changed what the reader emits (an answer state per field,
 * wrapped ratio labels) and #1420 adds the clear of a value an older read stored; spec §5.3 rule 5
 * makes a version change the ONLY re-read trigger, so without a bump the clear cannot run on a
 * stored document. The re-read volume is bounded by the document cycle, not by this constant: at
 * most DEFAULT_MAX_SPAWNS_PER_CYCLE (3) extractor spawns per cycle across every IPO, one slot
 * reserved for a re-read first, never-read documents next, the rest topped up (document-cycle.ts).
 *
 * Item 45 (OD-164(g), spec §2.5.6 item 7) bumped it to '@2026-10-03': items 39 (cover block), 40
 * (objects of the offer), 44 (OCR amount and CIN guards) and 46 (peer, ratio and promoter table
 * readers) changed what a stored offer document yields, and documents already re-read at
 * '@2026-10-02' were read before those readers existed. Same cycle bounds as above; the re-read
 * passes order IPOs by how soon their files are purged (document-cycle.ts `orderForRereads`).
 */
export const EXTRACTOR_VERSION = 'extract_filing.py@2026-10-04';

/**
 * #771 round 3 review (MAJOR): a version bump re-opens a COMPLETED document
 * only for the document types whose extraction that bump changed. Spec
 * section 2.5 "One download, one read" (OD-33): "The one allowed
 * re-extraction is an extractor-version change, and only for the fields that
 * failed". The '@2026-09-27' change is the issuer-ratio reader, which runs on
 * the prospectus family only, so a price-band ad or anchor report read at
 * '@2026-09-26' is NOT re-opened by it (staging: 33 of 97 re-opened
 * documents were price-band ads, carrying no ratio). A COMPLETED document is
 * done when its recorded version is at or after its type's floor here.
 * Bumping EXTRACTOR_VERSION for a change that affects another type means
 * raising that type's floor in the same change.
 */
export const REREAD_SINCE_DEFAULT = 'extract_filing.py@2026-09-26';

/**
 * #1247 item 2: the ONE record of which document types each extractor version
 * changed (spec §2.5, "One download, one read"). The per-type floors below are
 * DERIVED from it, so a bump cannot leave a second, hand-kept floor table
 * behind: bumping EXTRACTOR_VERSION without adding its entry here fails
 * tests/unit/services/extractor-version-floors.test.ts, and an entry naming a
 * type raises that type's floor automatically. Versions at or before
 * REREAD_SINCE_DEFAULT are the baseline every type was read at.
 */
export const EXTRACTOR_VERSION_CHANGES: Readonly<Record<string, readonly string[]>> = {
  // #771: issuer-ratio reader (prospectus family only).
  'extract_filing.py@2026-09-26b': ['RHP', 'DRHP', 'PROSPECTUS'],
  // #771 round 3: ratio column chosen by its period heading (prospectus family only).
  'extract_filing.py@2026-09-27': ['RHP', 'DRHP', 'PROSPECTUS'],
  // #1420 + #1429: answer states per field, wrapped ratio labels, the older-value clear. Prospectus
  // family only, as for the two bumps above (the #1429 reader change is the ratio reader); a price-band
  // ad is NOT re-opened here, so no clear runs for its values until a bump names PRICE_BAND_AD.
  'extract_filing.py@2026-10-02': ['RHP', 'DRHP', 'PROSPECTUS'],
  // Item 45 (OD-164(g)): items 39 (cover block), 40 (objects of the offer) and 46 (peer, ratio and
  // promoter tables) read the prospectus family; item 44's OCR amount and CIN guards apply to a
  // price-band ad's OCR pages, so PRICE_BAND_AD is re-opened here for the first time since the baseline.
  'extract_filing.py@2026-10-03': ['RHP', 'DRHP', 'PROSPECTUS', 'PRICE_BAND_AD'],
  // Item 39 round 2 + #1477: the price band ad's band / face-value glyph slot no longer eats a leading
  // digit (18 of 76 staging adverts read differently, 16 of them had been REFUSED), the OCR lost-digit
  // guard, and the cover reader on the advert. Item 46 round 2 (PR #1480): financial statement
  // fiscal-year / two-line headers and the ratio note (prospectus family).
  'extract_filing.py@2026-10-04': ['RHP', 'DRHP', 'PROSPECTUS', 'PRICE_BAND_AD'],
};

function deriveRereadFloors(changes: Readonly<Record<string, readonly string[]>>): Record<string, string> {
  const floors: Record<string, string> = {};
  for (const [version, types] of Object.entries(changes)) {
    for (const type of types) {
      const key = type.toUpperCase();
      if (floors[key] === undefined || version > floors[key]) floors[key] = version;
    }
  }
  return floors;
}

export const REREAD_SINCE_BY_TYPE: Readonly<Record<string, string>> = deriveRereadFloors(EXTRACTOR_VERSION_CHANGES);

const EXTRACTOR_VERSION_PREFIX = 'extract_filing.py@';

/** The oldest recorded version at which a COMPLETED document of `type` counts as read. */
export function rereadSinceFor(type: string, version: string = EXTRACTOR_VERSION): string {
  // A caller passing its own version (tests, a pinned run) keeps exact-match semantics.
  if (version !== EXTRACTOR_VERSION) return version;
  return REREAD_SINCE_BY_TYPE[type.toUpperCase()] ?? REREAD_SINCE_DEFAULT;
}

/** true when `recorded` is an extract_filing.py version at or after `floor` (the '@' suffix orders as a string). */
export function versionAtLeast(recorded: string | null | undefined, floor: string): boolean {
  if (!recorded || !recorded.startsWith(EXTRACTOR_VERSION_PREFIX) || !floor.startsWith(EXTRACTOR_VERSION_PREFIX)) {
    return recorded === floor;
  }
  return recorded.slice(EXTRACTOR_VERSION_PREFIX.length) >= floor.slice(EXTRACTOR_VERSION_PREFIX.length);
}
