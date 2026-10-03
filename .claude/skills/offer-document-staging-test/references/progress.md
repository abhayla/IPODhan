# Round state (update at the end of every step that changes it)

Artifact page URL: https://claude.ai/artifact/XucBMmPTJMQQE8oQnd8xTa (publish with this `url`; never a second page)

## national-stock-exchange-of-india-ltd (round 1, started 2026-10-03)

| Order | Document | Id | State | Before (C/W/M/NP) | After |
|---|---|---|---|---|---|
| 1 | DRHP (SEBI, Jun 2026, 614 pp) | d88fad44-75ce-4d90-aec7-2bb9f97aa734 | MEASURED 2026-10-03; causes F-241..F-246; fixes next (STEP 6) | 6 / 0 / 94 / 64 | - |
| 2 | RHP (SEBI, filed 2026-09-10) | 3cb0ba27-4ec8-4b65-bb2a-e6ee74492120 | todo | - | - |
| 3 | PRICE_BAND_AD x3 (BSE + 2 NSE zip members) | 214277c0 / ae7ba11f / 3a1341f2 | todo | - | - |
| 4 | PROSPECTUS | none on staging | todo: record the fetch block | - | - |

### Round 1 working files (laptop scratch, not committed)
`%TEMP%/claude-doc/`: drhp-truth.json (164 fields from the PDF), drhp-extract.json (extractor at 86869ea2),
drhp-saved.json (staging), drhp-compare.json, drhp-causes.json (94 misses, classes A-F). The truth fixture moves into
`scraper/tests/fixtures/offer-doc-truth/` with the first fix PR.
