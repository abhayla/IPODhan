/**
 * OD-73 review round 1 (MAJOR-2, PR #914): the nightly check `s_settled_field_rewritten` must rank
 * sources through the WRITER's own definition, never a second list. The audit is plain JS on the
 * VPS and cannot import this TypeScript, so this module records the writer's answers — the output
 * of `getSourcePriority` and `allowsSameSourceRefresh` themselves, for every settled field, source,
 * IPO type and listing venue, with `ENABLE_POLICY_WRITER` off AND on — into
 * `scraper/config/writer-source-ranking.json`. The audit only looks answers up in that table.
 *
 * `tests/unit/config/writer-source-ranking.test.ts` regenerates the table and fails when the
 * committed JSON differs, so a change to the matrix, the manifest, `switchover.json` or the
 * venue rule that is not re-snapshotted cannot merge.
 *
 * Regenerate: `cd scraper && npx tsx scripts/build-writer-ranking-snapshot.ts` (`--check` to verify).
 */
import {
  getSourcePriority,
  allowsSameSourceRefresh,
  isTimeBased,
  type ScraperSource,
} from './field-priority-matrix.js';
import { FEATURE_FLAGS } from './feature-flags.js';

/** `ipos` fields OD-73 settles, camelCase as `field_sources.field_name` stores them. */
export const SETTLED_IPO_FIELDS = [
  'priceRangeMin', 'priceRangeMax', 'lotSize', 'issueSize', 'faceValue',
  'openDate', 'closeDate', 'listingDate', 'allotmentDate', 'registrar', 'leadManagers',
] as const;

export const WRITER_SOURCES: readonly ScraperSource[] = [
  'ADMIN', 'DRHP', 'NSE', 'BSE', 'MONEYCONTROL', 'CHITTORGARH', 'INVESTORGAIN_GMP', 'API_FALLBACK', 'REG',
];

export const IPO_TYPES = ['MAINBOARD', 'SME_BSE', 'SME_NSE'] as const;

/**
 * Listing venues the writer distinguishes (OD-64): unknown (no exchanges resolved), each exchange
 * alone, both, and a venue naming neither. The key is what `venueKey()` in the audit computes.
 */
export const VENUES: Record<string, readonly string[]> = {
  unknown: [],
  NSE: ['NSE'],
  BSE: ['BSE'],
  'BSE,NSE': ['NSE', 'BSE'],
  none: ['OTHER'],
};

type RankTable = Record<string, Record<string, Record<string, Record<string, number>>>>;

export interface WriterRankingSnapshot {
  _generated: string;
  fields: string[];
  timeBased: string[];
  /** policy flag state -> ipoType -> venue -> field -> { source: writer priority index } (unranked omitted) */
  rank: Record<'policyWriterOff' | 'policyWriterOn', RankTable>;
  /** policy flag state -> ipoType -> field -> sources the writer lets refresh their own value */
  sameSourceRefresh: Record<'policyWriterOff' | 'policyWriterOn', Record<string, Record<string, string[]>>>;
}

function snapshotFor(): { rank: RankTable; refresh: Record<string, Record<string, string[]>> } {
  const rank: RankTable = {};
  const refresh: Record<string, Record<string, string[]>> = {};
  for (const ipoType of IPO_TYPES) {
    rank[ipoType] = {};
    refresh[ipoType] = {};
    for (const [venue, exchanges] of Object.entries(VENUES)) {
      rank[ipoType][venue] = {};
      for (const field of SETTLED_IPO_FIELDS) {
        const bySource: Record<string, number> = {};
        for (const source of WRITER_SOURCES) {
          const p = getSourcePriority(field, source, 'ipos', ipoType, exchanges);
          if (p !== -1) bySource[source] = p;
        }
        rank[ipoType][venue][field] = bySource;
      }
    }
    for (const field of SETTLED_IPO_FIELDS) {
      refresh[ipoType][field] = WRITER_SOURCES.filter((s) => allowsSameSourceRefresh(field, s, 'ipos', ipoType));
    }
  }
  return { rank, refresh };
}

/** The writer's answers under both `ENABLE_POLICY_WRITER` states. Restores the flag afterwards. */
export function buildWriterRankingSnapshot(): WriterRankingSnapshot {
  const flags = FEATURE_FLAGS as { ENABLE_POLICY_WRITER: boolean };
  const saved = flags.ENABLE_POLICY_WRITER;
  try {
    flags.ENABLE_POLICY_WRITER = false;
    const off = snapshotFor();
    flags.ENABLE_POLICY_WRITER = true;
    const on = snapshotFor();
    return {
      _generated: 'by scraper/scripts/build-writer-ranking-snapshot.ts from getSourcePriority/allowsSameSourceRefresh — do not edit by hand',
      fields: [...SETTLED_IPO_FIELDS],
      timeBased: SETTLED_IPO_FIELDS.filter((f) => isTimeBased(f, 'ipos')),
      rank: { policyWriterOff: off.rank, policyWriterOn: on.rank },
      sameSourceRefresh: { policyWriterOff: off.refresh, policyWriterOn: on.refresh },
    };
  } finally {
    flags.ENABLE_POLICY_WRITER = saved;
  }
}
