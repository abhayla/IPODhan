// Pure, DB-free core of audit-detection-floor.mjs's runCheck() wrapper (#1113).
//
// RCA: the previous runCheck(fn) recorded a thrown check under fn.name (e.g.
// "checkSettledFieldRewrites"), never under the registered check id(s) that
// function actually owns (e.g. "s_settled_field_rewritten"). floor-delta.mjs
// diffs by registered id, so a crashed check's real id read as silently
// ABSENT (never NEW/GONE/SAME) while a fake, unregistered id
// ("checkSettledFieldRewrites") appeared instead. check_roster then correctly
// flagged the real id as "declared check produced no line tonight".
//
// This module owns only the id-attribution logic, with `record`/`results`
// injected, so it can be unit-tested without a DB connection.
export async function runCheckAgainstIds(fn, ids, { record, results }) {
  try {
    await fn();
  } catch (e) {
    const message = e && e.stack ? e.message : String(e);
    const owned = ids && ids.length ? ids : [fn.name || 'unknown_check'];
    const reported = new Set(results.map((r) => r.id));
    for (const id of owned) {
      if (reported.has(id)) continue; // already recorded (e.g. partial results before the throw)
      record(id, fn.name || 'unknown_check', 'UNVERIFIABLE', `threw: ${message}`);
    }
  }
}
