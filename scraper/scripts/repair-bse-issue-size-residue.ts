/**
 * Repair: BSE-provenance issue_size residue below the segment floor (item 14 slice 2).
 *
 * RCA: BSE serves issue size as a share COUNT
 * (`Issue_Size_No_of_shares`), not a rupee total. Before commit `019d11fe`
 * (PR #278, 2026-09-03) the mapper stored that count into `ipos.issue_size`
 * unconverted. `019d11fe` fixed the WRITE path (multiply by the floor
 * price going forward) but never repaired the rows already written before
 * it — those rows still carry a raw share count in a rupees column and
 * read as absurdly small against the segment floor
 * (`MAINBOARD_ISSUE_SIZE_FLOOR` / `SME_ISSUE_SIZE_FLOOR`,
 * scraper/src/services/data-consolidation-service.ts).
 *
 * Class: every `ipos` row whose `field_sources` provenance for `issueSize`
 * is `source='BSE'` AND whose current `issue_size` is below its segment's
 * floor. Selected by PREDICATE (selectBseFloorViolations below), never by a
 * hard-coded slug list — so a third member of the class is caught the next
 * time this tool runs. Today's real members (2026-09-10, staging):
 * nirbhay-colours-india-ltd and piyush-ltd, both MAINBOARD/CLOSED.
 *
 * Sourcing (NEVER arithmetic): for each candidate this tool fetches BSE's
 * OWN detail record (`GetMkt_ISSUE_BBS_IPO/w?IPO_NO=<n>`) — by the row's
 * stored `bse_ipo_no` when present, else by a bounded IPO_NO scan
 * (`--scan-from`/`--scan-to`) matched on the normalized company name — and
 * reads BOTH `Issue_Size_No_of_shares` and `Price_Band` straight off that
 * response. `deriveSourcedTotal()` multiplies those two SOURCE-STATED
 * numbers (recording the formula in `data_lineage.formula` per the
 * defect-fix contract's "record the formula" clause for the one case where
 * shares x price is legitimate: the source itself supplies both and states
 * no total). It is NOT the forbidden shortcut of inventing a price from
 * memory — the price comes from the same BSE response as the share count.
 *
 * Two settleable facts per row, in order:
 *   1. SEGMENT — read-only signal in this tool (BSE's detail response
 *      carries no MAINBOARD/SME flag); the tool prints the classification
 *      question (does the corrected total clear the SME floor?) but never
 *      writes `segment` — that decision needs the owner's word.
 *   2. ISSUE SIZE — written ONLY when the sourced total differs from the
 *      current stored value; when they already match (rounding-tolerant),
 *      the row is reported ALREADY_CORRECT and left untouched — the
 *      current value already equals the BSE-source-backed shares x price
 *      figure, so "repairing" it would just be writing the same number
 *      back with a new source. A row this tool cannot source at all is
 *      reported UNSOURCED, never guessed.
 *
 * dry-run by default (`--apply` to write, plus `--allow-prod`, per
 * scripts/lib/repair-tool.ts). ONE transaction per row; a `field_sources`
 * provenance row is written for every changed value; a read-back after
 * write is printed.
 *
 * Usage (from scraper/, tunnel env exported):
 *   npx tsx scripts/repair-bse-issue-size-residue.ts [--scan-from N] [--scan-to N] [--apply] [--allow-prod]
 */
import { db } from '@ipodhan/shared';
import * as schema from '@ipodhan/shared/db/schema';
import { and, eq } from 'drizzle-orm';
import { pathToFileURL } from 'node:url';
import { normalizeCompanyNameForMatching } from '@ipodhan/shared/utils/company-name-normalizer';
import {
  MAINBOARD_ISSUE_SIZE_FLOOR,
  SME_ISSUE_SIZE_FLOOR,
} from '../src/services/data-consolidation-service.js';
import logger from '../src/utils/logger.js';
import { openRepairDb, upsertFieldSource, writeLedgerFile } from './lib/repair-tool.js';

const APPLY = process.argv.includes('--apply');
const ALLOW_PROD = process.argv.includes('--allow-prod');
export const UPDATED_BY = 'repair-bse-issue-size-residue';

function readIntFlag(name: string, def: number): number {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx < 0) return def;
  const v = Number(process.argv[idx + 1]);
  return Number.isFinite(v) ? v : def;
}
const SCAN_FROM = readIntFlag('scan-from', 7947);
const SCAN_TO = readIntFlag('scan-to', 7100);

const BSE_API_BASE = 'https://api.bseindia.com/BseIndiaAPI/api/';
const BSE_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  Origin: 'https://www.bseindia.com',
  Referer: 'https://www.bseindia.com/',
  Accept: 'application/json',
};

/** ---- Pure logic (unit-tested, no DB/network) ------------------------- */

export interface FloorViolationCandidateRow {
  ipoId: string;
  segment: 'MAINBOARD' | 'SME' | null;
  issueSize: number | null;
  issueSizeSource: string | null; // field_sources.source for issueSize, or null if untracked
}

/**
 * Selection predicate for the class: BSE-provenance issueSize below the
 * segment's floor. A non-BSE row below floor is a DIFFERENT class (already
 * covered by backfill-issue-size-chittorgarh-detail.ts); a BSE row that
 * already clears its floor is not a member at all.
 */
export function segmentFloor(segment: 'MAINBOARD' | 'SME' | null): number | null {
  return segment === 'MAINBOARD' ? MAINBOARD_ISSUE_SIZE_FLOOR : segment === 'SME' ? SME_ISSUE_SIZE_FLOOR : null;
}

export function selectBseFloorViolations<T extends FloorViolationCandidateRow>(rows: T[]): T[] {
  return rows.filter((r) => {
    if (r.issueSizeSource !== 'BSE') return false;
    const floor = segmentFloor(r.segment);
    if (floor === null) return false; // no segment (RIGHTS/NCD/REIT/InvIT) — floor doesn't apply
    if (r.issueSize === null) return true; // null/0 is the same defect class — no usable value
    return r.issueSize < floor;
  });
}

export interface BseSourcedFigures {
  shares: number;
  priceCapOrFixed: number;
  ipoNo: string;
}

/**
 * The one place shares x price happens — and it is legitimate here ONLY
 * because BOTH numbers were just read from the SAME BSE response as the
 * violation's own source of truth, and the source states no total of its
 * own. Never called with a hand-typed or remembered price.
 */
export function deriveSourcedTotal(figures: BseSourcedFigures): number {
  if (!Number.isFinite(figures.shares) || figures.shares <= 0) {
    throw new Error(`deriveSourcedTotal: shares must be a positive finite number, got ${figures.shares}`);
  }
  if (!Number.isFinite(figures.priceCapOrFixed) || figures.priceCapOrFixed <= 0) {
    throw new Error(`deriveSourcedTotal: priceCapOrFixed must be a positive finite number, got ${figures.priceCapOrFixed}`);
  }
  return Math.round(figures.shares * figures.priceCapOrFixed);
}

export type RepairDecision =
  | { status: 'UNSOURCED'; reason: string }
  | { status: 'ALREADY_CORRECT'; sourcedTotal: number; reason: string }
  | { status: 'WRITE'; sourcedTotal: number; reason: string }
  | { status: 'SKIP_ABOVE_FLOOR'; reason: string };

/**
 * Pure decision function — proves: a sourced row whose total already
 * matches the stored value is never rewritten (ALREADY_CORRECT); a sourced
 * row whose total differs is a WRITE; a row this tool could not source is
 * UNSOURCED, never defaulted to a guess.
 */
export function decideBseIssueSizeRepair(input: {
  current: number | null;
  segment: 'MAINBOARD' | 'SME' | null;
  sourced: BseSourcedFigures | null; // null = could not be sourced at all
}): RepairDecision {
  if (input.sourced === null) {
    return { status: 'UNSOURCED', reason: 'no matching BSE detail record found within the scanned IPO_NO range' };
  }
  const sourcedTotal = deriveSourcedTotal(input.sourced);
  const floor = segmentFloor(input.segment);
  if (floor !== null && sourcedTotal >= floor) {
    // Still respects the selection: this only fires if segment is corrected
    // upward from what's stored, which this tool never does on its own.
  }
  if (input.current !== null && Math.abs(input.current - sourcedTotal) <= 1) {
    return {
      status: 'ALREADY_CORRECT',
      sourcedTotal,
      reason: `stored value (${input.current}) already equals the BSE-source-backed total (shares ${input.sourced.shares} x price ${input.sourced.priceCapOrFixed} = ${sourcedTotal}) — left untouched`,
    };
  }
  return {
    status: 'WRITE',
    sourcedTotal,
    reason: `stored value (${input.current ?? 'NULL'}) differs from the BSE-source-backed total (${sourcedTotal}) — will write`,
  };
}

/** ---- Network sourcing -------------------------------------------------- */

interface BSEDetailRow {
  IPO_NO: string;
  ScripName: string;
  Issue_Size_No_of_shares: string;
  Price_Band: string; // "0.00-668.00" or "120.00-127.00"
}

function asArray<T>(j: unknown): T[] {
  if (Array.isArray(j)) return j as T[];
  if (j && typeof j === 'object') {
    const arr = Object.values(j as Record<string, unknown>).find((v) => Array.isArray(v));
    if (arr) return arr as T[];
  }
  return [];
}

async function fetchBseDetail(ipoNo: number): Promise<BSEDetailRow | null> {
  try {
    const r = await fetch(`${BSE_API_BASE}GetMkt_ISSUE_BBS_IPO/w?IPO_NO=${ipoNo}`, {
      headers: BSE_HEADERS,
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) return null;
    const text = await r.text();
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      return null;
    }
    return asArray<BSEDetailRow>(json)[0] ?? null;
  } catch (err) {
    logger.warn({ ipoNo, error: err instanceof Error ? err.message : String(err) }, 'BSE detail fetch failed');
    return null;
  }
}

/** "0.00-668.00" -> {low:0, high:668}; "120.00-127.00" -> {low:120, high:127}; else null. */
export function parseBsePriceBand(raw: string | undefined): { low: number; high: number } | null {
  if (!raw) return null;
  const m = raw.match(/^\s*([\d.]+)\s*-\s*([\d.]+)\s*$/);
  if (!m) return null;
  const low = Number(m[1]);
  const high = Number(m[2]);
  if (!Number.isFinite(low) || !Number.isFinite(high)) return null;
  return { low, high };
}

/**
 * Enumerate IPO_NO from `from` down to `to`, return the first detail row
 * whose normalized ScripName matches `normalizedTarget`. Bounded and
 * sequential (mirrors backfill-bse-historical.ts's established pattern) —
 * a scan-and-match, never a guess.
 */
async function findBseDetailByName(
  normalizedTarget: string,
  from: number,
  to: number
): Promise<{ ipoNo: number; row: BSEDetailRow } | null> {
  const step = from >= to ? -1 : 1;
  for (let n = from; step < 0 ? n >= to : n <= to; n += step) {
    const row = await fetchBseDetail(n);
    if (!row?.ScripName) continue;
    if (normalizeCompanyNameForMatching(row.ScripName) === normalizedTarget) {
      return { ipoNo: n, row };
    }
  }
  return null;
}

/** ---- Main -------------------------------------------------------------- */

async function main() {
  console.log('='.repeat(80));
  console.log(`BSE ISSUE-SIZE RESIDUE REPAIR (item 14 slice 2) — ${APPLY ? 'APPLY' : 'DRY-RUN'}`);
  console.log('='.repeat(80));

  await openRepairDb(db, {
    apply: APPLY,
    allowProd: ALLOW_PROD,
    toolName: 'repair-bse-issue-size-residue',
  });

  const rows = await db
    .select({
      id: schema.ipos.id,
      companyName: schema.ipos.companyName,
      slug: schema.ipos.slug,
      segment: schema.ipos.segment,
      status: schema.ipos.status,
      issueSize: schema.ipos.issueSize,
      priceRangeMin: schema.ipos.priceRangeMin,
      priceRangeMax: schema.ipos.priceRangeMax,
      bseIpoNo: schema.ipos.bseIpoNo,
      source: schema.fieldSources.source,
    })
    .from(schema.ipos)
    .leftJoin(
      schema.fieldSources,
      and(
        eq(schema.fieldSources.ipoId, schema.ipos.id),
        eq(schema.fieldSources.tableName, 'ipos'),
        eq(schema.fieldSources.fieldName, 'issueSize')
      )
    )
    .where(eq(schema.ipos.offeringType, 'IPO'));

  const candidates = selectBseFloorViolations(
    rows.map((r) => ({
      ipoId: r.id,
      segment: r.segment as 'MAINBOARD' | 'SME' | null,
      issueSize: r.issueSize === null ? null : Number(r.issueSize),
      issueSizeSource: r.source ?? null,
      // carry-through fields for reporting
      companyName: r.companyName,
      slug: r.slug,
      status: r.status,
      priceRangeMin: r.priceRangeMin,
      priceRangeMax: r.priceRangeMax,
      bseIpoNo: r.bseIpoNo,
    }))
  ) as unknown as Array<
    FloorViolationCandidateRow & {
      companyName: string;
      slug: string;
      status: string;
      priceRangeMin: number | null;
      priceRangeMax: number | null;
      bseIpoNo: number | null;
    }
  >;

  console.log(`class members (BSE-provenance issue_size below segment floor): ${candidates.length}`);

  let written = 0;
  let alreadyCorrect = 0;
  let unsourced = 0;

  for (const c of candidates) {
    console.log('-'.repeat(80));
    console.log(`${c.companyName} (${c.slug}) — segment=${c.segment} status=${c.status} issue_size=${c.issueSize} band=${c.priceRangeMin}-${c.priceRangeMax}`);

    let sourced: BseSourcedFigures | null = null;
    let sourceDescription: string;

    if (c.bseIpoNo != null) {
      const row = await fetchBseDetail(c.bseIpoNo);
      sourceDescription = `bse_ipo_no=${c.bseIpoNo} (stored)`;
      if (row) {
        const band = parseBsePriceBand(row.Price_Band);
        const shares = Number(row.Issue_Size_No_of_shares);
        if (band && Number.isFinite(shares) && shares > 0) {
          sourced = { shares, priceCapOrFixed: band.high, ipoNo: row.IPO_NO };
        }
      }
    } else {
      const normalized = normalizeCompanyNameForMatching(c.companyName);
      sourceDescription = `name-scan IPO_NO ${SCAN_FROM}->${SCAN_TO} (no bse_ipo_no stored)`;
      const found = await findBseDetailByName(normalized, SCAN_FROM, SCAN_TO);
      if (found) {
        const band = parseBsePriceBand(found.row.Price_Band);
        const shares = Number(found.row.Issue_Size_No_of_shares);
        if (band && Number.isFinite(shares) && shares > 0) {
          sourced = { shares, priceCapOrFixed: band.high, ipoNo: found.row.IPO_NO };
        }
      }
    }

    const decision = decideBseIssueSizeRepair({ current: c.issueSize, segment: c.segment, sourced });
    console.log(`  endpoint tried: GetMkt_ISSUE_BBS_IPO/w — ${sourceDescription}`);
    if (sourced) {
      console.log(`  BSE detail found: IPO_NO=${sourced.ipoNo} shares=${sourced.shares} price=${sourced.priceCapOrFixed}`);
    } else {
      console.log('  BSE detail found: none (no matching record in the scanned range)');
    }
    console.log(`  decision: ${decision.status} — ${decision.reason}`);

    if (decision.status === 'WRITE') {
      const floor = segmentFloor(c.segment);
      const clearsFloorAtCurrentSegment = floor !== null && decision.sourcedTotal >= floor;
      console.log(
        `  segment note (informational only, never written by this tool): at segment=${c.segment}, ` +
          `corrected total ${decision.sourcedTotal} ${clearsFloorAtCurrentSegment ? 'CLEARS' : 'still falls below'} the floor.`
      );
      if (!APPLY) {
        written++; // counted as "would write" in dry-run
        continue;
      }
      await db.transaction(async (tx) => {
        await upsertFieldSource(tx as any, {
          ipoId: c.ipoId,
          fieldName: 'issueSize',
          source: 'ADMIN',
          confidence: 100,
          previousValue: c.issueSize,
          dataLineage: {
            note: 'repair: item 14 slice 2 — BSE issue-size residue (pre-019d11fe unconverted share count)',
            formula: 'shares x price_band_high, both read from BSE GetMkt_ISSUE_BBS_IPO/w',
            bseIpoNo: sourced!.ipoNo,
            shares: sourced!.shares,
            priceCapOrFixed: sourced!.priceCapOrFixed,
          },
          updatedBy: UPDATED_BY,
        });
        await tx
          .update(schema.ipos)
          .set({ issueSize: String(decision.sourcedTotal) })
          .where(eq(schema.ipos.id, c.ipoId));
      });
      written++;

      const [after] = await db
        .select({ id: schema.ipos.id, issueSize: schema.ipos.issueSize, updatedAt: schema.ipos.updatedAt })
        .from(schema.ipos)
        .where(eq(schema.ipos.id, c.ipoId))
        .limit(1);
      console.log(`  read-back after write: ${JSON.stringify(after)}`);

      const ledgerPath = `evidence/${new Date().toISOString().slice(0, 10)}-item14-s2/applied-${c.slug}.json`;
      writeLedgerFile(ledgerPath, {
        appliedAt: new Date().toISOString(),
        ipoId: c.ipoId,
        slug: c.slug,
        before: c.issueSize,
        after: decision.sourcedTotal,
        sourced,
      });
      console.log(`  ledger written: ${ledgerPath}`);
    } else if (decision.status === 'ALREADY_CORRECT') {
      alreadyCorrect++;
    } else if (decision.status === 'UNSOURCED') {
      unsourced++;
    }
  }

  console.log('='.repeat(80));
  console.log(
    `summary: candidates=${candidates.length} ${APPLY ? 'written' : 'would-write'}=${written} already-correct=${alreadyCorrect} unsourced=${unsourced}`
  );
  if (!APPLY && candidates.length > 0) {
    console.log('DRY-RUN: re-run with --apply to write (requires --allow-prod against production).');
  }
  console.log('='.repeat(80));
  process.exit(0);
}

const isMain = import.meta.url === pathToFileURL(process.argv[1] ?? '').href;
if (isMain) {
  main().catch((e) => {
    logger.error({ error: e instanceof Error ? e.message : String(e) }, 'repair-bse-issue-size-residue crashed');
    console.error(e);
    process.exit(1);
  });
}
