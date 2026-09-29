/**
 * An admin creates an IPO row by hand — spec §9.2 item 15 (OD-111), with OD-89 (which identifiers
 * binding uses), OD-85 (source record keys), OD-34 (binding order) and OD-68 (a name-only match is
 * held).
 *
 * The row is created with the company name, the offering type and at least one identifier binding
 * uses: the CIN, an exchange or aggregator record number (BSE IPO number, NSE issue SYMBOL|SERIES,
 * Chittorgarh page id), or the NSE or BSE symbol. The SEBI filing number is refused: OD-89 dropped
 * it from binding, so a row carrying only that would be found by name alone.
 *
 * Each identifier is written EXACTLY where a scraper-created row has it — the CIN and symbol on
 * `ipos`, a record number in `ipo_source_keys` through `IPORepository.create`'s own key write — so
 * `resolveIpoRow` binds a later scraped record to this row with no special case. The one special
 * case is the reverse: a record that reaches this row on its NAME alone is held (OD-111), which
 * `resolveIpoRow` decides by the `IPO_CREATED_BY_ADMIN` audit row written here.
 *
 * Before creating, the admin's identity is run through the REAL resolver. If it binds an existing
 * row, that row already is this offering (or its identifier is taken): the create is refused and
 * the row named, so the admin edits it instead of making a duplicate.
 *
 * The field plan is planted by the scraper's next document cycle (PASS 2.5 plants every live IPO
 * without one, OD-76); the other values are typed in the editor under item 12 (OD-108).
 */
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '../db/schema';
import { auditLogs, offeringTypeEnum } from '../db/schema';
import { IPORepository, IPO_CREATED_BY_ADMIN_ACTION } from '../repositories/ipo-repository';
import { resolveIpoRow } from '../repositories/ipo-identity';
import {
  chittorgarhPageId,
  normalizeSourceKeyValue,
  SourceKeyDuplicateError,
  SourceKeyHeldError,
  SourceKeySupersededError,
  type SourceKeyRef,
  type SourceKeyType,
} from '../repositories/ipo-source-keys';
import { IdentityHeldForReviewError } from '../errors/repository-errors';
import { normalizeCin } from '../utils/cin';
import { normalizeCompanyNameForMatching } from '../utils/company-name-normalizer';
import { generateIPOSlug } from '../utils/slug';
import { logger } from '../logger';

type Db = NodePgDatabase<typeof schema>;

export type AdminIdentifierKind =
  | 'CIN'
  | 'NSE_SYMBOL'
  | 'BSE_SYMBOL'
  | 'BSE_IPO_NO'
  | 'NSE_ISSUE'
  | 'CG_PAGE_ID'
  /** Accepted only to be refused with the OD-89 reason. */
  | 'SEBI_FILING_NO';

export const ADMIN_IDENTIFIER_KINDS: readonly AdminIdentifierKind[] = [
  'CIN', 'NSE_SYMBOL', 'BSE_SYMBOL', 'BSE_IPO_NO', 'NSE_ISSUE', 'CG_PAGE_ID',
];

export const OFFERING_TYPES = offeringTypeEnum.enumValues;
export type OfferingType = (typeof OFFERING_TYPES)[number];

/** Types with a public detail page and editor today (`/ipos/<slug>`); every other type is Q3. */
const TYPES_WITH_DETAIL_PAGE: ReadonlySet<string> = new Set(['IPO']);

/** The source label each record number is stored under — the label its scraper writes (OD-85). */
const KEY_SOURCE: Record<Extract<AdminIdentifierKind, SourceKeyType>, string> = {
  BSE_IPO_NO: 'BSE',
  NSE_ISSUE: 'NSE',
  CG_PAGE_ID: 'CHITTORGARH',
};

export interface AdminIpoCreateInput {
  companyName: string;
  offeringType: string;
  segment?: 'MAINBOARD' | 'SME' | null;
  identifiers: { kind: AdminIdentifierKind; value: string }[];
  /** Where the admin read the identifiers (document and page, or a URL). Audit detail. */
  sourceNote?: string | null;
  actor: { name: string; adminId: string };
  ipAddress?: string | null;
  userAgent?: string | null;
}

export type AdminIpoCreateResult =
  | { kind: 'CREATED'; ipoId: string; slug: string; offeringType: string; editorPath: string | null }
  | { kind: 'INVALID'; reason: string }
  | { kind: 'EXISTS'; reason: string; ipoId: string; slug: string; companyName: string }
  | { kind: 'HELD'; reason: string; candidates: { id: string; slug: string; companyName: string }[] };

interface ParsedIdentity {
  cin: string | null;
  symbol: string | null;
  keys: SourceKeyRef[];
}

// Not a discriminated union: shared compiles without strictNullChecks, where `!r.ok` does not narrow.
interface ParseResult {
  ok: boolean;
  identity?: ParsedIdentity;
  reason?: string;
}

const SYMBOL_RE = /^[A-Z0-9][A-Z0-9&.-]{0,19}$/;

/** Validates and normalises each identifier; the reason names the one that failed. */
export function parseAdminIdentifiers(
  identifiers: readonly { kind: string; value: string }[]
): ParseResult {
  const list = (identifiers ?? []).filter((i) => i && typeof i.value === 'string' && i.value.trim() !== '');
  if (list.some((i) => i.kind === 'SEBI_FILING_NO')) {
    return {
      ok: false,
      reason: 'The SEBI filing number cannot identify a row: OD-89 dropped it from binding (SEBI numbers each document separately). ' +
        'Give the CIN, an exchange or aggregator record number, or the NSE or BSE symbol.',
    };
  }
  if (list.length === 0) {
    return {
      ok: false,
      reason: 'At least one identifier is required (OD-111): the CIN, an exchange or aggregator record number, or the NSE or BSE symbol. ' +
        'Without one, the scraper could only find this row by name, and a name-only match is held (OD-68).',
    };
  }
  const out: ParsedIdentity = { cin: null, symbol: null, keys: [] };
  for (const { kind, value } of list) {
    switch (kind) {
      case 'CIN': {
        const cin = normalizeCin(value);
        if (!cin) return { ok: false, reason: `"${value}" is not a CIN: a CIN is 21 letters and digits (for example U31909DL2005PLC139412).` };
        if (out.cin && out.cin !== cin) return { ok: false, reason: 'Two different CINs were given; a row has one.' };
        out.cin = cin;
        break;
      }
      case 'NSE_SYMBOL':
      case 'BSE_SYMBOL': {
        const symbol = normalizeSourceKeyValue(value);
        if (!symbol || !SYMBOL_RE.test(symbol)) return { ok: false, reason: `"${value}" is not an exchange symbol (up to 20 letters, digits, &, . or -).` };
        if (out.symbol && out.symbol !== symbol) {
          return { ok: false, reason: `Two different symbols were given (${out.symbol}, ${symbol}); the row stores one symbol. Give the other exchange's record number instead.` };
        }
        out.symbol = symbol;
        break;
      }
      case 'BSE_IPO_NO': {
        const v = normalizeSourceKeyValue(value);
        if (!v || !/^\d{1,10}$/.test(v)) return { ok: false, reason: `"${value}" is not a BSE IPO number (digits only).` };
        out.keys.push({ source: KEY_SOURCE.BSE_IPO_NO, keyType: 'BSE_IPO_NO', keyValue: v });
        break;
      }
      case 'NSE_ISSUE': {
        const v = normalizeSourceKeyValue(value)?.replace(/\s*\|\s*/, '|') ?? null;
        if (!v || !/^[A-Z0-9&.-]{1,20}\|[A-Z0-9]{1,4}$/.test(v)) {
          return { ok: false, reason: `"${value}" is not an NSE issue: write it as SYMBOL|SERIES (for example ICEL|EQ or ICEL|SM).` };
        }
        out.keys.push({ source: KEY_SOURCE.NSE_ISSUE, keyType: 'NSE_ISSUE', keyValue: v });
        break;
      }
      case 'CG_PAGE_ID': {
        const trimmed = value.trim();
        const id = /^\d{1,10}$/.test(trimmed) ? trimmed : chittorgarhPageId(trimmed);
        if (!id) return { ok: false, reason: `"${value}" is not a Chittorgarh page id: give the number, or the page URL (…/ipo/<name>/<id>/).` };
        out.keys.push({ source: KEY_SOURCE.CG_PAGE_ID, keyType: 'CG_PAGE_ID', keyValue: id });
        break;
      }
      default:
        return { ok: false, reason: `Unknown identifier kind "${kind}".` };
    }
  }
  return { ok: true, identity: out };
}

const noRedis = {
  get: async () => null, set: async () => 'OK', setex: async () => 'OK', del: async () => 0,
  keys: async () => [], scan: async () => ['0', []],
} as never;

export async function createIpoByAdmin(db: Db, input: AdminIpoCreateInput, redis?: unknown): Promise<AdminIpoCreateResult> {
  const companyName = typeof input.companyName === 'string' ? input.companyName.replace(/\s+/g, ' ').trim() : '';
  if (!companyName || companyName.length > 255) return { kind: 'INVALID', reason: 'The company name is required (up to 255 characters).' };
  if (!(OFFERING_TYPES as readonly string[]).includes(input.offeringType)) {
    return { kind: 'INVALID', reason: `"${input.offeringType}" is not an offering type (${OFFERING_TYPES.join(', ')}).` };
  }
  const segment = input.segment ?? null;
  if (segment !== null && segment !== 'MAINBOARD' && segment !== 'SME') return { kind: 'INVALID', reason: 'The segment is MAINBOARD or SME.' };
  if (input.offeringType === 'IPO' && !segment) {
    return { kind: 'INVALID', reason: 'An IPO needs its segment (MAINBOARD or SME): it decides which sources each field is read from (#860).' };
  }
  if (!input.actor?.name?.trim() || !input.actor?.adminId?.trim()) {
    return { kind: 'INVALID', reason: 'The admin name and account id are required: every admin write is attributed (OD-104, OD-113).' };
  }
  const parsed = parseAdminIdentifiers(input.identifiers);
  if (!parsed.ok || !parsed.identity) return { kind: 'INVALID', reason: parsed.reason ?? 'The identifiers are not valid.' };
  const { cin, symbol, keys } = parsed.identity;

  const repo = new IPORepository(db as never, (redis ?? noRedis) as never);
  const slug = generateIPOSlug(companyName);

  // The real resolver, exactly as a scraper record carrying these identifiers would run it.
  let existing;
  try {
    existing = await resolveIpoRow(repo, {
      companyName,
      normalizedName: normalizeCompanyNameForMatching(companyName),
      slug,
      cin,
      symbol,
      segment,
      offeringType: input.offeringType,
      sourceKeys: keys,
    });
  } catch (e) {
    if (e instanceof IdentityHeldForReviewError) {
      return { kind: 'HELD', reason: e.message, candidates: e.candidates.map((c) => ({ id: c.id, slug: c.slug, companyName: c.companyName })) };
    }
    if (e instanceof SourceKeySupersededError) return existsResult(repo, e.ipoId, 'this record number is an older, superseded number of that row');
    if (e instanceof SourceKeyDuplicateError) return existsResult(repo, e.ipoIds[0], 'these record numbers already belong to existing rows');
    if (e instanceof SourceKeyHeldError) return { kind: 'HELD', reason: e.message, candidates: [] };
    throw e;
  }
  if (existing) return existsResult(repo, existing.id, 'an identifier you gave already binds to it');

  // A symbol the resolver declined (another type or company) would still make two rows answer one
  // symbol, and the scraper could bind to either: refused the same way.
  if (symbol) {
    const holder = await repo.findBySymbol(symbol);
    if (holder) return existsResult(repo, holder.id, `symbol ${symbol} is already on it`);
  }

  let created;
  try {
    created = await db.transaction(async (tx) => {
      const txRepo = new IPORepository(tx as never, noRedis);
      const row = await txRepo.create(
        { companyName, slug, offeringType: input.offeringType, segment, status: 'UPCOMING', cin, symbol } as never,
        { sourceKeys: keys, boundBy: `admin:${input.actor.adminId}`.slice(0, 64) }
      );
      await tx.insert(auditLogs).values({
        adminUser: input.actor.name,
        actionType: IPO_CREATED_BY_ADMIN_ACTION,
        ipoId: row.id,
        tableName: 'ipos',
        fieldName: 'identity',
        newValue: row.slug,
        details: {
          rule: 'OD-111',
          adminId: input.actor.adminId,
          companyName,
          offeringType: input.offeringType,
          segment,
          identifiers: { cin, symbol, sourceKeys: keys.map((k) => `${k.source}:${k.keyType}:${k.keyValue}`) },
          sourceNote: input.sourceNote?.trim() || null,
        },
        ipAddress: input.ipAddress ?? null,
        userAgent: input.userAgent ?? null,
        success: true,
      });
      return row;
    });
  } catch (e) {
    if (e instanceof IdentityHeldForReviewError) {
      return { kind: 'HELD', reason: e.message, candidates: e.candidates.map((c) => ({ id: c.id, slug: c.slug, companyName: c.companyName })) };
    }
    if (e instanceof SourceKeyDuplicateError) return existsResult(repo, e.ipoIds.find((id) => id) ?? '', 'a record number you gave is already bound to it');
    const code = (e as { code?: string }).code;
    if (code === '23505') return { kind: 'INVALID', reason: 'Another row took this name or identifier at the same moment; reload and check before creating again.' };
    throw e;
  }

  // List/search cache entries are dropped after commit by the web wrapper (a rolled-back create must not drop them).
  logger.info({ ipoId: created.id, slug: created.slug, by: input.actor.name, cin, symbol, keys: keys.length }, '[OD-111] IPO row created by an admin');
  return {
    kind: 'CREATED',
    ipoId: created.id,
    slug: created.slug,
    offeringType: created.offeringType,
    editorPath: TYPES_WITH_DETAIL_PAGE.has(created.offeringType) ? `/ipos/${created.slug}?edit=` : null,
  };
}

async function existsResult(repo: IPORepository, ipoId: string, why: string): Promise<AdminIpoCreateResult> {
  const row = ipoId ? await repo.findByIdUncached(ipoId) : null;
  const slug = row?.slug ?? '(unknown)';
  const name = row?.companyName ?? '(unknown)';
  return {
    kind: 'EXISTS',
    ipoId,
    slug,
    companyName: name,
    reason: `Not created: this offering already exists as "${name}" (${slug}) — ${why}. Open that row and edit it instead.`,
  };
}
