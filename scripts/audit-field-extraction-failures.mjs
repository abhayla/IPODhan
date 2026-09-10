#!/usr/bin/env node
/**
 * Item 4 (OD-21) detection: read `field_extraction_failures` for the last 24h,
 * group by rule_id, and report.
 *
 * REPORT-ONLY by design at ship time. The design does not say what failure
 * rate is "too many" and this script does not invent one: it prints every rule
 * with a non-zero count and exits 0. Exit 1 is reserved for a real threshold
 * the owner sets once a few nights of real data exist to calibrate against
 * (pass --fail-over=<n> to opt in early). Exit 2 means the audit could not
 * run at all — which is never reported as green.
 *
 * Usage:
 *   DATABASE_URL=... node scripts/audit-field-extraction-failures.mjs [--hours=24] [--fail-over=N]
 */

import pg from 'pg';

const args = process.argv.slice(2);
const hours = Number((args.find((a) => a.startsWith('--hours=')) ?? '--hours=24').split('=')[1]);
const failOverArg = args.find((a) => a.startsWith('--fail-over='));
const failOver = failOverArg ? Number(failOverArg.split('=')[1]) : null;

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('audit-field-extraction-failures: DATABASE_URL is required');
  process.exit(2);
}
if (!Number.isFinite(hours) || hours <= 0) {
  console.error(`audit-field-extraction-failures: --hours must be a positive number, got "${hours}"`);
  process.exit(2);
}

const pool = new pg.Pool({ connectionString: url, options: '-c timezone=UTC' });

try {
  const { rows } = await pool.query(
    `SELECT rule_id,
            count(*)::int                    AS failures,
            count(DISTINCT ipo_id)::int      AS ipos,
            count(*) FILTER (WHERE resolved_at IS NULL)::int AS unresolved,
            min(cause)                       AS sample_cause
       FROM field_extraction_failures
      WHERE occurred_at > now() - ($1 || ' hours')::interval
      GROUP BY rule_id
      ORDER BY failures DESC`,
    [String(hours)]
  );

  if (rows.length === 0) {
    console.log(`audit-field-extraction-failures: PASS — no rule rejected any value in the last ${hours}h`);
    process.exit(0);
  }

  // signal-ownership.md R1: a count is not a reading. Every line names the rule
  // and carries a real cause string, so the failure is classifiable without a re-run.
  console.log(`audit-field-extraction-failures: ${rows.length} rule(s) rejected values in the last ${hours}h`);
  for (const r of rows) {
    console.log(
      `  ${r.rule_id}: ${r.failures} failure(s) across ${r.ipos} IPO(s), ${r.unresolved} still unresolved — e.g. ${r.sample_cause}`
    );
  }

  if (failOver !== null) {
    const over = rows.filter((r) => r.failures > failOver);
    if (over.length > 0) {
      console.error(
        `audit-field-extraction-failures: FAIL — ${over.length} rule(s) over the --fail-over=${failOver} threshold: ` +
          over.map((r) => `${r.rule_id}=${r.failures}`).join(', ')
      );
      process.exit(1);
    }
  }

  console.log('audit-field-extraction-failures: REPORT-ONLY — no threshold set, exiting 0 (see the registry entry)');
  process.exit(0);
} catch (err) {
  // R6: the gate prints its reason before a non-zero exit.
  const cause = err?.cause?.message ? ` (cause: ${err.cause.message})` : '';
  console.error(`audit-field-extraction-failures: could not run: ${err?.message ?? String(err)}${cause}`);
  process.exit(2);
} finally {
  await pool.end().catch(() => {});
}
