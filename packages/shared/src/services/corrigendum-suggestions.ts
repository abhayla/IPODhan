/**
 * Item 9 — a stored corrigendum becomes admin-reviewed SUGGESTIONS (OD-90, spec section 2.5.5 as
 * amended, F-163). Nothing here writes a field on its own: `recordCorrigendumSuggestions` only
 * inserts rows into the admin conflicts queue (`data_conflicts`, OD-61/OD-63), and the field is
 * written only by `acceptCorrigendumSuggestion`, which the admin's resolve action calls.
 *
 * Why suggestions and not an automatic write (F-163): three real corrigenda (Rays of Belief,
 * Skyways, Hy-Tech) use three unrelated phrasings and only one changes a field a document may
 * write. So the rule set below is SMALL and explicit, and any correction sentence it cannot map
 * still reaches the admin as `field = unknown` with its quote.
 */
import { createHash } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '../db/schema';
import { dataConflicts, fieldSources, ipoDetails, ipos } from '../db/schema';
import { createFieldProtectionService } from '../admin/field-protection-checker';
import { IPORepository } from '../repositories/ipo-repository';

type Db = NodePgDatabase<typeof schema>;

/** One page of a corrigendum, as the reader produced it. `ocr` marks a page read by OCR (section 2.2.1). */
export interface CorrigendumPage {
  page: number;
  text: string;
  ocr: boolean;
  confidence?: number | null;
}

export const UNKNOWN_FIELD = 'unknown';
export const CORRIGENDUM_ORIGIN = 'CORRIGENDUM';
export const CORRIGENDUM_ACCEPTED = 'CORRIGENDUM_ACCEPTED';
export const CORRIGENDUM_DISMISSED = 'CORRIGENDUM_DISMISSED';

/** Where each mappable field lives, and whether it is exchange-owned (E-1, section 1.2.1). */
export const CORRIGENDUM_FIELD_TARGETS: Record<string, { table: 'ipos' | 'ipo_details'; exchangeOwned: boolean }> = {
  designatedExchange: { table: 'ipo_details', exchangeOwned: false },
  openDate: { table: 'ipos', exchangeOwned: true },
  closeDate: { table: 'ipos', exchangeOwned: true },
};

export interface ParsedSuggestion {
  fieldName: string; // camelCase field, or UNKNOWN_FIELD
  tableName: string;
  proposedValue: string | null;
  statedOldValue: string | null;
  quote: string;
  page: number;
  ocr: boolean;
  ocrConfidence: number | null;
}

const QUOTE_CH = `["“”'‘’]?`;
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const DAY = '(?:(?:Mon|Tues|Wednes|Thurs|Fri|Satur|Sun)day,?\\s*)?';
const DATE = `${DAY}([A-Z][a-z]+\\s*\\d{1,2}[.,]?\\s*\\d{4})`;

// Rule 1 (Rays of Belief, text layer): "<Designated Stock Exchange> ... should be read as "NSE" instead of "BSE"".
const DESIGNATED_EXCHANGE = new RegExp(
  `Designated\\s+Stock\\s+Exchange[\\s\\S]{0,160}?read\\s+as\\s+${QUOTE_CH}(NSE|BSE)${QUOTE_CH}\\s+instead\\s+of\\s+${QUOTE_CH}(NSE|BSE)${QUOTE_CH}`,
  'gi'
);
// Rule 2 (Skyways, OCR): "... updated from Wednesday, August 26, 2026 to Thursday, August 27, 2026".
const DATE_CHANGE = new RegExp(`(?:updated|revised|changed|extended|modified)\\s+from\\s+${DATE}\\s+to\\s+${DATE}`, 'gi');
const CLOSE_LABEL = /(?:Issue|Bid|Offer)(?:\s*\/\s*(?:Issue|Bid|Offer))?\s+(?:clos\w*)/gi;
const OPEN_LABEL = /(?:Issue|Bid|Offer)(?:\s*\/\s*(?:Issue|Bid|Offer))?\s+(?:open\w*)/gi;
// A correction sentence no rule maps still reaches the admin (field = unknown).
const CORRECTION_CUE = /should\s+be\s+read\s+as|instead\s+of|(?:updated|revised)\s+from\s+\S+/gi;

function normalise(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** "August 27, 2026" -> "2026-08-27"; null when it is not a real calendar date. */
export function parseLongDate(s: string): string | null {
  const m = /^([A-Za-z]+)\s*(\d{1,2})[.,]?\s*(\d{4})$/.exec(s.trim());
  if (!m) return null;
  const month = MONTHS.indexOf(m[1].toLowerCase());
  if (month < 0) return null;
  const day = Number(m[2]);
  const year = Number(m[3]);
  const d = new Date(Date.UTC(year, month, day));
  if (d.getUTCMonth() !== month || d.getUTCDate() !== day) return null;
  return d.toISOString().slice(0, 10);
}

/** Start of the sentence containing `idx`: just after the previous ". " (or "1. " list marker). */
function sentenceStart(text: string, idx: number, maxBack = 300): number {
  const from = Math.max(0, idx - maxBack);
  const window = text.slice(from, idx);
  const re = /[.;:]\s+/g;
  let last = -1;
  let m: RegExpExecArray | null;
  while ((m = re.exec(window)) !== null) last = m.index + m[0].length;
  return last >= 0 ? from + last : from;
}

/**
 * Pure: turn the pages of one corrigendum into suggestions. Deterministic, no I/O.
 */
export function parseCorrigendumSuggestions(pages: CorrigendumPage[]): ParsedSuggestion[] {
  const out: ParsedSuggestion[] = [];
  for (const p of pages) {
    const text = normalise(p.text ?? '');
    if (!text) continue;
    const covered: Array<[number, number]> = [];
    const base = { page: p.page, ocr: p.ocr, ocrConfidence: p.ocr ? p.confidence ?? null : null };

    for (const m of text.matchAll(DESIGNATED_EXCHANGE)) {
      const start = sentenceStart(text, m.index!);
      const end = m.index! + m[0].length;
      covered.push([start, end]);
      out.push({
        ...base,
        fieldName: 'designatedExchange',
        tableName: 'ipo_details',
        proposedValue: m[1].toUpperCase(),
        statedOldValue: m[2].toUpperCase(),
        quote: text.slice(start, end),
      });
    }

    for (const m of text.matchAll(DATE_CHANGE)) {
      const oldIso = parseLongDate(m[1]);
      const newIso = parseLongDate(m[2]);
      const lookFrom = Math.max(0, m.index! - 220);
      const before = text.slice(lookFrom, m.index!);
      const lastOf = (re: RegExp): number => {
        let at = -1;
        for (const x of before.matchAll(re)) at = x.index!;
        return at;
      };
      const closeAt = lastOf(CLOSE_LABEL);
      const openAt = lastOf(OPEN_LABEL);
      let fieldName = UNKNOWN_FIELD;
      let labelAt = -1;
      if (closeAt >= 0 && closeAt >= openAt) {
        fieldName = 'closeDate';
        labelAt = closeAt;
      } else if (openAt >= 0) {
        fieldName = 'openDate';
        labelAt = openAt;
      }
      const start = labelAt >= 0 ? lookFrom + labelAt : sentenceStart(text, m.index!);
      const end = m.index! + m[0].length;
      covered.push([start, end]);
      out.push({
        ...base,
        fieldName: newIso ? fieldName : UNKNOWN_FIELD,
        tableName: fieldName === UNKNOWN_FIELD ? 'ipos' : CORRIGENDUM_FIELD_TARGETS[fieldName].table,
        proposedValue: newIso,
        statedOldValue: oldIso,
        quote: text.slice(start, end),
      });
    }

    for (const m of text.matchAll(CORRECTION_CUE)) {
      const at = m.index!;
      if (covered.some(([s, e]) => at >= s && at < e)) continue;
      const start = sentenceStart(text, at);
      const dot = text.indexOf('. ', at);
      const end = Math.min(dot >= 0 ? dot + 1 : text.length, at + 300);
      covered.push([start, end]);
      out.push({
        ...base,
        fieldName: UNKNOWN_FIELD,
        tableName: 'ipos',
        proposedValue: null,
        statedOldValue: null,
        quote: text.slice(start, end),
      });
    }
  }
  return out;
}

export function suggestionKey(documentId: string, fieldName: string, quote: string): string {
  return createHash('sha256').update(`${documentId}|${fieldName}|${quote}`).digest('hex');
}

async function readStored(
  db: Db,
  ipoId: string,
  tableName: string,
  fieldName: string
): Promise<{ value: string | null; source: string | null }> {
  let value: string | null = null;
  if (tableName === 'ipo_details' && fieldName === 'designatedExchange') {
    const r = await db.select({ v: ipoDetails.designatedExchange }).from(ipoDetails).where(eq(ipoDetails.ipoId, ipoId)).limit(1);
    value = r[0]?.v ?? null;
  } else if (tableName === 'ipos' && (fieldName === 'closeDate' || fieldName === 'openDate')) {
    const col = fieldName === 'closeDate' ? ipos.closeDate : ipos.openDate;
    const r = await db.select({ v: col }).from(ipos).where(eq(ipos.id, ipoId)).limit(1);
    value = r[0]?.v == null ? null : String(r[0].v);
  }
  const src = await db
    .select({ s: fieldSources.source })
    .from(fieldSources)
    .where(and(eq(fieldSources.ipoId, ipoId), eq(fieldSources.tableName, tableName), eq(fieldSources.rowKey, ''), eq(fieldSources.fieldName, fieldName)))
    .limit(1);
  return { value, source: src[0]?.s ?? null };
}

export interface RecordResult {
  parsed: number;
  inserted: number;
  duplicates: number;
  ids: string[];
}

/**
 * Record one suggestion row per parsed correction. Idempotent per (document, field, quote): the
 * second run of the same document inserts nothing (unique suggestion_key, ON CONFLICT DO NOTHING).
 * NEVER writes the field itself.
 */
export async function recordCorrigendumSuggestions(
  db: Db,
  args: { ipoId: string; documentId: string; pages: CorrigendumPage[] }
): Promise<RecordResult> {
  const parsed = parseCorrigendumSuggestions(args.pages);
  const result: RecordResult = { parsed: parsed.length, inserted: 0, duplicates: 0, ids: [] };
  for (const s of parsed) {
    const target = CORRIGENDUM_FIELD_TARGETS[s.fieldName];
    const stored = target ? await readStored(db, args.ipoId, s.tableName, s.fieldName) : { value: null, source: null };
    const exchangeOwned = target?.exchangeOwned ?? false;
    const rows = await db
      .insert(dataConflicts)
      .values({
        ipoId: args.ipoId,
        tableName: s.tableName,
        rowKey: '',
        fieldName: s.fieldName,
        // source1/value1 = what is stored now. `source1` is NOT NULL in the conflicts table; when
        // nothing recorded a source for the stored value, 'DRHP' (the document label) stands in
        // and evidence.storedSource says null — the admin sees the truth in the evidence.
        source1: (stored.source ?? 'DRHP') as never,
        value1: stored.value,
        source2: 'DRHP',
        value2: s.proposedValue,
        severity: 'WARNING',
        resolutionReason: null,
        documentId: args.documentId,
        suggestionKey: suggestionKey(args.documentId, s.fieldName, s.quote),
        evidence: {
          origin: CORRIGENDUM_ORIGIN,
          quote: s.quote,
          page: s.page,
          ocr: s.ocr,
          ocrConfidence: s.ocrConfidence,
          statedOldValue: s.statedOldValue,
          storedSource: stored.source,
          exchangeOwned,
          // E-1: for an exchange-owned field the stored value IS the exchange value; shown beside
          // the suggestion so the admin decides against it, never blind.
          exchangeValue: exchangeOwned ? stored.value : null,
        },
      })
      .onConflictDoNothing({ target: dataConflicts.suggestionKey })
      .returning({ id: dataConflicts.id });
    if (rows.length > 0) {
      result.inserted++;
      result.ids.push(rows[0].id);
    } else {
      result.duplicates++;
    }
  }
  return result;
}

export interface SuggestionDecision {
  ok: boolean;
  conflictId: string;
  fieldName?: string;
  appliedValue?: string | null;
  error?: string;
}

async function loadOpenSuggestion(db: Db, conflictId: string) {
  const rows = await db
    .select()
    .from(dataConflicts)
    .where(and(eq(dataConflicts.id, conflictId), isNull(dataConflicts.resolvedAt)))
    .limit(1);
  const row = rows[0];
  if (!row || !row.documentId) return null;
  return row;
}

// One definition (packages/shared/src/utils/conflict-reasons.ts), re-exported for existing callers.
export { isCorrigendumSuggestion } from '../utils/conflict-reasons';

/**
 * The admin ACCEPTS a suggestion: the proposed value is written as an ADMIN value (field_sources
 * source ADMIN, field protection on — ADMIN outranks every source and holds, OD-90), and the row
 * is closed. One transaction.
 */
export async function acceptCorrigendumSuggestion(
  db: Db,
  conflictId: string,
  adminName: string,
  note?: string
): Promise<SuggestionDecision> {
  const row = await loadOpenSuggestion(db, conflictId);
  if (!row) return { ok: false, conflictId, error: 'not an open corrigendum suggestion' };
  const target = CORRIGENDUM_FIELD_TARGETS[row.fieldName];
  if (!target || row.value2 == null) {
    return { ok: false, conflictId, fieldName: row.fieldName, error: 'suggestion names no writable field; dismiss it or edit the field by hand' };
  }
  const value = row.value2;
  const alreadyDecided = new Error('corrigendum suggestion already decided');
  try {
    await db.transaction(async (tx) => {
      const t = tx as unknown as Db;
      // Claim the row FIRST, re-checking it is still open: a second concurrent accept blocks on this
      // row lock, re-evaluates `resolved_at IS NULL` after the first commits, claims nothing, and
      // rolls back before writing any field (PR #989 review, MINOR 5).
      const claimed = await t
        .update(dataConflicts)
        .set({
          resolvedSource: 'ADMIN',
          resolutionReason: CORRIGENDUM_ACCEPTED,
          resolvedBy: adminName,
          resolvedAt: new Date(),
          adminNote: note ?? null,
        })
        .where(and(eq(dataConflicts.id, conflictId), isNull(dataConflicts.resolvedAt)))
        .returning({ id: dataConflicts.id });
      if (claimed.length === 0) throw alreadyDecided;
      if (target.table === 'ipo_details') {
        const updated = await t
          .update(ipoDetails)
          .set({ designatedExchange: value, updatedAt: new Date() } as never)
          .where(eq(ipoDetails.ipoId, row.ipoId))
          .returning({ id: ipoDetails.id });
        if (updated.length === 0) {
          await t.insert(ipoDetails).values({ ipoId: row.ipoId, designatedExchange: value, dataSource: 'MANUAL' } as never);
        }
      } else {
        // Sanctioned write path (T-316 ratchet): routes through IPORepository so this file never
        // becomes a direct `ipos` writer. Static call + the caller's own `tx` keeps the claim,
        // this write and the field_sources insert below in the ONE transaction.
        await IPORepository.applyAdminCorrigendumValue(t, row.ipoId, row.fieldName, value);
      }
      // #1033 (ist-timezone.md): `updatedAt`/`createdAt` are bound explicitly here as JS `Date`
      // objects (drizzle's PgTimestamp.mapToDriverValue always converts a Date via
      // `.toISOString()` before it reaches Postgres, so this is timezone-independent). Left
      // unset, a first-ever INSERT for this (ipo, table, row, field) falls through to the
      // column's `defaultNow()` -- Postgres's own server-side `now()`, which writes the
      // SESSION's timezone-dependent wall clock instead of a value this code controls. The
      // `onConflictDoUpdate` branch below already set `updatedAt` explicitly; this closes the
      // same gap on the INSERT branch so both paths use the identical, proven-safe mechanism.
      await t
        .insert(fieldSources)
        .values({
          ipoId: row.ipoId,
          tableName: target.table,
          rowKey: '',
          fieldName: row.fieldName,
          source: 'ADMIN',
          confidence: 100,
          previousValue: row.value1,
          previousSource: (row.evidence as { storedSource?: string | null } | null)?.storedSource as never,
          dataLineage: { method: 'ADMIN_CORRIGENDUM_ACCEPT', documentId: row.documentId, conflictId, by: adminName },
          updatedAt: new Date(),
          createdAt: new Date(),
        } as never)
        .onConflictDoUpdate({
          target: [fieldSources.ipoId, fieldSources.tableName, fieldSources.rowKey, fieldSources.fieldName],
          set: {
            source: 'ADMIN',
            confidence: 100,
            previousValue: row.value1,
            previousSource: (row.evidence as { storedSource?: string | null } | null)?.storedSource ?? null,
            dataLineage: { method: 'ADMIN_CORRIGENDUM_ACCEPT', documentId: row.documentId, conflictId, by: adminName },
            updatedAt: new Date(),
          } as never,
        });
      await createFieldProtectionService(t, null).markFieldAsManuallyEdited(
        row.ipoId,
        target.table,
        row.fieldName,
        adminName,
        note ?? `Corrigendum accepted (document ${row.documentId})`,
        true
      );
    });
  } catch (error) {
    if (error === alreadyDecided) {
      return { ok: false, conflictId, fieldName: row.fieldName, error: 'not an open corrigendum suggestion' };
    }
    throw error;
  }
  return { ok: true, conflictId, fieldName: row.fieldName, appliedValue: value };
}

/** The admin DISMISSES a suggestion: the row is closed and NOTHING else is written. */
export async function dismissCorrigendumSuggestion(
  db: Db,
  conflictId: string,
  adminName: string,
  note?: string
): Promise<SuggestionDecision> {
  const row = await loadOpenSuggestion(db, conflictId);
  if (!row) return { ok: false, conflictId, error: 'not an open corrigendum suggestion' };
  const claimed = await db
    .update(dataConflicts)
    .set({
      resolvedSource: row.source1,
      resolutionReason: CORRIGENDUM_DISMISSED,
      resolvedBy: adminName,
      resolvedAt: new Date(),
      adminNote: note ?? null,
    })
    // Re-check it is still open: a dismiss racing an accept must not overwrite the accept.
    .where(and(eq(dataConflicts.id, conflictId), isNull(dataConflicts.resolvedAt)))
    .returning({ id: dataConflicts.id });
  if (claimed.length === 0) return { ok: false, conflictId, fieldName: row.fieldName, error: 'not an open corrigendum suggestion' };
  return { ok: true, conflictId, fieldName: row.fieldName, appliedValue: null };
}
