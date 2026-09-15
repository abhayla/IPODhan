/**
 * BSE listed-scrip master (the active-equity list, with each scrip's GROUP).
 *
 * WHY THIS EXISTS. `exchange-segment-oracle.ts` resolves an IPO's board from either
 * exchange's listed-security master. Its NSE half is fed by `nse-equity-master.ts`; its
 * BSE half had no source at all, so `repair-segment-provenance.ts` passed it an empty
 * list and every BSE-only company resolved to `no-source`. Measured on staging
 * 2026-09-16: all 29 unprovenanced IPO rows are BSE-listed, and only the 4 carrying an
 * ISIN resolve via NSE. This is the other 25.
 *
 * THE SOURCE IS PROVEN, NOT ASSUMED. `docs/design/probes/bse-scrip-groups.mjs` (#651)
 * measured the endpoints before a line of this was written:
 *   - `ListOfScrips.csv`, the public "List of Securities" download -> HTTP 404
 *   - `ListofScripData/w?...&segment=Equity&status=Active` -> HTTP 200, 5155 records
 * The 200 carries `SCRIP_CD, Scrip_Name, Status, GROUP, FACE_VALUE, ISIN_NUMBER,
 * INDUSTRY, scrip_id, Segment, NSURL, Issuer_Name, Mktcap` — ISIN and GROUP both, which
 * is exactly what the oracle joins on. The committed fixture
 * `docs/design/probes/fixtures/bse/ListofScripData.sample.json` is 53 unmodified rows of
 * that real response, and this module's tests parse it rather than a shape typed from
 * memory.
 *
 * WHAT IT DELIBERATELY DOES NOT DO. It does not decide what a group MEANS. The mapping
 * from group to board lives in the oracle, derived from 187 already-provenanced
 * production rows, and only M/MT (SME) and A/B/T/XT/Z (mainboard) are evidenced. The
 * probe measured the live distribution: 3901 of 5155 scrips (75.7%) sit in an evidenced
 * group; X alone is 1160. This fetcher hands over the group verbatim and lets the oracle
 * refuse the rest — a fetcher that "helpfully" mapped X to MAINBOARD would reintroduce
 * the exact class the oracle's header records an earlier draft being corrected for.
 */
import { normalizeCompanyName, type BseScrip } from './exchange-segment-oracle.js';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)';
const REFERER = 'https://www.bseindia.com/';

/** The endpoint the probe proved returns 5155 rows with a GROUP. */
export const BSE_SCRIP_LIST_URL =
  'https://api.bseindia.com/BseIndiaAPI/api/ListofScripData/w' +
  '?Group=&Scripcode=&industry=&segment=Equity&status=Active';

/** One row of the live response, named as BSE names it. */
export interface BseScripRow {
  scripCode: string;
  name: string;
  isin: string;
  group: string;
  status: string;
}

export interface BseScripMaster {
  rows: BseScripRow[];
  byIsin: Map<string, BseScripRow>;
  byName: Map<string, BseScripRow>;
}

/**
 * Parse the API's payload. Exported so the tests can drive it from the committed
 * fixture without a network call — the parser is the part that rots when BSE changes a
 * key, and it is worth testing against real bytes.
 *
 * Tolerates the three shapes this API has been seen to use (bare array, `{Table:[]}`,
 * `{data:[]}`) because a wrapper change would otherwise read as "BSE delisted every
 * company", which is indistinguishable from an honest empty result.
 */
/**
 * BSE writes a PLACEHOLDER where a scrip has no ISIN, and it is not the empty string.
 * Measured on the live feed 2026-09-16: 5152 real ISINs, ONE empty, and TWO rows
 * carrying the literal "NA" — Chase Bright Steel and Pushpsons Industries, two unrelated
 * companies. Treating "NA" as an identifier indexes both under the same key, so a lookup
 * for one could return the OTHER company's board. That is the sourced-but-wrong class
 * this whole slice exists to avoid, arriving through the join instead of the mapping.
 *
 * Anything that is not shaped like an Indian ISIN (IN + 10 alphanumerics) is absence.
 */
function cleanIsin(v: unknown): string {
  const s = String(v ?? '').trim().toUpperCase();
  return /^IN[A-Z0-9]{10}$/.test(s) ? s : '';
}

export function parseBseScripPayload(body: string): BseScripRow[] {
  const parsed: unknown = JSON.parse(body);
  const raw: unknown = Array.isArray(parsed)
    ? parsed
    : (parsed as { Table?: unknown; data?: unknown })?.Table ??
      (parsed as { data?: unknown })?.data ??
      [];
  if (!Array.isArray(raw)) return [];
  const out: BseScripRow[] = [];
  for (const r of raw as Array<Record<string, unknown>>) {
    const row: BseScripRow = {
      scripCode: String(r.SCRIP_CD ?? '').trim(),
      name: String(r.Scrip_Name ?? r.Issuer_Name ?? '').trim(),
      isin: cleanIsin(r.ISIN_NUMBER),
      group: String(r.GROUP ?? '').trim().toUpperCase(),
      status: String(r.Status ?? '').trim(),
    };
    // A row with neither identifier cannot be joined to anything, so it is not a row.
    if (!row.isin && !row.name) continue;
    out.push(row);
  }
  return out;
}

/**
 * Index by ISIN and by normalised name; first occurrence wins, as the NSE master does.
 *
 * THE NAME KEY IS THE ORACLE'S OWN `normalizeCompanyName`, NOT the shared
 * `normalizeCompanyNameForMatching`. The two disagree on a real case: the shared one
 * expands '&' to ' and ', the oracle STRIPS it, because our stored names have had the
 * ampersand removed ("SI CAPITAL  FINANCIAL SERVICES" carries a double space where it
 * was). Indexing on one key space while the oracle matches on the other would produce a
 * `byName` map that silently disagrees with the resolution the oracle actually performs —
 * two competing answers to "is this the same company". One key space, the one that
 * decides.
 */
export function indexBseScrips(rows: BseScripRow[]): BseScripMaster {
  const byIsin = new Map<string, BseScripRow>();
  const byName = new Map<string, BseScripRow>();
  for (const r of rows) {
    if (r.isin && !byIsin.has(r.isin)) byIsin.set(r.isin, r);
    const key = normalizeCompanyName(r.name);
    if (key && !byName.has(key)) byName.set(key, r);
  }
  return { rows, byIsin, byName };
}

/**
 * Fetch the live master.
 *
 * THROWS RATHER THAN RETURNING EMPTY, deliberately, and this is the one place this
 * module differs from `nse-equity-master.ts`. That one catches its fetch error, logs a
 * line and returns whatever it has — so a total outage produces an empty map that the
 * oracle reads as "no company is listed anywhere" and the repair tool reads as "nothing
 * was sourceable today". Those are indistinguishable from an honest run, and the caller
 * gets no signal. A master that could not be fetched is a failure, not a result.
 */
export async function fetchBseScripMaster(
  opts: { timeoutMs?: number } = {},
): Promise<BseScripMaster> {
  const res = await fetch(BSE_SCRIP_LIST_URL, {
    headers: { 'User-Agent': UA, Referer: REFERER, Accept: 'application/json' },
    signal: AbortSignal.timeout(opts.timeoutMs ?? 45_000),
  });
  if (!res.ok) {
    throw new Error(`BSE scrip master: HTTP ${res.status} from ${BSE_SCRIP_LIST_URL}`);
  }
  const body = await res.text();
  // The probe records that BSE serves a ~112-byte JS shell for its JS-rendered pages.
  // A tiny 200 is a shell, not data, and must never be parsed into an empty master.
  if (body.length < 500) {
    throw new Error(
      `BSE scrip master: ${body.length}-byte body from a 200 — that is the JS-shell ` +
      'signature, not the scrip list',
    );
  }
  const rows = parseBseScripPayload(body);
  if (rows.length === 0) {
    throw new Error('BSE scrip master: parsed 0 rows from a non-empty 200 — the payload shape changed');
  }
  return indexBseScrips(rows);
}

/** Adapt to the shape `resolveSegmentFromMasters` takes. */
export function toOracleScrips(master: BseScripMaster): BseScrip[] {
  return master.rows.map((r) => ({ isin: r.isin, name: r.name, group: r.group }));
}
