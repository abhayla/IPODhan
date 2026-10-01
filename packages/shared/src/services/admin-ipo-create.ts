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
import { eq } from 'drizzle-orm';
import * as schema from '../db/schema';
import { auditLogs, ipos, offeringTypeEnum } from '../db/schema';
import { IPORepository, IPO_CREATED_BY_ADMIN_ACTION } from '../repositories/ipo-repository';
import { resolveIpoRow } from '../repositories/ipo-identity';
import { withHoldOrigin } from '../repositories/hold-origin';
import {
  chittorgarhPageId,
  findSourceKeysForIpo,
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
import { lockIdentifierValues } from './admin-identifier-alias';

import type Redis from 'ioredis';
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
  /** Another row holds this name's page address and no identifier given binds it (Tier A MINOR 3). */
  | { kind: 'SLUG_TAKEN'; reason: string; ipoId: string; slug: string; companyName: string }
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

export async function createIpoByAdmin(db: Db, input: AdminIpoCreateInput, redis?: Redis): Promise<AdminIpoCreateResult> {
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

  const repo = new IPORepository(db, redis ?? noRedis);
  const slug = generateIPOSlug(companyName);

  // Tier A MINOR 2: the uniqueness checks and the insert run in ONE transaction that first takes a
  // transaction-scoped advisory lock on every identifier given, so two admins creating the same CIN,
  // symbol or record number at once are serialised: the second reads the first's committed row and
  // is refused naming it. Locks are taken in sorted order so two creates never deadlock.
  const lockKeys = [
    cin ? `cin:${cin}` : null,
    symbol ? `symbol:${symbol}` : null,
    ...keys.map((k) => `key:${k.source}:${k.keyType}:${k.keyValue}`),
  ].filter((k): k is string => k !== null).sort();

  let outcome: { created?: Awaited<ReturnType<IPORepository['create']>>; refusal?: AdminIpoCreateResult };
  try {
    // Every hold recorded inside this scope is tagged admin-create (#1299), whichever path reaches it.
    outcome = await withHoldOrigin('admin-create', () => db.transaction(async (tx) => {
      await lockIdentifierValues(tx as never, lockKeys);
      const txRepo = new IPORepository(tx, noRedis);
      // A refusal RETURNS (the transaction commits), so a hold the resolver records stays recorded.
      const refusal = await refuseIfAlreadyThere(tx as never, txRepo, {
        companyName, slug, cin, symbol, segment, offeringType: input.offeringType, keys,
      });
      if (refusal) return { refusal };
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
      return { created: row };
    }));
  } catch (e) {
    // Not reached by an admin create today: `create`'s own OD-68 fold hold needs a known open date or
    // price band, which an admin create never carries, and a taken slug is refused above. Kept so a
    // future hold still reaches the form as a refusal naming the candidates, never an error.
    if (e instanceof IdentityHeldForReviewError) {
      return { kind: 'HELD', reason: e.message, candidates: e.candidates.map((c) => ({ id: c.id, slug: c.slug, companyName: c.companyName })) };
    }
    if (e instanceof SourceKeyDuplicateError) return existsResult(repo, e.ipoIds.find((id) => id) ?? '', 'a record number you gave is already bound to it');
    const code = (e as { code?: string }).code;
    if (code === '23505') return { kind: 'INVALID', reason: 'Another row took this name or identifier at the same moment; reload and check before creating again.' };
    throw e;
  }
  if (outcome.refusal) return outcome.refusal;
  if (!outcome.created) throw new Error('admin-ipo-create: transaction returned neither created nor refusal');
  const created = outcome.created;

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

/**
 * Every reason the admin's create must not insert, checked inside the locked transaction:
 *   1. the REAL resolver, exactly as a scraper record carrying these identifiers would run it, binds
 *      an existing row (or holds / reports a key conflict);
 *   2. a symbol the resolver declined (another type or company) is still on a row: two rows would
 *      answer one symbol and the scraper could bind to either;
 *   3. (Tier A MINOR 3) another row already holds this name's slug. `IPORepository.create` would HOLD
 *      the create (#928 / OD-130: an admin create carries no open date, so no separate-offering slug
 *      can be minted), and a hold is a scraper-side review queue, not an answer an admin can act on.
 *      The admin is told which row holds it instead: edit that row, or use the merge tool.
 */
async function refuseIfAlreadyThere(
  tx: Db,
  txRepo: IPORepository,
  id: { companyName: string; slug: string; cin: string | null; symbol: string | null; segment: 'MAINBOARD' | 'SME' | null; offeringType: string; keys: SourceKeyRef[] }
): Promise<AdminIpoCreateResult | null> {
  let existing;
  try {
    existing = await resolveIpoRow(txRepo, {
      companyName: id.companyName,
      normalizedName: normalizeCompanyNameForMatching(id.companyName),
      slug: id.slug,
      cin: id.cin,
      symbol: id.symbol,
      segment: id.segment,
      offeringType: id.offeringType,
      sourceKeys: id.keys,
      holdOrigin: 'admin-create',
    });
  } catch (e) {
    if (e instanceof IdentityHeldForReviewError) {
      return { kind: 'HELD', reason: e.message, candidates: e.candidates.map((c) => ({ id: c.id, slug: c.slug, companyName: c.companyName })) };
    }
    if (e instanceof SourceKeySupersededError) return existsResult(txRepo, e.ipoId, 'this record number is an older, superseded number of that row');
    if (e instanceof SourceKeyDuplicateError) return existsResult(txRepo, e.ipoIds[0], 'these record numbers already belong to existing rows');
    if (e instanceof SourceKeyHeldError) return { kind: 'HELD', reason: e.message, candidates: [] };
    throw e;
  }
  if (existing) return existsResult(txRepo, existing.id, await whyBound(tx, existing, id));

  if (id.symbol) {
    const holder = await txRepo.findBySymbol(id.symbol);
    if (holder) return existsResult(txRepo, holder.id, `symbol ${id.symbol} is already on it`);
  }

  const [slugHolder] = await tx
    .select({ id: ipos.id, slug: ipos.slug, companyName: ipos.companyName, status: ipos.status, offeringType: ipos.offeringType })
    .from(ipos)
    .where(eq(ipos.slug, id.slug))
    .limit(1);
  if (slugHolder) {
    return {
      kind: 'SLUG_TAKEN',
      ipoId: slugHolder.id,
      slug: slugHolder.slug,
      companyName: slugHolder.companyName,
      reason: `Not created: the page address "${slugHolder.slug}" already belongs to "${slugHolder.companyName}" ` +
        `(${slugHolder.offeringType}, ${slugHolder.status}), which none of your identifiers binds. ` +
        'If it is this offering, open that row and edit it (add the identifier there). If it is the same offering stored twice, use the merge tool. ' +
        'If it is a different offering of the same company (a relaunch), open that row first to confirm, then create this one with the name as the exchange lists it for the new offering.',
    };
  }
  return null;
}

/**
 * Why the resolver bound `row` to this create (#1299 M2). It reports no tier, so the wording is decided from
 * what the row itself carries: a CIN, symbol or record number the admin gave that is on the row is named;
 * anything else (a name tier, or a kept alias) gets neutral wording rather than a claim about an identifier.
 */
async function whyBound(
  tx: Db,
  row: { id: string; cin?: unknown; symbol?: unknown },
  id: { cin: string | null; symbol: string | null; keys: SourceKeyRef[] }
): Promise<string> {
  const rowCin = typeof row.cin === 'string' ? row.cin.trim().toUpperCase() : null;
  if (id.cin && rowCin === id.cin) return `the CIN ${id.cin} you gave is on it`;
  const rowSymbol = typeof row.symbol === 'string' ? row.symbol.trim().toUpperCase() : null;
  if (id.symbol && rowSymbol === id.symbol.toUpperCase()) return `the symbol ${id.symbol} you gave is on it`;
  if (id.keys.length > 0) {
    const onRow = await findSourceKeysForIpo(tx as never, row.id);
    const shared = id.keys.find((k) => onRow.some((r) => r.source === k.source && r.keyType === k.keyType && r.keyValue === k.keyValue));
    if (shared) return `the ${shared.keyType} ${shared.keyValue} you gave is already bound to it`;
  }
  return 'its name or an identifier you gave matches it';
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
