# Walkthrough: Riyaasat Lifestyle Ltd. (RIYAASAT) — 2026-09-09

**Generated** by `docs/design/probes/walkthrough.mjs`. Every value in the "stored today" column is
read from production through the read-only tunnel; every value in the "what the rank-1 source says"
column is read from a payload saved under `docs/design/probes/fixtures/`. Nothing here is typed.

| | |
|---|---|
| slug | `riyaasat-lifestyle-ltd` |
| status / segment | LISTED / SME |
| resolved type for Appendix A | **SME_BSE** |
| listing exchanges | ["BSE"] |
| open / close / listing | 2026-06-17 / 2026-06-24 / 2026-06-30 |
| documents on file | RHP (PENDING) |

## What this walk found, before the table

- **239 of 240 fields apply** to a SME_BSE issue; 1 are N/A for this offering type.
- **1 of those have a rank-1 source backed by a payload saved for THIS IPO.** A further 16 rank-1 sources are known to carry the field, but only from another IPO's payload; those rows say so instead of borrowing the number. The rest are the honest gap: see §A.0's fifth verification round for what "no matching label" does and does not mean.
- **170 applicable fields are empty on production right now.** That is the number the pull model exists to move.
- **0 stored values fail a stated plausibility rule.**

## The job timeline for this IPO under the three-job cadence (§2.1)

| When | Job | What it does for this IPO |
|---|---|---|
| before 2026-06-17, at 00:00 / 08:00 / 14:00 | Data job | discovers the IPO, downloads each document as it is filed, extracts it once on arrival, and walks the field plan. It never re-opens a document because time passed. |
| 2026-06-17 to 2026-06-24, every 30 min 10:00–18:30 | Live-figures job | subscription, demand graph and grey-market premium only. It touches no document, no plan row and no static field. |
| 2026-06-17 to 2026-06-24, at 00:00 / 08:00 / 14:00 | Data job | re-walks only fields whose plan row is still PENDING or due for verification; a newly filed corrigendum or price band advertisement is a new reason to read, and is read on the next data job rather than within the hour. |
| 2026-06-24 to 2026-06-30 | Data job | the timetable family (E-1) is re-read from NSE then BSE, because a printed advertisement is never reissued when a window moves. |
| after 2026-06-30 | Data job | listing performance; the documents stay on disk for the life of this row (OD-23), so this IPO never joins the closed backlog document-less. |
| from the first night after 2026-06-24, 22:00 | Closed-IPO job | eligible once `close_date` is in the past. Ten IPOs a night, newest close date first, this one marked done in `closed_ipo_resourcing` so it is never picked twice. |

## Every applicable field

`R1` is the source the plan would ask first for a SME_BSE issue. "What the rank-1 source says"
is the label found in the saved payload and the value beside it — an empty cell means the payload was
searched and no label matched, which is a rank to re-examine, not proof the source lacks the field.

| Field | Cls | R1 | R2 · R3 | What the rank-1 source says | Stored today | Rule | Evidence |
|---|---|---|---|---|---|---|---|
| `ipos.symbol` | D | DOC | BSE · CG | _(searched, no matching label)_ | `RIYAASAT` | _(no rule stated)_ | — |
| `ipos.company_name` | D | DOC | BSE · CG | _(searched, no matching label)_ | `Riyaasat Lifestyle Ltd.` | _(no rule stated)_ | — |
| `ipos.issue_size` | D | DOC | BSE · CG | _(searched, no matching label)_ | `302000000.00` | pass — Rs 30.20 crore | — |
| `ipos.lot_size` | D | DOC | BSE · CG | _(the source carries this field, but the only saved payload proving it belongs to a DIFFERENT IPO — nothing quoted)_ | `1200` | pass | — |
| `ipos.open_date` | T | BSE | CG · — | _(the source carries this field, but the only saved payload proving it belongs to a DIFFERENT IPO — nothing quoted)_ | 2026-06-17 | pass | — |
| `ipos.close_date` | T | BSE | CG · — | _(the source carries this field, but the only saved payload proving it belongs to a DIFFERENT IPO — nothing quoted)_ | 2026-06-24 | pass | — |
| `ipos.listing_date` | T | BSE | CG · — | _(searched, no matching label)_ | 2026-06-30 | pass | — |
| `ipos.status` | T | BSE | CG · — | _(searched, no matching label)_ | `LISTED` | _(no rule stated)_ | — |
| `ipos.registrar` | D | DOC | BSE · CG | _(searched, no matching label)_ | `Skyline Financial Services Private Limited` | _(no rule stated)_ | — |
| `ipos.registrar_id` | C | — | — · — | _(searched, no matching label)_ | `f7daaab7-56ed-4d3f-b0b6-af236584a783` | _(no rule stated)_ | — |
| `ipos.rating_override` | I | ADMIN | — · — | _(not probed: an admin-only field has no external source to probe)_ | `false` | _(no rule stated)_ | — |
| `ipos.slug` | C | — | — · — | _(searched, no matching label)_ | `riyaasat-lifestyle-ltd` | _(no rule stated)_ | — |
| `ipos.sector` | D | DOC | CG · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `ipos.price_range_min` | D | DOC | BSE · CG | _(searched, no matching label)_ | `106` | pass | — |
| `ipos.price_range_max` | D | DOC | BSE · CG | _(searched, no matching label)_ | `106` | pass | — |
| `ipos.last_scraped_at` | I | — | — · — | _(searched, no matching label)_ | 2026-09-03 | _(no rule stated)_ | — |
| `ipos.listing_exchanges` | T | BSE | CG · — | _(searched, no matching label)_ | `["BSE"]` | _(no rule stated)_ | — |
| `ipos.face_value` | D | DOC | BSE · CG | _(the source carries this field, but the only saved payload proving it belongs to a DIFFERENT IPO — nothing quoted)_ | `10` | pass | — |
| `ipos.allotment_date` | T | BSE | CG · — | _(searched, no matching label)_ | 2026-06-28 | _(no rule stated)_ | — |
| `ipos.company_description` | D | DOC | CG · — | _(searched, no matching label)_ | `Incorporated in October 2021, Riyaasat Lifestyle Limited ...` | _(no rule stated)_ | — |
| `ipos.lead_managers` | D | DOC | BSE · CG | _(searched, no matching label)_ | `["Mark Corporate"]` | _(no rule stated)_ | — |
| `ipos.isin` | D | DOC | BSE · CG | _(searched, no matching label)_ | `INE0KYI01012` | _(no rule stated)_ | — |
| `ipos.segment` | D | DOC | BSE · CG | _(searched, no matching label)_ | `SME` | _(no rule stated)_ | — |
| `ipos.offering_type` | D | DOC | BSE · CG | _(searched, no matching label)_ | `IPO` | _(no rule stated)_ | — |
| `ipos.scraper_locked` | I | ADMIN | — · — | _(not probed: an admin-only field has no external source to probe)_ | `false` | _(no rule stated)_ | — |
| `ipos.last_manual_edit_at` | I | — | — · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `ipos.objectives` | D | DOC | CG · — | _(searched, no matching label)_ | `[{"sno":1,"amount":12.47,"description":"Capital expenditu...` | _(no rule stated)_ | — |
| `ipos.bse_ipo_no` | I | BSE | — · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `ipos.bse_payload_lead_manager_count` | I | BSE | — · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `ipos.company_website` | D | DOC | CG · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `ipos.verifier_url` | I | — | — · — | _(searched, no matching label)_ | `https://www.chittorgarh.com/ipo/riyaasat-lifestyle-ipo/2538/` | _(no rule stated)_ | — |
| `ipos.cin` | D | DOC | — · — | _(the source carries this field, but the only saved payload proving it belongs to a DIFFERENT IPO — nothing quoted)_ | _(empty)_ | _(no rule stated)_ | — |
| `ipo_details.company_description` | D | DOC | CG · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `ipo_details.issue_type` | D | DOC | CG · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `ipo_details.fresh_issue` | D | DOC | BSE · CG | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `ipo_details.ofs_issue` | D | DOC | BSE · CG | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `ipo_details.face_value` | D | DOC | BSE · CG | _(the source carries this field, but the only saved payload proving it belongs to a DIFFERENT IPO — nothing quoted)_ | _(empty)_ | _(no rule stated)_ | — |
| `ipo_details.basis_of_allotment_date` | T | BSE | CG · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `ipo_details.initiation_of_refunds_date` | T | BSE | CG · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `ipo_details.credit_of_shares_date` | T | BSE | CG · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `ipo_details.exchanges` | D | DOC | BSE · CG | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `ipo_details.data_source` | I | — | — · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `ipo_details.last_verified_at` | I | — | — · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `ipo_details.compliance_officer` | D | DOC | — · — | _(the source carries this field, but the only saved payload proving it belongs to a DIFFERENT IPO — nothing quoted)_ | _(empty)_ | _(no rule stated)_ | — |
| `ipo_details.compliance_officer_phone` | D | DOC | — · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `ipo_details.compliance_officer_email` | D | DOC | — · — | _(the source carries this field, but the only saved payload proving it belongs to a DIFFERENT IPO — nothing quoted)_ | _(empty)_ | _(no rule stated)_ | — |
| `ipo_details.upi_cutoff_time` | D | DOC | CG · — | _(the source carries this field, but the only saved payload proving it belongs to a DIFFERENT IPO — nothing quoted)_ | _(empty)_ | _(no rule stated)_ | — |
| `ipo_details.designated_exchange` | D | DOC | — · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `ipo_details.lot_multiple` | D | DOC | BSE · CG | _(the source carries this field, but the only saved payload proving it belongs to a DIFFERENT IPO — nothing quoted)_ | _(empty)_ | _(no rule stated)_ | — |
| `ipo_details.allocation_pct` | D | DOC | — · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `ipo_details.pre_ipo_placement` | D | DOC | — · — | _(the source carries this field, but the only saved payload proving it belongs to a DIFFERENT IPO — nothing quoted)_ | _(empty)_ | _(no rule stated)_ | — |
| `ipo_details.bid_windows` | D | DOC | CG · — | _(the source carries this field, but the only saved payload proving it belongs to a DIFFERENT IPO — nothing quoted)_ | _(empty)_ | _(no rule stated)_ | — |
| `ipo_details.promoter_shares_held` | D | DOC | — · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `ipo_details.sebi_regulation_cited` | D | DOC | — · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `ipo_details.promoter_group_transactions_since_drhp` | D | DOC | — · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `ipo_details.cut_off_price` | D | DOC | — · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `ipo_details.min_investment` | D | DOC | — · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `ipo_details.isin` | D | DOC | BSE · CG | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `ipo_details.registrar_link` | D | DOC | — · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `ipo_details.lead_managers` | D | DOC | BSE · CG | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `ipo_details.company_address` | D | DOC | — · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `ipo_details.company_phone` | D | DOC | — · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `ipo_details.company_email` | D | DOC | — · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `ipo_details.company_city` | D | DOC | — · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `ipo_details.company_state` | D | DOC | — · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `ipo_details.company_pincode` | D | DOC | — · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `ipo_details.qib_shares_offered` | D | DOC | — · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `ipo_details.nii_shares_offered` | D | DOC | — · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `ipo_details.retail_shares_offered` | D | DOC | — · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `ipo_details.retail_max_allottees` | D | DOC | — · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `ipo_details.employee_shares_offered` | D | DOC | — · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `ipo_details.anchor_shares_offered` | D | DOC | — · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `ipo_details.max_retail_subscription` | D | DOC | — · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `ipo_details.max_employee_subscription` | D | DOC | — · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `ipo_details.employee_discount` | D | DOC | — · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `ipo_details.sponsor_banks` | D | DOC | BSE · CG | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `ipo_details.tick_size` | D | DOC | BSE · CG | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `ipo_details.ipo_market_timings` | D | DOC | BSE · CG | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `ipo_details.category_details` | D | DOC | — · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `ipo_details.sub_categories_upi` | D | DOC | — · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `financial_data.revenue_fy2022` | D | DOC | CG · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `financial_data.revenue_fy2023` | D | DOC | CG · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `financial_data.revenue_fy2024` | D | DOC | CG · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `financial_data.profit_fy2022` | D | DOC | CG · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `financial_data.profit_fy2023` | D | DOC | CG · — | _(searched, no matching label)_ | `1.32` | _(no rule stated)_ | — |
| `financial_data.profit_fy2024` | D | DOC | CG · — | _(searched, no matching label)_ | `4.08` | _(no rule stated)_ | — |
| `financial_data.net_worth` | D | DOC | CG · — | _(searched, no matching label)_ | `17.39` | _(no rule stated)_ | — |
| `financial_data.eps` | D | DOC | CG · — | _(searched, no matching label)_ | `4.79` | _(no rule stated)_ | — |
| `financial_data.roe` | D | DOC | CG · — | _(searched, no matching label)_ | `28.15` | _(no rule stated)_ | — |
| `financial_data.debt_to_equity` | D | DOC | CG · — | _(searched, no matching label)_ | `2.24` | _(no rule stated)_ | — |
| `financial_data.reserves_and_surplus` | D | DOC | CG · — | _(searched, no matching label)_ | `9.50` | _(no rule stated)_ | — |
| `financial_data.total_assets` | D | DOC | CG · — | _(searched, no matching label)_ | `76.15` | _(no rule stated)_ | — |
| `financial_data.total_borrowing` | D | DOC | CG · — | _(searched, no matching label)_ | `38.97` | _(no rule stated)_ | — |
| `financial_data.promoter_holding_pre_issue` | D | DOC | CG · — | _(searched, no matching label)_ | `99.87` | _(no rule stated)_ | — |
| `financial_data.promoter_holding_post_issue` | D | DOC | CG · — | _(searched, no matching label)_ | `73.40` | _(no rule stated)_ | — |
| `financial_data.market_cap` | D | DOC | CG · — | _(searched, no matching label)_ | `116.04` | _(no rule stated)_ | — |
| `financial_data.pre_ipo_eps` | D | DOC | CG · — | _(searched, no matching label)_ | `6.16` | _(no rule stated)_ | — |
| `financial_data.post_ipo_eps` | D | DOC | CG · — | _(searched, no matching label)_ | `4.79` | _(no rule stated)_ | — |
| `financial_data.ronw` | D | DOC | CG · — | _(searched, no matching label)_ | `24.67` | _(no rule stated)_ | — |
| `financial_data.pe_ratio` | D | DOC | — · — | _(searched, no matching label)_ | `22.53` | _(no rule stated)_ | — |
| `financial_data.ebitda_fy2022` | D | DOC | CG · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `financial_data.ebitda_fy2023` | D | DOC | CG · — | _(searched, no matching label)_ | `1.70` | _(no rule stated)_ | — |
| `financial_data.ebitda_fy2024` | D | DOC | CG · — | _(searched, no matching label)_ | `5.14` | _(no rule stated)_ | — |
| `financial_data.total_income_fy2022` | D | DOC | CG · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `financial_data.total_income_fy2023` | D | DOC | CG · — | _(searched, no matching label)_ | `20.94` | _(no rule stated)_ | — |
| `financial_data.total_income_fy2024` | D | DOC | CG · — | _(searched, no matching label)_ | `23.34` | _(no rule stated)_ | — |
| `financial_data.current_ratio` | D | DOC | — · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `financial_data.quick_ratio` | D | DOC | — · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `financial_data.inventory_turnover` | D | DOC | — · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `financial_statements.fiscal_year` | D | DOC | CG · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `financial_statements.revenue` | D | DOC | CG · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `financial_statements.total_income` | D | DOC | CG · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `financial_statements.ebitda` | D | DOC | CG · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `financial_statements.pat` | D | DOC | CG · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `financial_statements.net_worth` | D | DOC | CG · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `financial_statements.basis` | D | DOC | CG · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `financial_statements.unit` | D | DOC | CG · — | _(the source carries this field, but the only saved payload proving it belongs to a DIFFERENT IPO — nothing quoted)_ | _(empty)_ | _(no rule stated)_ | — |
| `financial_statements.eps_basic` | D | DOC | — · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `financial_statements.eps_diluted` | D | DOC | — · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `financial_statements.op_cash_flow` | D | DOC | — · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `financial_statements.dscr` | D | DOC | — · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `financial_statements.rent_expense` | D | DOC | — · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `ipo_valuation.price_floor` | D | DOC | BSE · CG | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `ipo_valuation.price_cap` | D | DOC | BSE · CG | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `ipo_valuation.mcap_at_cap` | D | DOC | CG · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `ipo_valuation.pe_at_cap` | D | DOC | CG · — | _(the source carries this field, but the only saved payload proving it belongs to a DIFFERENT IPO — nothing quoted)_ | _(empty)_ | _(no rule stated)_ | — |
| `ipo_valuation.mcap_at_floor` | D | DOC | — · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `ipo_valuation.pe_at_floor` | D | DOC | — · — | _(the source carries this field, but the only saved payload proving it belongs to a DIFFERENT IPO — nothing quoted)_ | _(empty)_ | _(no rule stated)_ | — |
| `ipo_valuation.ronw_weighted_3y` | D | DOC | — · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `ipo_valuation.pricing_event` | I | DOC | — · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `ipo_valuation.shares_at_floor` | D | DOC | — · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `ipo_valuation.shares_at_cap` | D | DOC | — · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `ipo_valuation.fresh_shares_at_floor` | D | DOC | — · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `ipo_valuation.fresh_shares_at_cap` | D | DOC | — · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `ipo_valuation.ofs_shares` | D | DOC | — · — | _(the source carries this field, but the only saved payload proving it belongs to a DIFFERENT IPO — nothing quoted)_ | _(empty)_ | _(no rule stated)_ | — |
| `ipo_valuation.total_shares_at_floor` | D | DOC | — · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `ipo_valuation.total_shares_at_cap` | D | DOC | — · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `ipo_valuation.face_value_multiple_floor` | C | — | — · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `ipo_valuation.face_value_multiple_cap` | C | — | — · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `ipo_valuation.pe_not_ascertainable_reason` | D | DOC | — · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `promoters.name` | D | DOC | CG · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `promoters.waca` | D | DOC | — · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `promoters.is_promoter_group` | D | DOC | — · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `ipo_intermediaries.role` | D | DOC | BSE · CG | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `ipo_intermediaries.name` | D | DOC | BSE · CG | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `ipo_risk_factors.seq` | D | DOC | — · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `ipo_risk_factors.heading` | D | DOC | — · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `brlm_track_record.brlm_name` | D | DOC | — · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `brlm_track_record.as_of_date` | D | DOC | — · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `brlm_track_record.issues_3y` | D | DOC | — · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `brlm_track_record.closed_below_issue_price` | D | DOC | — · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `promoters.shares_held` | D | DOC | — · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `promoters.waca_last_year` | D | DOC | — · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `ipo_intermediaries.sebi_reg_no` | D | DOC | — · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `ipo_intermediaries.contact_person` | D | DOC | — · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `ipo_intermediaries.phone` | D | DOC | — · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `ipo_intermediaries.email` | D | DOC | — · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `ipo_intermediaries.grievance_email` | D | DOC | — · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `ipo_risk_factors.body` | D | DOC | — · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `ipo_risk_factors.kpis` | D | DOC | — · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `promoter_acquisition_ranges.period` | D | DOC | — · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `promoter_acquisition_ranges.waca` | D | DOC | — · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `promoter_acquisition_ranges.cap_multiple` | D | DOC | — · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `promoter_acquisition_ranges.price_low` | D | DOC | — · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `promoter_acquisition_ranges.price_high` | D | DOC | — · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `peer_companies.company_name` | D | DOC | CG · — | _(searched, no matching label)_ | `Bizotic Commercial Ltd` | _(no rule stated)_ | — |
| `peer_companies.is_listed` | D | DOC | CG · — | _(searched, no matching label)_ | `true` | _(no rule stated)_ | — |
| `peer_companies.pe_ratio` | D | DOC | CG · — | _(searched, no matching label)_ | `26.46` | _(no rule stated)_ | — |
| `peer_companies.eps` | D | DOC | CG · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `peer_companies.diluted_eps` | D | DOC | CG · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `peer_companies.ronw` | D | DOC | CG · — | _(searched, no matching label)_ | `5.63` | _(no rule stated)_ | — |
| `peer_companies.nav` | D | DOC | CG · — | _(searched, no matching label)_ | `68.10` | _(no rule stated)_ | — |
| `peer_companies.pbv_ratio` | D | DOC | CG · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `peer_companies.data_source` | I | — | — · — | _(searched, no matching label)_ | `CHITTORGARH` | _(no rule stated)_ | — |
| `peer_companies.last_updated` | I | — | — · — | _(searched, no matching label)_ | 2026-06-17 | _(no rule stated)_ | — |
| `peer_companies.financial_statement_type` | D | DOC | — · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `anchor_investors.bid_date` | T | BSE | CG · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `anchor_investors.total_shares_offered` | D | DOC | — · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `anchor_investors.total_amount_raised` | D | DOC | — · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `anchor_investors.anchor_investors_count` | D | DOC | — · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `anchor_investors.investor_list` | D | DOC | — · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `anchor_investors.lock_in_50_percent_date` | C | — | — · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `anchor_investors.lock_in_remaining_date` | C | — | — · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `documents.type` | I | — | — · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `documents.title` | I | — | — · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `documents.url` | I | — | — · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `documents.file_size` | I | — | — · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `documents.uploaded_at` | I | — | — · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `documents.exchange` | I | — | — · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `documents.media_type` | I | — | — · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `documents.sequence_number` | I | — | — · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `documents.is_active` | I | — | — · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `documents.extraction_status` | I | — | — · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `documents.extracted_at` | I | — | — · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `documents.extraction_error` | I | — | — · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `documents.retry_count` | I | — | — · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `documents.sha256` | I | — | — · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `documents.filing_date` | D | DOC | BSE · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `subscriptions.timestamp` | I | — | — · — | _(searched, no matching label)_ | 2026-06-17 | _(no rule stated)_ | — |
| `subscriptions.qib_subscription` | X | BSE | CG · — | _(searched, no matching label)_ | `0.00` | _(no rule stated)_ | — |
| `subscriptions.nii_subscription` | X | BSE | CG · — | _(searched, no matching label)_ | `0.00` | _(no rule stated)_ | — |
| `subscriptions.retail_subscription` | X | BSE | CG · — | _(searched, no matching label)_ | `0.00` | _(no rule stated)_ | — |
| `subscriptions.total_subscription` | X | BSE | CG · — | _(searched, no matching label)_ | `0.00` | _(no rule stated)_ | — |
| `subscriptions.employee_subscription` | X | BSE | — · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `subscriptions.b_nii_subscription` | X | BSE | — · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `subscriptions.s_nii_subscription` | X | BSE | — · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `subscriptions.total_shares_bid` | X | BSE | — · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `subscriptions.shares_offered` | X | BSE | — · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `subscriptions.scope` | I | — | — · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `gmp_records.timestamp` | I | — | — · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `gmp_records.gmp` | W | IG | CG · — | GMP | _(empty)_ | _(no rule stated)_ | `investorgain/gmp-live.json` |
| `gmp_records.source` | I | — | — · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `gmp_records.gmp_percentage` | C | — | — · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `listing_performance.listing_price` | M | BSE | CG · — | _(searched, no matching label)_ | `80.60` | _(no rule stated)_ | — |
| `listing_performance.issue_price` | C | — | — · — | _(searched, no matching label)_ | `106.00` | _(no rule stated)_ | — |
| `listing_performance.listing_gain_percent` | C | — | — · — | _(searched, no matching label)_ | `-23.96` | _(no rule stated)_ | — |
| `listing_performance.current_price` | M | BSE | CG · — | _(searched, no matching label)_ | `70.35` | _(no rule stated)_ | — |
| `listing_performance.current_gain_percent` | C | — | — · — | _(searched, no matching label)_ | `-33.63` | _(no rule stated)_ | — |
| `listing_performance.last_updated` | I | — | — · — | _(searched, no matching label)_ | 2026-09-09 | _(no rule stated)_ | — |
| `listing_performance.current_price_bse` | M | BSE | — · — | _(searched, no matching label)_ | `70.35` | _(no rule stated)_ | — |
| `listing_performance.symbol` | C | — | — · — | _(searched, no matching label)_ | `RIYAASAT` | _(no rule stated)_ | — |
| `listing_performance.company_name` | C | — | — · — | _(searched, no matching label)_ | `Riyaasat Lifestyle Ltd.` | _(no rule stated)_ | — |
| `listing_performance.listing_date` | C | — | — · — | _(searched, no matching label)_ | 2026-06-30 | _(no rule stated)_ | — |
| `listing_performance.data_source` | I | — | — · — | _(searched, no matching label)_ | `SCRAPER` | _(no rule stated)_ | — |
| `ipo_demand_graph.timestamp` | I | — | — · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `ipo_demand_graph.price_point` | X | BSE | — · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `ipo_demand_graph.is_cut_off` | X | BSE | — · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `ipo_demand_graph.cumulative_quantity` | X | BSE | — · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `ipo_demand_graph.exchange` | X | BSE | — · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `registrars.name` | D | DOC | REG · CG | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `registrars.short_name` | D | DOC | REG · CG | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `registrars.email` | D | DOC | REG · CG | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `registrars.phone` | D | DOC | REG · CG | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `registrars.website` | D | REG | DOC · CG | _(not probed: no registrar-site probe was run in this round)_ | _(empty)_ | _(no rule stated)_ | — |
| `registrars.allotment_check_url` | I | REG | — · — | _(not probed: no registrar-site probe was run in this round)_ | _(empty)_ | _(no rule stated)_ | — |
| `registrars.address` | D | DOC | REG · CG | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `registrars.active` | I | ADMIN | — · — | _(not probed: an admin-only field has no external source to probe)_ | _(empty)_ | _(no rule stated)_ | — |
| `registrars.allotment_url_healthy` | I | — | — · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `registrars.allotment_url_checked_at` | I | — | — · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |

---

_Regenerate: `node docs/design/probes/walkthrough.mjs riyaasat-lifestyle-ltd`._


---

# The walk against the design, field by field

Everything above this line is generated by `docs/design/probes/walkthrough.mjs`. Everything below it
is the walk itself: the field plan of `docs/design/data-sourcing-pull-model.md` applied to this row
in field order, stopping at the FIRST rule that gives no answer. Numbers below are read from
production through the read-only tunnel on 2026-09-09 or from the generated table above; none are
typed from memory.

**Two things the generated table gets wrong for every IPO, stated once so no reader is misled:**

1. **Every date in the table is one day early.** `ipos.open_date` for this row reads
   `2026-06-18` in the database (`select open_date::text`), and the table prints
   `2026-06-17`. `node-pg` parses a PostgreSQL `date` as local midnight, and this machine runs
   IST (UTC+5:30), so `toISOString()` rolls it back a day. This affects the two walkthroughs
   published earlier as well — Asset Reconstruction opened on 2026-09-09, not the 2026-09-08 its
   file prints. Recorded as finding **F-104**.
2. **The `documents.*` rows read `_(empty)_` and that is a generator artefact, not a data gap.**
   `walkthrough.mjs` loads eleven child tables into `stored` and `documents` is not one of them, so
   every `documents.*` field renders empty. This IPO has one active document rows; they are
   listed in the header table above.


## Why this IPO was chosen

By query, in `docs/design/probes/pick-walkthrough-ipos.mjs`:

> SME issues quoted at a single price (`price_range_min = price_range_max`, both non-null), ranked by
> documents on disk, then most recent close date

**50 candidates**, and Riyaasat Lifestyle Ltd. ranks first: one active document, the most recent
close date among the rows that have one. The ranking is in `pick-walkthrough-ipos.out.json` in full,
so the choice is reproducible and nobody picked the flattering row.

**The reason the rule had to be written that way is itself the finding.** The field that would say
`FIXED_PRICE` is `ipo_details.issue_type` (§1.3 field 34, checked `BOOK_BUILDING / FIXED_PRICE /
HYBRID; FIXED_PRICE requires floor = cap`). On production it is **null for all 50** of these rows —
in fact `ipo_details` has **25 rows against 330 IPOs**, and the 19 rows that carry an `issue_type` all
say `BOOK_BUILDING`. **There is no `FIXED_PRICE` value anywhere on production.** So the only
production signal that an issue is fixed-price is that its band is a point.

## The walk, in field order

| # | Field | What the design says | Result |
|---:|---|---|---|
| 1 | `ipos.symbol` | §1.2 row 1; SME-BSE resolves to DOC · BSE · CG (§1.11: NSE cannot be rank 2 or 3) | stored `RIYAASAT`, passes |
| 2 | `ipos.company_name` | §1.2 row 2 | `Riyaasat Lifestyle Ltd.`, passes |
| 3 | `ipos.issue_size` | §1.2 row 3 | ₹30.20 crore, inside the 1–50,000 crore bound; the two component identities cannot run — `fresh_issue` and `ofs_issue` are empty |
| 4 | `ipos.lot_size` | §1.2 row 4 / §1.11: SME `lot_multiple × lot × floor ≥ ₹1,00,000`, `lot_multiple` READ from the row, effective from SEBI's 2025 framework | `lot_multiple` is **empty**, so the multiplier the rule insists on reading is not there. On `1 × 1200 × 106 = ₹1,27,200` it passes; the rule's own instruction cannot be followed |

And at field 14 it stops.

## THE STOP: §1.2 row 14 — `floor < cap` is a strict inequality that every fixed-price issue fails, and the exception that saves it needs a field production does not have

§1.2 row 14, the check before write for `price_range_min`:

> `floor < cap`; `cap ≤ 1.2 × floor` mainboard, `≤ 1.4 ×` SME; `floor ≥ face_value`

and its exception column:

> Fixed-price issues: floor = cap; the ratio check is skipped

§1.11's SME-on-BSE row says the same thing from the other side: *"Commonly FIXED_PRICE, so the
`cap ≤ 1.2 × floor` check is skipped and floor = cap is expected."*

**Stored on this row: `price_range_min` = 106, `price_range_max` = 106.** `floor < cap` is
**false**. Whether that is a validation failure or the expected shape of a legitimate issue depends
entirely on whether this is a fixed-price issue — and:

- `ipo_details.issue_type` is **empty** for this row, and for all 50 single-price SME rows;
- its rank-1 source is `DOC`, and this IPO's one document is an `RHP` hosted on Chittorgarh
  (`chittorgarh.net/reports/ipo_notes/riyaasat-rhp.pdf`) whose `extraction_status` is `PENDING`;
- rank 2 for SME-BSE is `CG`, which the generated table records as *"searched, no matching label"*.

**The question the design cannot answer:** how does the loop decide an issue is `FIXED_PRICE` when
`issue_type` has not arrived? The dependency is circular as written — the band check's applicability
is decided by a field whose own value must be read from a document, and until it is read the loop
cannot tell a legitimate fixed price (106 = 106) from a corrupted band (a cap lost, a floor copied
into both columns), which is a live class on this site. The design never states the inference in the
one direction that would break the circle: **floor = cap on an SME row implies FIXED_PRICE until a
document says otherwise.** It states only the converse — *"FIXED_PRICE requires floor = cap"* — which
cannot be run backwards.

**Rule and section named: §1.2 row 14 "check before write" and its exception column, restated in
§1.11 (SME on BSE). Recorded as finding F-101.**

## Continuing past the gap — everything below is PROVISIONAL on F-101

**The same missing field disables four more rows, and this time it costs money.** Appendix A marks
fields 227–230 (`ipo_demand_graph.price_point`, `is_cut_off`, `cumulative_quantity`, `exchange`)
*"N/A whenever `ipo_details.issue_type = FIXED_PRICE` (F-26) — a fixed-price issue has no bid book."*
For this row `issue_type` is empty, so the N/A cannot be resolved, and the generated table above
duly shows all four as applicable with rank 1 = `BSE`. This IPO has **0 rows in `ipo_demand_graph`**,
because it never had a bid book to read.

Under §2.1's cadence the live-figures job runs **every 30 minutes from 10:00 to 18:30** for the whole
bidding window. On a seven-day SME window that is roughly 120 fetches of a demand graph that does not
exist, per fixed-price issue — and 50 of the 173 SME rows with a band on production are
single-priced. This is the same finding as F-101 seen from the cost side rather than the correctness
side, and it is why F-101 is filed against the inference rule rather than against the band check
alone.

**What does resolve cleanly for this row, and is worth saying:** the SME-BSE rank resolution itself
behaves exactly as §1.11 promises. Every field's rank 2 and 3 in the generated table are drawn from
`BSE` and `CG` only; `NSE` appears nowhere. The exception is written correctly and the walk confirms
it on a real row.

Of the 240 fields, **239 apply** to an SME-BSE issue, **170 are empty on production**, and **1** has a
rank-1 source backed by a payload saved for this IPO.
