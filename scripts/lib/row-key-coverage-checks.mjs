// Item 1 slice s8 — "no child row is silently un-provenanced".
//
// WHY THIS EXISTS
// ---------------
// field_sources is keyed on (ipo_id, table_name, row_key, field_name). For the
// singleton tables (ipos, ipo_details) row_key is '' and that is correct. For
// the multi-row child tables it must identify WHICH row the fact came from.
// A code path that forgets to pass rowKey silently falls back to the ''
// default, so FY2023's revenue and FY2024's revenue both write provenance to
// the same key: the second write overwrites the first, and the provenance now
// names the wrong row. Nothing in the schema stops that — '' is a legal
// row_key — so only an independent audit can see it.
//
// WHAT IT ASSERTS
// ---------------
// For every (ipo, child table) pair holding MORE THAN ONE row, field_sources
// must hold at least one row per (table_name, row_key) pair that the child
// table actually contains. A derived child key with no provenance row is a
// silently un-provenanced row.
//
// THE ALL-EMPTY-KEY STATE IS **UNVERIFIABLE**, NEVER PASS
// -------------------------------------------------------
// No production caller passes a non-empty rowKey yet: both callers of
// consolidateIPOData pass tableName 'ipos', and the four child tables are
// still written directly by filing-persister. So today every child row's
// provenance (where any exists) sits under the '' default. Calling that PASS
// would make this check permanently, meaninglessly green through exactly the
// transition it exists to police — indistinguishable from a broken check.
// Calling it FAIL would make the nightly audit red from the day it merges
// until the writer slices land, which trains readers to ignore it.
//
// So a pair whose provenance is ALL '' is neither: it is NOT-YET-KEYED, and
// the check reports UNVERIFIABLE — a first-class state in this audit
// (exit code 3, P2 page, never counted as a pass). The switch to enforcement
// is automatic and per-pair: the moment field_sources holds ONE non-empty
// row_key for a pair, that pair is judged for real. No flag to remember to
// flip, and no way for the check to stay green by accident.
//
// RESIDUAL LIMIT, NAMED: a writer that lands and keys NOTHING at all leaves
// every pair NOT-YET-KEYED forever, so this check would page P2 nightly rather
// than FAIL. That is loud, not silent, but it is not a hard gate — the
// row-key round-trip test in the writer slice is what catches that case.
import { rowKeyForName } from './normalize-company-name.mjs';

// GUARD (table list): the four multi-row child tables this check sweeps.
// ipos / ipo_details / anchor_investors are singleton-shaped (row_key '' is
// correct there) and ipo_valuation / ipo_risk_factors are not part of item 1
// slice s8's stated class.
export const ROW_KEYED_CHILD_TABLES = [
  'financial_statements',
  'promoters',
  'ipo_intermediaries',
  'peer_companies',
];

// GUARD (key derivation): the row_key shape per table, matching the item-01
// card's row-key table exactly. Derived from the child row's OWN identity
// columns, never from the denormalized normalized_name the writer stored —
// the check must not depend on a value the path under audit wrote. Uses
// `rowKeyForName` — the SAME row-key function every write path and the
// backfill use (packages/shared/src/utils/company-name-normalizer.ts) — not
// the bare normalizer, because the bare normalizer collapses a non-empty
// JUNK name (e.g. "----") to '' and a genuinely-keyed junk row would then
// read as a FALSE FAIL against this check. Returns `null` when the row has
// no identity at all (name null/empty/whitespace-only) — the caller MUST
// skip that row rather than treat it as a missing key, because no writer
// will ever have minted provenance for a row it was told to skip.
export function deriveChildRowKey(tableName, row) {
  switch (tableName) {
    case 'financial_statements':
      return `${row.fiscalYear}:${row.basis}`;
    case 'promoters':
      return rowKeyForName(row.name ?? '');
    case 'ipo_intermediaries': {
      const nameKey = rowKeyForName(row.name ?? '');
      if (nameKey === null) return null;
      return `${row.role}:${nameKey}`;
    }
    case 'peer_companies':
      return rowKeyForName(row.companyName ?? '');
    default:
      throw new Error(`deriveChildRowKey: unknown child table '${tableName}'`);
  }
}

// The SELECTs the audit runs, one per table. Deliberately UNFILTERED: the
// "more than one row" rule lives in exactly one place (the classifier below)
// so that mutating it has one unambiguous test consequence. These four tables
// are small (low thousands of rows) — a nightly full read is cheap.
export const CHILD_ROW_SQL = {
  financial_statements:
    `SELECT c.ipo_id AS "ipoId", i.company_name AS "companyName",
            c.fiscal_year AS "fiscalYear", c.basis::text AS "basis"
       FROM financial_statements c JOIN ipos i ON i.id = c.ipo_id`,
  promoters:
    `SELECT c.ipo_id AS "ipoId", i.company_name AS "companyName", c.name AS "name"
       FROM promoters c JOIN ipos i ON i.id = c.ipo_id`,
  ipo_intermediaries:
    `SELECT c.ipo_id AS "ipoId", i.company_name AS "companyName",
            c.role::text AS "role", c.name AS "name"
       FROM ipo_intermediaries c JOIN ipos i ON i.id = c.ipo_id`,
  peer_companies:
    `SELECT c.ipo_id AS "ipoId", i.company_name AS "companyName",
            c.company_name AS "companyNameOfPeer"
       FROM peer_companies c JOIN ipos i ON i.id = c.ipo_id`,
};

export const PROVENANCE_KEYS_SQL =
  `SELECT ipo_id AS "ipoId", table_name AS "tableName", row_key AS "rowKey"
     FROM field_sources
    WHERE table_name = ANY($1)
    GROUP BY 1, 2, 3`;

const pairKey = (ipoId, tableName) => `${ipoId}|${tableName}`;

/**
 * Pure classifier. No DB, no clock, no network.
 *
 * @param {{childRows: Array<{ipoId: string, companyName: string, tableName: string, rowKey: string}>,
 *          provenanceKeys: Array<{ipoId: string, tableName: string, rowKey: string}>}} input
 * @returns {{status: 'PASS'|'FAIL'|'UNVERIFIABLE', offenders: string[],
 *            enforcedPairCount: number, notYetKeyedPairCount: number,
 *            multiRowPairCount: number, detail: string}}
 */
export function classifyRowKeyCoverage({ childRows, provenanceKeys }) {
  const provByPair = new Map();
  for (const p of provenanceKeys) {
    const k = pairKey(p.ipoId, p.tableName);
    if (!provByPair.has(k)) provByPair.set(k, new Set());
    provByPair.get(k).add(p.rowKey ?? '');
  }

  const childByPair = new Map();
  for (const r of childRows) {
    const k = pairKey(r.ipoId, r.tableName);
    if (!childByPair.has(k)) childByPair.set(k, []);
    childByPair.get(k).push(r);
  }

  const offenders = [];
  let enforcedPairCount = 0;
  let notYetKeyedPairCount = 0;
  let multiRowPairCount = 0;

  for (const [k, rows] of childByPair) {
    // GUARD (multi-row filter): a table holding ONE row for an IPO is
    // singleton-shaped for that IPO — row_key '' carries no ambiguity there,
    // so it is out of this check's class.
    if (rows.length <= 1) continue;
    multiRowPairCount++;

    const prov = provByPair.get(k) ?? new Set();
    // GUARD (enforced / not-yet-keyed split): a pair whose provenance is
    // entirely '' has not been row-keyed by any writer yet — see the header.
    const hasAnyRealKey = [...prov].some((rk) => rk !== '');
    if (!hasAnyRealKey) {
      notYetKeyedPairCount++;
      continue;
    }
    enforcedPairCount++;

    // GUARD (per-pair join): every derived child row key must be present in
    // that pair's field_sources row_keys.
    const distinctKeys = [...new Set(rows.map((r) => r.rowKey))];
    const missing = distinctKeys.filter((rk) => !prov.has(rk));
    if (missing.length) {
      const { companyName, tableName } = rows[0];
      offenders.push(
        `"${companyName}" ${tableName}: ${missing.length} of ${distinctKeys.length} row key(s) have no field_sources entry — ${missing.map((m) => `'${m}'`).join(', ')}`
      );
    }
  }

  if (offenders.length) {
    return {
      status: 'FAIL', offenders, enforcedPairCount, notYetKeyedPairCount, multiRowPairCount,
      detail: `${offenders.length} (ipo, table) pair(s) hold child rows with no per-row provenance, across ${enforcedPairCount} row-keyed pair(s)`,
    };
  }
  if (enforcedPairCount > 0) {
    return {
      status: 'PASS', offenders, enforcedPairCount, notYetKeyedPairCount, multiRowPairCount,
      detail: `checked and clean: ${enforcedPairCount} row-keyed (ipo, table) pair(s) have a field_sources row for every child row key` +
        (notYetKeyedPairCount ? `; ${notYetKeyedPairCount} further pair(s) are not row-keyed yet and were not judged` : ''),
    };
  }
  if (notYetKeyedPairCount > 0) {
    return {
      status: 'UNVERIFIABLE', offenders, enforcedPairCount, notYetKeyedPairCount, multiRowPairCount,
      detail: `nothing judgeable yet: all ${notYetKeyedPairCount} multi-row (ipo, table) pair(s) carry provenance only under the '' catch-all key — the row-keyed writer is not live, so per-row provenance cannot be judged. NOT a pass`,
    };
  }
  return {
    status: 'PASS', offenders, enforcedPairCount, notYetKeyedPairCount, multiRowPairCount,
    detail: `nothing to check: no IPO holds more than one row in ${ROW_KEYED_CHILD_TABLES.join('/')}`,
  };
}

/**
 * Runs the real SQL through an injected query function and classifies it.
 * Shared verbatim by the nightly audit and the seeded ipodhan_test proof, so
 * the seeded fail/pass cases exercise the SAME SQL production reads.
 *
 * @param {(sql: string, params?: unknown[]) => Promise<Array<object>>} q
 */
export async function collectRowKeyCoverage(q) {
  const childRows = [];
  for (const tableName of ROW_KEYED_CHILD_TABLES) {
    const rows = await q(CHILD_ROW_SQL[tableName]);
    for (const r of rows) {
      const source = tableName === 'peer_companies' ? { companyName: r.companyNameOfPeer } : r;
      const rowKey = deriveChildRowKey(tableName, source);
      // No-identity row (name null/empty/whitespace-only): the writer has no
      // key to have written provenance under, so this is not a "missing key"
      // — it is out of the check's class entirely. Skip, don't count.
      if (rowKey === null) continue;
      childRows.push({
        ipoId: r.ipoId,
        companyName: r.companyName,
        tableName,
        rowKey,
      });
    }
  }
  const provenanceKeys = await q(PROVENANCE_KEYS_SQL, [ROW_KEYED_CHILD_TABLES]);
  return classifyRowKeyCoverage({ childRows, provenanceKeys });
}
