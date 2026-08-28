/**
 * Lead managers from the NSE `ipo-detail` payload (T-403 F-2).
 *
 * WHY THIS EXISTS. The BSE core payload was the only source of lead managers,
 * so a single BSE transport failure cost us all of them — observed live on
 * 2026-08-28, when BSE returned http 0 three times for Skyways and the IPO was
 * recorded with zero lead managers although NSE's payload, fetched seconds
 * later in the same cycle, listed all three. Data we already hold in memory
 * must not be discarded because a different source was down.
 *
 * NSE's shape is not BSE's: where BSE gives one delimited field per party role,
 * NSE gives a flat `dataList` of `{title, value}` rows and packs every book
 * running lead manager into ONE English sentence:
 *
 *   "Holani Consultants Private Limited, Shannon Advisors Private Limited and
 *    Dolat Finserv Private Limited"
 *
 * So the separator is commas AND the final " and " — parsing on commas alone
 * silently merges the last two firms into one, which is the co-BRLM undercount
 * (F17) this project has already been bitten by once.
 */

/** The `dataList` row shape NSE returns. */
interface NseDataRow {
  title?: unknown;
  value?: unknown;
}

/** Titles that carry the book running lead managers, lowercased. */
const LEAD_MANAGER_TITLES = ['book running lead managers', 'book running lead manager', 'lead managers', 'lead manager'];

/** Read one `dataList` value by title (case-insensitive, trimmed). */
export function nseDataListValue(
  issueInfo: Record<string, unknown> | null | undefined,
  titles: string[]
): string | null {
  const rows = (issueInfo?.dataList as NseDataRow[] | undefined) ?? [];
  if (!Array.isArray(rows)) return null;
  for (const row of rows) {
    const title = typeof row?.title === 'string' ? row.title.trim().toLowerCase() : '';
    if (!titles.includes(title)) continue;
    const value = typeof row?.value === 'string' ? row.value : '';
    const cleaned = value.replace(/^"+|"+$/g, '').trim();
    if (cleaned !== '') return cleaned;
  }
  return null;
}

/**
 * The book running lead managers NSE lists, in order.
 *
 * Returns [] when the field is absent — never a partial guess. Splitting is on
 * commas and on a standalone " and "/" & ", which is how the exchange writes a
 * list of firms; "Private Limited" and other firm suffixes contain neither.
 */
export function parseNseLeadManagers(
  issueInfo: Record<string, unknown> | null | undefined
): string[] {
  const raw = nseDataListValue(issueInfo, LEAD_MANAGER_TITLES);
  if (!raw) return [];

  return raw
    .split(/,|\s+\band\b\s+|\s+&\s+/i)
    .map((part) => part.replace(/\s+/g, ' ').trim())
    .filter((part) => part.length > 2);
}
