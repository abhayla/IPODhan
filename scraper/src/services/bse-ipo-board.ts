/**
 * BSE IPO board parser + IPO_NO resolver (T-403 WP A, matrix §0/F12/F18).
 *
 * `api.bseindia.com/BseIndiaAPI/api/IPO_HomePageDetail/w` returns `{ Table: [...] }`
 * — the board of live ('L') and forthcoming ('F') issues. It is the ONLY way to
 * get the `IPO_NO` the core API is keyed on, because our own `ipos.bse_scrip_code`
 * is NULL for every current IPO (verified on the restored dump, 2026-08-28).
 *
 * TWO defects this closes.
 *
 * F12 — corporate-action pollution. The board is NOT an IPO-only feed: of the 22
 * rows captured live on 2026-08-28, NINE were `Takeover`, `Buyback - Tender Offer`,
 * `BuyBack`, `Debt Issue` or `RI`. Creating anything from an unfiltered board is
 * the June pollution class over again, so rows are filtered on `IR_FLAG_FULL`
 * BEFORE anything else looks at them.
 *
 * F18 — silent shape change. If BSE renames `Table` (or the payload arrives as an
 * error object), returning `[]` would be indistinguishable from "no IPOs today"
 * and the job would quietly write nothing forever. `parseBseBoard` THROWS a
 * `BseBoardShapeError` instead, so the runner falls to the other exchange and
 * alerts rather than silently writing nulls.
 *
 * Pure: no network, no logging.
 */

import { compactCompanyNameKey } from '@ipodhan/shared/utils/company-name-normalizer';
import { levenshteinSimilarity } from '@ipodhan/shared/utils/company-name-similarity';

/** Thrown when the board payload does not have the shape we parse (F18). */
export class BseBoardShapeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BseBoardShapeError';
  }
}

/**
 * `IR_FLAG_FULL` values that are genuine public equity issues. Everything else
 * on the board (Takeover / Buyback / BuyBack / Debt Issue / RI) is a corporate
 * action and must never become, or be matched to, an IPO (F12).
 */
export const IPO_ISSUE_FLAGS: readonly string[] = ['Book Building', 'Fixed Price'];

export interface BseBoardRow {
  ipoNo: number;
  scripCode: number | null;
  companyName: string;
  /** 'L' = live, 'F' = forthcoming. */
  status: string;
  issueFlag: string;
  startDate: string | null;
  endDate: string | null;
  /** Fixed-price issues have no price band, so no Price Band Advertisement (R9). */
  isFixedPrice: boolean;
}

/** 'YYYY-MM-DDT00:00:00' to 'YYYY-MM-DD'; null for anything else. */
function toIsoDate(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const m = value.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

/**
 * Parse the board payload into genuine-IPO rows only.
 * Throws `BseBoardShapeError` when `Table` is missing or not an array (F18).
 */
export function parseBseBoard(payload: unknown): BseBoardRow[] {
  if (!payload || typeof payload !== 'object') {
    throw new BseBoardShapeError('BSE board payload is not an object');
  }
  const table = (payload as { Table?: unknown }).Table;
  if (!Array.isArray(table)) {
    throw new BseBoardShapeError(
      `BSE board payload has no "Table" array (keys: ${Object.keys(payload).join(',') || 'none'})`
    );
  }

  const rows: BseBoardRow[] = [];
  for (const raw of table) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    const issueFlag = String(r.IR_FLAG_FULL ?? '').trim();
    if (!IPO_ISSUE_FLAGS.includes(issueFlag)) continue; // F12

    const ipoNo = Number(r.IPO_NO);
    const companyName = String(r.Scrip_name ?? '').trim();
    if (!Number.isFinite(ipoNo) || ipoNo <= 0 || companyName === '') continue;

    const scripCode = Number(r.Scrip_cd);
    rows.push({
      ipoNo,
      scripCode: Number.isFinite(scripCode) && scripCode > 0 ? scripCode : null,
      companyName,
      status: String(r.Status ?? '').trim(),
      issueFlag,
      startDate: toIsoDate(r.Start_Dt),
      endDate: toIsoDate(r.End_Dt),
      isFixedPrice: issueFlag === 'Fixed Price',
    });
  }
  return rows;
}

/**
 * Minimum normalized-key similarity for a fuzzy IPO_NO match. Deliberately high:
 * a WRONG IPO_NO fetches another company's filings, which §3 step 6 would then
 * have to catch. Exact key equality is tried first and is what all four
 * acceptance IPOs actually hit ("Skyways Air Services Ltd." and
 * "SKYWAYS AIR SERVICES LIMITED" both normalize to "skywaysairservices").
 */
export const IPO_NO_MATCH_THRESHOLD = 0.92;

/**
 * Resolve our `ipos.company_name` to a BSE board row.
 *
 * Exact normalized-key match first; a fuzzy pass over the same keys second, and
 * only when it clears `IPO_NO_MATCH_THRESHOLD` and is a STRICTLY unique best
 * score — an ambiguous tie returns null rather than guessing, because guessing
 * here means downloading the wrong company's RHP (F8).
 *
 * Returns null when the company is not on the board at all — which for an SME
 * issue is the NORMAL case (the mainboard board does not list SME, matrix §0),
 * i.e. F13, not a failure.
 */
export function resolveBseBoardRow(
  rows: BseBoardRow[],
  companyName: string
): BseBoardRow | null {
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const key = compactCompanyNameKey(String(companyName ?? ''));
  if (key === '') return null;

  const keyed = rows.map((row) => ({ row, key: compactCompanyNameKey(row.companyName) }));

  const exact = keyed.filter((k) => k.key === key);
  if (exact.length === 1) return exact[0].row;
  if (exact.length > 1) return null; // ambiguous — never guess

  let best: BseBoardRow | null = null;
  let bestScore = 0;
  let bestIsTied = false;
  for (const { row, key: candidateKey } of keyed) {
    if (candidateKey === '') continue;
    const score = levenshteinSimilarity(key, candidateKey);
    if (score < IPO_NO_MATCH_THRESHOLD) continue;
    if (score > bestScore) {
      bestScore = score;
      best = row;
      bestIsTied = false;
    } else if (score === bestScore) {
      bestIsTied = true;
    }
  }
  return bestIsTied ? null : best;
}

/** Convenience wrapper: the IPO_NO for a company, or null. */
export function resolveIpoNo(rows: BseBoardRow[], companyName: string): number | null {
  return resolveBseBoardRow(rows, companyName)?.ipoNo ?? null;
}

/**
 * Pull the detail row out of a `GetMkt_ISSUE_BBS_IPO` response.
 * The row lives at `IPONO_0[0]` — NOT at the top level (verified live). Returns
 * null when the payload carries no detail row, and throws only on a shape change
 * severe enough that we cannot tell the two apart (F18).
 */
export function extractBseCoreRow(payload: unknown): Record<string, unknown> | null {
  if (!payload || typeof payload !== 'object') {
    throw new BseBoardShapeError('BSE core payload is not an object');
  }
  const first = (payload as { IPONO_0?: unknown }).IPONO_0;
  if (first === undefined) {
    throw new BseBoardShapeError(
      `BSE core payload has no "IPONO_0" (keys: ${Object.keys(payload).join(',') || 'none'})`
    );
  }
  if (!Array.isArray(first) || first.length === 0) return null;
  const row = first[0];
  return row && typeof row === 'object' ? (row as Record<string, unknown>) : null;
}
