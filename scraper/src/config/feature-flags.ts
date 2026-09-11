/**
 * Feature Flags Configuration
 * Controls gradual rollout of Data Flow Architecture Fix features
 *
 * Usage:
 * - Set environment variables to enable features
 * - Use percentage rollout for gradual deployment
 */

// Load environment variables if not already loaded
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: join(__dirname, '..', '..', '.env') });

/**
 * Slot-aware feature-flag default (item 01 slice s5a).
 *
 * Resolves a flag's default from `DEPLOY_SLOT` so staging can default ON
 * without anyone editing a server env file, while prod stays OFF with no
 * action required:
 * - `DEPLOY_SLOT=staging` and the env var is genuinely UNSET (`undefined`)
 *   -> true
 * - any other slot value, OR `DEPLOY_SLOT` unset/missing -> false (this is
 *   the case that protects production — the safe answer is the fallback,
 *   not something every slot has to opt into)
 * - an explicit value on the flag's OWN env var always wins over the slot
 *   default, in either direction (e.g. forcing a flag on for a one-off prod
 *   test, or off on staging to isolate a regression)
 *
 * `undefined` vs explicitly-empty are NOT the same thing and must not be
 * treated the same. `undefined` means the operator never set this var — that
 * is the only case that falls through to the slot default. An explicit but
 * EMPTY value (`FLAG=`, or whitespace-only) is what a deploy template
 * produces when `FLAG=${SOMEVAR}` is written but `SOMEVAR` never expanded —
 * a template bug, not an operator choosing "use the default". Silently
 * turning that into ON on staging is the same silent-wrong-direction hazard
 * an unrecognised spelling is, so it is treated exactly like one: warn and
 * fail closed to `false`, never the slot default.
 *
 * Every OTHER flag in this file (the ENABLE_* assignments below) uses the
 * strict `process.env.X === 'true'` convention — exact string, no other
 * spelling recognised, no logging. This helper does NOT reuse that as-is:
 * it is the one place an operator's raw env spelling decides which of TWO
 * live defaults (staging-ON vs prod-OFF) a flag takes, so an unrecognised
 * spelling is a real hazard in BOTH directions — `FLAG=0` on staging must
 * not silently stay ON, and `FLAG=1`/`TRUE`/`yes` on prod must not silently
 * fall through to OFF. Recognised spellings (case-insensitive, trimmed):
 *   truthy: true, 1, yes, on
 *   falsy:  false, 0, no, off
 * Anything else — including empty/whitespace-only — is logged (flag name +
 * raw value) and resolved to `false` — the fail-closed safe value, NEVER the
 * slot default — so a typo (or an unexpanded template variable) is visible
 * in the logs instead of silently picking a live behaviour.
 * This widening is scoped to this opt-in helper only; the plain `=== 'true'`
 * flags above are untouched.
 */
const SLOT_AWARE_TRUTHY = new Set(['true', '1', 'yes', 'on']);
const SLOT_AWARE_FALSY = new Set(['false', '0', 'no', 'off']);

export function slotAwareFlagDefault(envVarName: string): boolean {
  const explicit = process.env[envVarName];
  // Only a genuinely UNSET var (`undefined`) falls through to the slot
  // default. An explicit empty string is handled below, identically to an
  // unrecognised value — see the doc comment above.
  if (explicit === undefined) {
    return process.env.DEPLOY_SLOT === 'staging';
  }
  const normalized = explicit.trim().toLowerCase();
  if (normalized === '') {
    console.warn(
      `slotAwareFlagDefault: ${envVarName} is explicitly set but empty — treating as unrecognised (fail-closed to false), not the slot default. This usually means a deploy-template variable (e.g. FLAG=\${SOMEVAR}) that did not expand — fix the template.`
    );
    return false;
  }
  if (SLOT_AWARE_TRUTHY.has(normalized)) return true;
  if (SLOT_AWARE_FALSY.has(normalized)) return false;
  console.warn(
    `slotAwareFlagDefault: unrecognised value ${envVarName}=${explicit} — treating as false (fail-closed), not the slot default.`
  );
  return false;
}

/**
 * Feature flag configuration
 * All flags default to false/0 for safety.
 *
 * REVIEWED EXCEPTION (item 01 slice s5a, T-item01-s5a): a flag that explicitly
 * reads its default via `slotAwareFlagDefault()` below may default ON for the
 * `staging` deploy slot instead of false. This is opt-in per flag (nothing
 * above is rewired by this slice) and the fallback for prod, local, and any
 * unset/unknown slot is still false — the safety default this comment
 * describes is unchanged for every flag that does not call the helper.
 */
export const FEATURE_FLAGS = {
  // ==================== CORE FEATURES ====================

  /**
   * Enable field source tracking
   * When enabled, records which scraper provided each field value
   * Default: false (Phase 0 foundation)
   */
  ENABLE_SOURCE_TRACKING: process.env.ENABLE_SOURCE_TRACKING === 'true',

  /**
   * Enable conflict detection and logging
   * When enabled, logs conflicts between scrapers to database
   * Default: false (Phase 0 foundation)
   */
  ENABLE_CONFLICT_DETECTION: process.env.ENABLE_CONFLICT_DETECTION === 'true',

  /**
   * Item 12 slice D: log LIVE rows that fold to one company identity on the
   * same open date. OBSERVE ONLY - never merges, never writes, and cannot
   * change which row resolveIpoRow returns.
   *
   * Plain `=== 'true'` on purpose, NOT slotAwareFlagDefault(): that helper
   * returns true on staging when unset, and this must be OFF in every slot
   * until someone sets it. Read by packages/shared (which cannot import this
   * file); this entry is the discoverable registration.
   */
  ENABLE_DISCOVERY_DUPLICATE_CHECK: process.env.ENABLE_DISCOVERY_DUPLICATE_CHECK === 'true',

  /**
   * Item 12 slice E: bind a GMP list row to an IPO by EXACT normalized name
   * when several IPOs share the same open+close dates, instead of accepting
   * the best character-similarity guess above 0.6.
   *
   * Measured before it was built: the similarity path is not a rare fallback
   * - 194 of 333 production rows (58%) sit in a shared date window. Against
   * the 29 real records in the captured fixture, exact name binds 24 to ONE
   * row with ZERO ambiguities, so exact name is already unique wherever it
   * matches and the 0.6 threshold can only add wrong answers.
   *
   * Cost while OFF-to-ON: four records (Jindal Supreme, Steamhouse, Asset
   * Reconstruction, Glass Wall Systems) stop binding until their stored names
   * align with the source's shorter form.
   *
   * Plain `=== 'true'`, NOT slotAwareFlagDefault(): this changes what gets
   * WRITTEN, so it must be off in every slot until someone turns it on.
   */
  ENABLE_STRICT_LIST_BINDING: process.env.ENABLE_STRICT_LIST_BINDING === 'true',

  /**
   * Enable data consolidation service
   * When enabled, uses smart merging with priority matrix
   * Default: false (Phase 1)
   */
  // T-467 round 4 (Tier A LOW): prettier-ignore -- this line is 100+ chars
  // and a re-wrap that pushes the `// PROD-REQUIRED-TRUE` marker onto its
  // own line breaks scripts/assert-env-keys.sh's marker grep (it requires
  // the key and its marker to share one line). No .prettierignore exists in
  // this repo today; this comment is belt-and-braces if one is ever added.
  // prettier-ignore
  ENABLE_DATA_CONSOLIDATION: process.env.ENABLE_DATA_CONSOLIDATION === 'true', // PROD-REQUIRED-TRUE (T-297 D9 / #193 -- rollout-flag liveness)

  /**
   * Enable early IPO detection (SEBI monitoring)
   * When enabled, detects IPOs 30-60 days before opening
   * Default: false (Phase 3)
   */
  ENABLE_EARLY_DETECTION: process.env.ENABLE_EARLY_DETECTION === 'true',

  /**
   * Enable normalized-company-name matching for InvestorGain GMP rows.
   * When enabled, GMP rows resolve to an IPO by normalized company name FIRST,
   * falling back to exact open/close-date matching. Lifts GMP coverage from the
   * few date-exact matches to all current IPOs (incl. symbol-less SME). (#6/#8)
   * Default: false
   */
  ENABLE_GMP_NAME_MATCH: process.env.ENABLE_GMP_NAME_MATCH === 'true',

  /**
   * Enable persisting Moneycontrol-scraped subscription %s into the
   * subscriptions table, matched by normalized company name (covers SME IPOs
   * that lack an NSE/BSE symbol). NSE/BSE symbol-based capture stays primary.
   * Default: false
   */
  ENABLE_MONEYCONTROL_SUBSCRIPTION: process.env.ENABLE_MONEYCONTROL_SUBSCRIPTION === 'true',

  /**
   * Enable the in-app scheduled InvestorGain GMP job (runs the GMP writer every
   * 6h so gmp_records stays fresh — the root-cause fix for frozen GMP coverage).
   * GATED OFF by default; activation in prod is Abhay's call (it must be paired
   * with retiring the external PM2 GMP run to avoid double-writes). (#6/#8)
   * Default: false
   */
  ENABLE_GMP_SCHEDULED_JOB: process.env.ENABLE_GMP_SCHEDULED_JOB === 'true',

  /**
   * Source the BSE IPO list+detail from BSE's JSON API (IPO_HomePageDetail/w +
   * GetMkt_ISSUE_BBS_IPO/w) instead of the broken Puppeteer/HTML scrapers (BSE
   * migrated to a SPA). Fills issue_size/lot/registrar/price-band/lead-managers.
   * GATED OFF by default; activation in prod is Abhay's call (deploy). (#enrich)
   * Default: false
   */
  ENABLE_BSE_API: process.env.ENABLE_BSE_API === 'true',

  /**
   * Enable the primary-source document discovery spine (Stage B of the
   * 2026-06-19 IPO-data-pipeline contract): discover the company's own filings
   * (RHP/DRHP/ADDENDUM/ANCHOR) from NSE/BSE/SEBI incl. SME boards, instead of
   * relying only on the Chittorgarh aggregator. Pure parsing core ships first;
   * live fetch + persistence + scheduler wiring land in the network session.
   * GATED OFF by default; activation in prod is Abhay's call (deploy/cron).
   * Default: false
   */
  ENABLE_PRIMARY_SOURCE_DISCOVERY: process.env.ENABLE_PRIMARY_SOURCE_DISCOVERY === 'true',

  /**
   * Enable the stage-transition reconciler (Stage F of the 2026-06-19 IPO-data-
   * pipeline contract): compute each IPO's lifecycle stage and enqueue only the
   * data fetches that are due-but-missing as it crosses DRHP→RHP→OPEN→CLOSED→LISTED,
   * instead of blindly running every scraper on a fixed timer. Pure planner core
   * (stage-reconciler.ts) ships first; the live query+enqueue+cron wiring is GATED
   * OFF and activated only on Abhay's §GATE (deploy/cron).
   * Default: false
   */
  ENABLE_STAGE_RECONCILER: process.env.ENABLE_STAGE_RECONCILER === 'true',

  /**
   * Enable the per-document fetch STATE MACHINE (T-403 WP B): replace the
   * once-daily, NSE-only, memoryless discovery pass with a per-cycle,
   * BSE-first pass that asks `document_fetch_state` what is still missing and
   * makes zero network calls for an IPO whose filings are all accounted for.
   *
   * Separate from ENABLE_PRIMARY_SOURCE_DISCOVERY (already true in prod) on
   * purpose: that flag gates whether document discovery runs at all, this one
   * gates WHICH implementation runs. Turning the new machine on and off is a
   * one-variable, reversible decision, and state rows persist across the flip (R13).
   *
   * HONEST SCOPE (T-403 M5): this flag does NOT gate everything in T-403. The
   * CLASSIFIER fix lives in `primary-source-discovery.ts`, which the flag-OFF
   * legacy backfill also calls, so with the flag off that path still classifies
   * better than it used to. It is prevented from emitting a post-0035 enum value
   * into a database that lacks it by `toPre0035DocumentType`.
   *
   * DEPLOY DEPENDENCY: migration 0035 MUST be applied before this flag is turned
   * on. `deploy-linux.sh` migrates before flipping traffic and
   * `assert-migrations-applied.sh` blocks the deploy on any gap, so the ordering
   * is enforced rather than assumed — but flipping the flag on a database
   * without 0035 would fail on the first document write.
   * GATED OFF by default; activation in prod is Abhay's call (deploy). (T-403)
   * Default: false
   */
  ENABLE_DOCUMENT_STATE_MACHINE: process.env.ENABLE_DOCUMENT_STATE_MACHINE === 'true',

  /**
   * Enable the periodic duplicate-IPO sweep job (P2-2b, round-4 review, T-293):
   * re-runs `merge-duplicate-ipos.ts`'s two-tier clustering (exact-normalized-
   * name UNION Levenshtein-typo) every cycle so a duplicate pair that slips
   * past the create-time check converges instead of living in prod forever.
   * Job runs DRY-RUN (report/log only) at all times, regardless of this flag —
   * this flag only gates whether the job runs AT ALL on the cron schedule.
   * Actual merge/delete (`dryRun: false`) is never wired to the cron path in
   * this build; a separate, explicit activation is Abhay's call.
   * Default: false
   */
  ENABLE_DUPLICATE_SWEEP_JOB: process.env.ENABLE_DUPLICATE_SWEEP_JOB === 'true',

  /**
   * Enable the "due-step" cycle (S-02 §5): replaces the flat "run every
   * source every 30 minutes regardless of IPO status or time of day" shape
   * of `--source=all` with a schedule-aware cycle — NSE/BSE discovery only at
   * 4 fixed IST slots/day (with catch-up), the stage reconciler every cycle,
   * live data (subscription/GMP/demand graph) only during market hours for
   * OPEN IPOs, and aggregator refresh (Moneycontrol/Chittorgarh) only for
   * UPCOMING/OPEN IPOs at most once/day. A Redis lock (`scraper:cycle`)
   * makes this safe under PM2's 30-minute `cron_restart` force-kill.
   * With the flag OFF (default), the SCHEDULE is unchanged — every source runs
   * on every 30-minute cycle, the legacy rollback path.
   *
   * What the flag does NOT gate (round-3 correction): the no-op write
   * suppression and the strict normalized field comparison at the `ipos` write
   * door (`data-persister.ts#diffFieldsForWrite`) apply on BOTH paths. They are
   * correctness fixes — do not write a row that is already identical, and do
   * write one that differs — not scheduling behaviour.
   *
   * Also flag-gated, alongside the schedule: the freshness SLO set
   * (`config/freshness-slo.ts#getActiveFreshnessSLOs`), because the flat-cadence
   * thresholds would page P1 hourly against the spaced-out due-step schedule.
   * See `scraper/src/scheduler/due-step-cycle.ts`.
   * Default: false
   */
  ENABLE_DUE_STEP_SCHEDULER: process.env.ENABLE_DUE_STEP_SCHEDULER === 'true',

  /**
   * Enable AUTOMATIC filing extraction + persistence inside the document cycle
   * (S-02). MAJOR-4: this flag gates ONLY the python extraction + persist
   * block below — it does NOT gate the step ledger. With the flag OFF, which
   * is the default and what production runs today, the discovery, document,
   * live-number, and reconciler hooks in `step-ledger-recorders.ts` still run
   * on every cycle and still write `ipo_pipeline_steps` rows (52 rows per new
   * IPO via `initStepLedger`, plus per-cycle step upserts; `writeSteps` never
   * throws, so a ledger failure cannot fail a scrape). What does NOT happen
   * with the flag off: the document cycle discovers and stores PDFs and stops
   * there — a stored RHP / price-band ad is turned into `ipos`,
   * `financial_statements`, `promoters`, `ipo_valuation`, … rows only by a
   * human running `scripts/persist-filing.ts`.
   *
   * With the flag on, `processPendingFilings` spawns the deterministic python
   * extractor for every stored-but-not-yet-extracted document and writes the
   * result through the SAME write door the CLI uses (`persistFilingExtraction`
   * with the admin protection filter and the W-45 paired-agreement gate) —
   * never a second write path. It is capped at `DEFAULT_MAX_SPAWNS_PER_CYCLE`
   * python spawns per document cycle and serialized across cycles by a Redis
   * lock (`filing-auto-persist.ts` / `document-cycle.ts`, MAJOR-1).
   *
   * Separate from ENABLE_DOCUMENT_STATE_MACHINE on purpose: that flag decides
   * whether documents are FOUND at all; this one decides whether finding one
   * automatically changes published data. Turning it on in production remains
   * a distinct owner decision (§GATE) because it is the first time a scrape
   * can rewrite a static field with no human in the loop.
   *
   * Default: SLOT-DEPENDENT via `slotAwareFlagDefault`, not the flat `false`
   * this comment used to claim. With the var genuinely unset: `true` on
   * `DEPLOY_SLOT=staging`, `false` on prod and on every other/unset slot. The
   * production gate is NOT weakened by this — it is moved, and it is the
   * EXPLICIT env value that carries it: prod acquires this flag only when an
   * operator writes it into the prod env file, which is exactly the §GATE
   * decision above. An explicit value always beats the slot default in both
   * directions, so `=false` on staging isolates a regression and `=true` on
   * prod is the owner's one deliberate way to switch it on there.
   *
   * Staging defaults ON so the auto-persist path is actually exercised on a
   * slot whose cycle logs and database can be READ, instead of being provable
   * only by an env edit on a live server. See `slotAwareFlagDefault` above for
   * the unset-vs-explicitly-empty distinction: an unexpanded deploy-template
   * variable (`FLAG=${SOMEVAR}`) warns and fails closed to `false`, never to
   * the staging default.
   */
  ENABLE_FILING_AUTO_PERSIST: slotAwareFlagDefault('ENABLE_FILING_AUTO_PERSIST'),

  /**
   * D-15 lift: let SME candidates through the SAME auto-persist door as
   * MAINBOARD, instead of the unconditional skip in `processPendingFilings`
   * (which otherwise writes an E1 ledger row with evidence reason
   * `sme_not_validated` and spawns nothing for every SME IPO).
   *
   * With this flag on, an SME candidate is extracted+persisted through the
   * identical write path MAINBOARD already uses — `persistFilingExtraction`
   * with the admin protection filter and the W-45 paired-agreement gate — with
   * `sme: true` passed to the extractor and the W-129 plausibility checks
   * (issue-size-wired) applied exactly as they are for MAINBOARD. No second
   * write path, no relaxed gate.
   *
   * With this flag off (the default), behaviour is byte-for-byte what shipped
   * under D-15: every SME candidate is skipped and gets one E1 ledger row.
   *
   * Independent of `ENABLE_FILING_AUTO_PERSIST` — this flag only matters once
   * that one is already on; it narrows/widens which SEGMENT the already-on
   * auto-persist path covers.
   *
   * The SME walk (W-128 financials exact, W-129 plausibility with issue-size
   * wiring, W-130 subscription, W-132 anchors) passed in production on
   * Qualiance International on 2026-09-04. Turning this on is a distinct
   * owner decision (§GATE), same class as `ENABLE_FILING_AUTO_PERSIST` itself.
   * Default: false
   */
  ENABLE_SME_FILING_AUTO_PERSIST: process.env.ENABLE_SME_FILING_AUTO_PERSIST === 'true',

  /**
   * T-478 round 2 (issue #225 follow-up): gates the NSE OFS category fetch
   * (`fetchAllIPOs('ofs')`) wired into the discovery step. The live OFS
   * payload SHAPE is unverified — no real OFS book has been observed since
   * this wiring landed (the capture fixture is IPO-shaped, not OFS-shaped;
   * see tests/fixtures/nse/). Default: false (prod stays off). Staging gets
   * this on to observe a real OFS book and capture its fixture before prod
   * enablement — see the follow-up issue linked from PR #362.
   */
  ENABLE_NSE_OFS: process.env.ENABLE_NSE_OFS === 'true',

  /**
   * #468: gates the rank-2 (UPCOMING/PRE_OPEN) discovery-budget reservation
   * in `runDocumentCycle` (`scraper/src/services/document-cycle.ts`) that
   * mirrors the existing rank-3 (LISTED, W-136) and rank-4 (purge, W-124)
   * reservations. Scheduler work-selection change — default OFF, per the
   * parent contract's default for this class of change. A flag left off
   * does NOT fix the underlying starvation; the owner must set this to
   * 'true' (staging first, then prod) for the fix to take effect.
   */
  // s0d: converted from `=== 'true'` to the slot-aware default. This flag was
  // introduced by this run and has never been deployed, so decision 28's
  // "never convert" (which protects pre-existing flags that may carry a prod
  // env value of unknown spelling) does not apply. It was OFF on staging,
  // which would have made its own staging proof measure a disabled feature.
  ENABLE_UPCOMING_DISCOVERY_RESERVATION: slotAwareFlagDefault('ENABLE_UPCOMING_DISCOVERY_RESERVATION'),

  /**
   * Item 22 slice 2: gates `defaultFetcher`'s streaming rewrite
   * (`document-discovery-runner.ts`) — counts bytes as they arrive and
   * aborts once the running total exceeds the document byte cap, instead of
   * buffering the whole response into memory before checking its size.
   * Default OFF until proven against a real large fixture in staging (see
   * the item-22 build card's Staging proof section); flag OFF is
   * byte-identical to the pre-existing buffer-then-check path.
   */
  // s0d deliberately did NOT convert this one, and the reason is a real
  // ordering constraint rather than caution: slot-aware means ON in staging,
  // and when the cap trips today `defaultFetcher` returns `status: 0` — the
  // SAME shape a timeout returns, by explicit design ("no caller needs a new
  // branch for too-big versus timed-out"). Switching the cap on in staging
  // before that refusal is distinguishable would make every over-size refusal
  // read as a timeout in the attempt log, which is precisely the D17 gap the
  // item-22 card names. It converts in the slice that gives the over-cap
  // refusal its own status, alongside `refused:resolved_private_address`.
  ENABLE_DOWNLOAD_STREAMING_CAP: process.env.ENABLE_DOWNLOAD_STREAMING_CAP === 'true',

  /**
   * OD-37 item 22 slice 3: refuse a host whose RESOLVED address is private,
   * loopback, link-local or the cloud metadata address, on EVERY fetch rung.
   *
   * Gated because it changes behaviour at the network boundary in a way that
   * can stop discovery: the check fails CLOSED, so a DNS failure REFUSES the
   * host rather than letting the fetch attempt and fail normally. That is the
   * right posture for a security boundary and the wrong thing to switch on
   * everywhere untested — a resolver blip would read as "every source failed".
   *
   * Uses `slotAwareFlagDefault` (item 01 slice s5a) rather than `=== 'true'`:
   * this flag has never been deployed, so it is exactly what that helper is
   * for. It defaults ON in staging, where the refusal log can be READ, and OFF
   * everywhere else until that reading exists.
   */
  ENABLE_RESOLVED_ADDRESS_REFUSAL: slotAwareFlagDefault('ENABLE_RESOLVED_ADDRESS_REFUSAL'),

  /**
   * Item 1 slice s5b: routes CHILD-table writes through
   * `DataConsolidationOrchestrator.consolidatedUpsertChildRows` — per-field
   * source-priority resolution plus a per-ROW `field_sources` provenance row —
   * instead of the direct repository upsert that resolves nothing.
   *
   * Scope while this stays a slice: `financial_statements` ONLY. The other
   * seven child tables named on the item-1 card still take the old path and
   * are unaffected by this flag; they arrive in s7a/s7b.
   *
   * OFF must be BYTE-IDENTICAL to the pre-slice write — the call site branches
   * on the flag and, when it is off, runs the untouched original upsert.
   *
   * Uses `slotAwareFlagDefault` (slice s5a) rather than `=== 'true'`: this
   * changes which of two sources' numbers a real IPO ends up showing, so it
   * defaults ON in staging (where a cycle can be READ against real documents)
   * and OFF in prod and every unset slot until that read exists.
   */
  ENABLE_CHILD_TABLE_CONSOLIDATION: slotAwareFlagDefault('ENABLE_CHILD_TABLE_CONSOLIDATION'),

  /**
   * Item 2 slice 4: gates whether the CLI entry point (the guard at the
   * bottom of `scraper/src/index.ts`) validates `scraper/config/field-manifest.json`
   * at process start. Default: false (Phase 0 — plain `process.env.X === 'true'`
   * pattern, matching `ENABLE_DATA_CONSOLIDATION` above, per the item-02 build
   * card's own text). Nothing reads the manifest yet (item 3 wires the matrix
   * to it) so a malformed file is harmless while this stays off; it exists so
   * item 3 can flip it once there is something to protect. Flag OFF is a
   * pure no-op — the loader import never even runs `loadFieldManifest()`.
   */
  ENABLE_FIELD_MANIFEST: process.env.ENABLE_FIELD_MANIFEST === 'true',

  /**
   * Item 4 (OD-21) — per-field validation before the write. OFF:
   * `consolidateField` behaves exactly as today (the gate never runs, no
   * `field_extraction_failures` row is ever written). ON: every incoming
   * field value is judged by the date-scoped, offering-type-scoped rule that
   * covers it; a failing field is dropped ON ITS OWN and recorded with its
   * cause, while every other field on the same document still writes.
   *
   * Default `false` in EVERY slot at merge time — this is a Tier A write-path
   * change and defect-fix-contract.md requires the staging proof before the
   * behaviour is live anywhere. Flipped on staging by hand once the proof is
   * read. Module-load-time flag, so a flip needs a process restart.
   */
  ENABLE_FIELD_EXTRACTION_VALIDATION: process.env.ENABLE_FIELD_EXTRACTION_VALIDATION === 'true',

  // ==================== ROLLOUT CONTROLS ====================
  // T-297 D9 / #193: this file is the SSOT for which flags gate live logic
  // in prod. `// LIVE-GATE` on a *_PERCENTAGE field and `// PROD-REQUIRED-TRUE`
  // on a boolean field are read by scripts/assert-env-keys.sh
  // (assert_rollout_flags_live) at deploy time on the prod slot: a LIVE-GATE
  // percentage of 0, or a PROD-REQUIRED-TRUE flag not literally 'true', fails
  // the deploy — this is what would have caught CONSOLIDATION_PERCENTAGE=0
  // silently voiding the entire consolidation pipeline (T-282). A new
  // percentage flag is deliberately NOT marked LIVE-GATE until its call site
  // actually reads it (SOURCE_TRACKING_PERCENTAGE / CONFLICT_DETECTION_PERCENTAGE
  // are real examples of unmarked percentage flags — see T-309 below).

  /**
   * Percentage of IPOs to use source tracking (0-100)
   * Enables gradual rollout with hash-based distribution
   * Default: 0 (disabled)
   */
  SOURCE_TRACKING_PERCENTAGE: parseInt(process.env.SOURCE_TRACKING_PERCENTAGE || '0'),

  /**
   * Percentage of IPOs to use conflict detection (0-100)
   * Default: 0 (disabled)
   */
  CONFLICT_DETECTION_PERCENTAGE: parseInt(process.env.CONFLICT_DETECTION_PERCENTAGE || '0'),

  /**
   * Percentage of IPOs to use data consolidation (0-100)
   * Default: 0 (disabled)
   */
  // T-467 round 4 (Tier A LOW): prettier-ignore -- same reason as
  // ENABLE_DATA_CONSOLIDATION above: a re-wrap must not split this key from
  // its `// LIVE-GATE` marker.
  // prettier-ignore
  CONSOLIDATION_PERCENTAGE: parseInt(process.env.CONSOLIDATION_PERCENTAGE || '0'), // LIVE-GATE (T-297 D9 / #193 -- 0 silently disables the whole consolidation pipeline, T-282)

  // ==================== TESTING & DEBUG ====================

  /**
   * Verbose logging for data flow operations
   * Default: false
   */
  DEBUG_DATA_FLOW: process.env.DEBUG_DATA_FLOW === 'true',

  /**
   * Specific scrapers to enable features for (comma-separated)
   * Example: 'NSE,BSE' - only enable for NSE and BSE scrapers
   * Default: empty (all scrapers)
   */
  ENABLED_SCRAPERS: (process.env.ENABLED_SCRAPERS || '').split(',').filter(Boolean),

  /**
   * Specific IPO IDs to enable features for (comma-separated)
   * Useful for targeted testing
   * Default: empty (all IPOs)
   */
  ENABLED_IPO_IDS: (process.env.ENABLED_IPO_IDS || '').split(',').filter(Boolean),

  // ==================== PERFORMANCE TUNING ====================

  /**
   * Maximum conflict logs per IPO per run
   * Prevents excessive logging for problematic IPOs
   * Default: 50
   */
  MAX_CONFLICTS_PER_IPO: parseInt(process.env.MAX_CONFLICTS_PER_IPO || '50'),

  /**
   * Batch size for bulk source tracking
   * Default: 100 fields per batch
   */
  SOURCE_TRACKING_BATCH_SIZE: parseInt(process.env.SOURCE_TRACKING_BATCH_SIZE || '100'),
};

/**
 * Check if feature should be used for a given IPO
 * Uses consistent hashing for percentage-based rollout
 */
export function shouldUseFeature(
  feature: keyof typeof FEATURE_FLAGS,
  ipoId?: string,
  scraperSource?: string
): boolean {
  const flag = FEATURE_FLAGS[feature];

  // Boolean flags
  if (typeof flag === 'boolean') {
    return flag;
  }

  // Percentage flags
  // Item 1 slice s5b: a PERCENTAGE feature is a per-ipoId hash rollout
  // (`simpleHash(ipoId) % 100 < flag`), so it NEEDS an id. Without this throw,
  // an empty id fell past the branch below and out the `return false` at the
  // end of this function: consolidation DISABLED on a slot whose environment
  // reads `CONSOLIDATION_PERCENTAGE=100`. `ipoId` is typed `string`, so `''`
  // is a valid value TypeScript cannot reject — the type system will never
  // catch this. A configuration that reads 100 and behaves as 0 is worse than
  // a crash, and the crash names the caller.
  //
  // Thrown HERE, not at the `data-consolidation-service.ts:628` call site,
  // because the emptiness is a property of THIS function's contract, not of
  // that one caller: any future percentage feature inherits the guard, and
  // there is exactly one such caller today (swept 2026-09-11), so the choke
  // point costs nothing and covers everything.
  if (typeof flag === 'number' && feature.includes('PERCENTAGE') && !ipoId) {
    throw new Error(
      `shouldUseFeature('${feature}') requires a non-empty ipoId: a percentage rollout is a ` +
        `per-IPO hash, and an empty id silently reads as 0% while the flag is ${flag}.`
    );
  }

  if (typeof flag === 'number' && ipoId && feature.includes('PERCENTAGE')) {
    // Use hash of IPO ID for consistent distribution
    const hash = simpleHash(ipoId);
    return (hash % 100) < flag;
  }

  // Array flags (scrapers, IPO IDs)
  if (Array.isArray(flag)) {
    if (scraperSource && flag.length > 0) {
      return flag.includes(scraperSource);
    }
    if (ipoId && flag.length > 0) {
      return flag.includes(ipoId);
    }
    // Empty array means all items
    return flag.length === 0;
  }

  return false;
}

/**
 * Simple hash function for consistent percentage-based rollout
 * Uses IPO ID to determine if feature should be enabled
 */
function simpleHash(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash);
}

/**
 * Get feature status summary (for logging/debugging)
 */
export function getFeatureStatus(): Record<string, boolean | number | string[]> {
  return {
    SOURCE_TRACKING: FEATURE_FLAGS.ENABLE_SOURCE_TRACKING,
    CONFLICT_DETECTION: FEATURE_FLAGS.ENABLE_CONFLICT_DETECTION,
    DATA_CONSOLIDATION: FEATURE_FLAGS.ENABLE_DATA_CONSOLIDATION,
    EARLY_DETECTION: FEATURE_FLAGS.ENABLE_EARLY_DETECTION,
    SOURCE_TRACKING_PCT: FEATURE_FLAGS.SOURCE_TRACKING_PERCENTAGE,
    CONFLICT_DETECTION_PCT: FEATURE_FLAGS.CONFLICT_DETECTION_PERCENTAGE,
    CONSOLIDATION_PCT: FEATURE_FLAGS.CONSOLIDATION_PERCENTAGE,
    // Item 1 slice s5b: the child-table writer sits BEHIND the two lines
    // above. All three are logged together so a reader never has to guess
    // which of the three gates a quiet cycle came from.
    CHILD_TABLE_CONSOLIDATION: FEATURE_FLAGS.ENABLE_CHILD_TABLE_CONSOLIDATION,
    FILING_AUTO_PERSIST: FEATURE_FLAGS.ENABLE_FILING_AUTO_PERSIST,
    SME_FILING_AUTO_PERSIST: FEATURE_FLAGS.ENABLE_SME_FILING_AUTO_PERSIST,
    DEBUG_MODE: FEATURE_FLAGS.DEBUG_DATA_FLOW,
    ENABLED_SCRAPERS: FEATURE_FLAGS.ENABLED_SCRAPERS,
  };
}

/**
 * Validate feature flag configuration
 * Throws error if invalid configuration detected
 */
export function validateFeatureFlags(): void {
  // Check percentage values are 0-100
  const percentageFlags = [
    'SOURCE_TRACKING_PERCENTAGE',
    'CONFLICT_DETECTION_PERCENTAGE',
    'CONSOLIDATION_PERCENTAGE',
  ] as const;

  for (const flag of percentageFlags) {
    const value = FEATURE_FLAGS[flag];
    if (value < 0 || value > 100) {
      throw new Error(`Feature flag ${flag} must be between 0 and 100, got ${value}`);
    }
  }

  // T-309 (T-305 round-6 P3): SOURCE_TRACKING_PERCENTAGE and
  // CONFLICT_DETECTION_PERCENTAGE are NEVER consulted by shouldUseFeature() at
  // any call site (grep confirms ENABLE_SOURCE_TRACKING / ENABLE_CONFLICT_DETECTION
  // gate `data-consolidation-service.ts` and `data-persister.ts` as PLAIN
  // BOOLEANS, with no percentage check anywhere) — unlike DATA_CONSOLIDATION,
  // whose CONSOLIDATION_PERCENTAGE genuinely IS read via
  // `shouldUseFeature('CONSOLIDATION_PERCENTAGE', ...)` in
  // data-consolidation-service.ts. A warning that checks a percentage which is
  // not the real gate is FALSE: it fired every cycle in prod
  // (ENABLE_SOURCE_TRACKING=true, SOURCE_TRACKING_PERCENTAGE unset=0) while
  // `field_sources`/`data_conflicts` were genuinely being written (~40x/cycle,
  // 695KB of misleading noise). Removed for these two flags; kept for
  // DATA_CONSOLIDATION below, whose percentage is the real gate.
  if (FEATURE_FLAGS.ENABLE_DATA_CONSOLIDATION && FEATURE_FLAGS.CONSOLIDATION_PERCENTAGE === 0) {
    console.warn('⚠️  DATA_CONSOLIDATION enabled but percentage is 0% - no IPOs will use it');
  }

  // Item 1 slice s5b: ENABLE_CHILD_TABLE_CONSOLIDATION is the THIRD gate in a
  // chain, not a switch. `consolidateIPOData` returns `fallbackConsolidation`
  // — incoming accepted, ZERO priority resolution, ZERO provenance — unless
  // ENABLE_DATA_CONSOLIDATION is true AND CONSOLIDATION_PERCENTAGE covers the
  // IPO. Staging and prod already carry both, so this is a FRESH-ENVIRONMENT
  // trap: CI's integration job, a developer laptop, the next box. Those are
  // exactly the places a quiet cycle gets written down as a proof. The line
  // prints the OTHER two values, because "misconfigured" sends the reader to
  // check the wrong one.
  if (
    FEATURE_FLAGS.ENABLE_CHILD_TABLE_CONSOLIDATION &&
    (!FEATURE_FLAGS.ENABLE_DATA_CONSOLIDATION || FEATURE_FLAGS.CONSOLIDATION_PERCENTAGE === 0)
  ) {
    console.warn(
      '⚠️  child-table consolidation flag is ON but the path is unreachable: ' +
        `ENABLE_DATA_CONSOLIDATION=${FEATURE_FLAGS.ENABLE_DATA_CONSOLIDATION} ` +
        `CONSOLIDATION_PERCENTAGE=${FEATURE_FLAGS.CONSOLIDATION_PERCENTAGE}`
    );
  }

  // T-278 P3-5: ENABLE_SOURCE_TRACKING is a hard prerequisite for
  // ENABLE_CONFLICT_DETECTION to ever record anything. Conflict detection
  // compares an incoming value against the LAST source recorded in
  // field_sources; if source tracking is off, that baseline is never
  // written, so consolidateField() always takes the "no existing value"
  // branch and conflictsDetected stays 0 forever even while consolidation
  // itself runs normally. This combination previously shipped silently —
  // warn loudly so it's never invisible again.
  if (FEATURE_FLAGS.ENABLE_DATA_CONSOLIDATION && !FEATURE_FLAGS.ENABLE_SOURCE_TRACKING) {
    console.warn(
      '⚠️  DATA_CONSOLIDATION is enabled but SOURCE_TRACKING is not — conflictsDetected will stay 0 forever (no field_sources baseline is ever persisted). See T-278 P3-5.'
    );
  }
}

/**
 * Log feature flag status at startup
 */
export function logFeatureFlags(): void {
  console.log('\n📋 Data Flow Architecture - Feature Flags Status:');
  console.log('================================================');

  const status = getFeatureStatus();
  for (const [key, value] of Object.entries(status)) {
    const icon = value ? '✅' : '❌';
    if (Array.isArray(value)) {
      console.log(`${icon} ${key}: [${value.join(', ') || 'ALL'}]`);
    } else {
      console.log(`${icon} ${key}: ${value}`);
    }
  }

  console.log('================================================\n');

  // Validate configuration
  try {
    validateFeatureFlags();
  } catch (error) {
    console.error('❌ Feature flag validation failed:', error);
    throw error;
  }
}

// Export utility functions
export { simpleHash };
