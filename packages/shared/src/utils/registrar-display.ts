/**
 * Registrar allotment-URL graceful degrade (P1-2, T-300, round-5 review).
 *
 * The standing daily health check (`scraper/src/scheduler/jobs/
 * registrar-health-check-job.ts`) persists `allotmentUrlHealthy` on each
 * `registrars` row. This is the single place that turns that persisted flag
 * into the URL actually shown to a user — an inactive or currently-unhealthy
 * registrar's allotment-check CTA MUST be hidden (return null), never a link
 * to a page confirmed dead. Both repository read paths that expose a
 * registrar to the UI (`web/lib/repositories/ipo-repository.ts`'s
 * `registrarRelation`, `web/lib/repositories/registrar-repository.ts`'s
 * findById/findByName/findAll/search) MUST route through this function
 * rather than each re-implementing the active/healthy check — a second,
 * drifted copy is exactly how the previous "88/192 broken CTA" incident
 * went undetected (round-5 review).
 */
export interface RegistrarUrlHealthFields {
  active: boolean;
  allotmentUrlHealthy: boolean;
  allotmentCheckUrl: string | null;
}

/**
 * Returns the allotment-check URL a user should be shown, or null when the
 * registrar is inactive or its URL is currently known-dead. Callers pass the
 * null result straight through to the UI's existing "no URL available"
 * fallback (`AllotmentCheckerCard`, `RegistrarCard` already handle
 * `allotmentCheckUrl === null` gracefully) — no UI change needed.
 */
export function effectiveAllotmentCheckUrl(registrar: RegistrarUrlHealthFields): string | null {
  if (!registrar.active) return null;
  if (!registrar.allotmentUrlHealthy) return null;
  return registrar.allotmentCheckUrl;
}

/** Returns a shallow copy of `registrar` with `allotmentCheckUrl` degraded via `effectiveAllotmentCheckUrl`. */
export function withEffectiveAllotmentCheckUrl<T extends RegistrarUrlHealthFields>(registrar: T): T {
  return { ...registrar, allotmentCheckUrl: effectiveAllotmentCheckUrl(registrar) };
}
