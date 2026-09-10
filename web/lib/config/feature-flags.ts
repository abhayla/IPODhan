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
 * The web app has no other flags to derive a convention from (see the file
 * header). This mirrors the scraper's copy exactly: an unrecognised spelling
 * is a hazard in BOTH directions — `FLAG=0` on staging must not silently
 * stay ON, `FLAG=1`/`TRUE`/`yes` on prod must not silently fall through to
 * OFF. Recognised spellings (case-insensitive, trimmed):
 *   truthy: true, 1, yes, on
 *   falsy:  false, 0, no, off
 * Anything else — including empty/whitespace-only — is logged (flag name +
 * raw value) and resolved to `false` — the fail-closed safe value, NEVER the
 * slot default — so a typo (or an unexpanded template variable) is visible
 * in the logs instead of silently picking a live behaviour.
 *
 * No flag in the web app calls this yet (the web app has no flags today);
 * this ships the shared, tested primitive so the first web flag does not
 * need to re-derive it.
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
