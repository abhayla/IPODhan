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

/**
 * PULL-OVERRIDES (item 3 slice S4): does every currently-active
 * `field_source_overrides` row still hold? A row is a violation when either:
 *   (a) it is past its `expires_at` but has no `expired_at` set (the CLI's
 *       `expire` was never run — the resolver already ignores it, but an
 *       unexpired-yet-stale row is a housekeeping signal: it should be
 *       cleaned up before it confuses the next `list`), or
 *   (b) it is still active (not expired either way) but is no longer VALID
 *       against the CURRENT manifest — a manifest change (capability flipped
 *       to false, or the field became class T) can invalidate a row that was
 *       valid when it was set. `validateCandidate` is injected so the audit
 *       script and this module's own test exercise the SAME logic as the
 *       CLI's `validateOverrideCandidate` (never a re-implementation).
 *
 * `rows` -- every override row with `expired_at IS NULL` (both active and
 * silently-stale candidates for (a); (b) only applies to rows that are
 * ALSO still time-active, i.e. `expires_at > now`).
 */
export function checkOverrideRow(row, now, validateCandidate) {
  const expiresAt = new Date(row.expiresAt);
  const isPastExpiry = expiresAt.getTime() <= now.getTime();

  if (isPastExpiry) {
    return {
      violation: `${row.id} (${row.tableName}.${row.fieldName}): expires_at ${row.expiresAt} is in the past but expired_at is not set — run \`expire ${row.id}\`.`,
      stillTimeActive: false,
    };
  }

  const failure = validateCandidate(
    {
      table: row.tableName,
      column: row.fieldName,
      ranks: [row.rank1Source, row.rank2Source, row.rank3Source].filter(Boolean),
      reason: row.reason,
    }
  );
  if (failure) {
    return {
      violation: `${row.id} (${row.tableName}.${row.fieldName}): no longer valid against the current manifest — ${failure.message}`,
      stillTimeActive: true,
    };
  }
  return { violation: null, stillTimeActive: true };
}

/**
 * Plain-JS mirror of `scraper/src/config/field-source-override-validation.ts`'s
 * `validateOverrideCandidate` (capable-source + S-05 rules only -- reason length and duplicate-
 * rank checks are a CLI-input concern, not a re-validation-against-drift concern, so they are not
 * repeated here). Reads the manifest JSON directly, same reason as `lookupManifestRanks` above (no
 * TS import from a plain .mjs script) -- KNOWN DUPLICATION, same scoped risk. MAJOR-3 fix (S4
 * review round 2): pinned against divergence by `scripts/tests/pull-policy-checks.test.mjs`'s
 * "validateOverrideCandidate and validateOverrideRankSet agree" cases, which import the REAL TS
 * validator directly (Node 22 native TS stripping) and compare its verdict to this mirror's on the
 * same candidates -- a future rule added to one but not the other fails that test.
 */
const DOCUMENT_SOURCES = new Set(['DOC', 'DRHP', 'RHP', 'PROSPECTUS', 'CORRIGENDUM', 'PRICE_BAND_AD']);

export function validateOverrideRankSet(manifest, table, column, ranks) {
  const fieldKey = `${table}.${column}`;
  const entry = manifest.fields?.[fieldKey];
  if (!entry) {
    return { message: `unknown field "${fieldKey}" -- no entry in the current field manifest.` };
  }
  if (entry.class === 'T') {
    const docSource = ranks.find((s) => DOCUMENT_SOURCES.has(s));
    if (docSource) {
      return { message: `"${fieldKey}" is an E-1 timetable field (S-05) -- may not rank a document source ("${docSource}").` };
    }
  }
  for (const source of ranks) {
    const capability = entry.capability?.[source];
    if (!capability || capability.capable === false) {
      return { message: `"${source}" is not a capable source for "${fieldKey}" per the current manifest.` };
    }
  }
  return null;
}
