/**
 * Item 7 S4 (spec docs/design/data-sourcing-pull-model.md §2.1 job table row
 * "Opening-day check", as amended by OD-87; §7.4 budget "2 calls a day").
 *
 * The opening-day check reads the two exchange LISTS only — NSE
 * `/api/ipo-current-issue` and BSE `IPO_HomePageDetail/w` — keeps the rows
 * whose listed open date is today (IST), and for each writes identity,
 * status and the open and close dates, nothing else (OD-87). No per-IPO
 * detail call, no subscription call or snapshot, no verifier hint, no
 * document. The write goes through the same identity resolution
 * (`resolveIpoRow` + OD-85 source keys) and the same consolidated upsert the
 * scrapers use, with `onlyFields` narrowing this write's claim to the four
 * fields, so the field-priority matrix still decides every value.
 *
 * Why not the orchestrators (review of rounds 1-2): they make per-IPO detail
 * and subscription calls by design and write every listed row; a flag that
 * narrows them leaked subscription snapshots, BSE detail calls and the data
 * job's verifier hint.
 */

import { istDayIso } from '@ipodhan/shared/utils/ist-day';
import type { ScrapedIPO } from '../utils/validators.js';
import { validateIPOData } from '../utils/validators.js';
import type { BSEListRow } from '../scrapers/bse-api-scraper.js';
import { bseSourceKeys, deriveBSEStatus, parseBSEDate } from '../scrapers/bse-api-scraper.js';

/** The only fields this job claims (OD-87). Keys are the consolidation input's camelCase names. */
export const OPENING_DAY_FIELDS = ['companyName', 'status', 'openDate', 'closeDate'] as const;

export type OpeningDaySource = 'NSE' | 'BSE';

/**
 * What one kept list row carries into the write: the four OD-87 fields, plus
 * the identity the resolver needs to find the row (source keys, symbol,
 * segment when the exchange states it). Nothing else — no band, lot, size,
 * registrar, CIN, ISIN, verifier URL or documents.
 */
export interface OpeningDayPayload {
  companyName: string;
  status: ScrapedIPO['status'];
  openDate: string;
  closeDate: string;
  symbol?: string | null;
  segment?: ScrapedIPO['segment'];
  listingExchange: OpeningDaySource;
  offeringType: 'IPO';
  sourceKeys: NonNullable<ScrapedIPO['sourceKeys']>;
}

export type OpeningDayWriteOutcome = 'inserted' | 'updated' | 'skipped';

export interface OpeningDayDeps {
  /** NSE current-issue list: one list request (`fetchCurrentIssueList`). */
  fetchNseList: () => Promise<ScrapedIPO[]>;
  /** BSE board: one list request (`fetchBSEBoard`). */
  fetchBseList: () => Promise<BSEListRow[]>;
  /** Stored `ipos` rows whose open_date equals the given IST day. */
  storedOpeningOn: (todayIso: string) => Promise<Array<{ id: string; companyName: string; status: string }>>;
  /** Identity + consolidated write of one payload (see `createOpeningDayWriter`). */
  writeRow: (source: OpeningDaySource, payload: OpeningDayPayload) => Promise<OpeningDayWriteOutcome>;
}

export interface OpeningDaySummary {
  todayIso: string;
  nseRowsChecked: number;
  bseRowsChecked: number;
  written: Array<{ source: OpeningDaySource; companyName: string; key: string | null; outcome: OpeningDayWriteOutcome | 'failed' }>;
  storedOpeningToday: Array<{ id: string; companyName: string; status: string }>;
  failures: string[];
}

function narrowNse(row: ScrapedIPO): OpeningDayPayload | null {
  if (!row.companyName || !row.openDate || !row.closeDate) return null;
  return {
    companyName: row.companyName,
    status: row.status,
    openDate: row.openDate,
    closeDate: row.closeDate,
    symbol: row.symbol ?? null,
    segment: row.segment,
    listingExchange: 'NSE',
    offeringType: 'IPO',
    sourceKeys: row.sourceKeys ?? [],
  };
}

function narrowBse(row: BSEListRow, todayIso: string): OpeningDayPayload | null {
  const companyName = (row.Scrip_name || '').trim();
  const openDate = parseBSEDate(row.Start_Dt);
  const closeDate = parseBSEDate(row.End_Dt);
  if (!companyName || !openDate || !closeDate) return null;
  // The board row carries no share count, band or notes; the OD-85 key records only what it said.
  const detailShape = { IPO_NO: String(row.IPO_NO ?? ''), ScripCode: String(row.Scrip_cd ?? ''), ScripName: companyName } as any;
  return {
    companyName,
    status: deriveBSEStatus(openDate, closeDate, todayIso, { statusCode: row.Status ?? null, notes: [], companyNames: [companyName] }),
    openDate,
    closeDate,
    // BSE's board exposes no segment field; a source that cannot state it must not claim it.
    segment: undefined,
    listingExchange: 'BSE',
    offeringType: 'IPO',
    sourceKeys: bseSourceKeys(detailShape, NaN, {}, openDate, closeDate, todayIso, row.Status ?? null, companyName),
  };
}

/** Rows whose listed open date is `todayIso`, narrowed to the OD-87 payload. */
export function selectOpeningToday(
  nseRows: readonly ScrapedIPO[],
  bseRows: readonly BSEListRow[],
  todayIso: string
): Array<{ source: OpeningDaySource; payload: OpeningDayPayload }> {
  const out: Array<{ source: OpeningDaySource; payload: OpeningDayPayload }> = [];
  for (const r of nseRows) {
    const p = narrowNse(r);
    if (p && p.openDate === todayIso) out.push({ source: 'NSE', payload: p });
  }
  for (const r of bseRows) {
    const p = narrowBse(r, todayIso);
    if (p && p.openDate === todayIso) out.push({ source: 'BSE', payload: p });
  }
  return out;
}

/**
 * One opening-day run: the two list calls (in parallel, each failing alone),
 * today's rows written, stored rows opening today named. Never throws for a
 * single source failure — it is reported in `failures`.
 */
export async function runOpeningDayDiscovery(deps: OpeningDayDeps, now: Date = new Date()): Promise<OpeningDaySummary> {
  const todayIso = istDayIso(now);
  const failures: string[] = [];
  const [nse, bse] = await Promise.allSettled([deps.fetchNseList(), deps.fetchBseList()]);
  const nseRows = nse.status === 'fulfilled' ? nse.value : [];
  const bseRows = bse.status === 'fulfilled' ? bse.value : [];
  if (nse.status === 'rejected') failures.push(`NSE list: ${nse.reason instanceof Error ? nse.reason.message : String(nse.reason)}`);
  if (bse.status === 'rejected') failures.push(`BSE list: ${bse.reason instanceof Error ? bse.reason.message : String(bse.reason)}`);

  const written: OpeningDaySummary['written'] = [];
  for (const { source, payload } of selectOpeningToday(nseRows, bseRows, todayIso)) {
    const key = payload.sourceKeys[0]?.keyValue ?? null;
    try {
      const outcome = await deps.writeRow(source, payload);
      written.push({ source, companyName: payload.companyName, key, outcome });
    } catch (error) {
      failures.push(`${source} ${payload.companyName}: ${error instanceof Error ? error.message : String(error)}`);
      written.push({ source, companyName: payload.companyName, key, outcome: 'failed' });
    }
  }

  let storedOpeningToday: OpeningDaySummary['storedOpeningToday'] = [];
  try {
    storedOpeningToday = await deps.storedOpeningOn(todayIso);
  } catch (error) {
    failures.push(`stored rows: ${error instanceof Error ? error.message : String(error)}`);
  }

  return { todayIso, nseRowsChecked: nseRows.length, bseRowsChecked: bseRows.length, written, storedOpeningToday, failures };
}

/** Minimal collaborator surface the writer needs — the same objects BaseScraperOrchestrator builds. */
export interface OpeningDayWriterCollaborators {
  ipoRepository: {
    bindSourceKeys: (ipoId: string, keys: any[], opts: { boundVia: any; boundBy: string }) => Promise<unknown>;
  } & Record<string, any>;
  resolveIpoRow: (repo: any, input: any) => Promise<any>;
  inferBoundVia: (incoming: any, existing: any) => any;
  withSourceKeyLineage: <T>(fn: () => Promise<T>) => Promise<T>;
  noWriteErrorNames: ReadonlySet<string>;
  fieldProtection: {
    isIPOLocked: (ipoId: string) => Promise<boolean>;
    filterProtectedFields: (ipoId: string, table: string, data: any, source: string) => Promise<{ filtered: Record<string, unknown> }>;
  };
  consolidatedUpsertIPO: (claim: any, source: OpeningDaySource, confidence: number, existing: any, onlyFields: string[]) => Promise<{ ipoId: string; isNew: boolean; skipped: boolean; skipReason?: string }>;
  normalizeName: (name: string) => string;
  identitySlug: (claim: any) => string;
}

/** Same per-source confidence BaseScraperOrchestrator.getConfidenceScore gives the exchanges. */
const CONFIDENCE: Record<OpeningDaySource, number> = { NSE: 95, BSE: 90 };

/**
 * Write one payload: resolve identity (OD-85 keys first), bind keys, honour
 * the IPO lock and field protection, then the consolidated upsert with
 * `onlyFields` = the OD-87 fields still unprotected.
 */
export function createOpeningDayWriter(c: OpeningDayWriterCollaborators) {
  return async (source: OpeningDaySource, payload: OpeningDayPayload): Promise<OpeningDayWriteOutcome> => {
    const validation = validateIPOData(payload);
    if (!validation.success) return 'skipped';
    return c.withSourceKeyLineage(async () => {
      const slug = c.identitySlug(payload);
      let existing: any;
      try {
        existing = await c.resolveIpoRow(c.ipoRepository, {
          companyName: payload.companyName,
          normalizedName: c.normalizeName(payload.companyName),
          slug,
          cin: null,
          isin: undefined,
          symbol: payload.symbol ?? undefined,
          openDate: payload.openDate,
          priceRangeMin: null,
          segment: payload.segment ?? null,
          offeringType: undefined,
          sourceKeys: payload.sourceKeys.length > 0 ? payload.sourceKeys : null,
        });
        if (existing && payload.sourceKeys.length > 0) {
          await c.ipoRepository.bindSourceKeys(existing.id, payload.sourceKeys, {
            boundVia: c.inferBoundVia(payload, existing),
            boundBy: `scraper:${source}`,
          });
        }
      } catch (error) {
        if (c.noWriteErrorNames.has((error as { name?: string })?.name ?? '')) return 'skipped';
        throw error;
      }

      let fields: string[] = [...OPENING_DAY_FIELDS];
      if (existing) {
        if (await c.fieldProtection.isIPOLocked(existing.id)) return 'skipped';
        const { filtered } = await c.fieldProtection.filterProtectedFields(existing.id, 'ipos', payload, source);
        fields = fields.filter((f) => f in filtered);
        if (fields.length === 0) return 'skipped';
      }

      // The stored identity rides along so the consolidated write keeps it (it
      // does not become this write's claim: `onlyFields` below excludes it).
      const claim = {
        ...payload,
        segment: payload.segment ?? existing?.segment ?? undefined,
        offeringType: existing?.offeringType ?? payload.offeringType,
      };
      const r = await c.consolidatedUpsertIPO(claim, source, CONFIDENCE[source], existing ?? null, fields);
      if (r.skipped) return 'skipped';
      return r.isNew ? 'inserted' : 'updated';
    });
  };
}
