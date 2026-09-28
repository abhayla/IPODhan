/**
 * The scraper's §1 field shape checks now live in ONE place, @ipodhan/shared/utils/ipo-field-checks,
 * so the admin write (spec §9.2 item 12, OD-108) runs exactly the check the scraper runs.
 * This module re-exports it; every scraper import path stays valid.
 */
export * from '@ipodhan/shared/utils/ipo-field-checks';
