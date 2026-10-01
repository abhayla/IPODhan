/**
 * IPO Repository
 *
 * Handles all data access operations for IPO entities.
 * Implements cache-aside pattern with Redis for optimized performance.
 */

import { eq, and, gte, lte, sql, desc, asc, inArray, like, getTableColumns } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type Redis from 'ioredis';
import { BaseRepository } from './base-repository';
import {
  ipos,
  financialData,
  documents,
  subscriptions,
  gmpRecords,
  listingPerformance,
  peerCompanies,
  registrars,
  fieldSources,
  ipoSlugRedirects,
  ipoMergeLog,
  auditLogs,
  ipoSourceKeys,
  ipoIdentifierAliases,
  type ipoStatusEnum,
  type segmentEnum,
  type offeringTypeEnum,
} from '../db/schema';
import type * as schema from '../db/schema';
import {
  CacheTTL,
  getIPOBySlugKey,
  getIPOByIdKey,
  getIPOListKey,
  getIPOSearchKey,
  getHistoricalIPOsKey,
} from '../cache/cache-keys';
import { EntityNotFoundError, DatabaseError, ProdWriteRefusedError, IdentityHeldForReviewError } from '../errors/repository-errors';
import { strictIdentityCompanyName } from '../utils/identity-decoration';
import { normalizeCin } from '../utils/cin';
import { currentHoldOrigin, type HoldOrigin } from './hold-origin';
import { logger } from '../logger';
import {
  normalizeSourceKeyRefs,
  recordSourceKeys,
  activeNseIssueSymbol,
  supersedeOlderKeysOnRelaunchMerge,
  type SourceKeyRef,
  type SourceKeyBoundVia,
} from './ipo-source-keys';
import { noteSourceKeyBind } from './source-key-lineage';
import { ofsIdentityConflict, segmentsConflict } from './ipo-identity-conflicts';
import {
  beginChildRowCapture,
  captureMergeDeletions,
  childRowDeltaJson,
  pkIdentitySql,
  pkMatchSql,
  readPrimaryKeys,
  missingForUnmerge,
  type ChildRowDelta,
  uncheckableUniqueIndexRefusal,
  type MergeCapture,
  type NulledRef,
} from './ipo-merge-restore';

/** audit_logs.action_type of an OD-68 hold; read by the nightly `i_identity_held` check. */
export const IDENTITY_HELD_ACTION = 'IDENTITY_HELD_FOR_REVIEW';
/** §9.2 item 15 (OD-111): the audit action that marks a row an admin created by hand. */
export const IPO_CREATED_BY_ADMIN_ACTION = 'IPO_CREATED_BY_ADMIN';

/**
 * audit_logs.action_type recorded when OD-130 mints a slug for a genuinely
 * separate offering instead of holding it — the transparency trail for a
 * decision that used to be silent (or a silent unique-constraint failure).
 * Not read by `i_identity_held` (that check is scoped to holds); a future
 * check can sweep this action_type the same way.
 */
export const SEPARATE_OFFERING_SLUG_ACTION = 'IDENTITY_SEPARATE_OFFERING_CREATED';

/**
 * #928: why a create whose slug is already held was not bound to that row, named
 * by the spec rule that refused it, so the audit_logs hold says what to decide.
 */
export function slugTakenReason(
  incoming: { cin?: string | null; segment?: string | null; offeringType?: string | null; openDate?: unknown },
  holder: { cin?: string | null; status?: string | null; segment?: string | null; offeringType?: string | null; openDate?: unknown }
): { rule: string; reason: string } {
  const inCin = normalizeCin(incoming.cin ?? null);
  const rowCin = normalizeCin(holder.cin ?? null);
  if (inCin && rowCin && inCin !== rowCin) {
    return { rule: 'OD-69', reason: `slug_taken: CIN differs (${inCin} vs ${rowCin})` };
  }
  if (holder.status === 'WITHDRAWN') {
    return { rule: 'OD-71', reason: 'slug_taken: the slug holder is WITHDRAWN (a refiling is a new offering)' };
  }
  if (incoming.segment && holder.segment && incoming.segment !== holder.segment) {
    return { rule: 'OD-68', reason: `slug_taken: segment differs (${incoming.segment} vs ${holder.segment})` };
  }
  // Tier A review round 1 (MINOR): a MISSING incoming offering type is
  // unknown, never a guessed 'IPO' — the resolver's own `ofsIdentityConflict`
  // treats an absent type on either side as "no information" and never a
  // conflict (ipo-identity.ts). Defaulting to 'IPO' here disagreed with that
  // and could mint an OD-70 slug for a record whose type was simply not
  // known yet.
  const inType = incoming.offeringType ?? null;
  if (inType && holder.offeringType && inType !== holder.offeringType) {
    return { rule: 'OD-70', reason: `slug_taken: offering type differs (${inType} vs ${holder.offeringType})` };
  }
  const day = (v: unknown): string | null =>
    v == null || v === '' ? null : v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10);
  const a = day(incoming.openDate);
  const b = day(holder.openDate);
  if (a && b && Math.abs(Date.parse(a) - Date.parse(b)) / 86_400_000 > 180) {
    return { rule: 'OD-35', reason: `slug_taken: open date beyond 180 days (${a} vs ${b})` };
  }
  return { rule: 'OD-68', reason: 'slug_taken: identity resolution did not bind the row holding this slug' };
}

/**
 * OD-130 (2026-09-27, `docs/design/data-sourcing-pull-model.md` §0.0.1): a
 * GENUINELY separate offering whose base slug is already taken gets its own
 * slug instead of being held forever. Scoped to the three `slugTakenReason`
 * rules the spec itself states are a NEW ROW, never an ambiguous one:
 *   - OD-69 (CIN differs)        — a different CIN is definitionally another company
 *   - OD-70 (offering type differs) — OD-35's table: "offering type changes … new row"
 *   - OD-71 (WITHDRAWN holder)   — OD-35's lapsed-draft rule: "… create a new row"
 * Deliberately EXCLUDED: the OD-68 catch-all (segment differs, or "identity
 * resolution did not bind" with no more specific reason) and OD-35 (open date
 * beyond 180 days) — §2.3.3.2 calls these AMBIGUOUS and prescribes hold-for-
 * review, not a new row (S2: "a same-name, same-segment live row with a
 * differing known date or band … held for review, not a new row"; the OD-35
 * lapsed-draft rule needs a `sebi_observation_date` field that does not exist
 * yet, so "no row is ever declared lapsed" purely from a date gap).
 */
export const SEPARATE_OFFERING_SLUG_RULES: ReadonlySet<string> = new Set(['OD-69', 'OD-70', 'OD-71']);

/** Minutes IST is ahead of UTC (`ist-timezone.md`: IST is this project's timezone). */
const IST_OFFSET_MINUTES = 5 * 60 + 30;

/**
 * The open year a slug suffix is minted from — the CALENDAR year of the
 * incoming record's own open date (never the existing holder's), read as an
 * INDIAN MARKET DATE (`ist-timezone.md`: "every date the platform publishes
 * is the Indian market date").
 *
 * Tier A review round 1 (MINOR): reading `.getUTCFullYear()` off the raw
 * value is wrong two ways.
 *   - A plain "YYYY-MM-DD" date-only string has no time-of-day to convert —
 *     its year IS the IST calendar year already; running it through `Date`
 *     and a UTC getter is an unnecessary (and here, safe only by accident)
 *     round-trip.
 *   - A genuine INSTANT (a `Date` object, e.g. midnight IST arriving as
 *     `...T18:30:00.000Z` the PREVIOUS UTC day for Jan 1) must be shifted to
 *     IST wall-clock time before its year is read, or a market date opening
 *     on the first of January reads back as December of the prior year.
 */
function openYearOf(value: unknown): number | null {
  if (value == null || value === '') return null;
  if (typeof value === 'string') {
    const m = /^(\d{4})-\d{2}-\d{2}/.exec(value.trim());
    if (m) return Number(m[1]);
  }
  const d = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(d.getTime())) return null;
  const ist = new Date(d.getTime() + IST_OFFSET_MINUTES * 60_000);
  return ist.getUTCFullYear();
}

/**
 * OD-130's two candidates, in order: `<slug>-<open-year>`, then
 * `<slug>-<open-year>-<segment>`. Returns `null` when no open date is known
 * (a draft with no open date cannot derive a year) — the caller then falls
 * back to the existing hold, per the spec's "no real case … until built" and
 * "an unknown [date] means not lapsed, never a guess" posture.
 */
export function deriveSeparateOfferingSlugCandidates(
  baseSlug: string,
  openDate: unknown,
  segment: string | null | undefined
): string[] | null {
  const year = openYearOf(openDate);
  if (!year) return null;
  const candidates = [`${baseSlug}-${year}`];
  if (segment) candidates.push(`${baseSlug}-${year}-${segment.toLowerCase()}`);
  return candidates;
}
import {
  normalizedCompanyNameSql,
  compactNormalizedCompanyNameSql,
  sanitizeDisplayCompanyName,
  normalizeCompanyNameForMatching,
} from '../utils/company-name-normalizer';
import { findMostSimilarName } from '../utils/company-name-similarity';
import { filterPatchUnderHold } from '../services/field-hold';
import { guardWriterIdentifiers } from '../services/admin-identifier-alias';

/** #1376: the identifier columns whose writes take the per-value lock (guardWriterIdentifiers). */
const WRITER_IDENTIFIER_COLUMNS = ['cin', 'isin', 'symbol'] as const;

/**
 * #1376 round 2 (OD-62 / OD-99): an identifier this write dropped because another row of the same
 * offering holds it. A caller that records outcomes (the scraper's B5 step ledger and field walk) passes
 * `onIdentifierRefused`; a log line alone is not a recorded reason.
 */
export type IdentifierRefusal = { fieldName: string; value: string; holder: string };
export type OnIdentifierRefused = (refused: IdentifierRefusal[]) => void;
import { recordListSuggestion, adminListMergeRefusal } from '../services/admin-list-hold';
import {
  checkMergeEligibility,
  assessRelaunch,
  relaunchException,
  buildCarryFieldInputs,
  columnToCamelCase,
  planCarryFields,
  planDescendantTables,
  buildProvenanceMap,
  REPOINT_TABLES,
  CARRY_IF_ABSENT_COLUMNS,
  DISAGREEING_IDENTIFIER_COLUMNS,
  type FkEdge,
  type CarryFieldPatch,
} from '../utils/duplicate-ipo-merge';
import type {
  IPO,
  IPOInsert,
  IPOWithRelations,
  IPOFilters,
  PaginatedResponse,
  IIPORepository,
  FinancialData,
  HistoricalIPO,
  HistoricalIPOQueryParams,
} from './types';

/**
 * The kind of boundary at which the SHORTER of two already-normalized names
 * is a prefix of the LONGER one — 'exact' (equal strings), 'punctuation'
 * (the longer string's next character is punctuation: hyphen, comma,
 * parenthesis, dot, ...), 'whitespace' (the next character is a plain
 * space), or `null` (no prefix relationship at all, including a mid-word
 * split like "ray" vs "rays").
 *
 * T-403 Tier-A review (item 2): a punctuation boundary is a STRONG signal
 * that one source appended a whole descriptive suffix to the SAME company
 * ("Rays of Belief Limited" -> "Rays of Belief Limited- For Profit Social
 * Enterprise"). A whitespace boundary is a WEAK signal — "Rays of Belief
 * Limited Holdings" reads as a genuinely DIFFERENT legal entity, not a
 * disagreement about the same company's full name — so callers MUST require
 * stronger corroboration (both open_date AND price_range_min, not either)
 * before treating a whitespace-boundary candidate as a match. See
 * `resolveIpoRow` in `ipo-identity.ts` for where that corroboration rule is
 * applied; this function only classifies the boundary, it never decides.
 */
export type PrefixBoundaryKind = 'exact' | 'punctuation' | 'whitespace' | null;

export function classifyPrefixBoundary(normalizedA: string, normalizedB: string): PrefixBoundaryKind {
  if (!normalizedA || !normalizedB) {
    return null;
  }
  if (normalizedA === normalizedB) {
    return 'exact';
  }

  const [shorter, longer] =
    normalizedA.length < normalizedB.length ? [normalizedA, normalizedB] : [normalizedB, normalizedA];

  if (!longer.startsWith(shorter)) {
    return null;
  }

  const boundaryChar = longer.charAt(shorter.length);
  if (/[^a-z0-9 ]/i.test(boundaryChar)) {
    return 'punctuation';
  }
  if (boundaryChar === ' ') {
    return 'whitespace';
  }
  return null;
}

/**
 * True when the SHORTER of two already-normalized names is a prefix of the
 * LONGER one at an 'exact' or 'punctuation' boundary (see
 * `classifyPrefixBoundary`) — the STRICT, single-corroborating-key-eligible
 * signal. A 'whitespace' boundary ("rays of belief" vs "rays of belief
 * limited holdings") is deliberately NOT included here (T-403 item 2) —
 * whitespace-separated extensions are a weaker signal that a caller may
 * still consider, but only under the stronger both-keys corroboration rule,
 * via `classifyPrefixBoundary` directly (see `findByNormalizedNamePrefix`
 * and `resolveIpoRow`).
 */
export function isWordBoundaryPrefixMatch(normalizedA: string, normalizedB: string): boolean {
  const kind = classifyPrefixBoundary(normalizedA, normalizedB);
  return kind === 'exact' || kind === 'punctuation';
}

/** The merge plan `mergeDuplicateInto` computes and, when `apply` is true, executes. */
/** What the caller already knows about the record, so same-name rows it separates are not "ambiguous" (#1235). */
export interface NormalizedNameNarrowing {
  segment?: 'MAINBOARD' | 'SME' | null;
  offeringType?: string | null;
  /** The row an ISIN / symbol / alias tier already bound; a stronger signal than the name. */
  keyBoundId?: string | null;
}

/** Bounded fetch for the same-name set: enough to narrow, never an unbounded scan. */
const NORMALIZED_NAME_FETCH_LIMIT = 10;

export interface MergeDuplicatePlan {
  keep: IPO;
  drop: IPO;
  patch: CarryFieldPatch[];
  toDelete: { table: string; col: string; count: number }[];
  toRepoint: { table: string; col: string; count: number }[];
  descendantTableCount: number;
  directTableCount: number;
}

export interface MergeDuplicateResult extends MergeDuplicatePlan {
  applied: boolean;
  keepSlug: string;
  droppedSlug: string;
  provenanceWritten: { fieldName: string; source: string; previousSource: string | null }[];
  /** What the apply transaction actually did per child table, from RETURNING (empty on a dry run). */
  childOutcome: MergeChildOutcome[];
  /** #1298: the §2.9 relaunch invalidation this merge ran (an OD-86 relaunch merge of a POSTPONED IPO); the caller sends the OD-120 alert. */
  relaunchCleared?: import('../services/relaunch-admin-clear').RelaunchClearSummary | null;
}

/** One child table's outcome inside a merge, taken from the rows the statements RETURNED. */
export interface MergeChildOutcome {
  table: string;
  col: string;
  kind: 'repoint' | 'delete';
  /** Ids of person-created rows moved onto the survivor. */
  repointedIds: string[];
  /** Person-created rows removed because the survivor already held their twin under a unique key. */
  deletedOnConflictCount: number;
  /** Those rows whole, as to_jsonb text. */
  deletedOnConflictRows: string[];
  /** Scraper-derived rows deleted (count only). */
  deletedCount: number;
}

/** What `unmergeDuplicate` did (or, on a dry run, would do). */
export interface UnmergeResult {
  mergeId: string;
  keepId: string;
  dropId: string;
  keepSlug: string;
  dropSlug: string;
  keepStatus: string;
  dropStatus: string;
  /** True for a pre-OD-92 entry restored with --partial. */
  partial: boolean;
  /** What the log cannot restore (empty for an OD-92 entry). */
  missing: string[];
  /** Survivor columns changed after the merge (non-empty only when every one was forced). */
  drift: string[];
  restoredRows: { table: string; count: number }[];
  repointedBack: { table: string; count: number; logged: number }[];
  applied: boolean;
}

/** §9.2 item 26: the row remembers `value` as a replaced identifier of this kind. */
function identifierAliasMatch(kind: 'CIN' | 'ISIN' | 'SYMBOL', value: string) {
  return sql`${ipos.id} IN (SELECT a.ipo_id FROM ${ipoIdentifierAliases} a WHERE a.kind = ${kind} AND a.value = ${value})`;
}

/**
 * #1233 round 2: work that must commit or roll back WITH an `ipos` write (the plan rebuild after a
 * board or exchange change, section 2.8). Runs inside the write transaction, after the update, under
 * the row lock `filterPatchUnderHold` takes; `before` is the type slice read under that lock.
 * A throw rolls the write back.
 */
export type IposWriteTxHook = (
  tx: unknown,
  before: { segment: string | null; listingExchanges: string[] | null; offeringType: string | null }
) => Promise<void>;

export class IPORepository extends BaseRepository implements IIPORepository {
  constructor(db: NodePgDatabase<typeof schema>, redis: Redis) {
    super(db, redis);
  }

  /**
   * Find all IPOs with optional filters and pagination
   */
  async findAll(filters: IPOFilters = {}): Promise<PaginatedResponse<IPO>> {
    const {
      status,
      segment,
      offeringType,
      sector,
      search,
      minIssueSize,
      maxIssueSize,
      openDateFrom,
      openDateTo,
      closeDateFrom,
      closeDateTo,
      listingDateFrom,
      listingDateTo,
      page = 1,
      limit = 20,
      sortBy = 'createdAt',
      sortOrder = 'desc',
    } = filters;

    const cacheKey = getIPOListKey(filters);

    return this.getFromCache(
      cacheKey,
      async () => {
        try {
          // Build where conditions
          const conditions = [];

          if (status) {
            if (Array.isArray(status)) {
              conditions.push(inArray(ipos.status, status as (typeof ipoStatusEnum.enumValues)[number][]));
            } else {
              conditions.push(eq(ipos.status, status as (typeof ipoStatusEnum.enumValues)[number]));
            }
          }

          if (segment) {
            if (Array.isArray(segment)) {
              conditions.push(inArray(ipos.segment, segment as (typeof segmentEnum.enumValues)[number][]));
            } else {
              conditions.push(eq(ipos.segment, segment as (typeof segmentEnum.enumValues)[number]));
            }
          }

          if (offeringType) {
            if (Array.isArray(offeringType)) {
              conditions.push(inArray(ipos.offeringType, offeringType as (typeof offeringTypeEnum.enumValues)[number][]));
            } else {
              conditions.push(eq(ipos.offeringType, offeringType as (typeof offeringTypeEnum.enumValues)[number]));
            }
          }

          if (sector) {
            conditions.push(eq(ipos.sector, sector));
          }

          if (search) {
            // Search by company name OR sector (case-insensitive, partial match)
            conditions.push(
              sql`(${ipos.companyName} ILIKE ${`%${search}%`} OR ${ipos.sector} ILIKE ${`%${search}%`})`
            );
          }

          if (minIssueSize) {
            conditions.push(gte(ipos.issueSize, minIssueSize.toString()));
          }

          if (maxIssueSize) {
            conditions.push(lte(ipos.issueSize, maxIssueSize.toString()));
          }

          if (openDateFrom) {
            conditions.push(gte(ipos.openDate, openDateFrom.toISOString()));
          }

          if (openDateTo) {
            conditions.push(lte(ipos.openDate, openDateTo.toISOString()));
          }

          if (closeDateFrom) {
            conditions.push(gte(ipos.closeDate, closeDateFrom.toISOString()));
          }

          if (closeDateTo) {
            conditions.push(lte(ipos.closeDate, closeDateTo.toISOString()));
          }

          if (listingDateFrom) {
            conditions.push(gte(ipos.listingDate, listingDateFrom.toISOString()));
          }

          if (listingDateTo) {
            conditions.push(lte(ipos.listingDate, listingDateTo.toISOString()));
          }

          const whereClause =
            conditions.length > 0 ? and(...conditions) : undefined;

          // Get total count
          const [{ count }] = await this.db
            .select({ count: sql<number>`count(*)::int` })
            .from(ipos)
            .where(whereClause);

          // Get paginated data
          const offset = (page - 1) * limit;
          const sortColumn = ipos[sortBy] || ipos.createdAt;
          const orderBy = sortOrder === 'asc' ? asc(sortColumn) : desc(sortColumn);

          const data = await this.db
            .select()
            .from(ipos)
            .where(whereClause)
            .orderBy(orderBy)
            .limit(limit)
            .offset(offset);

          const totalPages = Math.ceil(count / limit);

          return {
            data,
            meta: {
              total: count,
              page,
              limit,
              totalPages,
              hasNext: page < totalPages,
              hasPrev: page > 1,
            },
          };
        } catch (error) {
          throw new DatabaseError('Failed to fetch IPO list', undefined, error);
        }
      },
      CacheTTL.IPO_LIST
    );
  }

  /**
   * Find IPO by slug with all relations
   */
  async findBySlug(slug: string): Promise<IPOWithRelations | null> {
    const cacheKey = getIPOBySlugKey(slug);

    return this.getFromCache(
      cacheKey,
      async () => {
        try {
          const [ipo] = await this.db
            .select()
            .from(ipos)
            .where(eq(ipos.slug, slug))
            .limit(1);

          if (!ipo) {
            return null;
          }

          // Fetch related data
          const [
            financials,
            docs,
            subs,
            gmps,
            listing,
            peers,
            registrarData,
          ] = await Promise.all([
            this.db
              .select()
              .from(financialData)
              .where(eq(financialData.ipoId, ipo.id))
              .limit(1)
              .then((r) => r[0] || null),
            this.db
              .select()
              .from(documents)
              .where(eq(documents.ipoId, ipo.id)),
            this.db
              .select()
              .from(subscriptions)
              .where(eq(subscriptions.ipoId, ipo.id))
              .orderBy(desc(subscriptions.timestamp))
              .limit(10),
            this.db
              .select()
              .from(gmpRecords)
              .where(eq(gmpRecords.ipoId, ipo.id))
              .orderBy(desc(gmpRecords.timestamp))
              .limit(10),
            this.db
              .select()
              .from(listingPerformance)
              .where(eq(listingPerformance.ipoId, ipo.id))
              .limit(1)
              .then((r) => r[0] || null),
            this.db
              .select()
              .from(peerCompanies)
              .where(eq(peerCompanies.ipoId, ipo.id)),
            ipo.registrarId
              ? this.db
                  .select()
                  .from(registrars)
                  .where(eq(registrars.id, ipo.registrarId))
                  .limit(1)
                  .then((r) => r[0] || null)
              : Promise.resolve(null),
          ]);

          return {
            ...ipo,
            financialData: financials,
            documents: docs,
            subscriptions: subs,
            gmpRecords: gmps,
            listingPerformance: listing,
            peerCompanies: peers,
            registrarRelation: registrarData,
          };
        } catch (error) {
          throw new DatabaseError(
            `Failed to fetch IPO by slug: ${slug}`,
            undefined,
            error
          );
        }
      },
      CacheTTL.IPO_DETAIL,
      // W-15: identity lookup — never cache a miss. A slug miss followed
      // moments later by an insert of that exact IPO would otherwise stay
      // shadowed behind the cached `null` for the full 900s TTL, and a
      // caller relying on "not found -> safe to create" duplicates the row.
      { cacheNullResult: false }
    );
  }

  /**
   * Find IPO by normalized company name (Phase 11 Step 2)
   * Used for fuzzy matching to prevent duplicate IPOs
   *
   * Normalizes company name by removing legal entity suffixes (Ltd, Limited, IPO, etc.)
   * and matches against existing IPO company names using the same normalization
   *
   * @param normalizedName - Normalized company name (lowercase, stripped of suffixes)
   * @returns Basic IPO record or null if not found
   *
   * @example
   * // "Midwest Ltd" and "Midwest Limited" both normalize to "midwest"
   * const ipo = await repository.findByNormalizedName('midwest');
   */
  async findByNormalizedName(
    normalizedName: string,
    offeringType?: string,
    narrowing?: NormalizedNameNarrowing
  ): Promise<IPO | null> {
    if (!normalizedName) {
      return null;
    }

    try {
      // Normalize company_name at query time via the SHARED normalizer so the
      // SQL path stays in lock-step with the JS path (company-name-normalizer.ts).
      // The OR clause is a word-break FALLBACK (P2-1 checker finding, T-277F):
      // a hyphenated compound ("Atharva Poly-Plast") and its run-together
      // sibling ("Atharva Polyplast") land on different spaced keys but the
      // same compact (whitespace-stripped) key — compare compact keys too so
      // this class of pair matches. Exact match is a subset of compact match,
      // so this can only ADD matches, never drop one the exact path already found.
      const nameCondition = sql`${normalizedCompanyNameSql(sql`${ipos.companyName}`)} = ${normalizedName}
              OR ${compactNormalizedCompanyNameSql(sql`${ipos.companyName}`)} = ${normalizedName.replace(/\s+/g, '')}`;
      // T-478 round 3 (issue #225 follow-up, item 2): when a caller filters
      // by offering_type (the identity guard's "decline, then re-query for
      // the matching type" retry), more than one row can share a name AND
      // that type — an explicit ORDER BY makes the pick deterministic
      // instead of relying on Postgres's unspecified row order under LIMIT 1.
      //
      // Tier A review round 1 (MAJOR-2): "deterministic" is not "correct".
      // OD-130 is the first path that can legitimately leave TWO rows with
      // the same name live (`<slug>` and `<slug>-<open-year>`), so LIMIT 1
      // — deterministic or not — can bind a caller to the WRONG one of two
      // real, distinct offerings and silently write one company's data onto
      // the other's row. Fetch up to 2 with the SAME deterministic ORDER BY
      // on every path (not only the offeringType-filtered one) and HOLD
      // instead of picking when more than one comes back.
      const query = offeringType
        ? this.db.select().from(ipos).where(sql`(${nameCondition}) AND ${ipos.offeringType} = ${offeringType}`).orderBy(ipos.id)
        : this.db.select().from(ipos).where(nameCondition).orderBy(ipos.id);
      // #1235: fetch every same-name row (bounded), then narrow BEFORE deciding to hold. Two rows
      // that share a name are only ambiguous when nothing the caller already knows separates them.
      const rawMatches = await query.limit(NORMALIZED_NAME_FETCH_LIMIT);
      let matches = rawMatches;

      if (rawMatches.length > 1 && narrowing) {
        // An ISIN / symbol / alias bind (OD-34 / OD-89: key before name) that is one of the same-name
        // rows IS the answer: the name gives no competing signal, so the caller keeps the key row.
        // A key row OUTSIDE the same-name set proves nothing about which of the pair this record is,
        // and returning null here would let the slug tier bind one row of the pair and the resolver's
        // key-vs-name branch then prefers that name row over the key row. So we fail closed: the
        // pair is HELD exactly as it was before #1235 (no narrowing by segment/type either, because
        // the record is already bound to a third row by a stronger signal).
        if (narrowing.keyBoundId) {
          const keyRow = rawMatches.find((m: IPO) => m.id === narrowing.keyBoundId);
          if (keyRow) return keyRow;
        } else {
          const narrowed = rawMatches.filter(
            (m: IPO) => !segmentsConflict(narrowing.segment, m.segment) && !ofsIdentityConflict(narrowing.offeringType, m.offeringType)
          );
          // Every row separated from the record: return the first so the resolver declines it with
          // its own segment / OFS log lines (identical outcome to a single conflicting row).
          matches = narrowed.length === 0 ? rawMatches.slice(0, 1) : narrowed;
        }
      }

      if (matches.length > 1) {
        const candidates = matches.map((m: IPO) => ({
          id: m.id, slug: m.slug, companyName: m.companyName, openDate: m.openDate, priceRangeMin: m.priceRangeMin, status: m.status,
        }));
        logger.warn(
          { normalizedName, offeringType, candidateIds: candidates.map((c) => c.id), candidateSlugs: candidates.map((c) => c.slug) },
          '[OD-130 MAJOR-2] more than one row matches this normalized name - HELD, never binding to one at random'
        );
        const incoming = { companyName: normalizedName, slug: normalizedName, openDate: null, priceRangeMin: null };
        await this.recordIdentityHold(incoming, normalizedName, candidates, {
          rule: 'OD-130-MAJOR-2',
          reason: `ambiguous_normalized_name_match: "${normalizedName}" matches ${matches.length} rows (${candidates.map((c) => c.slug).join(', ')})`,
        });
        throw new IdentityHeldForReviewError(
          `IPORepository.findByNormalizedName: "${normalizedName}" matches ${matches.length} rows (${candidates.map((c) => c.slug).join(', ')}) - held, never bound to one at random`,
          incoming,
          candidates
        );
      }

      return matches[0] || null;
    } catch (error) {
      if (error instanceof IdentityHeldForReviewError) throw error;
      throw new DatabaseError(
        `Failed to fetch IPO by normalized name: ${normalizedName}`,
        undefined,
        error
      );
    }
  }

  /**
   * Find IPO by exchange ticker symbol (T-318, IDENT: NULL-safe key-first
   * identity). `symbol` is a plain (non-unique-in-DB-for-NULLs) column shared
   * by NSE and BSE listings — this is deliberately the NSE/BSE `symbol`
   * column ONLY, never `bseScripCode` (a separate keyspace per T-314C/T-316C
   * findings: BSE's numeric scrip code and NSE's ticker symbol must never be
   * cross-compared).
   *
   * NULL-safe by construction: an empty/whitespace-only input returns null
   * without querying, so this can never resolve a "NULL matches NULL" false
   * positive — Postgres would otherwise happily return multiple rows for
   * `symbol IS NULL`, and matching any of them would be wrong.
   *
   * @param symbol - Raw (un-normalized) ticker symbol. Normalized here via
   *   trim + uppercase before comparison (source scrapers vary in case).
   */
  /**
   * Item 12 slice D: every LIVE row whose open_date is the given calendar day.
   *
   * Used ONLY by the observe-only duplicate-candidate scan in `ipo-identity.ts`.
   * It is deliberately date-FILTERED rather than "fetch all live rows": a
   * same-day query returns a handful of rows, where a full live scan would cost
   * an O(n) fold on EVERY identity resolution — and identity resolution runs on
   * every scraped record.
   *
   * LIVE means the four statuses a duplicate can still do damage in. A LISTED
   * row pair is a historical artefact for a repair tool; an UPCOMING/OPEN pair
   * is two rows a scraper is actively writing to.
   *
   * Returns `[]` for an absent date rather than querying — same NULL-is-never-a-
   * key discipline as `findBySymbol`/`findByIsin` above.
   */
  async findLiveByOpenDate(openDate: string | Date | null | undefined): Promise<IPO[]> {
    if (openDate == null) {
      return [];
    }
    const day =
      openDate instanceof Date
        ? Number.isNaN(openDate.getTime())
          ? null
          : openDate.toISOString().slice(0, 10)
        : String(openDate).slice(0, 10);
    if (!day) {
      return [];
    }

    try {
      return await this.db
        .select()
        .from(ipos)
        .where(
          sql`${ipos.openDate} IS NOT NULL AND ${ipos.openDate}::date = ${day}::date AND ${ipos.status} IN ('UPCOMING', 'OPEN', 'CLOSED', 'LISTED')`
        )
        .orderBy(ipos.id);
    } catch (error) {
      throw new DatabaseError(
        `Failed to fetch live IPOs by open date: ${day}`,
        undefined,
        error as Error
      );
    }
  }

  /**
   * §9.2 item 26 (Tier A review MINOR-2): EVERY row carrying the symbol live or as a kept alias,
   * live holders first, then by id. `resolveIpoRow` walks the whole list, so a refused first
   * candidate never hides a valid second one.
   */
  async findAllBySymbol(symbol: string | null | undefined): Promise<IPO[]> {
    return this.findAllByIdentifier('SYMBOL', symbol);
  }

  /** §9.2 item 26: every row carrying the ISIN live or as a kept alias, live first (see findAllBySymbol). */
  async findAllByIsin(isin: string | null | undefined): Promise<IPO[]> {
    return this.findAllByIdentifier('ISIN', isin);
  }

  private async findAllByIdentifier(kind: 'SYMBOL' | 'ISIN', value: string | null | undefined): Promise<IPO[]> {
    const normalized = value?.trim().toUpperCase();
    if (!normalized) return [];
    const column = kind === 'SYMBOL' ? ipos.symbol : ipos.isin;
    try {
      const live = sql`upper(trim(${column})) = ${normalized}`;
      return await this.db
        .select()
        .from(ipos)
        .where(sql`(${live} OR ${identifierAliasMatch(kind, normalized)})`)
        .orderBy(sql`(${live}) DESC`, ipos.id);
    } catch (error) {
      throw new DatabaseError(`Failed to fetch IPOs by ${kind}: ${value}`, undefined, error as Error);
    }
  }

  async findBySymbol(symbol: string | null | undefined, offeringType?: string): Promise<IPO | null> {
    const normalized = symbol?.trim().toUpperCase();
    if (!normalized) {
      return null;
    }

    try {
      // T-478 round 3 (item 2): see findByNormalizedName's doc comment —
      // same offering_type-filtered retry + deterministic ORDER BY.
      // §9.2 item 26: an admin-replaced symbol is kept as an alias and still matches; a row
      // carrying the symbol live is preferred over one that only remembers it. The caller
      // (resolveIpoRow) re-checks an alias match against OD-35, since symbols are reused.
      const live = sql`upper(trim(${ipos.symbol})) = ${normalized}`;
      const matches = sql`(${live} OR ${identifierAliasMatch('SYMBOL', normalized)})`;
      const query = offeringType
        ? this.db.select().from(ipos).where(sql`${matches} AND ${ipos.offeringType} = ${offeringType}`)
        : this.db.select().from(ipos).where(matches);
      const [ipo] = await query.orderBy(sql`(${live}) DESC`, ipos.id).limit(1);

      return ipo || null;
    } catch (error) {
      throw new DatabaseError(
        `Failed to fetch IPO by symbol: ${symbol}`,
        undefined,
        error
      );
    }
  }

  /**
   * Find IPO by ISIN (International Securities Identification Number)
   * (T-318, IDENT: NULL-safe key-first identity). ISIN is the highest-
   * confidence natural key available — a 12-character code unique to the
   * security — and per T-314C's reproduction, 0 duplicate ISIN groups exist
   * in production across all rows that have one.
   *
   * NULL-safe by construction: an empty/whitespace-only input returns null
   * without querying, matching `findBySymbol`'s guarantee that NULL never
   * matches NULL.
   *
   * @param isin - Raw (un-normalized) ISIN. Normalized here via trim +
   *   uppercase before comparison.
   */
  async findByIsin(isin: string | null | undefined, offeringType?: string): Promise<IPO | null> {
    const normalized = isin?.trim().toUpperCase();
    if (!normalized) {
      return null;
    }

    try {
      // T-478 round 3 (item 2): same offering_type-filtered retry pattern.
      // §9.2 item 26: an admin-replaced ISIN is kept as an alias and still matches (live first).
      const live = sql`upper(trim(${ipos.isin})) = ${normalized}`;
      const matches = sql`(${live} OR ${identifierAliasMatch('ISIN', normalized)})`;
      const query = offeringType
        ? this.db.select().from(ipos).where(sql`${matches} AND ${ipos.offeringType} = ${offeringType}`)
        : this.db.select().from(ipos).where(matches);
      const [ipo] = await query.orderBy(sql`(${live}) DESC`, ipos.id).limit(1);

      return ipo || null;
    } catch (error) {
      throw new DatabaseError(
        `Failed to fetch IPO by ISIN: ${isin}`,
        undefined,
        error
      );
    }
  }

  /**
   * Every row carrying this CIN (OD-34 step 1, §2.3.3.2). A list, not one row:
   * a CIN names the COMPANY, so its IPO, a later OFS or rights issue, and a
   * refiled offering all share it — `resolveIpoRow` decides which one is the
   * incoming offering. NULL-safe like `findByIsin`: an absent input returns []
   * without querying, so NULL never matches NULL.
   */
  /**
   * OD-85 write rule for a record that BOUND to an existing row: its keys are written in one
   * transaction (a key already on another row, or a concurrent writer, rolls the whole set back).
   */
  async bindSourceKeys(
    ipoId: string,
    refs: SourceKeyRef[] | null | undefined,
    opts: {
      boundVia: SourceKeyBoundVia;
      boundBy: string;
      /**
       * OD-83 + OD-120: runs in the SAME transaction when the bind superseded an older key (a relaunch),
       * so the relaunch's admin-value clear commits or rolls back with the key change.
       */
      onSupersede?: (tx: { execute: (q: any) => Promise<any> }, ipoId: string, supersededIds: string[]) => Promise<unknown>;
    }
  ): Promise<Awaited<ReturnType<typeof recordSourceKeys>> | null> {
    const keys = normalizeSourceKeyRefs(refs ?? []);
    if (keys.length === 0) return null;
    const { onSupersede, ...recordOpts } = opts;
    const res = await this.db.transaction(async (tx) => {
      const out = await recordSourceKeys(tx, ipoId, keys, recordOpts);
      if (onSupersede && out.supersededIds.length > 0) await onSupersede(tx as never, ipoId, out.supersededIds);
      return out;
    });
    noteSourceKeyBind(ipoId, [...res.insertedIds, ...res.keptIds]);
    return res;
  }

  /** OD-85: the handle `resolveIpoRow` reads `ipo_source_keys` through. */
  sourceKeyDb(): NodePgDatabase<typeof schema> {
    return this.db;
  }

  /**
   * §9.2 item 15 (OD-111): was this row created by hand by an admin? Read from the creation's own
   * audit row (`IPO_CREATED_BY_ADMIN`), which `createIpoByAdmin` writes in the create transaction.
   * `resolveIpoRow` asks only after a NAME tier picked the row, never on an identifier bind.
   */
  async isAdminCreated(ipoId: string): Promise<boolean> {
    const rows = await this.db
      .select({ id: auditLogs.id })
      .from(auditLogs)
      .where(sql`${auditLogs.ipoId} = ${ipoId} AND ${auditLogs.actionType} = ${IPO_CREATED_BY_ADMIN_ACTION}`)
      .limit(1);
    return rows.length > 0;
  }

  /**
   * OD-111 / OD-68: a record that reached an admin-created row on its NAME alone is held for review,
   * never bound: the admin gave that row an identifier, and a record that does not carry it is not
   * proven to be the same offering. Records the hold (IDENTITY_HELD_FOR_REVIEW, rule OD-111, read by
   * the nightly `i_identity_held` check) and throws.
   */
  async holdNameOnlyBindToAdminRow(
    incoming: { companyName: string; slug: string; openDate: unknown; priceRangeMin: unknown },
    row: { id: string; slug: string; companyName: string; openDate: unknown; priceRangeMin: unknown; status: unknown },
    origin?: 'admin-create'
  ): Promise<never> {
    const day = incoming.openDate == null ? null : String(incoming.openDate instanceof Date ? incoming.openDate.toISOString() : incoming.openDate).slice(0, 10);
    const view = { companyName: incoming.companyName, slug: incoming.slug, openDate: day, priceRangeMin: incoming.priceRangeMin };
    const reason = `name-only match to admin-created row ${row.slug}: the record carries none of that row's identifiers (OD-111)`;
    logger.warn({ incoming: view, ipoId: row.id, slug: row.slug }, '[OD-111] name-only match to an admin-created row - held for review, not bound');
    await this.recordIdentityHold(view, incoming.companyName, [row], { rule: 'OD-111', reason, origin });
    throw new IdentityHeldForReviewError(
      `resolveIpoRow: "${incoming.companyName}" held for review (OD-111) - ${reason}; nothing written`,
      view,
      [row]
    );
  }

  async findByCin(cin: string | null | undefined): Promise<IPO[]> {
    const normalized = normalizeCin(cin);
    if (!normalized) {
      return [];
    }
    try {
      return await this.db
        .select()
        .from(ipos)
        // §9.2 item 26: a row whose CIN an admin replaced still carries the old one as an alias;
        // resolveByCin applies the same OD-35 eligibility to it as to a live CIN.
        .where(sql`(upper(trim(${ipos.cin})) = ${normalized} OR ${identifierAliasMatch('CIN', normalized)})`)
        .orderBy(ipos.id);
    } catch (error) {
      throw new DatabaseError(`Failed to fetch IPOs by CIN: ${cin}`, undefined, error as Error);
    }
  }

  /**
   * Find an existing IPO whose normalized company name is a close SPELLING
   * variant of `normalizedName` (P2-2a, T-293) — a typo like "Hybird" vs
   * "Hybrid" that `findByNormalizedName`'s exact + compact-whitespace tiers
   * cannot catch (the letters genuinely differ, not just punctuation/
   * whitespace). Deliberately the LAST-resort check on the CREATE path: it is
   * a real network+CPU cost (scans existing company names), so callers MUST
   * only reach it after the exact-match tiers have already returned null.
   *
   * Root cause this closes (round-4 review, T-293): "Dhanwel Hybird Seeds
   * Limited" and "Dhanwel Hybrid Seeds Ltd." minted two live prod rows
   * because NOTHING on the production insert path (`upsertIPO`) ever ran a
   * similarity check — `DuplicateDetectionService`'s 0.85-threshold fuzzy
   * check exists but `PipelineFactory.createProductionPipeline` sets
   * `skipDuplicateDetection: true` (see `data-validation-pipeline.ts`), so it
   * never actually executes on a live scrape.
   *
   * @param normalizedName - Normalized company name of the CANDIDATE (not yet
   *   in the DB) to check against existing rows.
   * @param threshold - Minimum Levenshtein similarity (0-1) to count as a match.
   */
  async findByFuzzyName(normalizedName: string, threshold = 0.85): Promise<IPO | null> {
    if (!normalizedName) {
      return null;
    }

    try {
      // Cheap pre-filter: only rows sharing the candidate's first word are
      // plausible typo variants — this keeps the scan bounded without a
      // full-table fetch, same spirit as IPODeduplicationService's tiering.
      // Known limitation: a typo IN the first word itself ("Dhanwel" ->
      // "Dhanwle") would not be pre-filtered in; the real prod pair this
      // closes (T-293) has its typo in the SECOND word ("Hybird"/"Hybrid").
      const firstWord = normalizedName.split(' ')[0];
      if (!firstWord || firstWord.length < 3) {
        return null;
      }

      const candidates = await this.db
        .select()
        .from(ipos)
        .where(sql`${normalizedCompanyNameSql(sql`${ipos.companyName}`)} LIKE ${firstWord + '%'}`)
        .limit(200);

      if (candidates.length === 0) {
        return null;
      }

      const byNormalizedName = new Map<string, IPO>();
      for (const candidate of candidates) {
        byNormalizedName.set(normalizeCompanyNameForMatching(candidate.companyName), candidate);
      }

      const match = findMostSimilarName(normalizedName, [...byNormalizedName.keys()], threshold);
      return match ? (byNormalizedName.get(match) ?? null) : null;
    } catch (error) {
      throw new DatabaseError(
        `Failed to fetch IPO by fuzzy name: ${normalizedName}`,
        undefined,
        error
      );
    }
  }

  /**
   * Find existing rows whose normalized company name is a WORD-BOUNDARY
   * PREFIX of `normalizedName`, or vice versa (W-108, tier 3b of
   * `resolveIpoRow`). Catches the case a spelling-typo fuzzy check
   * (`findByFuzzyName`) cannot: two sources genuinely disagree on the FULL
   * name — one appends a whole descriptive suffix the other omits
   * ("Rays of Belief Limited" vs "Rays of Belief Limited- For Profit Social
   * Enterprise") — not a few mis-typed letters.
   *
   * Deliberately NOT a match by itself: this is a candidate-narrowing read
   * only. The caller (`resolveIpoRow`) is responsible for requiring a
   * corroborating key (open_date / price_range_min) before treating any
   * returned row as a match, and for declining to match when more than one
   * candidate corroborates — a bare prefix relationship between two
   * genuinely different companies ("Rays of Belief Limited" vs "Rays of
   * Hope Limited" both start with "Rays of") MUST NOT resolve on name alone.
   *
   * Uncached (identity read, same reasoning as `findByFuzzyName`) and capped
   * at 5 rows — a prefix hint, not a full-table scan.
   *
   * @param normalizedName - normalizeCompanyNameForMatching() output for the
   *   INCOMING row being resolved.
   */
  async findByNormalizedNamePrefix(normalizedName: string): Promise<IPO[]> {
    if (!normalizedName) {
      return [];
    }

    try {
      // Same cheap pre-filter as findByFuzzyName: only rows sharing the
      // candidate's first word can possibly be in a prefix relationship
      // with it (in either direction), so this keeps the scan bounded.
      const firstWord = normalizedName.split(' ')[0];
      if (!firstWord || firstWord.length < 3) {
        return [];
      }

      // T-403 Tier-A review (item 5): fetch one row past the intended 200-row
      // cap so an overflow is DETECTABLE rather than silently truncated — a
      // silent truncation can turn "two candidates, decline (ambiguous)"
      // into "one candidate, accept" purely because the second candidate
      // fell off the end of an un-ordered LIMIT. On overflow, decline rather
      // than guess which 200 of 201+ rows to keep.
      const candidates = await this.db
        .select()
        .from(ipos)
        .where(sql`${normalizedCompanyNameSql(sql`${ipos.companyName}`)} LIKE ${firstWord + '%'}`)
        .limit(201);

      if (candidates.length > 200) {
        logger.warn(
          { normalizedName, candidateCount: candidates.length },
          '[W-108] prefix pre-filter overflow, declining'
        );
        return [];
      }

      // Broader-than-`isWordBoundaryPrefixMatch` net on purpose: this
      // candidate-narrowing read includes BOTH punctuation- and
      // whitespace-boundary prefix relationships (see `classifyPrefixBoundary`)
      // — the caller (`resolveIpoRow`) decides how much corroboration each
      // boundary kind needs before treating a candidate as a match. This
      // function stays a hint, never a match decision.
      const prefixMatches: IPO[] = [];
      for (const candidate of candidates) {
        const candidateNormalized = normalizeCompanyNameForMatching(candidate.companyName);
        if (classifyPrefixBoundary(candidateNormalized, normalizedName) !== null) {
          prefixMatches.push(candidate);
          if (prefixMatches.length > 5) {
            // T-403 Tier-A review (item 5): a 6th corroborating candidate
            // means the pre-filter is too coarse to trust a 5-row truncation
            // — decline rather than silently hand the caller an arbitrary
            // first-5 subset.
            logger.warn(
              { normalizedName, candidateCount: prefixMatches.length },
              '[W-108] prefix candidate cap overflow (6th match found), declining'
            );
            return [];
          }
        }
      }

      return prefixMatches;
    } catch (error) {
      throw new DatabaseError(
        `Failed to fetch IPO by normalized name prefix: ${normalizedName}`,
        undefined,
        error
      );
    }
  }

  /**
   * Find IPO by ID with cache-aside pattern
   */
  async findById(id: string): Promise<IPO | null> {
    const cacheKey = getIPOByIdKey(id);

    return this.getFromCache(
      cacheKey,
      async () => {
        try {
          const [ipo] = await this.db
            .select()
            .from(ipos)
            .where(eq(ipos.id, id))
            .limit(1);

          return ipo || null;
        } catch (error) {
          throw new DatabaseError(
            `Failed to fetch IPO by ID: ${id}`,
            undefined,
            error
          );
        }
      },
      CacheTTL.IPO_DETAIL,
      // W-15 sibling: same identity-lookup negative-cache hazard as findBySlug.
      { cacheNullResult: false }
    );
  }

  /**
   * Round-4 M-LOW: uncached read of a single row by id, for callers that MUST
   * NOT trust the `IPO_DETAIL` (900s) cache — e.g. the scraper write-diff gate
   * (`diffFieldsForWrite` in `scraper/src/services/data-persister.ts`), which
   * decides whether to write by comparing against the ROW, not a snapshot up
   * to 15 minutes stale. Bypasses `getFromCache` entirely: no read, no write,
   * so it can never populate or extend the cache's staleness window.
   */
  async findByIdUncached(id: string): Promise<IPO | null> {
    try {
      const [ipo] = await this.db
        .select()
        .from(ipos)
        .where(eq(ipos.id, id))
        .limit(1);

      return ipo || null;
    } catch (error) {
      throw new DatabaseError(
        `Failed to fetch IPO by ID (uncached): ${id}`,
        undefined,
        error
      );
    }
  }

  /**
   * Find IPOs by date range (for GMP matching)
   * Used to match external GMP data to database IPOs by dates
   */
  async findByDates(params: {
    openDate: string;
    closeDate?: string;
  }): Promise<IPO[]> {
    try {
      const conditions = [eq(ipos.openDate, params.openDate)];

      if (params.closeDate) {
        conditions.push(eq(ipos.closeDate, params.closeDate));
      }

      const whereClause = and(...conditions);

      const results = await this.db
        .select()
        .from(ipos)
        .where(whereClause);

      return results;
    } catch (error) {
      throw new DatabaseError(
        `Failed to find IPOs by dates: ${params.openDate}`,
        undefined,
        error
      );
    }
  }

  /**
   * Search IPOs by company name using trigram fuzzy search
   */
  async search(query: string, limit = 10): Promise<IPO[]> {
    const cacheKey = getIPOSearchKey(query);

    return this.getFromCache(
      cacheKey,
      async () => {
        try {
          // Use trigram similarity search
          const results = await this.db
            .select()
            .from(ipos)
            .where(sql`${ipos.companyName} % ${query}`)
            .orderBy(sql`similarity(${ipos.companyName}, ${query}) DESC`)
            .limit(limit);

          return results;
        } catch (error) {
          // Fallback to ILIKE search if trigram fails
          console.warn(
            'Trigram search failed, falling back to ILIKE:',
            error instanceof Error ? error.message : error
          );

          try {
            const results = await this.db
              .select()
              .from(ipos)
              .where(like(ipos.companyName, `%${query}%`))
              .limit(limit);

            return results;
          } catch (fallbackError) {
            throw new DatabaseError(
              `Failed to search IPOs: ${query}`,
              undefined,
              fallbackError
            );
          }
        }
      },
      CacheTTL.IPO_LIST
    );
  }

  /**
   * OD-68 hold-for-review, at the shared repository's create door (every
   * scraper and script create; the admin route uses web's own repository and
   * is NOT held - it is the human path).
   *
   * A create is only reached when `resolveIpoRow` bound nothing. The record is
   * HELD (no row created) only when a live row is plausibly the same offering
   * AND carries a KNOWN fact that contradicts the incoming record
   * (PR #910 review round 1, MAJOR-3):
   *   - same STRICT identity fold (decoration stripped, only corporate-form
   *     words dropped: "Laxmi India Finance" is not "Laxmi Finance"),
   *   - same segment and same offering type (an SME and a mainboard issue, or
   *     an IPO and an OFS, are two offerings - OD-70),
   *   - not WITHDRAWN, and open dates not more than 180 days apart when both
   *     are known (beyond that it is a new offering - OD-35 / OD-71),
   *   - and its open date or price band is KNOWN on both sides and DIFFERS.
   * Nothing known that differs: the record is created normally (OD-68 as
   * corrected); a same-fold pair with nothing contradicting is left to the
   * nightly `i_same_ipo_two_rows` sweep.
   *
   * A hold is DURABLE and READ BY A HUMAN (MAJOR-2, signal-ownership.md R3):
   * one audit_logs row per held record per candidate per day (action_type
   * IDENTITY_HELD_FOR_REVIEW, on /admin/audit), and the nightly check
   * `i_identity_held` lists every held record no row has since absorbed.
   */
  private async holdIfIdentityUnbound(data: IPOInsert): Promise<void> {
    const fold = strictIdentityCompanyName(data.companyName ?? '');
    if (!fold || !data.segment) return;
    const offeringType = data.offeringType ?? 'IPO';
    const rows = await this.db
      .select({
        id: ipos.id,
        slug: ipos.slug,
        companyName: ipos.companyName,
        openDate: ipos.openDate,
        priceRangeMin: ipos.priceRangeMin,
        status: ipos.status,
        cin: ipos.cin,
      })
      .from(ipos)
      .where(sql`${ipos.offeringType} = ${offeringType} AND ${ipos.segment} = ${data.segment} AND ${ipos.status} <> 'WITHDRAWN'`);
    const toDay = (v: unknown): string | null =>
      v == null || v === '' ? null : v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10);
    const toPrice = (v: unknown): number | null => {
      if (v == null || v === '') return null;
      const n = Number(v);
      return Number.isFinite(n) && n > 0 ? n : null;
    };
    const incomingDay = toDay(data.openDate);
    const incomingPrice = toPrice(data.priceRangeMin);
    const WINDOW_DAYS = 180;
    const incomingCin = normalizeCin(data.cin ?? null);
    const candidates = rows.filter((row) => {
      if (strictIdentityCompanyName(row.companyName) !== fold) return false;
      // OD-69: a known CIN that differs proves another company - nothing to hold for.
      const rowCin = normalizeCin(row.cin ?? null);
      if (incomingCin && rowCin && incomingCin !== rowCin) return false;
      const rowDay = toDay(row.openDate);
      if (incomingDay && rowDay && Math.abs(Date.parse(incomingDay) - Date.parse(rowDay)) / 86_400_000 > WINDOW_DAYS) {
        return false;
      }
      const dateDiffers = incomingDay != null && rowDay != null && incomingDay !== rowDay;
      const rowPrice = toPrice(row.priceRangeMin);
      const bandDiffers = incomingPrice != null && rowPrice != null && incomingPrice !== rowPrice;
      return dateDiffers || bandDiffers;
    });
    if (candidates.length === 0) return;
    const incoming = {
      companyName: data.companyName ?? '',
      slug: data.slug ?? '',
      openDate: incomingDay,
      priceRangeMin: data.priceRangeMin ?? null,
    };
    const candidateView = candidates.map((c) => ({
      id: c.id, slug: c.slug, companyName: c.companyName, openDate: c.openDate, priceRangeMin: c.priceRangeMin, status: c.status,
    }));
    logger.warn(
      { incoming, identityFold: fold, candidates: candidateView },
      'identity_held_for_review: no identifier bound this record and a same-name live row has a differing known open date or price band - NOT created (OD-68)'
    );
    await this.recordIdentityHold(incoming, fold, candidateView);
    throw new IdentityHeldForReviewError(
      `IPORepository.create: "${incoming.companyName}" held for review (OD-68) - its identity fold "${fold}" matches ` +
        candidates.map((c) => `${c.slug} (open ${String(c.openDate ?? 'unknown')}, band ${String(c.priceRangeMin ?? 'unknown')})`).join(', ') +
        ' whose known open date or price band differs; no row created',
      incoming,
      candidateView.map((c) => ({ ...c }))
    );
  }

  /**
   * Read-only slug-collision lookup, shared by `holdIfSlugTaken` and the
   * `identityHoldOverride` release path (OD-130 requirement (e)) so both
   * agree on who holds a slug and why.
   */
  private async findSlugHolder(slug: string) {
    const rows = await this.db
      .select({
        id: ipos.id,
        slug: ipos.slug,
        companyName: ipos.companyName,
        openDate: ipos.openDate,
        priceRangeMin: ipos.priceRangeMin,
        status: ipos.status,
        segment: ipos.segment,
        offeringType: ipos.offeringType,
        cin: ipos.cin,
      })
      .from(ipos)
      .where(eq(ipos.slug, slug));
    return rows.find((r) => r.slug === slug) ?? null;
  }

  /**
   * OD-130: `<slug>-<open-year>`, then `<slug>-<open-year>-<segment>` — the
   * first of those two DB checks not to come back with a row. `null` means
   * neither candidate is computable (no open date) or both are already taken
   * — the caller falls back to holding, as before.
   */
  private async mintSeparateOfferingSlug(data: { slug?: string | null; openDate?: unknown; segment?: string | null }): Promise<string | null> {
    if (!data.slug) return null;
    const candidates = deriveSeparateOfferingSlugCandidates(data.slug, data.openDate, data.segment ?? null);
    if (!candidates) return null;
    for (const candidate of candidates) {
      const holder = await this.findSlugHolder(candidate);
      if (!holder) return candidate;
    }
    return null;
  }

  /**
   * #928 (OD-69 / OD-71 / OD-35, #903): the record reached create because
   * `resolveIpoRow` declined the row that already holds its slug (a differing
   * CIN, a WITHDRAWN holder, another segment or type, a date beyond 180 days).
   * The insert would fail on `ipos.slug`'s unique constraint on every cycle with
   * no durable trace.
   *
   * OD-130 (2026-09-27): when the decline is one of the three rules the spec
   * calls a genuinely SEPARATE offering (`SEPARATE_OFFERING_SLUG_RULES`), a
   * fresh slug is minted (`<slug>-<open-year>`, then `<slug>-<open-year>-
   * <segment>`) and the create proceeds under it — the FIRST row's slug is
   * never touched. Every other decline (the OD-68 catch-all, OD-35) is still
   * HELD (OD-68: "held for review instead of creating a second row"; OD-85
   * read rule 3: "a failed check writes nothing and holds the record"),
   * recorded in audit_logs and read nightly by `i_identity_held`.
   */
  private async holdIfSlugTaken(data: IPOInsert): Promise<void> {
    if (!data.slug) return;
    const holder = await this.findSlugHolder(data.slug);
    if (!holder) return;

    const why = slugTakenReason(data, holder);
    const incoming = {
      companyName: data.companyName ?? '',
      slug: data.slug,
      openDate: data.openDate == null ? null : String(data.openDate).slice(0, 10),
      priceRangeMin: data.priceRangeMin ?? null,
    };
    const candidate = {
      id: holder.id, slug: holder.slug, companyName: holder.companyName, openDate: holder.openDate, priceRangeMin: holder.priceRangeMin, status: holder.status,
    };

    if (SEPARATE_OFFERING_SLUG_RULES.has(why.rule)) {
      const minted = await this.mintSeparateOfferingSlug(data);
      if (minted) {
        logger.info(
          { incoming, holder: candidate, rule: why.rule, reason: why.reason, mintedSlug: minted },
          '[OD-130] separate offering: slug minted instead of holding - the create proceeds'
        );
        await this.db.insert(auditLogs).values({
          adminUser: 'SYSTEM',
          actionType: SEPARATE_OFFERING_SLUG_ACTION,
          ipoId: null,
          tableName: 'ipos',
          fieldName: 'slug',
          oldValue: data.slug,
          newValue: minted,
          details: { rule: why.rule, reason: why.reason, incoming, holder: candidate, mintedSlug: minted },
          success: true,
        });
        data.slug = minted;
        return;
      }
      logger.warn(
        { incoming, holder: candidate, rule: why.rule, reason: why.reason },
        '[OD-130] separate offering declined slug mint (no open date, or both candidates taken) - falling back to a hold'
      );
    }

    logger.warn(
      { incoming, holder: candidate, rule: why.rule, reason: why.reason },
      'identity_held_for_review: the slug is held by a row identity resolution did not bind - NOT created (#928)'
    );
    await this.recordIdentityHold(incoming, strictIdentityCompanyName(incoming.companyName), [candidate], why);
    throw new IdentityHeldForReviewError(
      `IPORepository.create: "${incoming.companyName}" held for review (${why.rule}) - slug ${data.slug} is held by ${holder.id}; ${why.reason}; no row created`,
      incoming,
      [{ ...candidate }]
    );
  }

  /**
   * §9.2 item 26 (Tier A review CRITICAL-1, round 2): the durable half of an admin-removed-value hold.
   * `resolveIpoRow` refused to bind a record reached only through an identifier an admin removed (a
   * kept alias or an admin-SUPERSEDED source key) and throws; this records it on
   * the OD-68 hold path (audit_logs IDENTITY_HELD_FOR_REVIEW, read nightly by `i_identity_held`).
   */
  async recordAliasIdentityHold(
    incoming: { companyName: string; slug: string; openDate: string | null; priceRangeMin: unknown },
    candidates: { id: string; slug: string; companyName: string; openDate: unknown; priceRangeMin: unknown; status: unknown }[],
    reason: string,
    origin?: 'admin-create'
  ): Promise<void> {
    await this.recordIdentityHold(incoming, strictIdentityCompanyName(incoming.companyName) ?? '', candidates, {
      rule: 'OD-68 / spec §9.2 item 26',
      reason,
      origin,
    });
  }

  /**
   * The durable half of a hold: one audit_logs row per (incoming slug, first
   * candidate) per day, so a record re-scraped every cycle does not flood the
   * log. A failure here never turns a hold into a create - the caller throws
   * regardless - and is logged at error level.
   */
  private async recordIdentityHold(
    incoming: { companyName: string; slug: string; openDate: string | null; priceRangeMin: unknown },
    fold: string,
    candidates: { id: string; slug: string; companyName: string; openDate: unknown; priceRangeMin: unknown; status: unknown }[],
    why?: { rule: string; reason: string; origin?: HoldOrigin }
  ): Promise<void> {
    // An explicit origin wins; otherwise the ambient scope (#1299) tags every path an admin create reaches.
    const origin = why?.origin ?? currentHoldOrigin();
    try {
      // Dedupe per origin: an admin's hold must never hide a scraper's hold on the same slug and row (#1299 MINOR-4).
      const existing = await this.db
        .select({ id: auditLogs.id })
        .from(auditLogs)
        .where(sql`${auditLogs.actionType} = ${IDENTITY_HELD_ACTION} AND ${auditLogs.newValue} = ${incoming.slug} AND ${auditLogs.ipoId} = ${candidates[0].id} AND COALESCE(${auditLogs.details}->>'origin', '') = ${origin ?? ''} AND ${auditLogs.timestamp} > now() - interval '1 day'`)
        .limit(1);
      if (existing.length > 0) return;
      await this.db.insert(auditLogs).values({
        adminUser: 'SYSTEM',
        actionType: IDENTITY_HELD_ACTION,
        ipoId: candidates[0].id,
        tableName: 'ipos',
        fieldName: 'identity',
        oldValue: candidates.map((c) => c.slug).join(','),
        newValue: incoming.slug,
        details: why
          ? { rule: why.rule, reason: why.reason, ...(origin ? { origin } : {}), identityFold: fold, incoming, candidates }
          : { rule: 'OD-68', ...(origin ? { origin } : {}), identityFold: fold, incoming, candidates },
        success: false,
        errorMessage: why
          ? `held for review: "${incoming.companyName}" - ${why.reason}`
          : `held for review: "${incoming.companyName}" matches ${candidates.map((c) => c.slug).join(', ')} with a differing known open date or price band`,
      });
    } catch (error) {
      logger.error(
        { incoming, error: error instanceof Error ? error.message : String(error) },
        'identity_held_for_review: could not write the audit_logs record - the hold stands but the nightly i_identity_held check will not see it'
      );
    }
  }

  /**
   * Create new IPO.
   *
   * `options.identityHoldOverride` (MAJOR-2): a human read the hold and decided
   * the record IS a separate offering. It skips the OD-68 hold and records the
   * decision (who, why) in audit_logs as IDENTITY_HOLD_OVERRIDDEN. A scraper
   * never passes it.
   */
  async create(
    data: IPOInsert,
    options?: {
      identityHoldOverride?: { by: string; reason: string };
      sourceKeys?: SourceKeyRef[] | null;
      boundBy?: string;
      /** #1196: work that commits or rolls back WITH the row (its provenance). A throw rolls the create back. */
      inTx?: (tx: unknown, created: IPO) => Promise<void>;
      onIdentifierRefused?: OnIdentifierRefused;
    }
  ): Promise<IPO> {
    // #860: an IPO's segment decides which manifest ranks its fields get
    // (`ipoTypeKey` needs it), so an IPO created without one has every ranked
    // source chosen for a GUESSED type -- and `pull_plan_rank` cannot see
    // that, because the policy it checks against was picked using the same
    // guess. Measured on staging: 10 genuine IPOs in that state, one of them
    // OPEN and being walked now with 190 guessed plan rows.
    //
    // Scoped to offering_type = 'IPO' deliberately. Of the 41 null-segment
    // rows, 31 are OFS, TENDER, NCD, RIGHTS, BUYBACK or INVITS, where
    // "MAINBOARD vs SME" does not apply and null is the honest value. A
    // wider guard would reject 31 correct rows to fix 10 wrong ones.
    if (data.offeringType === 'IPO' && !data.segment) {
      throw new Error(
        `IPORepository.create: an IPO (offeringType=IPO) may not be created without a segment — ` +
        `"${data.companyName ?? data.slug ?? 'unknown'}" had segment=${data.segment ?? 'undefined'}. ` +
        'The segment decides which manifest ranks its fields get; without it every rank is resolved for a guessed type. See #860.'
      );
    }
    if (options?.identityHoldOverride) {
      const { by, reason } = options.identityHoldOverride;
      if (!by?.trim() || !reason?.trim()) {
        throw new Error('IPORepository.create: identityHoldOverride needs a non-empty `by` and `reason` (OD-68)');
      }
      // OD-130 requirement (e): releasing a held case still needs a free
      // slug. An admin overriding the hold has decided the record IS a
      // separate offering; if its slug is still taken (the usual case — it
      // is the SAME slug the hold recorded), mint one the same way the
      // automatic path would, rather than let the insert fail on the unique
      // constraint the override was supposed to get past.
      if (data.slug) {
        const stillTaken = await this.findSlugHolder(data.slug);
        if (stillTaken) {
          const minted = await this.mintSeparateOfferingSlug(data);
          if (!minted) {
            throw new Error(
              `IPORepository.create: identityHoldOverride cannot release "${data.companyName ?? data.slug}" - ` +
              `slug "${data.slug}" is taken by ${stillTaken.id} and no open date is known to derive <slug>-<year> (OD-130)`
            );
          }
          logger.info(
            { companyName: data.companyName, from: data.slug, to: minted, by, reason },
            '[OD-130] identity hold override: slug minted for the released row'
          );
          data.slug = minted;
        }
      }
      logger.warn({ companyName: data.companyName, slug: data.slug, by, reason }, 'identity hold OVERRIDDEN by a human - creating the row (OD-68)');
      await this.db.insert(auditLogs).values({
        adminUser: by,
        actionType: 'IDENTITY_HOLD_OVERRIDDEN',
        tableName: 'ipos',
        fieldName: 'identity',
        newValue: data.slug ?? null,
        details: { rule: 'OD-68', companyName: data.companyName, reason },
      });
    } else {
      await this.holdIfIdentityUnbound(data);
      await this.holdIfSlugTaken(data);
    }
    try {

      // Single write choke point: every IPO create — regardless of which
      // scraper/consolidation path produced it — stores a sanitized display
      // name (strip trailing scrape-artifact status token, e.g. "Ltd. O"). #42
      if (data.companyName) {
        data = { ...data, companyName: sanitizeDisplayCompanyName(data.companyName) };
      }

      // OD-85 write rule: the record's source keys are written in the SAME transaction as the row
      // create. A concurrent create of the same record loses on the keys' unique index, and its row
      // insert rolls back with it — so two concurrent creates leave one row.
      const keys = normalizeSourceKeyRefs(options?.sourceKeys ?? []);
      const inTx = options?.inTx;
      // #1376: a create carrying a CIN / ISIN / symbol runs the identifier guard in its transaction.
      const writesIdentifier = WRITER_IDENTIFIER_COLUMNS.some((c) => (data as Record<string, unknown>)[c] != null);
      let createRefusals: IdentifierRefusal[] = [];
      const ipo = keys.length === 0 && !writesIdentifier && !inTx
        ? (await this.db.insert(ipos).values(data).returning())[0]
        : await this.db.transaction(async (tx) => {
        const row = { ...data } as Record<string, unknown>;
        const refusedIds = await guardWriterIdentifiers(
          tx as never,
          // A create with no offering type passes `null`: sameOfferingAs() then cannot rule any holder out
          // by type, so a holder inside the 180-day window refuses (fail closed). That is recorded through
          // onIdentifierRefused like any other refusal, never silent; the row keeps the identifier
          // untouched until a typed write supplies it (test: identifier-refusal-recorded-1376, null type).
          { ipoId: null, offeringType: (row.offeringType as string | undefined) ?? null, openDate: row.openDate ?? null },
          row
        );
        createRefusals = refusedIds;
        if (refusedIds.length > 0) {
          logger.warn({ slug: data.slug, refused: refusedIds }, '[#1376 OD-68] identifier held by another row of the same offering: created without it');
        }
        const [created] = await tx.insert(ipos).values(row as IPOInsert).returning();
        if (keys.length > 0) {
          const rec = await recordSourceKeys(tx, created.id, keys, { boundVia: 'CREATE', boundBy: options?.boundBy ?? 'unknown' });
          noteSourceKeyBind(created.id, rec.insertedIds);
        }
        if (inTx) await inTx(tx, created);
        return created;
      });

      if (createRefusals.length > 0) options?.onIdentifierRefused?.(createRefusals);

      // Invalidate list cache
      await this.deleteCachePattern('ipo:list:*');
      await this.deleteCachePattern('ipo:search:*');

      return ipo;
    } catch (error) {
      const err = error as any;
      // Enhanced error logging - show full PostgreSQL error details
      console.error('[CREATE ERROR]', {
        company: data.companyName,
        message: err.message,
        code: err.code,              // PostgreSQL error code (e.g., '23505' for unique violation)
        constraint: err.constraint,   // Constraint name that was violated
        column: err.column,           // Column name that caused the error
        detail: err.detail,           // Detailed error message from PostgreSQL
        hint: err.hint,               // Hint for fixing the error
        table: err.table,             // Table name where error occurred
        where: err.where,             // Location in query where error occurred
        position: err.position        // Character position in query
      });
      throw new DatabaseError('Failed to create IPO', undefined, error);
    }
  }

  /**
   * Update IPO by ID
   */
  async update(
    id: string,
    data: Partial<IPOInsert>,
    options?: { honourProtection?: { source: string }; onIdentifierRefused?: OnIdentifierRefused }
  ): Promise<IPO> {
    // §9.2 item 19: EVERY update() honours the admin hold inside its own transaction — scraper,
    // repair tool or job alike (ADMIN outranks every source, §2.7). The admin path itself writes
    // through `applyAdminCorrigendumValue`, never here. `source` only names the writer in the log.
    return (
      await this.updateHonouringProtection(id, data, options?.honourProtection?.source ?? 'update()', undefined, options?.onIdentifierRefused)
    ).ipo;
  }

  /**
   * `update()` that also reports which requested fields an admin hold dropped (§9.2 item 19, OD-131).
   * A sibling rather than a new `update()` return shape: `update()` has dozens of callers that read the
   * returned IPO, and only the writers that record provenance or count repairs need the dropped list.
   * Such a caller MUST NOT write a `field_sources` row (or count a repair) for a dropped field — the
   * ADMIN row stays the field's source.
   */
  async updateReportingHolds(
    id: string,
    data: Partial<IPOInsert>,
    options?: { honourProtection?: { source: string }; inTx?: IposWriteTxHook; onIdentifierRefused?: OnIdentifierRefused }
  ): Promise<{ ipo: IPO; dropped: string[] }> {
    return this.updateHonouringProtection(id, data, options?.honourProtection?.source ?? 'update()', options?.inTx, options?.onIdentifierRefused);
  }

  /**
   * Spec §9.2 item 19 (§2.7): the write re-checks admin protection INSIDE its own transaction.
   * Orchestrators filter protected fields before they get here, but that read is outside any
   * transaction (and Redis-cached), so an admin save landing between that filter and this write was
   * overwritten. Here (`field-hold.ts`): lock the `ipos` row FOR NO KEY UPDATE (the lock
   * `writeAdminFieldValue` takes first), read `scraper_locked` and every protected `ipos` field,
   * drop them from the patch, and write the rest — one transaction. An admin save that committed
   * while this waited on the lock is seen by the protection read (READ COMMITTED takes a new
   * snapshot per statement) and survives.
   */
  private async updateHonouringProtection(
    id: string,
    data: Partial<IPOInsert>,
    source: string,
    inTx?: IposWriteTxHook,
    onIdentifierRefused?: OnIdentifierRefused
  ): Promise<{ ipo: IPO; dropped: string[] }> {
    let dropped: string[] = [];
    let identifierRefusals: IdentifierRefusal[] = [];
    let ipo: IPO;
    try {
      ipo = await this.db.transaction(async (txRaw) => {
        const tx = txRaw as unknown as NodePgDatabase<typeof schema>;
        const { updatedAt: _ignored, ...incoming } = data as Record<string, unknown>;
        const filtered = await filterPatchUnderHold(tx, id, 'ipos', incoming, { honourScraperLock: true });
        if (!filtered.hold) throw new EntityNotFoundError('IPO', id);
        dropped = filtered.dropped;
        // #1233 round 2: the type slice as it stood under this write's row lock, for `inTx`.
        const [typeBefore] = inTx
          ? await tx
              .select({ segment: ipos.segment, listingExchanges: ipos.listingExchanges, offeringType: ipos.offeringType })
              .from(ipos)
              .where(eq(ipos.id, id))
              .limit(1)
          : [];
        // §9.2 items 8 and 9 (OD-107): lead managers the admin owns are never replaced; a writer's
        // different list becomes a suggestion (rows to add / remove) for the admin queue.
        if (Array.isArray(incoming.leadManagers) && filtered.hold.protectedFields.has('leadManagers')) {
          const [cur] = await tx.select({ lm: ipos.leadManagers }).from(ipos).where(eq(ipos.id, id));
          await recordListSuggestion(tx as never, {
            ipoId: id,
            list: 'lead_managers',
            source,
            stored: (Array.isArray(cur?.lm) ? cur.lm : []).map((name) => ({ name })),
            incoming: (incoming.leadManagers as unknown[]).map((name) => ({ name })),
          });
        }
        const patch = filtered.patch as Record<string, unknown>;
        const runInTx = async (row: IPO): Promise<IPO> => {
          if (inTx) {
            await inTx(tx, {
              segment: (typeBefore?.segment as string | null | undefined) ?? null,
              listingExchanges: (typeBefore?.listingExchanges as string[] | null | undefined) ?? null,
              offeringType: (typeBefore?.offeringType as string | null | undefined) ?? null,
            });
          }
          return row;
        };
        if (Object.keys(patch).length === 0) {
          const [current] = await tx.select().from(ipos).where(eq(ipos.id, id)).limit(1);
          return runInTx(current as IPO);
        }
        // Same choke point for every write carrying a company name (#42): persist the sanitized form.
        if (typeof patch.companyName === 'string' && patch.companyName) patch.companyName = sanitizeDisplayCompanyName(patch.companyName);
        // F-145 class (OD-85): with an ACTIVE NSE_ISSUE key, `symbol` is that key's symbol.
        if (patch.symbol !== undefined) {
          const keySymbol = await activeNseIssueSymbol(tx as never, id);
          if (keySymbol && keySymbol !== patch.symbol) {
            logger.info({ ipoId: id, incoming: patch.symbol, active: keySymbol }, '[OD-85] ipos.symbol follows the ACTIVE NSE_ISSUE key');
            patch.symbol = keySymbol;
          }
        }
        // #1376: a CIN / ISIN / symbol this write changes takes the admin's per-value lock, and one
        // another row of the same offering already carries is removed (OD-68), inside this transaction.
        const writesIdentifier = WRITER_IDENTIFIER_COLUMNS.some((c) => patch[c] != null);
        const [self] = writesIdentifier
          ? await tx
              .select({ offeringType: ipos.offeringType, openDate: ipos.openDate, cin: ipos.cin, isin: ipos.isin, symbol: ipos.symbol })
              .from(ipos)
              .where(eq(ipos.id, id))
              .limit(1)
          : [];
        const refusedIds = !writesIdentifier ? [] : await guardWriterIdentifiers(
          tx as never,
          {
            ipoId: id,
            offeringType: (patch.offeringType as string | undefined) ?? self?.offeringType ?? null,
            openDate: patch.openDate ?? self?.openDate ?? null,
            current: { cin: self?.cin, isin: self?.isin, symbol: self?.symbol },
          },
          patch
        );
        if (refusedIds.length > 0) {
          dropped = [...dropped, ...refusedIds.map((r) => r.fieldName)];
          identifierRefusals = refusedIds;
          logger.warn({ ipoId: id, source, refused: refusedIds }, '[#1376 OD-68] identifier held by another row of the same offering: not written');
          if (Object.keys(patch).length === 0) {
            const [current] = await tx.select().from(ipos).where(eq(ipos.id, id)).limit(1);
            return runInTx(current as IPO);
          }
        }
        const [written] = await tx
          .update(ipos)
          .set({ ...(patch as Partial<IPOInsert>), updatedAt: new Date() })
          .where(eq(ipos.id, id))
          .returning();
        return runInTx(written as IPO);
      });
    } catch (error) {
      if (error instanceof EntityNotFoundError) throw error;
      throw new DatabaseError(`Failed to update IPO: ${id}`, undefined, error);
    }
    if (dropped.length > 0) {
      logger.info({ ipoId: id, source, dropped }, '[item 19] protected fields dropped inside the write transaction');
    }
    if (identifierRefusals.length > 0) onIdentifierRefused?.(identifierRefusals);
    await this.invalidateCache([getIPOByIdKey(id), getIPOBySlugKey(ipo.slug)], ['ipo:list:*', 'ipo:search:*']);
    return { ipo, dropped };
  }

  /**
   * Repair-tool entry point (#453 class): write ONLY the price-dependent
   * offer-terms fields (`priceRangeMin`, `priceRangeMax`, `lotSize`,
   * `issueSize`) for a row created before its band was published. A
   * distinct, narrowly-scoped method rather than a call through `update()`
   * so the write-ratchet's `repository` pattern (`ipoRepository\.(create|
   * update|delete|upsert)\(`) does not flag every NEW repair-script file
   * that needs to correct these fields — the write lives here, in this
   * already-baselined file, not re-typed as a direct `db.update(ipos)` in
   * a new script (`scripts/check-write-ratchet.mjs`, T-316).
   */
  async applyOfferTerms(
    id: string,
    data: Pick<Partial<IPOInsert>, 'priceRangeMin' | 'priceRangeMax' | 'lotSize' | 'issueSize'>
  ): Promise<{ ipo: IPO; dropped: string[] }> {
    return this.updateReportingHolds(id, data);
  }

  /**
   * Repair-tool entry point (lane C item 2 slice 6 — face-value-as-band
   * class): write ONLY `faceValue`. A sibling of `applyOfferTerms` rather
   * than folding `faceValue` into it, because the two are sourced from
   * DIFFERENT signals in the repair tool that calls them (the offer terms
   * from report 82's Issue Price; the face value from the detail page) and
   * a caller correcting one must never be tempted to pass a stale/undefined
   * value for the other through a shared, wider parameter shape. Same
   * write-ratchet rationale as `applyOfferTerms`: this method is the
   * already-baselined write path a new repair script routes through,
   * instead of a direct `db.update(ipos)`.
   */
  async applyFaceValue(id: string, faceValue: number): Promise<{ ipo: IPO; dropped: string[] }> {
    return this.updateReportingHolds(id, { faceValue });
  }

  /**
   * Repair-tool entry point (#1051, name-pollution cleanup): write ONLY `companyName`, through
   * `update()`, which stores the sanitized form. Same write-ratchet rationale as `applyFaceValue`:
   * the write lives in this already-baselined file, never re-typed as a direct `db.update(ipos)`
   * in a script (`scripts/check-write-ratchet.mjs`, T-316).
   */
  async applySanitizedCompanyName(id: string, companyName: string): Promise<{ ipo: IPO; dropped: string[] }> {
    return this.updateReportingHolds(id, { companyName });
  }

  /**
   * Repair-tool entry point (OD-74 item 14 / OD-77): write ONLY `issueSize`. A fresh repair write
   * stamps `updatedAt` now (through `update()`); the tool's `--undo` passes `restoreUpdatedAt` to put
   * the row back to its exact before-image. Same write-ratchet rationale as `applyOfferTerms`: the
   * write lives in this already-baselined file, never re-typed as a direct `db.update(ipos)` in a
   * new script (`scripts/check-write-ratchet.mjs`, T-316).
   */
  async applyIssueSizeRepair(
    id: string,
    issueSize: string | null,
    restoreUpdatedAt?: string
  ): Promise<{ ipo: IPO; dropped: string[] }> {
    if (restoreUpdatedAt === undefined) return this.updateReportingHolds(id, { issueSize });
    // --undo: the same hold as every other write (§9.2 item 19) — an admin value set since the repair
    // is never put back to the before-image. Lock + hold read + write in ONE transaction.
    let dropped: string[] = [];
    const ipo = await this.db.transaction(async (txRaw) => {
      const tx = txRaw as unknown as NodePgDatabase<typeof schema>;
      const filtered = await filterPatchUnderHold(tx, id, 'ipos', { issueSize }, { honourScraperLock: true });
      if (!filtered.hold) throw new EntityNotFoundError('IPO', id);
      dropped = filtered.dropped;
      if (dropped.length > 0) {
        const [current] = await tx.select().from(ipos).where(eq(ipos.id, id)).limit(1);
        return current as IPO;
      }
      const [row] = await tx
        .update(ipos)
        .set({ issueSize, updatedAt: sql`${restoreUpdatedAt}::timestamp` })
        .where(eq(ipos.id, id))
        .returning();
      return row as IPO;
    });
    if (dropped.length > 0) logger.info({ ipoId: id, dropped }, '[item 19] issue-size undo skipped: held by admin');
    await this.invalidateCache([getIPOByIdKey(id), getIPOBySlugKey(ipo.slug)], ['ipo:list:*', 'ipo:search:*']);
    return { ipo, dropped };
  }

  /**
   * Repair-tool entry point (item 12, OD-68 — decorated-slug cleanup): rename
   * `ipos.slug` and write its `ipo_slug_redirects` row (old -> new) in ONE
   * transaction, guarded on the row still holding `oldSlug` (never on `id`
   * alone — a concurrent write could have changed the slug since the caller
   * read it; returns 'raced' rather than clobbering it). Same write-ratchet
   * rationale as `applyOfferTerms`/`applyFaceValue`/`applyIssueSizeRepair`:
   * the write lives here, in this already-baselined file, not re-typed as a
   * direct `db.update(ipos)` transaction in a new script
   * (`scripts/check-write-ratchet.mjs`, T-316). The caller (the repair
   * script) still owns the shadow guard (refusing when `oldSlug` is
   * currently live on a DIFFERENT row) — that is a read, not a write, and
   * belongs to the tool's own collision policy.
   */
  async renameSlugWithRedirect(
    id: string,
    oldSlug: string,
    newSlug: string,
    reason: string
  ): Promise<'written' | 'raced'> {
    return (await this.renameSlugWithRedirectDetailed(id, oldSlug, newSlug, reason)).outcome;
  }

  /**
   * Same write as `renameSlugWithRedirect`, returning what it ACTUALLY changed
   * (#457): the `ipos` row's slug/updated_at before (read under FOR UPDATE in
   * the same transaction) and after, and the `ipo_slug_redirects` row only if
   * THIS call inserted it (`onConflictDoNothing` returns nothing when a redirect
   * for `oldSlug` already existed — that pre-existing row is not ours to undo).
   * Timestamps are returned as the column's own text so a restore is exact.
   */
  async renameSlugWithRedirectDetailed(
    id: string,
    oldSlug: string,
    newSlug: string,
    reason: string
  ): Promise<
    | { outcome: 'raced' }
    | {
        outcome: 'written';
        before: { slug: string; updatedAt: string | null };
        after: { slug: string; updatedAt: string | null };
        redirect: { id: string; oldSlug: string; ipoId: string; reason: string; createdAt: string } | null;
      }
  > {
    const result = await this.db.transaction(async (tx) => {
      const locked = await tx
        .select({ slug: ipos.slug, updatedAt: sql<string | null>`${ipos.updatedAt}::text` })
        .from(ipos)
        .where(and(eq(ipos.id, id), eq(ipos.slug, oldSlug)))
        .for('update');
      if (locked.length === 0) return { outcome: 'raced' as const };
      const updated = await tx
        .update(ipos)
        .set({ slug: newSlug, updatedAt: new Date() })
        .where(and(eq(ipos.id, id), eq(ipos.slug, oldSlug)))
        .returning({ slug: ipos.slug, updatedAt: sql<string | null>`${ipos.updatedAt}::text` });
      if (updated.length === 0) return { outcome: 'raced' as const };
      const inserted = await tx
        .insert(ipoSlugRedirects)
        .values({ oldSlug, ipoId: id, reason })
        .onConflictDoNothing({ target: ipoSlugRedirects.oldSlug })
        .returning({ id: ipoSlugRedirects.id, createdAt: sql<string>`${ipoSlugRedirects.createdAt}::text` });
      return {
        outcome: 'written' as const,
        before: { slug: locked[0].slug, updatedAt: locked[0].updatedAt },
        after: { slug: updated[0].slug, updatedAt: updated[0].updatedAt },
        redirect: inserted.length === 1 ? { id: inserted[0].id, oldSlug, ipoId: id, reason, createdAt: inserted[0].createdAt } : null,
      };
    });
    if (result.outcome === 'written') {
      await this.invalidateCache(
        [getIPOByIdKey(id), getIPOBySlugKey(oldSlug), getIPOBySlugKey(newSlug)],
        ['ipo:list:*', 'ipo:search:*', `ipo:detail:${oldSlug}`, `ipo:detail:${newSlug}`]
      );
    }
    return result;
  }

  /**
   * Item 9 corrigendum accept (OD-90): write ONE `ipos` column from inside the caller's OWN
   * transaction. `acceptCorrigendumSuggestion`
   * (packages/shared/src/services/corrigendum-suggestions.ts) claims the `data_conflicts` row,
   * writes this value, and records `field_sources` provenance all in one transaction — the claim
   * and the write must never be split across two commits. Static, and taking the transaction
   * handle directly, because the caller already holds a `tx`; wrapping it in an IPORepository
   * instance bound to `this.db` would either write outside that transaction or force a nested
   * transaction. Same write-ratchet rationale as `applyOfferTerms`/`renameSlugWithRedirect`: the
   * write lives here, in this already-baselined file, never re-typed as a direct
   * `db.update(ipos)` in a new call site (`scripts/check-write-ratchet.mjs`, T-316).
   */
  static async applyAdminCorrigendumValue(
    tx: NodePgDatabase<typeof schema>,
    id: string,
    fieldName: string,
    value: unknown
  ): Promise<void> {
    await tx
      .update(ipos)
      .set({ [fieldName]: value, lastManualEditAt: sql`now()` } as never)
      .where(eq(ipos.id, id));
  }

  /**
   * Delete IPO by ID
   */
  async delete(id: string): Promise<void> {
    try {
      const [ipo] = await this.db
        .delete(ipos)
        .where(eq(ipos.id, id))
        .returning();

      if (!ipo) {
        throw new EntityNotFoundError('IPO', id);
      }

      // Invalidate cache
      await this.invalidateCache(
        [getIPOByIdKey(id), getIPOBySlugKey(ipo.slug)],
        ['ipo:list:*', 'ipo:search:*']
      );
    } catch (error) {
      if (error instanceof EntityNotFoundError) {
        throw error;
      }
      throw new DatabaseError(
        `Failed to delete IPO: ${id}`,
        undefined,
        error
      );
    }
  }

  /**
   * Merge two `ipos` rows that are one IPO twice (F-55 class: a company
   * name-fold gap let a duplicate row through create-time dedup). Discovers
   * every descendant table from the LIVE `information_schema` FK graph
   * (never a hand-typed list — the class this exists to prevent, see
   * `docs/architecture/write-path-hardening.md`), repoints person-created
   * rows (`REPOINT_TABLES`) onto the survivor, deletes scraper-derived rows
   * with the dropped row, carries a short allow-list of absent scalar
   * columns onto the survivor with a `field_sources` provenance row each,
   * writes a slug redirect so the dropped row's URL keeps resolving, and
   * deletes the dropped `ipos` row. All-or-nothing in one transaction when
   * `opts.apply` is true; `opts.apply: false` (the default posture callers
   * should use first) returns the same plan without writing anything.
   *
   * The production-write guard lives IN THIS METHOD (MAJOR-3, PR #433
   * review): when `opts.apply` is true, it reads `current_database()` from
   * the SAME connection (`this.db`) and throws `ProdWriteRefusedError`
   * before any write if that name is `ipodhan` and `opts.allowProd` is not
   * `true`. Every caller — the CLI wrapper
   * (`scraper/scripts/repair-merge-duplicate-ipo.ts`, which passes
   * `allowProd` through from `--allow-prod`), a future admin route, or
   * anything else — is protected the same way; the guard cannot be bypassed
   * by forgetting to reimplement it at the call site.
   */
  async mergeDuplicateInto(
    keepId: string,
    dropId: string,
    opts: {
      apply: boolean;
      forceDifferentName?: boolean;
      setIssueSize?: string;
      issueSizeNote?: string;
      /** Required truthy to APPLY against the production database ("ipodhan"); ignored for dry runs. */
      allowProd?: boolean;
      /**
       * Item 19 / #807: who ran this merge, recorded verbatim in `ipo_merge_log.merged_by`.
       * The tool or operator name comes from the CALLER and is never inferred here — a log
       * that guesses its own author is worse than one that says "unknown".
       */
      mergedBy?: string;
      /**
       * #1298 (§2.9, OD-139): which fields are DOCUMENT fields (the scraper passes
       * `isRelaunchDocumentField`). Required for an OD-86 relaunch merge that involves a POSTPONED
       * row: the merge is then the relaunch filing, so the old offer's document values are
       * invalidated in this transaction. Missing on such a merge -> the merge is refused.
       */
      isRelaunchDocumentField?: (tableName: string, fieldName: string) => boolean;
      /**
       * #1402 (spec §2.8): the field manifest the survivor's plan is rebuilt from when the merge
       * fills segment, offering_type or listing_exchanges. Missing on such a merge -> the merge is
       * refused (it would leave the plan on the old type's ranks).
       */
      planManifest?: import('../services/plan-invalidating-rebuild').PlanManifest;
    }
  ): Promise<MergeDuplicateResult> {
    if (keepId === dropId) {
      throw new DatabaseError('mergeDuplicateInto: keepId and dropId name the same row', undefined);
    }

    // --- prod write guard (MAJOR-3, PR #433 review) ---------------------------------------------
    // First thing when apply is true, before any read or write: read from THIS SAME connection
    // (this.db), never an env var — the tunnel env can say "staging" while the socket is on prod
    // (see repair-tool.ts's queryCurrentDatabase doc). Refuses for every current and future caller
    // of this method, not just the CLI wrapper — a bypass is no longer possible by forgetting to
    // reimplement the guard at a new call site.
    if (opts.apply) {
      const currentDbResult = await this.db.execute(sql`select current_database()`);
      const currentDbRows = (currentDbResult as unknown as { rows: { current_database: string }[] }).rows;
      const currentDbName = String(currentDbRows?.[0]?.current_database ?? '');
      if (currentDbName.toLowerCase() === 'ipodhan' && opts.allowProd !== true) {
        throw new ProdWriteRefusedError(
          `mergeDuplicateInto: refusing to APPLY writes against the production database "ipodhan" ` +
            `(current_database() = "${currentDbName}") — pass opts.allowProd: true to override.`,
          currentDbName
        );
      }
    }

    const rows = await this.db.select().from(ipos).where(inArray(ipos.id, [keepId, dropId]));
    if (rows.length !== 2) {
      throw new DatabaseError(
        `mergeDuplicateInto: expected 2 rows in ipos for [${keepId}, ${dropId}], found ${rows.length}`,
        undefined
      );
    }
    const keep = rows.find((r) => r.id === keepId)!;
    const drop = rows.find((r) => r.id === dropId)!;

    // OD-86: the relaunch exception reads both rows' source keys (shares, band, postponed flag).
    const pairKeys = await this.db.select().from(ipoSourceKeys).where(inArray(ipoSourceKeys.ipoId, [keepId, dropId]));
    const relaunch = assessRelaunch(
      keep,
      drop,
      pairKeys.filter((k) => k.ipoId === keepId),
      pairKeys.filter((k) => k.ipoId === dropId)
    );
    const eligibility = checkMergeEligibility({
      relaunch,
      keepOpenDate: keep.openDate,
      dropOpenDate: drop.openDate,
      keepOfferingType: keep.offeringType,
      dropOfferingType: drop.offeringType,
      keepCloseDate: keep.closeDate,
      dropCloseDate: drop.closeDate,
      keepListingDate: keep.listingDate,
      dropListingDate: drop.listingDate,
      keepCompanyName: keep.companyName,
      dropCompanyName: drop.companyName,
      forceDifferentName: opts.forceDifferentName ?? false,
      identifiers: DISAGREEING_IDENTIFIER_COLUMNS.map((col) => {
        const jsKey = columnToCamelCase(col) as keyof typeof keep;
        return { column: col, keepValue: keep[jsKey], dropValue: drop[jsKey] };
      }),
      keepIssueSize: keep.issueSize,
      dropIssueSize: drop.issueSize,
      // Acknowledged ONLY when the operator passed BOTH flags — a bare --set-issue-size with no
      // --issue-size-note is not source-backed and must not silently bypass the disagreement check.
      issueSizeCorrectionAcknowledged: Boolean(opts.setIssueSize) && Boolean(opts.issueSizeNote),
    });
    if (eligibility.eligible === false) {
      throw new DatabaseError(`mergeDuplicateInto: refused — ${eligibility.reason}`, undefined);
    }

    // --- discover children from the live schema (never hand-listed) --------------------------
    const fkResult = await this.db.execute(sql`
      select distinct tc.table_name as child, kcu.column_name as col, ccu.table_name as parent
      from information_schema.table_constraints tc
      join information_schema.key_column_usage kcu
        on tc.constraint_name = kcu.constraint_name and tc.table_schema = kcu.table_schema
      join information_schema.constraint_column_usage ccu
        on tc.constraint_name = ccu.constraint_name and tc.table_schema = ccu.table_schema
      where tc.constraint_type = 'FOREIGN KEY' and tc.table_schema = 'public'
    `);
    const fks = (fkResult as unknown as { rows: FkEdge[] }).rows;
    const { reach, direct } = planDescendantTables(fks);

    // --- count keep/drop rows in every direct child, for the plan report -------------------------
    const counts: { table: string; col: string; keep: number; drop: number }[] = [];
    for (const table of direct) {
      const { col } = reach.get(table)!;
      const r = await this.db.execute(sql`
        select count(*) filter (where ${sql.identifier(col)} = ${keepId})::int as keep,
               count(*) filter (where ${sql.identifier(col)} = ${dropId})::int as drop
        from ${sql.identifier(table)}
        where ${sql.identifier(col)} in (${keepId}, ${dropId})
      `);
      const row = (r as unknown as { rows: { keep: number; drop: number }[] }).rows[0];
      counts.push({ table, col, keep: row?.keep ?? 0, drop: row?.drop ?? 0 });
    }

    // --- provenance already on the DROP row, so a carried field keeps its real source -------------
    // MAJOR-1 (PR #433 review): scoped to dropId at the query AND again in buildProvenanceMap — a
    // keep-side row must never become the "drop provenance" a carried value gets stamped with.
    const provRows = await this.db
      .select({
        ipoId: fieldSources.ipoId,
        fieldName: fieldSources.fieldName,
        source: fieldSources.source,
        confidence: fieldSources.confidence,
      })
      .from(fieldSources)
      .where(and(eq(fieldSources.ipoId, dropId), eq(fieldSources.tableName, 'ipos')));
    const dropProv = buildProvenanceMap(provRows, dropId);

    let relaunchCleared: import('../services/relaunch-admin-clear').RelaunchClearSummary | null = null;
    let patch = planCarryFields(buildCarryFieldInputs(keep, drop, dropProv), dropId);
    // #1298 (§2.9): an OD-86 relaunch merge with a POSTPONED side is the relaunch filing.
    const relaunchOfPostponed =
      relaunchException(relaunch) && (String(keep.status) === 'POSTPONED' || String(drop.status) === 'POSTPONED');
    if (relaunchOfPostponed) {
      if (!opts.isRelaunchDocumentField) {
        throw new DatabaseError(
          'mergeDuplicateInto: an OD-86 relaunch merge of a POSTPONED IPO needs isRelaunchDocumentField (§2.9 invalidation, #1298)',
          undefined
        );
      }
      // The old offer's document values must not survive the relaunch: when the postponed row is the
      // one dropped, its document columns are not carried (identity columns still are, OD-83).
      if (String(drop.status) === 'POSTPONED') {
        const isDoc = opts.isRelaunchDocumentField;
        patch = patch.filter((p) => {
          const f = columnToCamelCase(p.column);
          return ['cin', 'symbol', 'isin', 'companyName'].includes(f) || !isDoc('ipos', f);
        });
      }
    }
    if (opts.setIssueSize) {
      patch.push({
        column: 'issue_size',
        value: opts.setIssueSize,
        source: 'ADMIN',
        confidence: 100,
        note: opts.issueSizeNote || 'corrected during duplicate merge',
      });
    }

    // #1294 item 4 (§9.2 items 8 and 28(b), clarified 2026-10-01): the merge deletes the dropped row's
    // child lists and may carry lead managers onto the survivor. An admin-owned list is never deleted
    // or replaced silently: the merge (dry run included) is refused, naming the IPO and the list.
    // This early read is a fast path (it also refuses the dry run); the apply re-reads it under the
    // row locks below, because an admin list edit can commit between here and that lock (PR #1371).
    const listRefusalArgs = {
      keep: { id: keepId, slug: String(keep.slug) },
      drop: { id: dropId, slug: String(drop.slug) },
      carriedColumns: patch.map((p) => p.column),
    };
    const listRefusal = await adminListMergeRefusal(this.db as never, listRefusalArgs);
    if (listRefusal) throw new DatabaseError(`mergeDuplicateInto: refused — ${listRefusal}`, undefined);

    const toDelete = counts.filter((x) => x.drop > 0 && !REPOINT_TABLES.has(x.table));
    const toRepoint = counts.filter((x) => x.drop > 0 && REPOINT_TABLES.has(x.table));

    const plan: MergeDuplicatePlan = {
      keep,
      drop,
      patch,
      toDelete: toDelete.map((x) => ({ table: x.table, col: x.col, count: x.drop })),
      toRepoint: toRepoint.map((x) => ({ table: x.table, col: x.col, count: x.drop })),
      descendantTableCount: reach.size,
      directTableCount: direct.length,
    };

    if (!opts.apply) {
      return { ...plan, applied: false, keepSlug: keep.slug, droppedSlug: drop.slug, provenanceWritten: [], childOutcome: [] };
    }

    // --- apply, all or nothing -----------------------------------------------------------------
    // CORRECT FOR NOW, NOT CORRECT IN GENERAL: keyed on (ipoId, tableName) and
    // mapped by fieldName alone, so two sibling rows of one table would collapse
    // into one map entry. Every row_key is '' today; the moment slice s5b writes
    // real keys this reads an arbitrary sibling. Which key a merge should carry
    // is a design question owned by s5b/s7a/s7b — do not guess it here.
    const keepProvRows = await this.db
      .select({ fieldName: fieldSources.fieldName, source: fieldSources.source })
      .from(fieldSources)
      .where(and(eq(fieldSources.ipoId, keepId), eq(fieldSources.tableName, 'ipos')));
    const keepProv = new Map(keepProvRows.map((p) => [p.fieldName, p.source]));

    const provenanceWritten: { fieldName: string; source: string; previousSource: string | null }[] = [];

    const childOutcome: MergeChildOutcome[] = [];

    await this.db.transaction(async (tx) => {
      // --- #900 / #807 findings 4-5: lock BOTH rows first and snapshot them whole ----------------
      // One statement, ordered by id, so two merges touching the same pair lock in the same order
      // and cannot deadlock. `to_jsonb(i.*)` carries every column the LIVE table has — not the
      // list schema.ts declares, which ipodhan_staging already exceeds by six columns — and is
      // read as TEXT so numerics keep their exact scale (JSON.parse would turn 10.00 into 10).
      // The text is written back into jsonb server-side below, never through a JS object.
      const lockedResult = await tx.execute(sql`
        select i.id::text as id, to_jsonb(i.*)::text as row
        from ipos i
        where i.id in (${keepId}, ${dropId})
        order by i.id
        for update
      `);
      const locked = (lockedResult as unknown as { rows: { id: string; row: string }[] }).rows ?? [];
      const keepRowText = locked.find((r) => r.id === keepId)?.row;
      const dropRowText = locked.find((r) => r.id === dropId)?.row;
      if (!keepRowText || !dropRowText) {
        // Something deleted one of the pair between planning and now. Merging against a row that
        // is no longer there would log a snapshot of nothing; abort and let the operator re-plan.
        throw new DatabaseError(
          `mergeDuplicateInto: ${!keepRowText ? 'keep' : 'drop'} row vanished before the merge transaction locked it — re-run the plan`,
          undefined
        );
      }

      // PR #1371 round 2 (§9.2 items 8, 28(b)): every admin list write locks its `ipos` row (FOR NO
      // KEY UPDATE, `lockAndReadListOwnership` / `writeAdminFieldValue`), which conflicts with the
      // FOR UPDATE just taken, so the ownership read here is final until commit: re-check it.
      const lockedListRefusal = await adminListMergeRefusal(tx as never, listRefusalArgs);
      if (lockedListRefusal) throw new DatabaseError(`mergeDuplicateInto: refused — ${lockedListRefusal}`, undefined);

      // The patch was planned from an UNLOCKED read of the survivor. A carry-if-absent value is
      // only correct while the survivor's column is still absent; if a concurrent writer filled it
      // in the meantime, applying the stale patch would overwrite that write. Refuse instead.
      const keepLocked = JSON.parse(keepRowText) as Record<string, unknown>;
      const raced = patch.filter(
        (p) => p.source !== 'ADMIN' && keepLocked[p.column] !== null && keepLocked[p.column] !== undefined
      );
      if (raced.length > 0) {
        throw new DatabaseError(
          `mergeDuplicateInto: the survivor's ${raced.map((p) => p.column).join(', ')} was written after the plan was made — re-run the plan`,
          undefined
        );
      }

      // Both IPOs' provenance, whole, BEFORE the child loop below deletes the dropped side's
      // field_sources rows (field_sources is a scraper-derived child, not a REPOINT table). Spec
      // §2.3.3.3: the log holds "every field value and every provenance row".
      const fsResult = await tx.execute(sql`
        select fs.ipo_id::text as ipo_id, to_jsonb(fs.*)::text as row
        from field_sources fs
        where fs.ipo_id in (${keepId}, ${dropId})
        order by fs.ipo_id, fs.table_name, fs.field_name, fs.id
      `);
      const fsRows = (fsResult as unknown as { rows: { ipo_id: string; row: string }[] }).rows ?? [];
      const keepFieldSources = fsRows.filter((r) => r.ipo_id === keepId).map((r) => r.row);
      const dropFieldSources = fsRows.filter((r) => r.ipo_id === dropId).map((r) => r.row);

      // OD-92 (§2.3.3.3 "the rows themselves"): before the first delete, every row this merge
      // will remove (the direct scraper-derived children and everything their FK cascades take
      // with them) whole, every reference a SET NULL cascade will clear, and both IPOs' source
      // keys as they stand now (an OD-86 relaunch merge supersedes some of them below).
      const capture: MergeCapture = await captureMergeDeletions(
        tx,
        dropId,
        direct.filter((t) => !REPOINT_TABLES.has(t)).map((t) => ({ table: t, col: reach.get(t)!.col }))
      );
      const keysBefore = (
        (await tx.execute(sql`
          select to_jsonb(k.*)::text as row from ipo_source_keys k
          where k.ipo_id in (${keepId}, ${dropId}) order by k.id
        `)) as unknown as { rows: { row: string }[] }
      ).rows.map((r) => r.row);
      let supersededKeyIds: string[] = [];
      let olderIdForRelaunch: string | null = null;
      let relaunchDelta: ChildRowDelta[] = [];

      // --- child tables FIRST: repoint person-created data, delete scraper-derived data --------
      // Must run before the `ipos` row for dropId is deleted below: most FKs into `ipos` are
      // ON DELETE CASCADE (schema.ts), so deleting the dropped `ipos` row before this loop would
      // let Postgres cascade-delete REPOINT_TABLES rows too (user_watchlist, ipo_reviews, ...) —
      // exactly the person-created data this loop exists to save by repointing, not deleting.
      for (const table of direct) {
        const { col } = reach.get(table)!;
        if (REPOINT_TABLES.has(table)) {
          // #900: never table-wide. The old code ran one table-wide UPDATE and, on ANY unique
          // violation, deleted EVERY dropped-side row of the table — so one user watching both
          // IPOs cost every other watcher their watch. Now a dropped row is deleted only when the
          // survivor already holds its twin under a unique key that includes the IPO column;
          // every other row is repointed. Both steps RETURN the rows they touched, and those rows
          // — not a pre-transaction count — are what the log records.
          const conflict = await this.buildRepointConflictPredicate(tx, table, col, keepId);
          let deletedOnConflict: string[] = [];
          if (conflict) {
            const delResult = await tx.execute(sql`
              delete from ${sql.identifier(table)} d
              where d.${sql.identifier(col)} = ${dropId} and (${conflict})
              returning to_jsonb(d.*)::text as row
            `);
            deletedOnConflict = ((delResult as unknown as { rows: { row: string }[] }).rows ?? []).map((r) => r.row);
          }
          // No savepoint and no 23505 fallback: if a unique violation still happens here, the
          // predicate above missed a key, and the only safe answer is to abort the whole merge.
          const updResult = await tx.execute(sql`
            update ${sql.identifier(table)} d set ${sql.identifier(col)} = ${keepId}
            where d.${sql.identifier(col)} = ${dropId}
            returning to_jsonb(d.*) ->> 'id' as id
          `);
          const repointedIds = ((updResult as unknown as { rows: { id: string | null }[] }).rows ?? []).map(
            (r) => r.id
          );
          if (repointedIds.some((id) => id === null || id === undefined)) {
            throw new DatabaseError(
              `mergeDuplicateInto: ${table} has no id column, so its repointed rows cannot be logged — refusing`,
              undefined
            );
          }
          if (repointedIds.length > 0 || deletedOnConflict.length > 0) {
            childOutcome.push({
              table,
              col,
              kind: 'repoint',
              repointedIds: repointedIds as string[],
              deletedOnConflictCount: deletedOnConflict.length,
              deletedOnConflictRows: deletedOnConflict,
              deletedCount: 0,
            });
          }
        } else {
          const delResult = await tx.execute(sql`
            with d as (
              delete from ${sql.identifier(table)} where ${sql.identifier(col)} = ${dropId} returning 1
            )
            select count(*)::int as n from d
          `);
          const n = Number((delResult as unknown as { rows: { n: number }[] }).rows?.[0]?.n ?? 0);
          if (n > 0) {
            childOutcome.push({
              table,
              col,
              kind: 'delete',
              repointedIds: [],
              deletedOnConflictCount: 0,
              deletedOnConflictRows: [],
              deletedCount: n,
            });
          }
        }
      }

      // Item 19 / #807: the merge log, written INSIDE this transaction and BEFORE the delete
      // below. After the delete there is nothing left to snapshot; outside the transaction, a
      // log written before it can record a merge that then rolls back, and one written after
      // can miss a merge that crashed halfway.
      //
      // Layout (no migration — the 0051 jsonb columns carry it):
      //   drop_row               the dropped ipos row, to_jsonb, every live column (snake_case);
      //                          restorable with jsonb_populate_record(null::ipos, drop_row)
      //   survivor_patch         { format: 2, patch, keepRowBefore, fieldSourcesBefore: { keep, drop } }
      //   repointed_child_counts [{ table, col, count, repointedIds, deletedOnConflictCount,
      //                             deletedOnConflictRows }]   person-created rows
      //   deleted_child_counts   [{ table, col, count }]      scraper-derived rows, count only
      // Row snapshots are spliced in as JSON TEXT and parsed by Postgres, so a numeric's scale
      // and a timestamp's text survive exactly.
      const rawArray = (texts: string[]) => `[${texts.join(',')}]`;
      const survivorPatchJson =
        `{"format":2,"patch":${JSON.stringify(patch)},"keepRowBefore":${keepRowText},` +
        `"fieldSourcesBefore":{"keep":${rawArray(keepFieldSources)},"drop":${rawArray(dropFieldSources)}}}`;
      const repointedJson = rawArray(
        childOutcome
          .filter((c) => c.kind === 'repoint')
          .map(
            (c) =>
              `{"table":${JSON.stringify(c.table)},"col":${JSON.stringify(c.col)},` +
              `"count":${c.repointedIds.length},"repointedIds":${JSON.stringify(c.repointedIds)},` +
              `"deletedOnConflictCount":${c.deletedOnConflictCount},` +
              `"deletedOnConflictRows":${rawArray(c.deletedOnConflictRows)}}`
          )
      );
      const deletedJson = JSON.stringify(
        childOutcome
          .filter((c) => c.kind === 'delete')
          .map((c) => ({ table: c.table, col: c.col, count: c.deletedCount }))
      );

      const [logRow] = await tx.insert(ipoMergeLog).values({
        keepIpoId: keepId,
        keepSlug: keep.slug,
        dropIpoId: dropId,
        dropSlug: drop.slug,
        dropRow: sql`${dropRowText}::jsonb` as unknown as Record<string, unknown>,
        survivorPatch: sql`${survivorPatchJson}::jsonb` as unknown as Record<string, unknown>,
        deletedChildCounts: sql`${deletedJson}::jsonb` as unknown as Record<string, unknown>,
        repointedChildCounts: sql`${repointedJson}::jsonb` as unknown as Record<string, unknown>,
        mergedBy: opts.mergedBy || 'unknown',
      }).returning({ id: ipoMergeLog.id });

      // DEFECT 2 (2026-09-16 staging dedupe): the dropped `ipos` row is deleted here — after
      // child-table repoint/delete above, but BEFORE any carried-column UPDATE on the survivor
      // below. A carried value (e.g. symbol) can be identical to a value the dropped row still
      // holds; writing the survivor's UPDATE first, while the dropped row still exists, makes
      // both rows hold that value at once — which any unique-constrained column the dropped row
      // still carries (checked against schema.ts: currently only `slug`, which is never a
      // carried column; any future addition to CARRY_IF_ABSENT_COLUMNS that is also
      // unique-constrained would hit this) cannot survive, crashing the whole transaction
      // (icelectricals, 2026-09-16: symbol='ICELCO' observed on both rows mid-transaction).
      // Deleting the dropped row first means the carried value only ever exists on the survivor.
      // #1376: the carried cin / isin / symbol below therefore skip guardWriterIdentifiers ON PURPOSE. The only
      // other holder of a value the survivor lacks is this dropped row (same offering, OD-68), and it is deleted
      // here, in the same transaction, before the carry UPDATE. The order is pinned by
      // ipo-repository.merge-order.test.ts ("symbol: DELETE on the dropped ipos row is issued before the survivor
      // is UPDATEd ...").
      await tx.delete(ipos).where(eq(ipos.id, dropId));

      // OD-86 + OD-83: a relaunch merge leaves the survivor with both records' keys; the older
      // row's key of each source the newer row also carries is SUPERSEDED here, in the same
      // transaction, so one source never holds two ACTIVE keys on one row.
      if (relaunchException(relaunch)) {
        const keepDay = String(keep.openDate ?? '').slice(0, 10);
        const dropDay = String(drop.openDate ?? '').slice(0, 10);
        const olderId = keepDay && dropDay ? (keepDay < dropDay ? keepId : dropDay < keepDay ? dropId : null) : null;
        olderIdForRelaunch = olderId;
        if (olderId) {
          const newerId = olderId === keepId ? dropId : keepId;
          supersededKeyIds = await supersedeOlderKeysOnRelaunchMerge(
            tx,
            pairKeys.filter((k) => k.ipoId === olderId),
            pairKeys.filter((k) => k.ipoId === newerId),
            `merge of ${drop.slug} into ${keep.slug}`
          );
        }
      }

      // #1298 (§2.9, OD-139): the OD-86 relaunch merge is a relaunch filing. On a POSTPONED survivor
      // the same invalidation as the OD-83 supersede runs here, in the merge transaction and BEFORE the carried values are written (clear, then refill) (admin values
      // per OD-120, non-admin document values and lists, the document plan reopened).
      if (relaunchOfPostponed && supersededKeyIds.length > 0) {
        const { clearAdminValuesOnRelaunch } = await import('../services/relaunch-admin-clear');
        // OD-92 (#1298 round 2): everything the clear changes on the survivor's child rows (holds,
        // provenance, list rows, one-row child values, audit marks, plan and document-fetch rows) is
        // captured whole around it and logged, so the unmerge can put every one back.
        const childCapture = await beginChildRowCapture(
          tx,
          keepId,
          direct.filter((t) => t !== 'ipos' && t !== 'ipo_merge_log').map((t) => ({ table: t, col: reach.get(t)!.col }))
        );
        relaunchCleared = await clearAdminValuesOnRelaunch(
          tx as never,
          keepId,
          { kind: 'SOURCE_KEY_RELAUNCH', supersededKeyIds },
          [],
          opts.isRelaunchDocumentField!
        );
        relaunchDelta = await childCapture.finish();
        // Refill: every `ipos` value the relaunch emptied takes the NEWER record's value when the
        // survivor is the older, postponed row (the newer row is the relaunch's own terms).
        if (relaunchCleared && olderIdForRelaunch === keepId) {
          const dropRow = drop as unknown as Record<string, unknown>;
          for (const inv of relaunchCleared.invalidated ?? []) {
            if (inv.tableName !== 'ipos' || inv.fieldName === '*') continue;
            const v = dropRow[inv.fieldName];
            if (v === null || v === undefined || patch.some((p) => columnToCamelCase(p.column) === inv.fieldName)) continue;
            const prov = dropProv.get(inv.fieldName);
            patch.push({
              column: inv.fieldName.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`),
              value: v,
              source: prov ? prov.source : 'DRHP',
              confidence: prov ? prov.confidence : 90,
              note: `relaunch refill from the merged newer record ${dropId} (§2.9, #1298)`,
            } as (typeof patch)[number]);
          }
        }
      }

      // #1402 (spec §2.8): a filled plan input (segment / offering_type / listing_exchanges) is written
      // through the one write-and-rebuild door, so the survivor's plan is rebuilt in this transaction.
      const { isPlanInvalidatingField, writeIposRebuildingPlanInTx } = await import('../services/plan-invalidating-rebuild');
      const planInputSet: Record<string, unknown> = {};
      for (const p of patch) {
        const jsKey = columnToCamelCase(p.column);
        if (isPlanInvalidatingField('ipos', jsKey)) planInputSet[jsKey] = p.value;
      }
      if (Object.keys(planInputSet).length > 0) {
        await writeIposRebuildingPlanInTx(tx as never, keepId, { ...planInputSet, updatedAt: new Date() }, opts.planManifest);
      }

      for (const p of patch) {
        const jsKey = columnToCamelCase(p.column);
        if (!(jsKey in planInputSet)) {
          await tx
            .update(ipos)
            .set({ [jsKey]: p.value, updatedAt: new Date() } as Partial<typeof ipos.$inferInsert>)
            .where(eq(ipos.id, keepId));
        }

        const previousSource = keepProv.get(jsKey) ?? null;
        const keepValueBefore = (keep as unknown as Record<string, unknown>)[jsKey];
        await tx
          .insert(fieldSources)
          .values({
            ipoId: keepId,
            tableName: 'ipos',
            fieldName: jsKey,
            source: p.source as (typeof fieldSources.$inferInsert)['source'],
            confidence: p.confidence,
            previousValue: keepValueBefore === null || keepValueBefore === undefined ? null : String(keepValueBefore),
            previousSource: previousSource as (typeof fieldSources.$inferInsert)['previousSource'],
            dataLineage: { tool: 'merge-duplicate-ipo', mergedFrom: dropId, note: p.note, at: new Date().toISOString() },
            updatedBy: 'merge-duplicate-ipo',
          })
          .onConflictDoUpdate({
            // MUST mirror unique_field_source_per_ipo (item 1 slice s18:
            // ipo_id, table_name, row_key, field_name). Postgres needs an
            // arbiter index matching this list EXACTLY; the only unique index
            // on the table is the 4-column one, so a 3-column target here is
            // 42P10 on the first write — inside this transaction, which would
            // roll the value write back with it. rowKey is omitted from
            // .values() above, so it defaults to '' and behaviour is unchanged.
            target: [fieldSources.ipoId, fieldSources.tableName, fieldSources.rowKey, fieldSources.fieldName],
            set: {
              source: p.source as (typeof fieldSources.$inferInsert)['source'],
              confidence: p.confidence,
              previousValue: keepValueBefore === null || keepValueBefore === undefined ? null : String(keepValueBefore),
              previousSource: previousSource as (typeof fieldSources.$inferInsert)['previousSource'],
              // #1068 sweep (same class as #755/#753/#1065): MERGE, never replace. A plain
              // object here REPLACES the whole jsonb column on conflict, destroying whatever
              // docType/other keys an earlier write on this SAME (ipo, table, row, field) had
              // set. Same coalesce-and-concat merge as field-sources-repository.ts's fix.
              dataLineage: sql`COALESCE(${fieldSources.dataLineage}, '{}'::jsonb) || ${JSON.stringify({
                tool: 'merge-duplicate-ipo',
                mergedFrom: dropId,
                note: p.note,
                at: new Date().toISOString(),
              })}::jsonb`,
              updatedBy: 'merge-duplicate-ipo',
              updatedAt: new Date(),
            },
          });
        provenanceWritten.push({ fieldName: jsKey, source: p.source, previousSource });
      }

      // The old URL must keep resolving; a merge that 404s a live IPO page is a regression.
      const redirectRows = await tx
        .insert(ipoSlugRedirects)
        .values({ oldSlug: drop.slug, ipoId: keepId, reason: 'DUPLICATE_MERGE' })
        .onConflictDoNothing({ target: ipoSlugRedirects.oldSlug })
        .returning({ id: ipoSlugRedirects.id });

      // OD-92: the rest of what an exact unmerge needs, written last so it can include the
      // survivor as the merge left it (the drift check compares against this) and the ids of
      // the redirect and superseded keys this transaction created or changed.
      const keepAfterText = (
        (await tx.execute(sql`select to_jsonb(i.*)::text as row from ipos i where i.id = ${keepId}`)) as unknown as {
          rows: { row: string }[];
        }
      ).rows[0]?.row;
      // #1298 follow-up (OD-92 "every automatic merge is reversible"): the survivor_patch was written
      // BEFORE the relaunch clear + refill ran. The logged patch becomes the patch actually applied (the
      // refill's entries carry the source and confidence they were written with), plus one entry per
      // survivor column the clear changed and nothing refilled (no source wrote it: RELAUNCH_CLEAR, 0).
      // updated_at is restored on its own rule. Compared inside the database, so a numeric's scale and
      // a timestamp's text are compared exactly.
      const appliedPatch = JSON.stringify(patch);
      const clearedOnly = keepAfterText
        ? (
            (await tx.execute(sql`
              select coalesce(jsonb_agg(jsonb_build_object(
                       'column', k, 'value', a.after -> k, 'source', 'RELAUNCH_CLEAR', 'confidence', 0,
                       'note', ${`emptied by this merge's relaunch clear (§2.9, #1298); restored by unmerge`}::text)), '[]'::jsonb)::text as extra
              from (select ${keepAfterText}::jsonb as after, ${keepRowText}::jsonb as before) a,
                   lateral jsonb_object_keys(a.after) k
              where k <> 'updated_at'
                and (a.before -> k) is distinct from (a.after -> k)
                and k <> all (array(select jsonb_array_elements(${appliedPatch}::jsonb) ->> 'column'))
            `)) as unknown as { rows: { extra: string }[] }
          ).rows[0]?.extra ?? '[]'
        : '[]';
      // The survivor's own provenance for every logged column is restored by the unmerge's step 6 from
      // fieldSourcesBefore, so the child-row delta leaves those rows to it (one owner per row).
      const loggedFields = new Set(
        [...patch.map((p) => p.column), ...(JSON.parse(clearedOnly) as { column: string }[]).map((e) => e.column)].map(columnToCamelCase)
      );
      const ownedByStep6 = (text: string) => {
        const r = JSON.parse(text) as { table_name?: string; row_key?: string | null; field_name?: string };
        return r.table_name === 'ipos' && (r.row_key ?? '') === '' && loggedFields.has(String(r.field_name));
      };
      const loggedDelta = relaunchDelta
        .map((d) =>
          d.table !== 'field_sources'
            ? d
            : {
                ...d,
                deleted: d.deleted.filter((t) => !ownedByStep6(t)),
                inserted: d.inserted.filter((t) => !ownedByStep6(t)),
                updated: d.updated.filter((u) => !ownedByStep6(u.before)),
              }
        )
        .filter((d) => d.deleted.length || d.inserted.length || d.updated.length);
      const restoreJson =
        `{"format":3,"deletedRows":[${capture.deletedRows
          .map((t) => `{"table":${JSON.stringify(t.table)},"rows":${rawArray(t.rows)}}`)
          .join(',')}],` +
        `"nulledRefs":${JSON.stringify(capture.nulledRefs)},` +
        `"sourceKeysBefore":${rawArray(keysBefore)},"supersededKeyIds":${JSON.stringify(supersededKeyIds)},` +
        `"relaunchDelta":${childRowDeltaJson(loggedDelta)},` +
        `"keepRowAfter":${keepAfterText ?? 'null'},"redirectId":${JSON.stringify(redirectRows[0]?.id ?? null)}}`;
      await tx
        .update(ipoMergeLog)
        .set({
          restoreData: sql`${restoreJson}::jsonb` as unknown as Record<string, unknown>,
          survivorPatch: sql`jsonb_set(survivor_patch, '{patch}', ${appliedPatch}::jsonb || ${clearedOnly}::jsonb)` as unknown as Record<string, unknown>,
        })
        .where(eq(ipoMergeLog.id, logRow!.id));
      // Child-table repoint/delete and the dropped `ipos` row delete both already ran above
      // (DEFECT 2 fix) — before this patch loop, so a unique-constrained carried value never has
      // to coexist on both rows.

    });

    await this.invalidateCache(
      [getIPOByIdKey(keepId), getIPOBySlugKey(keep.slug), getIPOByIdKey(dropId), getIPOBySlugKey(drop.slug)],
      ['ipo:list:*', 'ipo:search:*']
    );

    return { ...plan, applied: true, keepSlug: keep.slug, droppedSlug: drop.slug, provenanceWritten, childOutcome, relaunchCleared };
  }

  /**
   * Item 19 / OD-92: undo one logged merge (spec §2.3.3.3 "`unmerge <merge-id>`: it restores both
   * rows from the log and re-points the slug redirect so the page that was redirected goes back to
   * its own row"). One transaction, parent before child: the removed `ipos` row, every row the
   * merge deleted (direct and cascaded) whole, every reference a SET NULL cascade cleared, the
   * person-created rows moved back by logged id, source keys an OD-86 relaunch superseded put back
   * whole, the survivor's provenance for the fields the merge carried, the survivor itself from
   * its pre-merge snapshot, the merge's redirect removed, and the log row marked unmerged.
   *
   * Refusals, all before any write:
   *   - the entry is already unmerged;
   *   - the removed row's id is live again;
   *   - the entry predates OD-92 and `partial` is not set (the message lists what is missing);
   *   - the survivor changed after the merge (drift) in a column `forceFields` does not name.
   *     Inferred, not spec-stated (recorded under OD-92): the spec says "restore", and silently
   *     overwriting a real post-merge change is worse than asking.
   * `apply: false` validates and reports without writing. Same production guard as the merge.
   */
  async unmergeDuplicate(
    mergeId: string,
    opts: { apply: boolean; allowProd?: boolean; partial?: boolean; forceFields?: string[]; unmergedBy?: string }
  ): Promise<UnmergeResult> {
    if (opts.apply) {
      const r = await this.db.execute(sql`select current_database()`);
      const name = String((r as unknown as { rows: { current_database: string }[] }).rows?.[0]?.current_database ?? '');
      if (name.toLowerCase() === 'ipodhan' && opts.allowProd !== true) {
        throw new ProdWriteRefusedError(
          `unmergeDuplicate: refusing to APPLY writes against the production database "ipodhan" — pass opts.allowProd: true to override.`,
          name
        );
      }
    }

    const declaredIpoColumns = getTableColumns(ipos);
    const result = await this.db.transaction(async (tx) => {
      const rows = <T>(r: unknown) => ((r as { rows?: T[] }).rows ?? []) as T[];
      const [log] = await tx.select().from(ipoMergeLog).where(eq(ipoMergeLog.id, mergeId)).for('update');
      if (!log) throw new DatabaseError(`unmergeDuplicate: no merge log entry ${mergeId}`, undefined);
      if (log.unmergedAt) {
        throw new DatabaseError(
          `unmergeDuplicate: merge ${mergeId} was already unmerged at ${log.unmergedAt.toISOString()} by ${log.unmergedBy ?? 'unknown'}`,
          undefined
        );
      }
      if (!log.keepIpoId) throw new DatabaseError(`unmergeDuplicate: the survivor of merge ${mergeId} no longer exists`, undefined);
      const keepId = log.keepIpoId;
      const dropId = log.dropIpoId;
      const missing = missingForUnmerge(log);
      if (missing.some((m) => m.startsWith('drop_row predates'))) {
        throw new DatabaseError(`unmergeDuplicate: not reversible: ${missing.join('; ')}`, undefined);
      }
      if (missing.length && !opts.partial) {
        throw new DatabaseError(
          `unmergeDuplicate: partly reversible: ${missing.join('; ')} — pass --partial to restore what the log holds`,
          undefined
        );
      }
      const live = rows<{ n: number }>(await tx.execute(sql`select count(*)::int as n from ipos where id = ${dropId}`))[0];
      if (live && live.n > 0) throw new DatabaseError(`unmergeDuplicate: ipos row ${dropId} exists again — refusing`, undefined);

      const sp = (log.survivorPatch ?? {}) as {
        patch?: CarryFieldPatch[];
        keepRowBefore?: Record<string, unknown>;
        fieldSourcesBefore?: { keep?: Record<string, unknown>[]; drop?: Record<string, unknown>[] };
      };
      const keepBefore = sp.keepRowBefore;
      if (!keepBefore) {
        throw new DatabaseError(`unmergeDuplicate: merge ${mergeId} has no survivor snapshot (pre-#900 log)`, undefined);
      }
      // OD-92 chain guard: `keepId` (log.keep_ipo_id) is repointed forward when the survivor of THIS
      // merge is itself later merged away (REPOINT_TABLES, #996's fix). If it no longer matches the
      // survivor id this entry's own before-snapshot recorded, step 7 below would write this entry's
      // (older) pre-merge values onto the WRONG row — the later survivor's row, not the one this merge
      // actually touched. Refuse and name the later merge to unmerge first (chain unwinds newest-first).
      const beforeId = String((keepBefore as { id?: unknown }).id ?? '');
      if (beforeId && beforeId !== keepId) {
        const laterMerge = rows<{ id: string }>(
          await tx.execute(sql`
            select id::text as id from ipo_merge_log
            where drop_ipo_id = ${beforeId} and unmerged_at is null
            order by merged_at desc limit 1
          `)
        )[0];
        throw new DatabaseError(
          `unmergeDuplicate: merge ${mergeId}'s survivor (${beforeId}) was itself merged away into ${keepId} by a later merge` +
            (laterMerge ? ` (${laterMerge.id})` : '') +
            ` — unmerge ${laterMerge ? laterMerge.id : 'that later merge'} first, then retry ${mergeId}`,
          undefined
        );
      }
      const rd = (log.restoreData ?? null) as null | {
        deletedRows: { table: string; rows: Record<string, unknown>[] }[];
        nulledRefs: NulledRef[];
        sourceKeysBefore: Record<string, unknown>[];
        supersededKeyIds: string[];
        keepRowAfter: Record<string, unknown> | null;
        redirectId: string | null;
        relaunchDelta?: { table: string; pk?: string[]; deleted: Record<string, unknown>[]; inserted: Record<string, unknown>[]; updated: { before: Record<string, unknown>; after: Record<string, unknown> }[] }[];
      };
      const patchFields = (sp.patch ?? []).map((p) => p.column);
      const fieldNames = patchFields.map(columnToCamelCase);

      const repointedEntries = (Array.isArray(log.repointedChildCounts) ? log.repointedChildCounts : []) as {
        table: string;
        col: string;
        repointedIds: string[];
        deletedOnConflictRows?: unknown[];
      }[];

      // Every logged value is read out of `ipo_merge_log` INSIDE the database (never round-tripped
      // through JS numbers), so a bigint above 2^53 or a numeric's scale comes back exactly.
      const logExpr = (path: ReturnType<typeof sql>) => sql`(select ${path} from ipo_merge_log where id = ${mergeId})`;
      const keepBeforeExpr = logExpr(sql`survivor_patch->'keepRowBefore'`);
      const keepAfterExpr = logExpr(sql`restore_data->'keepRowAfter'`);
      // #1298 round 2: the survivor's child rows the merge's relaunch clear changed (ipo-merge-restore.ts
      // beginChildRowCapture). Each part is read out of the log inside the database.
      const pkByTable = await readPrimaryKeys(tx);
      const deltaParts = (rd?.relaunchDelta ?? []).map((d, i) => {
        const pk = d.pk?.length ? d.pk : ['id'];
        const idOf = (row: Record<string, unknown>) => pk.map((c) => String(row[c])).join(',');
        return {
        table: d.table,
        pk,
        del: logExpr(sql`restore_data->'relaunchDelta'->${i}::int->'deleted'`),
        ins: logExpr(sql`restore_data->'relaunchDelta'->${i}::int->'inserted'`),
        upd: logExpr(sql`restore_data->'relaunchDelta'->${i}::int->'updated'`),
        forceable: [...d.inserted.map(idOf), ...d.updated.map((u) => idOf(u.after))].map((id) => `relaunch:${d.table}:${id}`),
        };
      });

      // --- drift, over the CARRIED columns only (OD-92) -----------------------------------------
      // The merge changed the survivor only in the carried columns (and updated_at). Every other
      // column keeps whatever a scraper wrote since; only a carried column that changed after the
      // merge is a conflict, and only a carried column can be forced.
      const forceableDelta = deltaParts.flatMap((d) => d.forceable);
      const badForce = (opts.forceFields ?? []).filter(
        (f) => !patchFields.includes(f) && !fieldNames.map((n) => `field_sources.${n}`).includes(f) && !forceableDelta.includes(f)
      );
      if (badForce.length) {
        throw new DatabaseError(
          `unmergeDuplicate: --force-fields names ${badForce.join(', ')}, which the merge did not carry ` +
            `(carried: ${patchFields.join(', ') || 'none'}); only a carried column is restored or forced`,
          undefined
        );
      }
      const lockedKeep = rows<{ n: number }>(
        await tx.execute(sql`select count(*)::int as n from (select 1 from ipos where id = ${keepId} for update) x`)
      )[0];
      if (!lockedKeep || lockedKeep.n === 0) throw new DatabaseError(`unmergeDuplicate: survivor ${keepId} not found`, undefined);
      const drift = patchFields.length
        ? rows<{ c: string }>(
            await tx.execute(
              rd?.keepRowAfter
                ? sql`select c from jsonb_array_elements_text(${JSON.stringify(patchFields)}::jsonb) c
                      where (select to_jsonb(i.*) -> c from ipos i where i.id = ${keepId}) is distinct from (${keepAfterExpr} -> c)`
                : // pre-OD-92 entry: no after-row; the carried value is the patch value, compared as text
                  sql`select p->>'column' as c from jsonb_array_elements(${logExpr(sql`survivor_patch->'patch'`)}) p
                      where (select to_jsonb(i.*) ->> (p->>'column') from ipos i where i.id = ${keepId})
                            is distinct from (p->>'value')`
            )
          ).map((r) => r.c)
        : [];
      const fsDrift = fieldNames.length
        ? rows<{ field_name: string }>(
            await tx.execute(sql`
              select field_name from field_sources
              where ipo_id = ${keepId} and table_name = 'ipos' and row_key = ''
                and field_name = any(array(select jsonb_array_elements_text(${JSON.stringify(fieldNames)}::jsonb)))
                and updated_by is distinct from 'merge-duplicate-ipo'
            `)
          ).map((r) => `field_sources.${r.field_name}`)
        : [];
      // A row the relaunch clear created or changed must still be as the merge left it; a row it
      // deleted must still be absent (a live row under that id is a collision, never forceable).
      const deltaDrift: string[] = [];
      for (const d of deltaParts) {
        const t = sql.identifier(d.table);
        const changed = rows<{ id: string }>(
          await tx.execute(sql`
            select ${pkIdentitySql(sql`e`, d.pk)} as id from jsonb_array_elements(${d.ins}) e,
              lateral jsonb_populate_record(null::${t}, e) r
            where (select to_jsonb(t.*) from ${t} t where ${pkMatchSql(sql`t`, sql`r`, d.pk)}) is distinct from e
            union all
            select ${pkIdentitySql(sql`(e->'after')`, d.pk)} from jsonb_array_elements(${d.upd}) e,
              lateral jsonb_populate_record(null::${t}, e->'after') r
            where (select to_jsonb(t.*) from ${t} t where ${pkMatchSql(sql`t`, sql`r`, d.pk)}) is distinct from e->'after'
          `)
        );
        deltaDrift.push(...changed.map((r) => `relaunch:${d.table}:${r.id}`));
      }
      const allDrift = [...drift, ...fsDrift, ...deltaDrift];
      const unforced = allDrift.filter((d) => !(opts.forceFields ?? []).includes(d));
      if (unforced.length) {
        throw new DatabaseError(
          `unmergeDuplicate: carried column(s) changed after the merge: ${unforced.join(', ')} — restoring would ` +
            `overwrite that; name them in --force-fields to overwrite, or leave the merge in place`,
          undefined
        );
      }

      // --- unique collisions, before any write (OD-92) ------------------------------------------
      // A row restored under a unique key the survivor (or anyone) now holds would fail mid-way with
      // a raw 23505. Every unique index is read from the catalog and every restored row is checked
      // against it first; each clash is named and nothing is written.
      const restoreSets: { table: string; rowsExpr: ReturnType<typeof sql> }[] = [
        { table: 'ipos', rowsExpr: sql`jsonb_build_array(${logExpr(sql`drop_row`)})` },
        ...(rd?.deletedRows ?? []).map((t, i) => ({
          table: t.table,
          rowsExpr: logExpr(sql`restore_data->'deletedRows'->${i}::int->'rows'`),
        })),
        ...repointedEntries.map((r, i) => ({
          table: r.table,
          rowsExpr: logExpr(sql`coalesce(repointed_child_counts->${i}::int->'deletedOnConflictRows', '[]'::jsonb)`),
        })),
        {
          table: 'ipo_source_keys',
          rowsExpr: sql`(select coalesce(jsonb_agg(e), '[]'::jsonb) from jsonb_array_elements(${logExpr(
            sql`coalesce(restore_data->'sourceKeysBefore', '[]'::jsonb)`
          )}) e where e->>'id' = any(array(select jsonb_array_elements_text(${JSON.stringify(rd?.supersededKeyIds ?? [])}::jsonb))))`,
        },
      ];
      for (const d of deltaParts) restoreSets.push({ table: d.table, rowsExpr: d.del });
      const collisions: string[] = [];
      for (const d of deltaParts) {
        const back = rows<{ id: string }>(
          await tx.execute(sql`
            select ${pkIdentitySql(sql`e`, d.pk)} as id from jsonb_array_elements(${d.del}) e,
              lateral jsonb_populate_record(null::${sql.identifier(d.table)}, e) r
            where exists (select 1 from ${sql.identifier(d.table)} t where ${pkMatchSql(sql`t`, sql`r`, d.pk)})
          `)
        );
        for (const b of back) collisions.push(`refused: ${d.table} row ${b.id}, deleted by the merge's relaunch clear, exists again`);
      }
      for (const set of restoreSets) {
        const uniques = rows<{ name: string; cols: string[] | string; complex: boolean; nulls_not_distinct: boolean }>(
          await tx.execute(sql`
            select i.indexrelid::regclass::text as name,
                   (i.indexprs is not null or i.indpred is not null) as complex,
                   coalesce(i.indnullsnotdistinct, false) as nulls_not_distinct,
                   array(select a.attname::text from unnest(i.indkey) with ordinality k(attnum, ord)
                         join pg_attribute a on a.attrelid = i.indrelid and a.attnum = k.attnum order by k.ord) as cols
            from pg_index i
            where i.indrelid = to_regclass(${`public.${set.table}`}) and i.indisunique and not i.indisprimary
          `)
        );
        for (const u of uniques) {
          const refusal = uncheckableUniqueIndexRefusal({
            table: set.table,
            name: u.name,
            complex: u.complex,
            nullsNotDistinct: u.nulls_not_distinct,
          });
          if (refusal) {
            collisions.push(refusal);
            continue;
          }
          const cols = Array.isArray(u.cols) ? u.cols : String(u.cols).replace(/^{|}$/g, '').split(',').filter(Boolean);
          if (!cols.length) continue;
          const match = sql.join(
            cols.map((c) => sql`t.${sql.identifier(c)} = r.${sql.identifier(c)}`),
            sql` and `
          );
          const setPk = pkByTable.get(set.table) ?? ['id'];
          const clash = rows<{ id: string }>(
            await tx.execute(sql`
              select distinct ${pkIdentitySql(sql`to_jsonb(t.*)`, setPk)} as id
              from jsonb_populate_recordset(null::${sql.identifier(set.table)}, ${set.rowsExpr}) r
              join ${sql.identifier(set.table)} t on ${match}
              where ${pkIdentitySql(sql`to_jsonb(t.*)`, setPk)} is distinct from ${pkIdentitySql(sql`to_jsonb(r.*)`, setPk)}
            `)
          );
          for (const c of clash) collisions.push(`refused: ${set.table} ${u.name} collides with survivor row ${c.id}`);
        }
      }
      if (collisions.length) {
        throw new DatabaseError(
          `unmergeDuplicate: nothing written — restoring would break a unique key:\n${collisions.join('\n')}\n` +
            `Resolve or remove the named rows, then re-run the unmerge.`,
          undefined
        );
      }

      const out: UnmergeResult = {
        mergeId,
        keepId,
        dropId,
        keepSlug: String(keepBefore.slug ?? log.keepSlug),
        dropSlug: log.dropSlug,
        keepStatus: String(keepBefore.status ?? ''),
        dropStatus: String((log.dropRow as Record<string, unknown>).status ?? ''),
        partial: missing.length > 0,
        missing,
        drift: allDrift,
        restoredRows: (rd?.deletedRows ?? []).map((t) => ({ table: t.table, count: t.rows.length })),
        repointedBack: [],
        applied: false,
      };
      if (!opts.apply) return out;

      // `ipos` is written only through the query builder (write ratchet, OD-49); each value is read
      // out of the logged row server-side.
      const fromLogged = (rowExpr: ReturnType<typeof sql>, only: ((name: string) => boolean) | null) =>
        Object.fromEntries(
          Object.entries(declaredIpoColumns)
            .filter(([, c]) => (only ? only(c.name) : true))
            .map(([k, c]) => [k, sql`(jsonb_populate_record(null::ipos, ${rowExpr})).${sql.identifier(c.name)}`])
        );
      // Read back what was restored, compared inside the database: the columns of `rowExpr` named by
      // `cols` (all of them when null) must equal the live row, or the transaction rolls back.
      const exactOrThrow = async (id: string, rowExpr: ReturnType<typeof sql>, cols: string[] | null, what: string) => {
        const off = rows<{ k: string }>(
          await tx.execute(sql`
            select l.k from jsonb_each(${rowExpr}) l(k, v)
            where (${cols === null} or l.k = any(array(select jsonb_array_elements_text(${JSON.stringify(cols ?? [])}::jsonb))))
              and l.v is distinct from (select to_jsonb(i.*) -> l.k from ipos i where i.id = ${id})
          `)
        ).map((r) => r.k);
        if (off.length) {
          throw new DatabaseError(`unmergeDuplicate: ${what} did not restore exactly in ${off.join(', ')} — rolled back`, undefined);
        }
      };

      // 1. the removed ipos row, under its original id, read back whole
      await tx.insert(ipos).values(fromLogged(logExpr(sql`drop_row`), null) as never);
      await exactOrThrow(dropId, logExpr(sql`drop_row`), null, 'the removed ipos row');
      // 2. every deleted row, parent tables first (the order the log was written in)
      for (const [i, t] of (rd?.deletedRows ?? []).entries()) {
        await tx.execute(sql`
          insert into ${sql.identifier(t.table)}
          select * from jsonb_populate_recordset(null::${sql.identifier(t.table)}, ${logExpr(sql`restore_data->'deletedRows'->${i}::int->'rows'`)})
        `);
      }
      // A pre-OD-92 entry (--partial): the dropped side's provenance is the one child set logged whole.
      if (!rd && sp.fieldSourcesBefore?.drop?.length) {
        await tx.execute(sql`
          insert into field_sources
          select * from jsonb_populate_recordset(null::field_sources, ${logExpr(sql`survivor_patch->'fieldSourcesBefore'->'drop'`)})
        `);
      }
      // 3. references a SET NULL cascade cleared
      for (const n of rd?.nulledRefs ?? []) {
        await tx.execute(sql`
          update ${sql.identifier(n.table)} t set ${sql.identifier(n.col)} = ${n.value}
          where (to_jsonb(t.*) ->> 'id') = ${n.id} and t.${sql.identifier(n.col)} is null
        `);
      }
      // 4. person-created rows back to the dropped IPO; conflict-deleted twins re-inserted
      for (const [i, r] of repointedEntries.entries()) {
        const moved = rows<{ id: string }>(
          await tx.execute(sql`
            update ${sql.identifier(r.table)} t set ${sql.identifier(r.col)} = ${dropId}
            where (to_jsonb(t.*) ->> 'id') = any(array(select jsonb_array_elements_text(${JSON.stringify(r.repointedIds)}::jsonb)))
              and t.${sql.identifier(r.col)} = ${keepId}
            returning to_jsonb(t.*) ->> 'id' as id
          `)
        );
        if (r.deletedOnConflictRows?.length) {
          await tx.execute(sql`
            insert into ${sql.identifier(r.table)}
            select * from jsonb_populate_recordset(null::${sql.identifier(r.table)},
              ${logExpr(sql`repointed_child_counts->${i}::int->'deletedOnConflictRows'`)})
          `);
        }
        out.repointedBack.push({ table: r.table, count: moved.length, logged: r.repointedIds.length });
      }
      // 5. source keys an OD-86 relaunch merge superseded, put back whole
      if ((rd?.supersededKeyIds ?? []).length) {
        const keyCols = rows<{ c: string }>(
          await tx.execute(sql`
            select column_name::text as c from information_schema.columns
            where table_schema = 'public' and table_name = 'ipo_source_keys' and column_name <> 'id'
            order by ordinal_position
          `)
        ).map((r) => r.c);
        for (const id of rd!.supersededKeyIds) {
          await tx.execute(sql`
            update ipo_source_keys set (${sql.join(keyCols.map((c) => sql.identifier(c)), sql`, `)}) =
              (select ${sql.join(keyCols.map((c) => sql`r.${sql.identifier(c)}`), sql`, `)}
               from jsonb_populate_record(null::ipo_source_keys,
                 (select e from jsonb_array_elements(${logExpr(sql`restore_data->'sourceKeysBefore'`)}) e where e->>'id' = ${id})) r)
            where id = ${id}
          `);
        }
      }
      // 5b. the survivor's child rows as they stood before the merge's relaunch clear (§2.9, #1298):
      //     rows it created removed, rows it changed put back, rows it deleted re-inserted whole (holds,
      //     provenance, list rows, audit marks, plan and document-fetch state), then read back exactly.
      for (const d of deltaParts) {
        const t = sql.identifier(d.table);
        await tx.execute(sql`
          delete from ${t} t using jsonb_array_elements(${d.ins}) e, lateral jsonb_populate_record(null::${t}, e) r
          where ${pkMatchSql(sql`t`, sql`r`, d.pk)}
        `);
        const cols = rows<{ c: string }>(
          await tx.execute(sql`
            select column_name::text as c from information_schema.columns
            where table_schema = 'public' and table_name = ${d.table}
            order by ordinal_position
          `)
        ).map((r) => r.c).filter((c) => !d.pk.includes(c));
        if (cols.length) {
          await tx.execute(sql`
            update ${t} t set (${sql.join(cols.map((c) => sql.identifier(c)), sql`, `)}) =
              (select ${sql.join(cols.map((c) => sql`r.${sql.identifier(c)}`), sql`, `)}
               from jsonb_populate_record(null::${t}, e->'before') r)
            from jsonb_array_elements(${d.upd}) e, lateral jsonb_populate_record(null::${t}, e->'before') k
            where ${pkMatchSql(sql`t`, sql`k`, d.pk)}
          `);
        }
        await tx.execute(sql`insert into ${t} select * from jsonb_populate_recordset(null::${t}, ${d.del})`);
        const off = rows<{ id: string }>(
          await tx.execute(sql`
            select ${pkIdentitySql(sql`s.x`, d.pk)} as id
            from (select e as x from jsonb_array_elements(${d.del}) e
                  union all select e->'before' from jsonb_array_elements(${d.upd}) e) s,
              lateral jsonb_populate_record(null::${t}, s.x) r
            where (select to_jsonb(t.*) from ${t} t where ${pkMatchSql(sql`t`, sql`r`, d.pk)}) is distinct from s.x
          `)
        ).map((r) => r.id);
        if (off.length) {
          throw new DatabaseError(
            `unmergeDuplicate: ${d.table} rows changed by the relaunch clear did not restore exactly (${off.join(', ')}) — rolled back`,
            undefined
          );
        }
      }
      // 6. the carried fields' provenance on the survivor, as it stood before the merge; provenance
      //    for fields the merge did not carry is left alone
      if (fieldNames.length) {
        const names = JSON.stringify(fieldNames);
        await tx.execute(sql`
          delete from field_sources where ipo_id = ${keepId} and table_name = 'ipos' and row_key = ''
            and field_name = any(array(select jsonb_array_elements_text(${names}::jsonb)))
        `);
        await tx.execute(sql`
          insert into field_sources
          select (jsonb_populate_record(null::field_sources, e)).*
          from jsonb_array_elements(${logExpr(sql`coalesce(survivor_patch->'fieldSourcesBefore'->'keep', '[]'::jsonb)`)}) e
          where e->>'table_name' = 'ipos' and coalesce(e->>'row_key', '') = ''
            and e->>'field_name' = any(array(select jsonb_array_elements_text(${names}::jsonb)))
        `);
      }
      // 7. the survivor: ONLY the carried columns go back to their pre-merge values. updated_at goes
      //    back too only when nothing wrote the row since the merge; otherwise the newer stamp stays.
      const untouchedSinceMerge = rd?.keepRowAfter
        ? rows<{ same: boolean }>(
            await tx.execute(sql`
              select (select to_jsonb(i.*) from ipos i where i.id = ${keepId}) = ${keepAfterExpr} as same
            `)
          )[0]?.same === true
        : false;
      const restoreCols = [...patchFields, ...(untouchedSinceMerge ? ['updated_at'] : [])];
      if (restoreCols.length) {
        await tx
          .update(ipos)
          .set(fromLogged(keepBeforeExpr, (n) => restoreCols.includes(n)) as never)
          .where(eq(ipos.id, keepId));
        await exactOrThrow(keepId, keepBeforeExpr, restoreCols, 'the survivor');
      }
      // 8. the merge's redirect goes, so the dropped slug serves its own row again
      if (rd?.redirectId) {
        await tx.delete(ipoSlugRedirects).where(eq(ipoSlugRedirects.id, rd.redirectId));
      } else if (!rd) {
        await tx
          .delete(ipoSlugRedirects)
          .where(
            and(
              eq(ipoSlugRedirects.oldSlug, log.dropSlug),
              eq(ipoSlugRedirects.ipoId, keepId),
              eq(ipoSlugRedirects.reason, 'DUPLICATE_MERGE')
            )
          );
      }
      // 9. mark the entry so it cannot be unmerged twice
      await tx
        .update(ipoMergeLog)
        .set({ unmergedAt: sql`now()` as unknown as Date, unmergedBy: opts.unmergedBy || 'unknown' })
        .where(eq(ipoMergeLog.id, mergeId));
      out.applied = true;
      return out;
    });

    if (result.applied) {
      await this.invalidateCache(
        [getIPOByIdKey(result.keepId), getIPOBySlugKey(result.keepSlug), getIPOByIdKey(result.dropId), getIPOBySlugKey(result.dropSlug)],
        ['ipo:list:*', 'ipo:search:*', `ipo:detail:${result.keepSlug}`, `ipo:detail:${result.dropSlug}`]
      );
    }
    return result;
  }

  /**
   * #900: the SQL condition, over a dropped-side row aliased `d`, that is true exactly when moving
   * `d` onto the survivor would violate a unique key — i.e. the survivor already holds a row with
   * the same values in every OTHER column of a unique key that includes the IPO column.
   *
   * Read from the live catalog (pg_index), never hand-listed: `user_watchlist`'s
   * UNIQUE (user_id, ipo_id) exists on production but not in schema.ts, which is precisely how a
   * hand-kept list would miss it. Mirrors Postgres's own NULL rule: under the default NULLS
   * DISTINCT, a NULL never conflicts, so plain `=` is exact; under NULLS NOT DISTINCT it uses
   * IS NOT DISTINCT FROM. Returns null when no such key exists (nothing can conflict).
   *
   * A unique index with an expression or a WHERE clause on a REPOINT table is refused rather than
   * approximated: guessing its conflict rule wrong either deletes a row that should have moved or
   * aborts every merge, and neither should happen silently.
   */
  private async buildRepointConflictPredicate(
    tx: { execute: (q: ReturnType<typeof sql>) => Promise<unknown> },
    table: string,
    col: string,
    keepId: string
  ): Promise<ReturnType<typeof sql> | null> {
    const idxResult = await tx.execute(sql`
      select i.indexrelid::regclass::text as name,
             (i.indexprs is not null or i.indpred is not null) as complex,
             coalesce(i.indnullsnotdistinct, false) as nulls_not_distinct,
             array(
               select a.attname::text
               from unnest(i.indkey) with ordinality as k(attnum, ord)
               join pg_attribute a on a.attrelid = i.indrelid and a.attnum = k.attnum
               order by k.ord
             ) as cols
      from pg_index i
      where i.indrelid = to_regclass(${`public.${table}`}) and i.indisunique
    `);
    const indexes =
      (
        idxResult as unknown as {
          rows: { name: string; complex: boolean; nulls_not_distinct: boolean; cols: string[] | string }[];
        }
      ).rows ?? [];

    const clauses: ReturnType<typeof sql>[] = [];
    for (const idx of indexes) {
      // node-postgres returns name[] as a JS array; a text[] literal is tolerated defensively.
      const cols = Array.isArray(idx.cols) ? idx.cols : String(idx.cols).replace(/^{|}$/g, '').split(',').filter(Boolean);
      if (idx.complex) {
        throw new DatabaseError(
          `mergeDuplicateInto: ${table} has unique index ${idx.name} with an expression or predicate — ` +
            `the merge cannot tell which rows would conflict, refusing`,
          undefined
        );
      }
      if (!cols.includes(col)) continue;
      const others = cols.filter((c) => c !== col);
      const match = others.map((c) =>
        idx.nulls_not_distinct
          ? sql`s.${sql.identifier(c)} is not distinct from d.${sql.identifier(c)}`
          : sql`s.${sql.identifier(c)} = d.${sql.identifier(c)}`
      );
      const where = [sql`s.${sql.identifier(col)} = ${keepId}`, ...match];
      clauses.push(sql`exists (select 1 from ${sql.identifier(table)} s where ${sql.join(where, sql` and `)})`);
    }
    return clauses.length === 0 ? null : sql.join(clauses, sql` or `);
  }

  /**
   * Find peer IPOs in the same sector with financial data
   * Used for peer comparison on IPO detail page
   */
  async findPeers(
    ipoId: string,
    sector: string | null,
    limit = 8
  ): Promise<Array<IPO & { financialData: FinancialData | null }>> {
    try {
      // If no sector specified, return empty array
      if (!sector) {
        return [];
      }

      // Query IPOs in the same sector, excluding the current IPO
      const peerIpos = await this.db
        .select()
        .from(ipos)
        .where(and(eq(ipos.sector, sector), sql`${ipos.id} != ${ipoId}`))
        .limit(limit);

      // Fetch financial data for each peer IPO
      const peersWithFinancials = await Promise.all(
        peerIpos.map(async (peer) => {
          const [financial] = await this.db
            .select()
            .from(financialData)
            .where(eq(financialData.ipoId, peer.id))
            .limit(1);

          return {
            ...peer,
            financialData: financial || null,
          };
        })
      );

      return peersWithFinancials;
    } catch (error) {
      throw new DatabaseError(
        `Failed to fetch peer IPOs for sector: ${sector}`,
        undefined,
        error
      );
    }
  }

  /**
   * Update IPO rating and rationale
   * Used by the rating calculation script to store calculated ratings
   *
   * @param ipoId - IPO ID
   * @param rating - Calculated rating (1-5 stars, 0.5 increments)
   * @param rationale - Human-readable explanation of the rating
   */
  /**
   * Update ONLY the two document-source hint columns (T-403 H-1/W-1).
   *
   * A narrow sibling of `update()` for a reason that is not cosmetic: `update()`
   * ends in a bare `.returning()`, which asks Postgres for every column
   * `schema.ts` declares. A database built purely from the migration journal has
   * 32 of those 55 (measured — evidence/T-403/journal-schema-drift.json), so a
   * two-column patch fails there on columns it never touched. This selects the
   * two columns it writes and returns the id, which works on any environment
   * and is what lets the acceptance harness exercise the REAL write path
   * instead of a raw-SQL stand-in.
   *
   * Returns null when no row matched, rather than throwing: this is bookkeeping
   * on the side of a scrape, and a missing IPO must not fail a cycle.
   */
  async updateDocumentSourceHints(
    ipoId: string,
    hints: { companyWebsite?: string; verifierUrl?: string }
  ): Promise<{ id: string; slug: string } | null> {
    const patch: Partial<IPOInsert> = {};
    if (hints.companyWebsite !== undefined) patch.companyWebsite = hints.companyWebsite;
    if (hints.verifierUrl !== undefined) patch.verifierUrl = hints.verifierUrl;

    // §9.2 item 19: an admin-held website / verifier URL is never replaced by a discovered hint.
    let row: IPO;
    try {
      row = (await this.updateHonouringProtection(ipoId, patch, 'updateDocumentSourceHints')).ipo;
    } catch (error) {
      if (error instanceof EntityNotFoundError) return null;
      throw error;
    }
    await this.invalidateCache([], [`ipo:detail:${row.slug}`]);
    return { id: row.id, slug: row.slug };
  }

  /**
   * Public cache-invalidation entry point (T-513 / #419) for write paths that
   * persist an `ipos` row through their own transaction — e.g. a raw
   * drizzle write that needs an in-transaction SQL WHERE write-once guard
   * this repository's own `update()` cannot express — but still owe the same
   * cache contract every other `ipos` write gets. Callers MUST invoke this
   * AFTER their transaction commits, never from inside it: a rolled-back
   * transaction must not drop a still-valid cache entry. `invalidateCache`
   * already swallows Redis errors internally (`deleteCache`/
   * `deleteCachePattern` catch-and-log) so a cache-layer failure here can
   * never fail the caller's write.
   */
  async invalidateIpoCache(id: string, slug: string): Promise<void> {
    await this.invalidateCache(
      [getIPOByIdKey(id), getIPOBySlugKey(slug)],
      ['ipo:list:*', 'ipo:search:*']
    );
  }

  async updateRating(
    ipoId: string,
    rating: number | null,
    rationale: string
  ): Promise<IPO> {
    try {
      // §9.2 item 19: an admin-held rating / rationale is never replaced by a computed one.
      const { ipo } = await this.updateHonouringProtection(ipoId, { rating, ratingRationale: rationale }, 'updateRating');
      await this.invalidateCache([], [`ipo:detail:${ipo.slug}`]);

      return ipo;
    } catch (error) {
      if (error instanceof EntityNotFoundError) {
        throw error;
      }
      throw new DatabaseError(
        `Failed to update rating for IPO: ${ipoId}`,
        undefined,
        error
      );
    }
  }

  /**
   * Find historical IPOs with filtering, sorting, and computed fields
   * Used for /api/ipos/history endpoint (Story 6.1)
   *
   * Filters:
   * - status: LISTED (fixed)
   * - listing_date: NOT NULL (fixed)
   * - year: Extracted from listing_date (2020-2025, All)
   * - sector: Optional sector filter
   * - performance: Positive/Negative/All based on listing gain
   *
   * Computed fields:
   * - listingGainPercent: ((listing_close - issue_price) / issue_price) * 100
   * - year: EXTRACT(YEAR FROM listing_date)
   *
   * Sorting:
   * - listing_date: Sort by listing date
   * - listing_gain: Sort by listing gain percentage
   * - subscription: Sort by total subscription (requires join)
   */
  async findHistorical(
    filters: HistoricalIPOQueryParams
  ): Promise<PaginatedResponse<HistoricalIPO>> {
    const {
      year,
      sector,
      performance,
      sort = 'listing_date',
      sortOrder = 'desc',
      page = 1,
      limit = 20,
    } = filters;

    const cacheKey = getHistoricalIPOsKey(filters);

    return this.getFromCache(
      cacheKey,
      async () => {
        try {
          // Build base conditions: status='LISTED' AND listing_date IS NOT NULL
          // AND offering_type='IPO' (T-277F checker finding #3). A row
          // reclassified to a non-IPO offering type (e.g. INVITS/REITS via
          // the NON_IPO_TRUST_SHAPE guard) still has segment='MAINBOARD' and
          // status='LISTED' — without this filter it stayed ranked on the
          // historical/tracker query even after reclassification (Cube
          // Highways Trust rendering on the Mainboard Performance Tracker).
          const conditions = [
            eq(ipos.status, 'LISTED'),
            eq(ipos.offeringType, 'IPO'),
            sql`${ipos.listingDate} IS NOT NULL`,
          ];

          // Add year filter (extract year from listing_date)
          if (year && year !== 'All') {
            const yearNum = parseInt(year, 10);
            conditions.push(
              sql`EXTRACT(YEAR FROM ${ipos.listingDate}) = ${yearNum}`
            );
          }

          // Add sector filter
          if (sector) {
            conditions.push(eq(ipos.sector, sector));
          }

          const whereClause = and(...conditions);

          // Get total count
          const [{ count }] = await this.db
            .select({ count: sql<number>`count(*)::int` })
            .from(ipos)
            .leftJoin(
              listingPerformance,
              eq(ipos.id, listingPerformance.ipoId)
            )
            .where(whereClause);

          // Build the query with computed fields
          const offset = (page - 1) * limit;

          // Determine sort column
          let orderByClause;
          if (sort === 'listing_date') {
            orderByClause =
              sortOrder === 'asc'
                ? asc(ipos.listingDate)
                : desc(ipos.listingDate);
          } else if (sort === 'listing_gain') {
            // Sort by computed listing_gain_percent
            orderByClause =
              sortOrder === 'asc'
                ? asc(listingPerformance.listingGainPercent)
                : desc(listingPerformance.listingGainPercent);
          } else if (sort === 'subscription') {
            // Sort by max total subscription
            // This requires a subquery to get the latest subscription
            orderByClause =
              sortOrder === 'asc'
                ? sql`(SELECT MAX(total_subscription) FROM subscriptions WHERE ipo_id = ${ipos.id}) ASC NULLS LAST`
                : sql`(SELECT MAX(total_subscription) FROM subscriptions WHERE ipo_id = ${ipos.id}) DESC NULLS LAST`;
          } else {
            // Default to listing_date desc
            orderByClause = desc(ipos.listingDate);
          }

          // Fetch data with joins
          const results = await this.db
            .select({
              ipo: ipos,
              listingClose: listingPerformance.listingPrice,
              issuePrice: listingPerformance.issuePrice,
              listingGainPercent: listingPerformance.listingGainPercent,
              subscription: sql<number | null>`(SELECT MAX(total_subscription) FROM subscriptions WHERE ipo_id = ${ipos.id})`,
            })
            .from(ipos)
            .leftJoin(
              listingPerformance,
              eq(ipos.id, listingPerformance.ipoId)
            )
            .where(whereClause)
            .orderBy(orderByClause)
            .limit(limit)
            .offset(offset);

          // Transform results to include computed year and filter by performance
          let data = results.map((row) => {
            const year = row.ipo.listingDate
              ? new Date(row.ipo.listingDate).getFullYear()
              : 0;

            return {
              ...row.ipo,
              listingClose: row.listingClose,
              issuePrice: row.issuePrice,
              listingGainPercent: row.listingGainPercent
                ? Number(row.listingGainPercent)
                : null,
              subscription: row.subscription ? Number(row.subscription) : null,
              year,
            };
          });

          // Apply performance filter after fetching (since it depends on computed field)
          if (performance && performance !== 'All') {
            data = data.filter((ipo) => {
              if (performance === 'Positive') {
                return (
                  ipo.listingGainPercent !== null && ipo.listingGainPercent > 0
                );
              } else if (performance === 'Negative') {
                return (
                  ipo.listingGainPercent !== null && ipo.listingGainPercent < 0
                );
              }
              return true;
            });
          }

          const totalPages = Math.ceil(count / limit);

          return {
            data,
            meta: {
              total: count,
              page,
              limit,
              totalPages,
              hasNext: page < totalPages,
              hasPrev: page > 1,
            },
          };
        } catch (error) {
          throw new DatabaseError(
            'Failed to fetch historical IPO list',
            undefined,
            error
          );
        }
      },
      CacheTTL.HISTORICAL_IPOS
    );
  }
}

/**
 * §9.2 item 23 (OD-116, OD-118, OD-150): the one writer of `ipos.hidden_*` (admin hide / unhide),
 * kept on the shared write path (config/write-ratchet-baseline.json). `state` null unhides. The
 * WHERE makes it idempotent against a concurrent hide/unhide: returns true only when this call
 * changed the row.
 */
export async function writeIpoHiddenState(
  tx: Pick<NodePgDatabase<typeof schema>, 'update'>,
  ipoId: string,
  state: { hiddenAt: Date; hiddenReason: string; hiddenBy: string; hiddenByAdminId: string | null } | null
): Promise<boolean> {
  const updated = await tx
    .update(ipos)
    .set(state ?? { hiddenAt: null, hiddenReason: null, hiddenBy: null, hiddenByAdminId: null })
    .where(and(eq(ipos.id, ipoId), state ? sql`${ipos.hiddenAt} IS NULL` : sql`${ipos.hiddenAt} IS NOT NULL`))
    .returning({ id: ipos.id });
  return updated.length === 1;
}

/**
 * #1304 M1: the one writer of `ipos.postponed_at` outside the status-write trigger, used by the
 * backfill for IPOs POSTPONED before the column existed. Kept on the shared write path
 * (config/write-ratchet-baseline.json). It writes the PLANNED value (so the ledger records exactly
 * what was written) and re-checks every condition in each UPDATE, all in one transaction: still POSTPONED, still NULL, and
 * the status provenance row (field_sources, ipos.status) still holds the planned updated_at. A row
 * that changed since the plan is skipped, not forced. Never writes `status`, so the stamping trigger
 * does not fire. Returns the ids actually written.
 */
export async function writeIpoPostponedAtBackfill(
  db: Pick<NodePgDatabase<typeof schema>, 'transaction'>,
  fill: ReadonlyArray<{ ipoId: string; evidenceAt: string }>
): Promise<string[]> {
  if (fill.length === 0) return [];
  return db.transaction(async (tx) => {
    const written: string[] = [];
    for (const r of fill) {
      const at = sql`${r.evidenceAt}::timestamp`;
      const updated = await tx
        .update(ipos)
        .set({ postponedAt: at as never })
        .where(
          and(
            eq(ipos.id, r.ipoId),
            eq(ipos.status, 'POSTPONED'),
            sql`${ipos.postponedAt} IS NULL`,
            sql`EXISTS (SELECT 1 FROM field_sources fs WHERE fs.ipo_id = ${ipos.id} AND fs.table_name = 'ipos'
                  AND fs.row_key = '' AND fs.field_name = 'status' AND fs.updated_at = ${at})`
          )
        )
        .returning({ id: ipos.id });
      if (updated.length === 1) written.push(String(updated[0].id));
    }
    return written;
  });
}
