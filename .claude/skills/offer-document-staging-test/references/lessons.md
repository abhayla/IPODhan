# Lessons from earlier rounds (read at STEP 0; newest first)

Each lesson is also folded into the SKILL.md step it changes.

## 2026-10-03 — round 1 DRHP measured

- **Run the extractor on the laptop to split "not read" from "read but not saved".** Staging's served sha
  (`ssh rfp-vps cat /var/www/ipodhan/DEPLOYED_SHA-staging`) is the code to compare; if `git log <sha>..origin/main` shows no
  change to `scraper/scripts/` or the persister, the laptop run IS staging's read. `python scraper/scripts/extract_filing.py
  <pdf> --doc-type <TYPE>` took 3 min on a 614-page DRHP and writes no DB.
- **Classify every miss by cause class A-F** (A no reader, B reader failed, C read not persisted, D persisted not recorded,
  E blocked by a rule, F truth questionable). One code-reading agent did all 94 in 9 min; re-check its top 3 claims in code.
- **Two emails can both be right.** The cover contact box and the General Information chapter printed different compliance
  officer emails; the spec reads the cover (OD-164(b)). Record every printed alternative in the truth file.

## 2026-10-03 — round 1 setup (NSE, national-stock-exchange-of-india-ltd)

- **CORRECTED same day: `field_sources.source = 'DRHP'` does not mean "from the DRHP".** Every filing type saves as
  `DRHP` (filing-persister.ts SOURCE ENUM NOTE). Of the 669 "DRHP" rows on NSE, the DRHP's own lineage is on 3; the rest
  belong to the RHP / adverts or carry no document id (ipo_intermediaries 372, ipo_risk_factors 263 with none). Measure
  per document by receipts (OD-91) and `data_lineage.documentId` only. The bullet below is the superseded first reading.
- **(superseded) Two provenance layers that disagree in size.** For the NSE DRHP (d88fad44), `document_field_receipts` held 6 rows
  (ipos/ipo_details only), while `field_sources` with source=DRHP held 669 rows across 6 tables
  (ipo_intermediaries 372, ipo_risk_factors 263, financial_statements 15, peer_companies 7, ipos 7, ipo_valuation 5).
  Reading only the receipts would report the document as almost empty. Evidence: measure-doc-saved.cjs output, 2026-10-03.
- **`data_lineage.documentId` is rarely set.** 3 of 669 DRHP provenance rows name the document; the rest carry no
  document id. Match by source type and exclude rows that name a different document.
- **`documents.filing_date` is mostly null** (6 of 7 NSE rows). Order documents by type first, then by date.
- **The F-224 baseline (RHP gave 4 fields) is stale.** OD-164 items 37-46 (cover reader, objects, table readers,
  OCR guards) landed or partly landed on 2026-10-02/03. Always re-measure; never quote an old count.
- **NSE has no PROSPECTUS row on staging** (F-224: fetch BLOCKED_ALL; item 44 says it is on SEBI 104637). Record it
  when the round reaches the PROSPECTUS.

- **Scripts must use the shared DB pool.** The first version of measure-doc-saved built its own `pg` client and failed
  the PR gate step `check-db-connection-defaults` (#640). Use `createUtcPool` + `resolveDiscreteDbParams` from
  `scripts/lib/`. The UTC parser also changes how naive timestamps print: documents.extracted_at for the DRHP read
  03:18Z through a raw client and 08:48Z through the shared pool (which one is the true instant: unverified).
