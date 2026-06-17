# DEFERRED — Source-capped coverage tails (registrar / lot_size / allotment_date / issue_size)

**Status:** DEFERRED to a future dedicated session (Abhay's decision, 2026-06-17 — "big issue; needs root-cause + alternative sources").
**Saved here on purpose** so it's findable: `docs/goals/2026-06-17-DEFERRED-source-capped-coverage-tails.md`.
**Parent goal:** `docs/goals/2026-06-16-ipo-data-completeness.md` (these are its remaining `--gate` FAILs after sessions 1–4 + the deploy).

---

## The problem (why these `--gate` checks still FAIL)

After all autonomous work + the 2026-06-17 prod deploy, these remain below threshold:

| Check | Now | Threshold | Population |
|---|---|---|---|
| core.registrar | **85.0%** (226/266) | ≥90% | all real IPOs |
| core.lot_size | **82.0%** (218/266) | ≥95% | all real IPOs |
| core.allotment_date | **52.8%** (134/254) | ≥90% | CLOSED/LISTED |
| issue_size > 0 | **37 rows = ₹0** | (>0) | substance — see #8 |

**Symptom:** the unmatched IPOs **are not present in the Chittorgarh source** the per-IPO enricher uses (Chittorgarh report 118 = 1359-IPO discovery map; the tail isn't in it). So coverage is **source-capped**, not a code bug. allotment_date is further capped because report 118 lacks older CLOSED IPOs.

---

## Root cause to investigate (next session — START HERE)

1. **Characterize the unmatched set** (the ~40 registrar / ~48 lot / ~120 allotment IPOs): are they old CLOSED? SME without Chittorgarh detail pages? name-mismatch (matching fails, data exists)? Quantify each cause. (Matching-failure ≠ data-absent — distinguish them first.)
2. **issue_size=0 (#8):** 37 genuine IPOs (BHARTI AIRTEL, INFIBEAM, FUSION FINANCE…) have ₹0 — owned by the BSE enrichment path; confirm whether BSE/source has a real value or it's genuinely absent.

## Alternative sources / fixes to evaluate

- **NSE/BSE per-IPO detail pages** (beyond the past-issues feed) for registrar/lot/allotment.
- **SEBI filings** (DRHP/RHP/basis-of-allotment) for allotment_date + registrar.
- **Registrar sites** (Linkintime / KFin / Bigshare / Cameo) — authoritative for registrar + allotment.
- **Moneycontrol per-IPO** pages.
- **DoD revision (PM call):** if the data is genuinely not publicly available for the unmatched IPOs, scope the thresholds to the *matchable* population (honest) rather than chase unreachable 90/95%. Do NOT fabricate.

## Related (already filed)

- **#41** allotment_date plausibility guard (absurd dates). **#45** registrar parse (address-pollution) + `normalizeRegistrar()`. **#8** issue_size=0 (evidence added). **#43** substance-plausibility gate (catches all of these in CI).

## Next-session task (one line)

Characterize the unmatched set → pick the right alternative source(s) per field → backfill via the existing per-IPO enricher infra (`chittorgarh-detail-fields.ts` pattern) OR revise the DoD to the matchable population; close #8/#41/#45 along the way.
