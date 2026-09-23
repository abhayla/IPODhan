#!/usr/bin/env node
// scripts/ops/admin-queue-size.mjs — build item 35, docs/design/spec-deviation-guideline.md
// §5.1, OD-63, .claude/rules/signal-ownership.md R1/R3.
//
// The admin queue (open data_conflicts rows, plus absent fields on ipo_field_plan) has never
// been printed anywhere the owner reads. Measured 2026-09-19: 45,804 conflicts / 31,659
// resolved (every resolution SYSTEM, never a human) / 14,145 still open, plus 12,701 absent
// fields across 71 IPOs. This module reports the OPEN size, grouped by IPO, live and upcoming
// named individually so an admin opening one company settles every field with one document
// open, and everything older collapsed into one summary line (naming 63 closed IPOs every
// night is how a report becomes something nobody reads).
//
// Usage:
//   node scripts/ops/admin-queue-size.mjs           print the block, exit 0
//   node scripts/ops/admin-queue-size.mjs --json    the same data as json, for the floor script

import pg from 'pg';
import { pathToFileURL } from 'node:url';
import { createUtcPool, installUtcTimestampParsing, assertUtcSession } from '../lib/pg-utc.mjs';
// OD-75 round 2: admin-only rows (a source changing its own value) are not queue work.
import { behaviourConflictPredicate } from '../lib/conflict-reasons.mjs';

// Absence states per OD-62 (packages/shared/src/db/schema.ts, fieldPlanStateEnum): a field the
// pipeline has given up asking for. PENDING/SUPPLIED are not absences.
const ABSENCE_STATES = ['NOT_PRINTED', 'NOT_AVAILABLE_YET', 'CHECK_FAILED', 'EXHAUSTED'];

/**
 * Read the open admin queue, grouped by IPO, live/upcoming first.
 * @param {pg.Pool} pool
 * @returns {Promise<{
 *   total: number,
 *   byIpo: Array<{ slug: string; status: string; conflicts: number; absences: number; live: boolean }>,
 * }>}
 */
/**
 * Pure grouping/ordering step, exported separately so the ordering, grouping, zero-count and
 * sum-reconciliation rules are testable without a database (build item 35's test list).
 * @param {Array<{slug: string, status: string, open_date: any, conflicts: number}>} conflictRows
 * @param {Array<{slug: string, status: string, open_date: any, absences: number}>} absenceRows
 */
export function groupAndOrder(conflictRows, absenceRows) {
  const bySlug = new Map();
  const upsert = (slug, status, openDate) => {
    if (!bySlug.has(slug)) {
      bySlug.set(slug, {
        slug,
        status,
        openDate,
        conflicts: 0,
        absences: 0,
        // Live/upcoming: OPEN or UPCOMING per ipoStatusEnum. CLOSED/LISTED/WITHDRAWN/POSTPONED
        // are everything-else, per §5.1's "live and upcoming IPOs first".
        live: status === 'OPEN' || status === 'UPCOMING',
      });
    }
    return bySlug.get(slug);
  };
  for (const r of conflictRows) upsert(r.slug, r.status, r.open_date).conflicts = r.conflicts;
  for (const r of absenceRows) upsert(r.slug, r.status, r.open_date).absences = r.absences;

  // Zero-count IPOs never appear at all — an IPO reaches bySlug only via a row with a
  // non-zero group-by count, so this is implicit, not an extra filter to maintain.
  const all = [...bySlug.values()];
  const byIpo = all
    .filter((e) => e.conflicts > 0 || e.absences > 0)
    .sort((a, b) => {
      if (a.live !== b.live) return a.live ? -1 : 1; // live/upcoming first
      // Within a group, oldest open_date first so the longest-waiting IPO leads.
      const ad = a.openDate ? new Date(a.openDate).getTime() : Infinity;
      const bd = b.openDate ? new Date(b.openDate).getTime() : Infinity;
      return ad - bd;
    })
    .map(({ slug, status, conflicts, absences, live }) => ({ slug, status, conflicts, absences, live }));

  const total = byIpo.reduce((sum, e) => sum + e.conflicts + e.absences, 0);
  return { total, byIpo };
}

export async function adminQueueSize(pool) {
  const { rows: conflictRows } = await pool.query(`
    SELECT i.slug, i.status, i.open_date, COUNT(*)::int AS conflicts
    FROM data_conflicts dc
    JOIN ipos i ON i.id = dc.ipo_id
    WHERE dc.resolved_at IS NULL
      AND ${behaviourConflictPredicate('dc')}
    GROUP BY i.slug, i.status, i.open_date
  `);

  const { rows: absenceRows } = await pool.query(
    `
    SELECT i.slug, i.status, i.open_date, COUNT(*)::int AS absences
    FROM ipo_field_plan p
    JOIN ipos i ON i.id = p.ipo_id
    WHERE p.state = ANY($1::field_plan_state[])
    GROUP BY i.slug, i.status, i.open_date
  `,
    [ABSENCE_STATES]
  );

  return groupAndOrder(conflictRows, absenceRows);
}

/** Render the printed block exactly as the card specifies. */
export function formatAdminQueueBlock({ total, byIpo }) {
  const live = byIpo.filter((e) => e.live);
  const rest = byIpo.filter((e) => !e.live);
  const restConflicts = rest.reduce((s, e) => s + e.conflicts, 0);
  const restAbsences = rest.reduce((s, e) => s + e.absences, 0);

  const lines = [`ADMIN-QUEUE  open ${total} across ${byIpo.length} IPOs  (live/upcoming first)`];
  for (const e of live) {
    lines.push(`  ${e.status.padEnd(9)} ${e.slug.padEnd(20)} conflicts ${String(e.conflicts).padStart(4)}   absences ${String(e.absences).padStart(4)}`);
  }
  if (rest.length > 0) {
    lines.push(`  LISTED and older: ${rest.length} IPOs, conflicts ${restConflicts}, absences ${restAbsences}`);
  }
  return lines.join('\n');
}

async function main() {
  installUtcTimestampParsing();
  const pool = createUtcPool(
    process.env.DATABASE_HOST && process.env.DATABASE_PASSWORD
      ? {
          host: process.env.DATABASE_HOST,
          port: parseInt(process.env.DATABASE_PORT || '5432'),
          database: process.env.DATABASE_NAME || 'ipodhan',
          user: process.env.DATABASE_USER || 'postgres',
          password: process.env.DATABASE_PASSWORD,
          ssl: false,
          max: 4,
        }
      : { connectionString: process.env.DATABASE_URL, ssl: false, max: 4 }
  );
  try {
    await assertUtcSession(pool);
    const data = await adminQueueSize(pool);
    if (process.argv.includes('--json')) {
      console.log(JSON.stringify(data));
    } else {
      console.log(formatAdminQueueBlock(data));
    }
    process.exit(0);
  } finally {
    await pool.end();
  }
}

const isMainModule = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMainModule) {
  main().catch((err) => {
    console.error(`FATAL: unhandled error: ${err.stack || err.message}`);
    process.exit(2);
  });
}
