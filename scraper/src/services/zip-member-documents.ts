/**
 * Item 22 (OD-36, F-154; failure class container-unwrapped-to-one-member):
 * store every typed member of an offer-document zip as its own document row.
 *
 * ONE path, two callers: the discovery runner (a zip fetched now) and
 * `scripts/repair-zip-member-documents.ts` (zips stored before this change).
 * The repair tool must never carry its own copy of these rules.
 *
 * Rules, per member other than the one stored as the wanted document:
 *  - `gid`, `unclassified`, `too_small`, `too_large`: not stored, reported.
 *  - typed as the SAME type as the main document: a volume split, not stored
 *    (0 of 41 measured zips are volume splits), reported.
 *  - same sha256 as a document of THIS IPO already stored, in this run or any
 *    earlier one (OD-33): no second row. The DB is asked, not only an
 *    in-memory map, because the same bytes arrive from different places on
 *    different days (Skyways' price-band advertisement came from BSE and from
 *    NSE's RATIOS zip; a company-site PDF can equal a zip member).
 *  - otherwise stored, keyed by a STABLE member identity:
 *    `<zip url>#member=<url-encoded member path>`. Never by position: the
 *    exchange inserts members ahead of the offer document (HTEL's RHP is
 *    part 5), so a position key would let a re-fetch write one member's bytes
 *    onto another member's row. `part_number` still records the position at
 *    fetch time, for citations.
 */
import type {
  DocumentFetchStateValue,
  FetchAttempt,
  IDocumentFetchStateStore,
} from '@ipodhan/shared/repositories/document-fetch-state-repository';
import type { DocumentSink } from './document-discovery-runner.js';
import type { ZipMemberReport } from './document-download-verifier.js';
import type { DocumentType } from './document-types.js';
import { applyOutcome, toPersistedState, type StateRow } from './document-state-machine.js';
import { storeDocument, getStoreDir } from './document-store.js';
import { resolveAdmissionExtractionStatus } from '../config/document-admission-status.js';

const MEMBER_FRAGMENT = '#member=';

/**
 * The `documents.url` of one zip member. A fragment never reaches the server
 * (RFC 3986 §3.5), so fetching this URL still returns the zip; it only names
 * which member the row is. `documents.url` is globally unique and the bare zip
 * URL already belongs to the main document.
 */
export function zipMemberUrl(zipUrl: string, memberName: string): string {
  return `${zipUrl.split('#')[0]}${MEMBER_FRAGMENT}${encodeURIComponent(memberName)}`;
}

/** The member path a `#member=` URL names, or null for any other URL. */
export function memberNameFromUrl(url: string): string | null {
  const at = url.indexOf(MEMBER_FRAGMENT);
  if (at < 0) return null;
  try {
    return decodeURIComponent(url.slice(at + MEMBER_FRAGMENT.length));
  } catch {
    return null;
  }
}

export type ZipMemberAction = 'stored' | 'would_store' | 'duplicate' | 'skipped';

export interface ZipMemberOutcome {
  member: string;
  position: number;
  bytes: number;
  sha256: string;
  action: ZipMemberAction;
  /** Why, in the words the attempt log and the repair ledger print. */
  reason: string;
  type?: DocumentType;
  typedBy?: 'name' | 'folder';
  /** The row that holds these bytes (stored now, or found by sha256). */
  documentId?: string;
  url?: string;
  /**
   * Set when this member means the IPO now HAS a document of this type: stored
   * now, or its bytes are already stored under the same type. The caller marks
   * that type FOUND in `document_fetch_state`.
   */
  suppliesType?: DocumentType;
}

export interface ZipMemberInput {
  ipoId: string;
  zipUrl: string;
  /** The main document's title; a member's title is `<zipTitle> | <file name>`. */
  zipTitle: string;
  exchange: string;
  mainType: DocumentType;
  members: readonly ZipMemberReport[];
  /** Report what would be stored; write nothing (the repair tool's default). */
  dryRun?: boolean;
}

export type SeenBySha = Map<string, { documentId: string; docType: DocumentType }>;

export async function storeZipMemberDocuments(
  deps: { documents: DocumentSink; storeDir?: string },
  input: ZipMemberInput,
  seenBySha: SeenBySha = new Map()
): Promise<ZipMemberOutcome[]> {
  const outcomes: ZipMemberOutcome[] = [];
  for (const m of input.members) {
    const base = { member: m.name, position: m.position, bytes: m.bytes, sha256: m.sha256, type: m.type, typedBy: m.typedBy };
    if (m.disposition !== 'typed' || !m.type) {
      outcomes.push({ ...base, action: 'skipped', reason: m.type ? `${m.disposition}:${m.type}` : m.disposition });
      continue;
    }
    if (m.type === input.mainType) {
      outcomes.push({ ...base, action: 'skipped', reason: `same_type_as_main:${m.type}` });
      continue;
    }
    const url = zipMemberUrl(input.zipUrl, m.name);

    const seen = seenBySha.get(m.sha256);
    const existing = seen
      ? { id: seen.documentId, type: seen.docType as string }
      : ((await deps.documents.findBySha256ForIpo?.(input.ipoId, m.sha256)) ?? null);
    if (existing) {
      outcomes.push({
        ...base,
        action: 'duplicate',
        reason: `sha256_already_stored_as:${existing.type}`,
        documentId: existing.id,
        url,
        ...(existing.type === m.type ? { suppliesType: m.type } : {}),
      });
      continue;
    }

    if (input.dryRun) {
      // Remembered, so the same bytes in a LATER zip of this run report as the
      // duplicate the apply will find by sha256 (Madhur's corrigendum ships in
      // both its RHP and its RATIOS zip) instead of a second row to add.
      seenBySha.set(m.sha256, { documentId: '(dry-run)', docType: m.type });
      outcomes.push({ ...base, action: 'would_store', reason: `new:${m.type}`, url });
      continue;
    }

    const stored = await storeDocument({
      ipoId: input.ipoId,
      docType: m.type,
      pdf: m.content,
      sha256: m.sha256,
      storeDir: deps.storeDir ?? getStoreDir(),
    });
    if (!stored.stored) {
      outcomes.push({ ...base, action: 'skipped', reason: 'store_full', url });
      continue;
    }
    const row = await deps.documents.upsertDocument({
      ipoId: input.ipoId,
      type: m.type,
      title: `${input.zipTitle} | ${m.name.split('/').pop() ?? m.name}`,
      url,
      exchange: input.exchange,
      mediaType: 'PDF',
      extractionStatus: resolveAdmissionExtractionStatus(m.type),
      isActive: true,
      fileSize: m.bytes,
      sha256: m.sha256,
      partNumber: m.position,
    });
    seenBySha.set(m.sha256, { documentId: row.id, docType: m.type });
    outcomes.push({ ...base, action: 'stored', reason: `stored_as:${m.type}`, documentId: row.id, url, suppliesType: m.type });
  }
  return outcomes;
}

/**
 * States a zip-supplied document may move to FOUND from. FOUND/EXTRACTED/
 * EXTRACT_FAILED already hold a document (maybe another filing of the type,
 * which must not be swapped); SUPERSEDED is a deliberate retirement.
 */
const OPEN_STATES: ReadonlySet<DocumentFetchStateValue> = new Set<DocumentFetchStateValue>([
  'WANTED',
  'NOT_YET_FILED',
  'NOT_FOUND',
  'BLOCKED_ALL',
  'NOT_APPLICABLE',
]);

/**
 * Mark one document type FOUND because a zip member supplied it, through the
 * state machine's own `found` transition (the same one the per-type chain
 * uses). Without this the type's fallback chain kept running on every cycle
 * and recorded NOT_FOUND for a document already stored (Tier A round 1,
 * MAJOR 2). Returns true when a row changed.
 */
export async function markTypeFoundFromZip(
  store: IDocumentFetchStateStore,
  ipoId: string,
  docType: DocumentType,
  documentId: string,
  zipUrl: string,
  now: Date = new Date()
): Promise<boolean> {
  const row = await store.ensureRow(ipoId, docType);
  if (!OPEN_STATES.has(row.state)) return false;
  const transition = applyOutcome({ docType, state: row.state } as StateRow, 'found', now);
  const line: FetchAttempt = {
    source: 'CHAIN',
    http: 0,
    ms: 0,
    outcome: `rungs[${docType}]: EXCHANGES:found_in_zip (${zipUrl})`,
  };
  await store.update(row.id, {
    state: toPersistedState(transition.state),
    nextRetryAt: transition.nextRetryAt,
    blockedSinceAt: transition.blockedSinceAt,
    documentId,
    lastAttempt: [line],
  });
  return true;
}
