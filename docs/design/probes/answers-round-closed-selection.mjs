#!/usr/bin/env node
// Read-only (#1493): runs the REAL 22:00 closed-IPO selection (`closedIpoCandidatesQuery`, rendered by
// drizzle exactly as node-postgres receives it) against ipodhan_staging with an unbounded cap, and counts
// the picks by walk / answers-only and status/offering type. Run: npx tsx docs/design/probes/answers-round-closed-selection.mjs
// The resourcing version is the latest one staging recorded (the live job computes it from the manifest
// fingerprint + extractor version; a PARTIAL row of an older version is a walk pick either way).
import { PgDialect } from 'drizzle-orm/pg-core';
import { openReadOnlyPool, saveOutput, nowStamp } from './_lib.mjs';
import { closedIpoCandidatesQuery } from '../../../scraper/src/scheduler/closed-ipo-job.ts';

const pool = await openReadOnlyPool('ipodhan_staging');
try {
  const v = await pool.query(`SELECT resourced_at_version AS v FROM closed_ipo_resourcing ORDER BY last_attempt_at DESC NULLS LAST LIMIT 1`);
  const version = v.rows[0]?.v ?? 'none';
  const tally = (rows) => {
    const out = {};
    for (const r of rows) {
      const k = `${r.answersOnly ? 'answersOnly' : 'walk'} ${String(r.status).toUpperCase()}/${r.offeringType}`;
      out[k] = (out[k] ?? 0) + 1;
    }
    return out;
  };
  const run = async (answersRound, cap) => {
    const q = new PgDialect().sqlToQuery(closedIpoCandidatesQuery(version, cap, answersRound));
    return (await pool.query(q.sql, q.params)).rows;
  };
  const all = await run(true, 100000);
  const off = await run(false, 100000);
  const capped = await run(true, 10);
  const out = {
    measuredAt: nowStamp(),
    version,
    answersRoundOn: { total: all.length, byKind: tally(all) },
    answersRoundOff: { total: off.length, byKind: tally(off) },
    cap10: { total: capped.length, byKind: tally(capped) },
  };
  saveOutput('answers-round-closed-selection', out);
  console.log(JSON.stringify(out, null, 2));
} finally {
  await pool.end();
}
