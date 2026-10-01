/**
 * repair-chittorgarh-default-prospectus.ts - #1442 (follow-up of #1417 / PR #1441).
 *
 * RCA: before #1441, `detectProspectusDocType` typed a Chittorgarh-path PDF by file name only and
 * fell through to PROSPECTUS when the name named no type, so a DEFAULT (not evidence) became the
 * terminal, top-ranked type (OD-30, OD-154). #1441 fixed new rows; this tool repairs the rows the
 * old default already stored.
 *
 * Class (selected BY RULE, never by a list of slugs): every ACTIVE `documents` row stored as
 * PROSPECTUS whose title ends "(Chittorgarh)" (the Chittorgarh backfill's title) AND whose URL
 * file name names none of DRHP/RHP/PROSPECTUS (`detectProspectusDocType` returns null - the same
 * test #1441 now applies). Any IPO status, any slot (prod only with the existing owner flag).
 *
 * Each selected row's cover is read by the ONE classifier (`resolveProspectusRowType`, which wraps
 * `classifyOfferDocumentCover`); nothing here classifies text:
 *   cover says PROSPECTUS            -> KEEP (confirmed by cover), nothing written
 *   cover says RHP / DRHP            -> RETYPE to it and re-open the plan rows chosen from it (OD-154)
 *   dead link (HTTP 404 / 410 ONLY)  -> RETIRE: is_active=false (the codebase's superseded/retired
 *                                       flag, honoured by plan supersession and the walk's document
 *                                       fetcher, shown by the admin page) + reason in extraction_error
 *   HTML-200 / 5xx / timeout / network error, unreadable cover  -> NO CHANGE, listed as a known-data issue
 *   / cover names no offer type
 * A COMPLETED row (ranked fields already written) is listed separately and is NOT written unless
 * `--include-completed` is given. Never defaults to PROSPECTUS.
 *
 * Usage (from scraper/):
 *   npx tsx scripts/repair-chittorgarh-default-prospectus.ts --expect-db ipodhan_staging          # dry run
 *   npx tsx scripts/repair-chittorgarh-default-prospectus.ts --expect-db ipodhan_staging --apply
 *   (production also needs --allow-prod; --ipo <uuid[,uuid]> scopes; --include-completed)
 * The tool never connects to Redis: it prints the `documents:<ipoId>` keys (with slot prefix) to drop.
 */
import { sql } from 'drizzle-orm';
import { db } from '@ipodhan/shared';
import { getDocumentsKey } from '@ipodhan/shared/cache/cache-keys';
import { IpoFieldPlanRepository } from '@ipodhan/shared/repositories';
import { heldStatesSqlList } from '../src/services/document-state-machine.js';
import { looksLikePdf } from '../src/services/primary-source-discovery.js';
import {
  chittorgarhDocumentTitle,
  detectProspectusDocType,
  resolveProspectusRowType,
  type ChittorgarhProspectusRow,
  type ProspectusTypeResolverDeps,
} from '../src/scrapers/chittorgarh-document-scraper.js';
import { fileNameFromUrl } from '../src/services/document-classifier.js';
import {
  buildIpoScopeCondition,
  openRepairDb,
  readExpectDbFlag,
  repairToolRedisSlot,
  resolveIpoScope,
} from './lib/repair-tool.js';

export type RepairAction = 'KEEP_CONFIRMED' | 'RETYPE' | 'RETIRE' | 'NO_CHANGE';

export interface SelectedRow {
  companyName: string;
  documentId: string;
  ipoId: string;
  slug: string;
  url: string;
  title: string;
  currentType: string;
  extractionStatus: string;
}

export interface PlannedRow extends SelectedRow {
  fileName: string;
  cover: string;
  action: RepairAction;
  newType?: 'RHP' | 'DRHP';
  reason: string;
  /** extraction already COMPLETED: ranked fields were written from this row. */
  completed: boolean;
  planRowsToReopen: number;
}

export interface RepairDeps extends ProspectusTypeResolverDeps {
  /** why a fetch changed nothing (HTTP 503, timeout, HTML page ...), recorded in the NO_CHANGE reason */
  fetchNote?: (url: string) => string | undefined;
  /** pause between downloads (politeness); tests pass 0 */
  delayMs?: number;
}

export interface RepairOptions {
  apply: boolean;
  includeCompleted: boolean;
  ipoIds: string[];
  slotPrefix: string;
}

interface DbLike {
  execute: (q: any) => Promise<any>;
  transaction: <T>(fn: (tx: { execute: (q: any) => Promise<any> }) => Promise<T>) => Promise<T>;
}

const rowsOf = (r: unknown): Record<string, any>[] => ((r as { rows?: Record<string, any>[] }).rows ?? []) as Record<string, any>[];

/** The class, by rule: stored PROSPECTUS, Chittorgarh-titled, file name naming no offer type. */
export async function selectDefaultTypedRows(d: DbLike, ipoIds: string[] = []): Promise<SelectedRow[]> {
  const scope = buildIpoScopeCondition(ipoIds, 'd.ipo_id');
  const res = await d.execute(sql`
    SELECT d.id, d.ipo_id, i.slug, i.company_name, d.url, d.title, d.type::text AS type, d.extraction_status
      FROM documents d JOIN ipos i ON i.id = d.ipo_id
     WHERE d.type = 'PROSPECTUS'
       AND d.is_active IS NOT FALSE
       AND d.title LIKE '%(Chittorgarh)'
       ${scope ? sql`AND ${scope}` : sql``}
     ORDER BY i.slug, d.id`);
  return rowsOf(res)
    .map((r) => ({
      documentId: String(r.id),
      ipoId: String(r.ipo_id),
      slug: String(r.slug ?? ''),
      companyName: String(r.company_name ?? ''),
      url: String(r.url),
      title: String(r.title),
      currentType: String(r.type),
      extractionStatus: String(r.extraction_status ?? ''),
    }))
    .filter((r) => detectProspectusDocType(r.url) === null);
}

async function countPlanRows(d: DbLike | { execute: (q: any) => Promise<any> }, documentId: string): Promise<number> {
  const res = await d.execute(
    sql`SELECT count(*)::int AS n FROM ipo_field_plan WHERE chosen_document_id = ${documentId}::uuid AND state = 'SUPPLIED'`
  );
  return Number(rowsOf(res)[0]?.n ?? 0);
}

/** Read every selected row's cover through the ONE classifier and decide the action. Writes nothing. */
export async function planRepair(d: DbLike, deps: RepairDeps, ipoIds: string[] = []): Promise<PlannedRow[]> {
  const selected = await selectDefaultTypedRows(d, ipoIds);
  const out: PlannedRow[] = [];
  for (const [i, s] of selected.entries()) {
    if (i > 0 && (deps.delayMs ?? 0) > 0) await new Promise((r) => setTimeout(r, deps.delayMs));
    const row: ChittorgarhProspectusRow = {
      companyName: s.slug, slug: s.slug, isin: null, bseScripCode: null, nseSymbol: null,
      exchange: null, issueType: null, openDate: null, pdfUrl: s.url, docType: null,
    };
    const res = await resolveProspectusRowType(row, deps);
    const base = { ...s, fileName: fileNameFromUrl(s.url), completed: s.extractionStatus === 'COMPLETED' };
    let planned: Omit<PlannedRow, 'planRowsToReopen'>;
    if (res.ok && res.docType === 'PROSPECTUS') {
      planned = { ...base, cover: 'PROSPECTUS', action: 'KEEP_CONFIRMED', reason: 'confirmed by cover' };
    } else if (res.ok) {
      planned = { ...base, cover: res.docType, action: 'RETYPE', newType: res.docType as 'RHP' | 'DRHP', reason: `cover says ${res.docType}` };
    } else if ((res as { reason: string }).reason === 'not_pdf') {
      planned = { ...base, cover: 'not_pdf', action: 'RETIRE', reason: 'dead link (HTTP 404 / 410): not a document' };
    } else {
      const why = (res as { reason: string }).reason;
      const note = deps.fetchNote?.(s.url);
      planned = { ...base, cover: why, action: 'NO_CHANGE', reason: `known-data issue, left unchanged: ${why}${note ? ` (${note})` : ''}` };
    }
    const planRowsToReopen = planned.action === 'RETYPE' || planned.action === 'RETIRE' ? await countPlanRows(d, s.documentId) : 0;
    out.push({ ...planned, planRowsToReopen });
  }
  return out;
}

export interface ApplyOutcome {
  documentId: string;
  slug: string;
  status: 'APPLIED' | 'SKIPPED_COMPLETED' | 'NO_CHANGE' | 'FAILED';
  detail: string;
}

/** The unique_doc_per_ipo violation, however the driver / drizzle wrapped it. */
export function isUniqueDocPerIpoViolation(err: unknown): boolean {
  for (let e: any = err, depth = 0; e && depth < 5; e = e.cause, depth++) {
    if (e.code === '23505' && (e.constraint === undefined || e.constraint === 'unique_doc_per_ipo')) return true;
    if (typeof e.message === 'string' && e.message.includes('unique_doc_per_ipo')) return true;
  }
  return false;
}

/** The row the retype collided with: same IPO, new type, and the same media type / exchange / sequence. */
async function existingOfferDocument(d: DbLike, p: PlannedRow): Promise<string | null> {
  const res = await d.execute(sql`
    SELECT o.id FROM documents me JOIN documents o
      ON o.ipo_id = me.ipo_id AND o.type = ${p.newType!}::document_type AND o.id <> me.id
     AND o.media_type IS NOT DISTINCT FROM me.media_type
     AND o.exchange IS NOT DISTINCT FROM me.exchange
     AND o.sequence_number IS NOT DISTINCT FROM me.sequence_number
     WHERE me.id = ${p.documentId}::uuid ORDER BY o.id LIMIT 1`);
  const id = rowsOf(res)[0]?.id;
  return id ? String(id) : null;
}

/** One transaction per row: a failed row never half-changes. Re-reads each changed row. */
export async function applyRepair(d: DbLike, planned: PlannedRow[], opts: RepairOptions): Promise<{ outcomes: ApplyOutcome[]; cacheKeys: string[] }> {
  const outcomes: ApplyOutcome[] = [];
  const cacheKeys = new Set<string>();
  for (const p of planned) {
    if (p.action !== 'RETYPE' && p.action !== 'RETIRE') continue;
    if (p.completed && !opts.includeCompleted) {
      outcomes.push({ documentId: p.documentId, slug: p.slug, status: 'SKIPPED_COMPLETED', detail: 'extraction COMPLETED: ranked fields already written; re-run with --include-completed after review' });
      continue;
    }
    try {
      await d.transaction(async (tx) => {
        const upd =
          p.action === 'RETYPE'
            ? await tx.execute(sql`UPDATE documents SET type = ${p.newType!}::document_type, title = ${chittorgarhDocumentTitle(p.newType!, p.companyName)}, updated_at = now()
                 WHERE id = ${p.documentId}::uuid AND type = 'PROSPECTUS' AND is_active IS NOT FALSE RETURNING id`)
            : await tx.execute(sql`UPDATE documents SET is_active = false, extraction_error = ${`RETIRED_NOT_A_DOCUMENT (#1442): ${p.reason}`}, updated_at = now()
                 WHERE id = ${p.documentId}::uuid AND type = 'PROSPECTUS' AND is_active IS NOT FALSE RETURNING id`);
        if (rowsOf(upd).length !== 1) throw new Error('row changed since it was read; nothing written');
        // A held (ipo, doc type) fetch-state row that points at this document would read as FOUND
        // forever: put it back to WANTED the way demoteMissingFiles does (state, retry clock, pointer).
        await tx.execute(sql`UPDATE document_fetch_state SET state = 'WANTED', next_retry_at = NULL, document_id = NULL, updated_at = now()
             WHERE document_id = ${p.documentId}::uuid AND state IN (${sql.raw(heldStatesSqlList())})`);
        const plan = await tx.execute(
          sql`SELECT id FROM ipo_field_plan WHERE chosen_document_id = ${p.documentId}::uuid AND state = 'SUPPLIED'`
        );
        const toReopen = rowsOf(plan).map((r) => ({
          planRowId: String(r.id),
          expectedChosenDocumentId: p.documentId,
          supersededBy: p.documentId,
          cause: p.action === 'RETYPE' ? `document retyped PROSPECTUS->${p.newType} by cover (#1442); re-rank per OD-154` : 'document retired as not a document (#1442)',
        }));
        if (toReopen.length > 0) {
          const { reopenedIds } = await new IpoFieldPlanRepository(tx as never, null).reopenSuperseded(toReopen);
          if (reopenedIds.length !== toReopen.length) throw new Error('plan re-open did not cover every row; rolled back');
        }
      });
      const back = rowsOf(await d.execute(sql`SELECT type::text AS type, is_active FROM documents WHERE id = ${p.documentId}::uuid`))[0];
      const held = p.action === 'RETYPE' ? back?.type === p.newType && back?.is_active === true : back?.type === 'PROSPECTUS' && back?.is_active === false;
      if (!held) throw new Error(`READ-BACK MISMATCH: ${JSON.stringify(back)}`);
      cacheKeys.add(`${opts.slotPrefix}${getDocumentsKey(p.ipoId)}`);
      outcomes.push({ documentId: p.documentId, slug: p.slug, status: 'APPLIED', detail: p.action === 'RETYPE' ? `PROSPECTUS -> ${p.newType}; ${p.planRowsToReopen} plan row(s) re-opened` : `retired (is_active=false); ${p.planRowsToReopen} plan row(s) re-opened` });
    } catch (err) {
      const dup = p.action === 'RETYPE' && isUniqueDocPerIpoViolation(err) ? await existingOfferDocument(d, p) : null;
      if (dup) {
        outcomes.push({ documentId: p.documentId, slug: p.slug, status: 'NO_CHANGE', detail: `NO_CHANGE: an RHP/DRHP row already exists for this IPO (document ${dup})` });
      } else {
        outcomes.push({ documentId: p.documentId, slug: p.slug, status: 'FAILED', detail: err instanceof Error ? err.message : String(err) });
      }
    }
  }
  return { outcomes, cacheKeys: [...cacheKeys] };
}

export function formatReport(planned: PlannedRow[]): string[] {
  const lines = ['slug | document id | file name | current type | cover | action'];
  for (const p of planned) {
    lines.push(`${p.slug} | ${p.documentId} | ${p.fileName} | ${p.currentType} | ${p.cover} | ${p.action}${p.newType ? ` -> ${p.newType}` : ''}${p.completed ? ' [EXTRACTION COMPLETED]' : ''}`);
  }
  const completed = planned.filter((p) => p.completed);
  if (completed.length > 0) {
    lines.push(`EXTRACTION ALREADY COMPLETED (${completed.length}); changing these alters ranked fields already written: ${completed.map((p) => p.slug).join(', ')}`);
  }
  const issues = planned.filter((p) => p.action === 'NO_CHANGE');
  if (issues.length > 0) lines.push(`KNOWN-DATA ISSUES (unchanged, ${issues.length}): ${issues.map((p) => `${p.slug} (${p.cover})`).join(', ')}`);
  return lines;
}

export type FetchClass = { kind: 'pdf' | 'dead_link' | 'not_changed'; note?: string };

/**
 * Decide what one HTTP answer means. RETIRE needs proof the link is dead: ONLY HTTP 404 / 410.
 * A 200 that is not a PDF (Cloudflare challenge, maintenance page), any 5xx / 3xx / 4xx other than
 * 404 and 410, a timeout or a network error is transient and changes nothing (stays on the
 * known-data list, with the reason).
 */
export function classifyFetchAnswer(status: number, body: Buffer | null): FetchClass {
  if (status === 404 || status === 410) return { kind: 'dead_link', note: `HTTP ${status}` };
  if (status >= 200 && status < 300) {
    if (body && looksLikePdf(body)) return { kind: 'pdf' };
    return { kind: 'not_changed', note: `HTTP ${status} but the body is not a PDF (challenge or maintenance page?)` };
  }
  return { kind: 'not_changed', note: `HTTP ${status}` };
}

/** Real fetch (same browser User-Agent the backfill sends). Notes explain every no-change answer. */
export function makeLiveFetch(
  timeoutMs = 60_000,
  fetchImpl: typeof fetch = fetch
): { fetchPdf: (url: string) => Promise<Buffer | null>; fetchNote: (url: string) => string | undefined } {
  const notes = new Map<string, string>();
  const fetchPdf = async (url: string): Promise<Buffer | null> => {
    notes.delete(url);
    try {
      const res = await fetchImpl(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(timeoutMs), redirect: 'follow' });
      const ok = res.status >= 200 && res.status < 300;
      const body = ok ? Buffer.from(await res.arrayBuffer()) : null;
      const c = classifyFetchAnswer(res.status, body);
      if (c.kind === 'dead_link') return Buffer.from(c.note!); // a non-PDF marker: the resolver reads it as not_pdf -> RETIRE
      if (c.kind === 'not_changed') {
        notes.set(url, c.note!);
        return null;
      }
      return body;
    } catch (err) {
      const name = err instanceof Error ? err.name : '';
      notes.set(url, name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : `network error: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  };
  return { fetchPdf, fetchNote: (u) => notes.get(u) };
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  const apply = argv.includes('--apply');
  const expectDb = readExpectDbFlag(argv);
  if (expectDb === null) {
    console.error('repair-chittorgarh-default-prospectus: --expect-db <name> is required');
    return 2;
  }
  const scope = resolveIpoScope(argv);
  if (scope.unusable || scope.invalid.length > 0) {
    console.error('repair-chittorgarh-default-prospectus: --ipo needs valid uuid(s)');
    return 2;
  }
  const { dbName } = await openRepairDb(db as never, {
    apply,
    allowProd: argv.includes('--allow-prod'),
    toolName: 'repair-chittorgarh-default-prospectus',
    expectDb,
  });
  const slot = repairToolRedisSlot(dbName).slot;
  const slotPrefix = slot === 'unknown' ? '' : `${slot}:`;
  const d = db as unknown as DbLike;
  const live = makeLiveFetch();
  const planned = await planRepair(d, { fetchPdf: live.fetchPdf, fetchNote: live.fetchNote, delayMs: 1500 }, scope.ipoIds);
  console.log(`mode: ${apply ? 'APPLY' : 'DRY RUN'} on ${dbName}; ${planned.length} row(s) selected by rule`);
  for (const l of formatReport(planned)) console.log(l);
  if (!apply) {
    console.log('DRY RUN: nothing written. Re-run with --apply.');
    return 0;
  }
  const { outcomes, cacheKeys } = await applyRepair(d, planned, { apply, includeCompleted: argv.includes('--include-completed'), ipoIds: scope.ipoIds, slotPrefix });
  for (const o of outcomes) console.log(`${o.status} ${o.slug} ${o.documentId}: ${o.detail}`);
  console.log(`drop these cache keys (this tool does not touch Redis): ${cacheKeys.join(' ') || '(none)'}`);
  return outcomes.some((o) => o.status === 'FAILED') ? 1 : 0;
}

if (process.argv[1] && process.argv[1].endsWith('repair-chittorgarh-default-prospectus.ts')) {
  main().then((c) => process.exit(c)).catch((e) => { console.error(e); process.exit(1); });
}
