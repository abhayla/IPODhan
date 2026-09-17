// Pure predicates for item 3 slice S6's three pull-model policy checks
// (PULL-POLICY, PULL-WRITE-POLICY, PULL-PLAN-RANK). Imported by both
// scripts/audit-detection-floor.mjs (real DB/manifest rows) and
// scripts/tests/pull-policy-checks.test.mjs (planted-violation fixtures) so
// the audit and its self-test exercise the SAME logic — never a
// re-implementation in the test (that is exactly how a paper check hides).

/**
 * PULL-PLAN-RANK: does one plan row's stored ranks match what the policy
 * resolver would produce for its manifest version? Compared as an ordered
 * array — a rank at the wrong position is a real disagreement, not a
 * cosmetic one (the walk asks rank 1 first).
 *
 * `planRanks` = [plan.rank1Source, plan.rank2Source, plan.rank3Source]
 * filtered of nulls (mirrors field-plan-walk.ts's own `planRanks` build).
 * `policyRanks` = policy.ranks for the SAME (table, field, ipoType) at the
 * policy's own version — the caller resolves via the manifest version the
 * plan row itself recorded (plan.manifestVersion), never the CURRENT
 * manifest, so a row written under an older manifest version is judged
 * against the policy that produced it, not against today's manifest (that
 * mismatch is PULL-POLICY's job, not this check's).
 */
export function checkPlanRankMatchesPolicy(plan, policyRanks) {
  const planRanks = [plan.rank1Source, plan.rank2Source, plan.rank3Source].filter(Boolean);
  const policy = Array.isArray(policyRanks) ? policyRanks : [];
  if (planRanks.length !== policy.length || planRanks.some((s, i) => s !== policy[i])) {
    return `${plan.tableName}.${plan.fieldName} (${plan.rowKey || 'singleton'}): plan ranks [${planRanks.join(',')}] != policy ranks [${policy.join(',')}] at manifestVersion=${plan.manifestVersion}`;
  }
  return null;
}

/**
 * PULL-WRITE-POLICY: does a field_sources row's chosen source belong to the
 * policy's ranked set for that field/IPO-type at all? A source that WROTE a
 * value but is not in `policy.ranks` and is not `ADMIN` (the one source the
 * resolver deliberately never lists, §1) is a write the policy never
 * authorized — exactly the class the writer's own equivalence check (item
 * 11, `normalizeChosen`/`areEquivalent`) cannot catch, because those compare
 * VALUES between two answers, not "was this source allowed to answer at
 * all". ADMIN is always exempt: manual override always wins regardless of
 * manifest rank (matches `field-priority-matrix.ts`'s stated source order).
 */
export function checkWriteSourceInPolicy(fieldSourceRow, policyRanks) {
  const source = fieldSourceRow.source;
  if (source === 'ADMIN') return null;
  const policy = Array.isArray(policyRanks) ? policyRanks : [];
  if (!policy.includes(source)) {
    return `${fieldSourceRow.tableName}.${fieldSourceRow.fieldName} (${fieldSourceRow.rowKey || 'singleton'}): written by ${source}, not in policy ranks [${policy.join(',')}]`;
  }
  return null;
}

/**
 * PULL-POLICY: does the committed manifest equal what the generator would
 * produce right now? Wraps `generate-field-manifest.mjs --check`'s own exit
 * code — that script IS the spec-vs-committed comparison (S0b); this check
 * reuses it rather than re-implementing manifest generation a second time.
 * `runCheckFn` is injected (executFileSync wrapper) so the unit test can
 * plant a non-zero-exit fixture without touching the real committed file.
 */
export function checkManifestMatchesGenerator(runCheckFn) {
  const result = runCheckFn();
  if (result.exitCode !== 0) {
    return `field-manifest.json differs from scripts/generate-field-manifest.mjs's output (exit ${result.exitCode}): ${result.output.split('\n').slice(0, 3).join(' / ')}`;
  }
  return null;
}

/**
 * Rank lookup mirroring `scraper/src/config/field-source-policy.ts`'s
 * `resolveFieldSourcePolicy` (table/field/ipoType -> ranks array), read
 * directly off the parsed manifest JSON rather than importing the TS
 * resolver — `scripts/*.mjs` runs as plain Node ESM with no TS loader, and
 * every existing script in this family (`generate-field-manifest.mjs`,
 * `repair-invariants/plan-rank2-never-bse-for-issue-size.mjs`) already reads
 * this file directly rather than importing scraper/src. KNOWN DUPLICATION:
 * if the resolver's rank-lookup rule changes (fieldKey shape, `na` handling),
 * this lookup must change with it — the risk is scoped narrowly (one
 * function, no capability/override logic) and is the same trade-off the
 * generator itself already makes reading the spec file directly.
 */
export function lookupManifestRanks(manifest, table, field, ipoType) {
  const entry = manifest.fields?.[`${table}.${field}`];
  if (!entry) return null;
  const ranks = entry.rank?.[ipoType];
  return Array.isArray(ranks) ? ranks : [];
}

/**
 * Mirrors `resolveIpoTypeKey` (scraper/src/services/field-plan-generator.ts)
 * exactly — same two-line rule, duplicated for the same reason as
 * `lookupManifestRanks` above (no TS import from a plain .mjs script).
 */
export function ipoTypeKey(segment, listingExchanges) {
  if (segment !== 'SME') return 'MAINBOARD';
  return (listingExchanges ?? []).includes('NSE') ? 'SME_NSE' : 'SME_BSE';
}
