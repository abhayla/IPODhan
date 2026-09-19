/**
 * S7 — nightly consensus check (docs/design/s7-consensus-check-plan.md).
 *
 * WHAT THIS CHECKS (half 1 of the plan)
 * --------------------------------------
 * For every `field_sources` row whose field is NOT `comparisonFamily: 'ABSTAIN'` in the field
 * manifest, re-derive what the verdict SHOULD be from the row's own `witnesses` column plus the
 * manifest's segment-scoped capable-source count for that IPO, and compare it against the
 * `verdict` column actually stored. Any mismatch is reported BY IDENTITY (ipo, table, field) --
 * never as a bare count (signal-ownership.md R1).
 *
 * This is a THIN WRAPPER around the real production logic, not a re-implementation of it:
 * `computeVerdict` (scraper/src/services/witness-verdict.ts) and `areEquivalent`
 * (scraper/src/services/normalization-engine.ts) are IMPORTED, not copied -- the exact functions
 * S3b-2's writer calls. A re-implementation would drift from the writer the moment either changes
 * (the #783 class this plan explicitly warns about). The comparison family for each field is read
 * from the SAME manifest the writer reads (`loadFieldManifest`), never a hardcoded list.
 *
 * THE EMPTY-COLUMN CASE (ENABLE_VERDICT_WRITER is set nowhere -- every slot's `verdict` column is
 * NULL on every row today): this check distinguishes "0 rows have a verdict written yet" from
 * "every written verdict is correct" and SAYS WHICH in its PASS/message. A bare `0 mismatches`
 * would look identical to a check that verified nothing.
 *
 * ABSTAIN fields (14 in the manifest) are EXCLUDED from the mismatch population entirely -- a
 * null verdict there is correct BY DESIGN (comment on `computeVerdict`: ABSTAIN fields never
 * reach the writer). A null verdict on a 2+-witness NON-ABSTAIN field IS a finding (S1: writer
 * should have computed one and didn't).
 *
 * WHAT THIS DOES NOT CHECK -- OD-61 (half 2 of the plan: no public payload carries a verdict or a
 * second value) is added to the EXISTING `e_route_sweep` loop in `audit-detection-floor.mjs`, not
 * duplicated here -- see that file's `checkE()` and the plan's "REUSE, measured" section.
 *
 * WHAT THIS MUST NEVER DO -- read and report only. A wrong verdict is repaired via the admin
 * queue (S9), never auto-corrected here (defect-fix-contract.md's repair-vs-detection split).
 *
 * USAGE
 * -----
 *   npx tsx scripts/audit-consensus-verdict.ts <DATABASE_URL>
 *   npm run audit:consensus-verdict             # against $DATABASE_URL
 *
 * Exit 0 = every non-ABSTAIN field_sources row's verdict matches its own witnesses (or none are
 * written yet -- WRITER_DORMANT is a real, distinct PASS state, printed as such). Exit 1 = at
 * least one mismatch (or a connection failure -- never a silent skip).
 */
import './lib/alias-preflight-auto.mjs';
import { Client } from 'pg';
import { computeVerdict, type Verdict } from '../scraper/src/services/witness-verdict.ts';
import { loadFieldManifest } from '../scraper/src/config/field-manifest-loader.ts';
import { resolveIpoTypeKey, type IpoTypeKey } from '../scraper/src/services/field-plan-generator.ts';
import type { ComparisonFamily } from '../scraper/src/services/normalization-engine.ts';
import { fieldNameToColumn } from '../scraper/src/config/field-name-case.ts';

export interface FieldSourceRow {
  ipoId: string;
  companyName: string;
  segment: 'MAINBOARD' | 'SME' | null;
  listingExchanges: string[] | null;
  tableName: string;
  rowKey: string;
  fieldName: string;
  verdict: string | null;
  witnesses: unknown;
}

export interface Mismatch {
  ipoId: string;
  companyName: string;
  tableName: string;
  fieldName: string;
  storedVerdict: string | null;
  expectedVerdict: Verdict;
  reason: string;
}

const COMPARABLE_FAMILIES = new Set<ComparisonFamily>([
  'MONEY',
  'RATIO',
  'IDENTITY',
  'IDENTIFIER',
  'DATE',
  'SET',
  'BOOLEAN',
  'COUNT',
]);

/**
 * Re-derive the expected verdict for ONE field_sources row using the SAME `computeVerdict` the
 * writer calls. Returns `null` when the row's field is ABSTAIN (not this check's population --
 * a null verdict there is correct by design) or when the manifest has no entry for
 * `${tableName}.${fieldName}` (an unmapped field, e.g. an ADMIN-only column -- also out of
 * population, not a mismatch).
 */
export function expectedVerdictForRow(
  row: FieldSourceRow,
  manifest: ReturnType<typeof loadFieldManifest>
): { expected: Verdict; family: ComparisonFamily } | null {
  // field_sources.field_name is camelCase (issueSize); the manifest key is the raw snake_case
  // column (issue_size) -- same inverse conversion field-plan-walk.ts's own writer applies via
  // fieldNameToColumn (field-name-case.ts). A direct camelCase join against the manifest silently
  // matches nothing (field-sources-field-name-is-camelcase lesson) -- exactly the false-empty-
  // population bug this conversion exists to avoid.
  const fieldKey = `${row.tableName}.${fieldNameToColumn(row.fieldName)}`;
  const entry = manifest.fields[fieldKey];
  if (!entry) return null; // not this check's population -- no manifest row to re-derive against
  if (entry.comparisonFamily === 'ABSTAIN') return null; // by design: never reaches computeVerdict

  const ipoType: IpoTypeKey = resolveIpoTypeKey({
    segment: row.segment,
    listingExchanges: row.listingExchanges,
  });
  const ranks = entry.rank[ipoType];
  const capableSourceCount = Array.isArray(ranks) ? ranks.length : 0;

  const witnesses = Array.isArray(row.witnesses) ? (row.witnesses as Array<Record<string, unknown>>) : [];
  const answers = witnesses.map((w, i) => ({
    rank: i,
    source: String(w.source),
    value: w.value,
    at: String(w.at ?? ''),
    docType: typeof w.docType === 'string' ? w.docType : undefined,
  }));

  const family = entry.comparisonFamily as ComparisonFamily;
  if (!COMPARABLE_FAMILIES.has(family)) return null; // defensive -- schema already refuses this

  const { verdict } = computeVerdict(answers, capableSourceCount, family);
  return { expected: verdict, family };
}

/**
 * Walk a fetched row set and report mismatches BY IDENTITY. `writtenCount` distinguishes
 * "0 verdicts written" (WRITER_DORMANT) from "N verdicts written, M mismatched".
 */
/**
 * #794: the exit decision, split out of `main` so it is testable without a database.
 *
 * WRITER_DORMANT is a TERMINAL PASS, not a step on the way to FATAL. Before this split,
 * the dormant branch printed its line and then fell through to the unconditional
 * `mismatches.length > 0` FATAL, so with `ENABLE_VERDICT_WRITER` off - its state in
 * EVERY environment - the check exited 1 with a mismatch count exactly equal to its
 * eligible population (6715 of 6715, staging, 2026-09-19). A gate whose only possible
 * output is FATAL carries no information: it cannot tell "the writer is off" (expected)
 * from "the writer is on and computing wrong verdicts", which is the one case it exists
 * to catch. Re-derivation against an empty column is not a mismatch; it is the
 * documented dormant state.
 *
 * The FATAL path is unchanged for the case that matters: verdicts ARE being written and
 * at least one disagrees with re-derivation.
 */
export function decideExit(input: {
  mismatches: Mismatch[];
  writtenCount: number;
  eligibleCount: number;
}): { code: 0 | 1; status: 'PASS' | 'FAIL'; detail: string } {
  const { mismatches, writtenCount, eligibleCount } = input;

  if (writtenCount === 0) {
    return {
      code: 0,
      status: 'PASS',
      detail:
        eligibleCount === 0
          ? 'WRITER_DORMANT: 0 eligible field_sources rows exist yet'
          : `WRITER_DORMANT: ${eligibleCount} eligible row(s), 0 carry a verdict (ENABLE_VERDICT_WRITER is off). ` +
            `Re-derivation differs on ${mismatches.length}, which is the dormant state, not a defect. ` +
            'This check goes FAIL only once verdicts are actually written.',
    };
  }

  if (mismatches.length > 0) {
    return {
      code: 1,
      status: 'FAIL',
      detail:
        `${mismatches.length} mismatch(es) of ${eligibleCount} eligible row(s) (${writtenCount} written): ` +
        mismatches
          .slice(0, 8)
          .map((m) => `[${m.companyName}/${m.ipoId}] ${m.tableName}.${m.fieldName} (${m.reason})`)
          .join('; '),
    };
  }

  return {
    code: 0,
    status: 'PASS',
    detail: `0 mismatches across ${eligibleCount} eligible row(s) (${writtenCount} written)`,
  };
}

export function auditRows(
  rows: FieldSourceRow[],
  manifest: ReturnType<typeof loadFieldManifest>
): { mismatches: Mismatch[]; writtenCount: number; eligibleCount: number } {
  const mismatches: Mismatch[] = [];
  let writtenCount = 0;
  let eligibleCount = 0;

  for (const row of rows) {
    const derived = expectedVerdictForRow(row, manifest);
    if (derived === null) continue; // ABSTAIN or unmapped field -- not this check's population
    eligibleCount += 1;
    if (row.verdict !== null) writtenCount += 1;

    if (row.verdict !== derived.expected) {
      mismatches.push({
        ipoId: row.ipoId,
        companyName: row.companyName,
        tableName: row.tableName,
        fieldName: row.fieldName,
        storedVerdict: row.verdict,
        expectedVerdict: derived.expected,
        reason:
          row.verdict === null
            ? `no verdict stored; re-derived from ${Array.isArray(row.witnesses) ? row.witnesses.length : 0} witness(es) as ${derived.expected} (family ${derived.family})`
            : `stored ${row.verdict}, re-derived ${derived.expected} from witnesses (family ${derived.family})`,
      });
    }
  }

  return { mismatches, writtenCount, eligibleCount };
}

async function fetchRows(client: Client): Promise<FieldSourceRow[]> {
  const { rows } = await client.query(`
    SELECT
      fs.ipo_id            AS "ipoId",
      i.company_name       AS "companyName",
      i.segment            AS "segment",
      i.listing_exchanges  AS "listingExchanges",
      fs.table_name        AS "tableName",
      fs.row_key           AS "rowKey",
      fs.field_name        AS "fieldName",
      fs.verdict           AS "verdict",
      fs.witnesses          AS "witnesses"
    FROM field_sources fs
    JOIN ipos i ON i.id = fs.ipo_id
  `);
  return rows;
}

// Same machine-checkable shape audit-detection-floor.mjs's own `record(id, ...)` calls use
// (scripts/tests/audit-detection-floor.test.mjs's manifest<->script wiring test resolves a
// FOREIGN auditScript by grepping for exactly `record('<id>'`), so this check can be registered
// as a real, non-paper entry in docs/reviews/detection-checks/ pointing at THIS file.
// detection-check: s7_consensus_verdict
function record(id: string, status: 'PASS' | 'FAIL', detail: string): void {
  console.log(`[${status}] ${id} — ${detail}`);
}

function resolveClient(): Client {
  const argOrUrl = process.argv[2] ?? process.env.DATABASE_URL;
  if (argOrUrl) return new Client({ connectionString: argOrUrl });
  if (process.env.DATABASE_HOST && process.env.DATABASE_PASSWORD) {
    return new Client({
      host: process.env.DATABASE_HOST,
      port: parseInt(process.env.DATABASE_PORT || '5432', 10),
      database: process.env.DATABASE_NAME || 'ipodhan',
      user: process.env.DATABASE_USER || 'postgres',
      password: process.env.DATABASE_PASSWORD,
    });
  }
  console.error('FATAL: no DATABASE_URL (arg or env var) and no DATABASE_HOST+DATABASE_PASSWORD pair.');
  process.exit(1);
}

async function main() {
  const client = resolveClient();
  try {
    await client.connect();
  } catch (error) {
    console.error(`FATAL: could not connect to the target database: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }

  try {
    await client.query("SET TIME ZONE 'UTC'");
    const dbNameResult = await client.query<{ current_database: string }>('select current_database()');
    const slot = dbNameResult.rows[0]?.current_database ?? '(unknown)';

    const manifest = loadFieldManifest();
    const rows = await fetchRows(client);
    const { mismatches, writtenCount, eligibleCount } = auditRows(rows, manifest);

    console.log(`Consensus verdict check on slot "${slot}": ${rows.length} field_sources row(s), ${eligibleCount} in this check's population (non-ABSTAIN, manifest-mapped).`);

    if (eligibleCount === 0) {
      console.log('WRITER_DORMANT: no field_sources rows exist yet (empty population). Nothing to verify -- distinct from "verified clean".');
    } else if (writtenCount === 0) {
      console.log(`WRITER_DORMANT: ${eligibleCount} eligible row(s), 0 carry a verdict yet (ENABLE_VERDICT_WRITER is off). Re-derivation still ran against the empty verdict column and found ${mismatches.length} mismatch(es) against what SHOULD be there.`);
    } else {
      console.log(`${writtenCount} of ${eligibleCount} eligible row(s) carry a written verdict.`);
    }

    const decision = decideExit({ mismatches, writtenCount, eligibleCount });
    record('s7_consensus_verdict', decision.status, decision.detail);

    if (decision.code === 1) {
      console.error(`FATAL: ${mismatches.length} verdict mismatch(es), by identity (ipo / table / field):`);
      for (const m of mismatches) {
        console.error(`  [${m.companyName} / ${m.ipoId}] ${m.tableName}.${m.fieldName}: ${m.reason}`);
      }
      process.exit(1);
    }

    console.log(`OK: ${decision.detail}`);
    process.exit(0);
  } catch (error) {
    console.error(`FATAL: consensus verdict check itself failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  } finally {
    await client.end();
  }
}

if (process.argv[1] && process.argv[1].endsWith('audit-consensus-verdict.ts')) {
  main();
}
