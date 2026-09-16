/**
 * IST calendar-day helper for web — a re-export of THE implementation.
 *
 * #687 slice 4: this file used to hold its own copy of the offset-shifted
 * day arithmetic, identical to packages/shared/src/utils/ist-day.ts and to
 * scraper/src/scheduler/due-step-cycle.ts istDateIso(). Three identical
 * functions meant three places a fix had to land. web already imports other
 * shared utilities through the package exports map
 * (`@ipodhan/shared/utils/slug` and friends), so it imports this one too.
 *
 * The local name `istDateIso` is kept so web's existing callers
 * (lib/repositories/market-holiday-repository.ts,
 * lib/services/status-updater-service.ts and their tests) do not change.
 *
 * @module web/lib/utils/ist-date
 */

export { istDayIso as istDateIso } from '@ipodhan/shared/utils/ist-day';
