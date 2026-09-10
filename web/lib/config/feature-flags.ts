/**
 * Feature Flags Configuration (web)
 *
 * item 01 slice s5a: the web app has no feature flags of its own yet — this
 * module ships the slot-aware default helper (the deploy-time contract that
 * DEPLOY_SLOT must plumb into) with no flags wired to it. It mirrors
 * `scraper/src/config/feature-flags.ts#slotAwareFlagDefault` so the two apps
 * share one behaviour, not two independently-maintained copies.
 */

/**
 * Slot-aware feature-flag default (item 01 slice s5a).
 *
 * Resolves a flag's default from `DEPLOY_SLOT` so staging can default ON
 * without anyone editing a server env file, while prod stays OFF with no
 * action required:
 * - `DEPLOY_SLOT=staging` and no explicit value for `envVarName` -> true
 * - any other slot value, OR `DEPLOY_SLOT` unset/missing -> false (this is
 *   the case that protects production — the safe answer is the fallback,
 *   not something every slot has to opt into)
 * - an explicit `true`/`false` on the flag's OWN env var always wins over
 *   the slot default, in either direction (e.g. forcing a flag on for a
 *   one-off prod test, or off on staging to isolate a regression)
 *
 * No flag in the web app calls this yet (the web app has no flags today);
 * this ships the shared, tested primitive so the first web flag does not
 * need to re-derive it.
 */
export function slotAwareFlagDefault(envVarName: string): boolean {
  const explicit = process.env[envVarName];
  if (explicit === 'true') return true;
  if (explicit === 'false') return false;
  return process.env.DEPLOY_SLOT === 'staging';
}
