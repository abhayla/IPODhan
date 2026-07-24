# IPO data audit

`chittorgarh-audit.py` — read-only comparison of IPODhan's IPO data vs Chittorgarh, to surface
data-quality drift (e.g., the duplicate-row + stale-scraper issues found 2026-07-18). Deterministic
data pull; the fuzzy name-matching / field-diff layer is intended to run on top (LLM or reviewer).
Config via env (`DATABASE_URL`, optional `CHITTORGARH_REPORT_URL`).
