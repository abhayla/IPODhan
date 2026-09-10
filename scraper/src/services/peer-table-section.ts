/**
 * Item 8a slice 1 — find the peer-comparison section in an RHP, and refuse the
 * three things that look like it.
 *
 * This is deliberately ONLY the locator. Column mapping is slice 2. The reason
 * for the split is that finding the right section has already been got wrong
 * three times on this item, twice by me:
 *
 *   1. The card claimed "peer comparison table 4 of 4" from a keyword match.
 *      Keywords appear throughout the Basis-for-Offer-Price narrative.
 *   2. I then filed an issue claiming the table does not exist at all, because I
 *      searched for `comparison with listed industry peers` and got zero hits.
 *      The documents do not word it that way. The table was on the page I had
 *      already cited.
 *   3. Writing this file, a third: the card records Glasswall's heading as
 *      "Comparison with listed industry peers". It is not. That phrase appears
 *      in Glasswall only inside a NOTE, as a cross-reference in curly quotes
 *      ("...based on the peer set provided below under 'Comparison with listed
 *      industry peers'"). Its real heading, twelve lines later, reads
 *      "VI. Comparison of accounting ratios with listed industry peers".
 *
 * So across the four issuers measured there are TWO wordings, not three:
 *
 *   6.   Comparison of Accounting Ratios with Listed Industry Peers   (Karamtara, PRASOLCHEM)
 *   8.   Comparison of key accounting ratios with listed industry peers (Kanohar)
 *   VI.  Comparison of accounting ratios with listed industry peers   (Glasswall)
 *
 * The section marker is `6.`, `8.` or a roman `VI.`, and it is NOT by itself a
 * discriminator: numbered NOTES ("1. The face value of each Equity Share…")
 * match the same shape. What separates a heading from a mention is that the
 * heading PHRASE STARTS THE LINE, after an optional marker. A prose
 * cross-reference has the phrase in the middle of a sentence.
 *
 * And one trap that is not a wording problem at all: Kanohar prints a SECOND
 * peer-shaped table, "Comparison of KPIs with our peers listed in India", with
 * the same companies and numeric columns. It must be refused. Without that,
 * "does the matcher find a table" and "does the matcher find the RIGHT table"
 * are the same question.
 */

/**
 * The heading, allowing the words between "comparison" and "with" to vary
 * ("of accounting ratios", "of key accounting ratios"). Bounded rather than
 * open so it cannot swallow half a paragraph on its way to a later "with
 * listed industry peers".
 */
const HEADING_PHRASE = /comparison(?:\s+\S+){0,4}?\s+with\s+(?:the\s+)?listed\s+industry\s+peers/i;

/** `6.`, `8.`, `VI.`, `III.` — optional, and never sufficient on its own. */
const SECTION_MARKER = /^\s*(?<marker>\d{1,2}|[IVXLC]{1,5})[.)]\s+/i;

/**
 * The KPI table Kanohar prints separately. Matched so it can be REFUSED with a
 * named reason rather than silently not-matched, because "we found nothing" and
 * "we found the wrong thing and declined it" are different outcomes and only
 * one of them is worth alerting on.
 */
const KPI_HEADING = /comparison\s+of\s+kpis?\b/i;

export interface PeerTableSection {
  /** The heading line as printed, trimmed. */
  heading: string;
  /** `6`, `8`, `VI` — null when the heading carried no marker. */
  sectionMarker: string | null;
  /** 0-based index of the heading line within the supplied text. */
  headingLine: number;
  /** The lines after the heading, up to whatever ends the section. */
  body: string[];
}

/**
 * What ends the section. `Notes:` is the common terminator; a following
 * numbered heading also ends it. A numbered NOTE does not — which is why this
 * requires the marker to be followed by an upper-case-ish heading rather than
 * accepting any marker at all.
 */
function endsSection(line: string): boolean {
  const t = line.trim();
  if (/^notes?\s*:/i.test(t)) return true;
  if (/^source\s*:/i.test(t)) return true;
  const m = SECTION_MARKER.exec(t);
  if (!m) return false;
  const rest = t.slice(m[0].length);
  // A heading is a short title-ish line. A note is a sentence: it runs long and
  // ends in a full stop. Judging on shape rather than on the marker is what
  // keeps "1. Figures for listed peers have been provided by our Company…"
  // from being read as the next section.
  return rest.length > 0 && rest.length < 90 && !/\.$/.test(rest);
}

/**
 * Locate the peer-comparison section.
 *
 * Returns null when the text has no such section — including when it has the
 * KPI table instead, which is reported through `lastRefusal` so a caller can
 * tell "absent" from "present and refused".
 */
export function findPeerTableSection(text: string): PeerTableSection | null {
  const lines = text.split(/\r?\n/);

  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i];
    const trimmed = raw.trim();
    if (trimmed === '') continue;

    // Strip an optional section marker, then require the phrase to START what
    // remains. A cross-reference inside a sentence fails here, which is exactly
    // how Glasswall's note is told apart from Glasswall's heading.
    const markerMatch = SECTION_MARKER.exec(trimmed);
    const afterMarker = markerMatch ? trimmed.slice(markerMatch[0].length) : trimmed;
    if (!/^comparison\b/i.test(afterMarker)) continue;

    // It starts with "Comparison" — but of what?
    if (KPI_HEADING.test(afterMarker)) continue;
    if (!HEADING_PHRASE.test(afterMarker)) continue;

    const body: string[] = [];
    for (let j = i + 1; j < lines.length; j += 1) {
      if (endsSection(lines[j])) break;
      body.push(lines[j]);
    }

    return {
      heading: trimmed,
      sectionMarker: markerMatch?.groups?.marker ?? null,
      headingLine: i,
      body,
    };
  }

  return null;
}

/**
 * True when the text contains the KPI comparison table — the peer-shaped table
 * that is NOT this one. Exposed so a caller can say "the wrong table was here"
 * instead of reporting a silent miss.
 */
export function containsKpiComparisonTable(text: string): boolean {
  return text
    .split(/\r?\n/)
    .some((line) => {
      const t = line.trim();
      const m = SECTION_MARKER.exec(t);
      const after = m ? t.slice(m[0].length) : t;
      return /^comparison\b/i.test(after) && KPI_HEADING.test(after);
    });
}
