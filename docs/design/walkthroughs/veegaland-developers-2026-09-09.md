# Walkthrough: Veegaland Developers Ltd. (VEEGALAND) — 2026-09-09

**Generated** by `docs/design/probes/walkthrough.mjs`. Every value in the "stored today" column is
read from production through the read-only tunnel; every value in the "what the rank-1 source says"
column is read from a payload saved under `docs/design/probes/fixtures/`. Nothing here is typed.

| | |
|---|---|
| slug | `veegaland-developers-ltd` |
| status / segment | UPCOMING / MAINBOARD |
| resolved type for Appendix A | **MAINBOARD** |
| listing exchanges | ["NSE","BSE"] |
| open / close / listing | 2026-09-09 / 2026-09-14 / 2026-09-17 |
| documents on file | CORRIGENDUM (PENDING), DRHP (COMPLETED), PRICE_BAND_AD (COMPLETED), RATIOS_BASIS_ISSUE_PRICE (PENDING), RHP (COMPLETED) |

## What this walk found, before the table

- **240 of 240 fields apply** to a MAINBOARD issue; 0 are N/A for this offering type.
- **2 of those have a rank-1 source backed by a payload saved for THIS IPO.** A further 19 rank-1 sources are known to carry the field, but only from another IPO's payload; those rows say so instead of borrowing the number. The rest are the honest gap: see §A.0's fifth verification round for what "no matching label" does and does not mean.
- **184 applicable fields are empty on production right now.** That is the number the pull model exists to move.
- **0 stored values fail a stated plausibility rule.**

## The job timeline for this IPO under the three-job cadence (§2.1)

| When | Job | What it does for this IPO |
|---|---|---|
| before 2026-09-09, at 00:00 / 08:00 / 14:00 | Data job | discovers the IPO, downloads each document as it is filed, extracts it once on arrival, and walks the field plan. It never re-opens a document because time passed. |
| 2026-09-09 to 2026-09-14, every 30 min 10:00–18:30 | Live-figures job | subscription, demand graph and grey-market premium only. It touches no document, no plan row and no static field. |
| 2026-09-09 to 2026-09-14, at 00:00 / 08:00 / 14:00 | Data job | re-walks only fields whose plan row is still PENDING or due for verification; a newly filed corrigendum or price band advertisement is a new reason to read, and is read on the next data job rather than within the hour. |
| 2026-09-14 to 2026-09-17 | Data job | the timetable family (E-1) is re-read from NSE then BSE, because a printed advertisement is never reissued when a window moves. |
| after 2026-09-17 | Data job | listing performance; the documents stay on disk for the life of this row (OD-23), so this IPO never joins the closed backlog document-less. |
| from the first night after 2026-09-14, 22:00 | Closed-IPO job | eligible once `close_date` is in the past. Ten IPOs a night, newest close date first, this one marked done in `closed_ipo_resourcing` so it is never picked twice. |

## Every applicable field

`R1` is the source the plan would ask first for a MAINBOARD issue. "What the rank-1 source says"
is the label found in the saved payload and the value beside it — an empty cell means the payload was
searched and no label matched, which is a rank to re-examine, not proof the source lacks the field.

| Field | Cls | R1 | R2 · R3 | What the rank-1 source says | Stored today | Rule | Evidence |
|---|---|---|---|---|---|---|---|
| `ipos.symbol` | D | DOC | NSE · BSE | _(searched, no matching label)_ | `VEEGALAND` | _(no rule stated)_ | — |
| `ipos.company_name` | D | DOC | NSE · BSE | _(searched, no matching label)_ | `Veegaland Developers Ltd.` | _(no rule stated)_ | — |
| `ipos.issue_size` | D | DOC | BSE · CG | _(searched, no matching label)_ | `2100000000.00` | pass — Rs 210.00 crore | — |
| `ipos.lot_size` | D | DOC | BSE · NSE | _(the source carries this field, but the only saved payload proving it belongs to a DIFFERENT IPO — nothing quoted)_ | `107` | pass | — |
| `ipos.open_date` | T | NSE | BSE · CG | _(the source carries this field, but the only saved payload proving it belongs to a DIFFERENT IPO — nothing quoted)_ | 2026-09-09 | pass | — |
| `ipos.close_date` | T | NSE | BSE · CG | _(the source carries this field, but the only saved payload proving it belongs to a DIFFERENT IPO — nothing quoted)_ | 2026-09-14 | pass | — |
| `ipos.listing_date` | T | NSE | BSE · CG | _(searched, no matching label)_ | 2026-09-17 | pass | — |
| `ipos.status` | T | NSE | BSE · CG | status | `UPCOMING` | _(no rule stated)_ | `nse/ipo-current-issue.json` |
| `ipos.registrar` | D | DOC | NSE · BSE | _(searched, no matching label)_ | `MUFG Intime India Private Limited` | _(no rule stated)_ | — |
| `ipos.registrar_id` | C | — | — · — | _(searched, no matching label)_ | `2af24602-0819-4949-b9ce-16dd6d648ddc` | _(no rule stated)_ | — |
| `ipos.rating_override` | I | ADMIN | — · — | _(not probed: an admin-only field has no external source to probe)_ | `false` | _(no rule stated)_ | — |
| `ipos.slug` | C | — | — · — | _(searched, no matching label)_ | `veegaland-developers-ltd` | _(no rule stated)_ | — |
| `ipos.sector` | D | DOC | CG · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `ipos.price_range_min` | D | DOC | NSE · BSE | _(searched, no matching label)_ | `130` | pass | — |
| `ipos.price_range_max` | D | DOC | NSE · BSE | _(searched, no matching label)_ | `140` | pass | — |
| `ipos.last_scraped_at` | I | — | — · — | _(searched, no matching label)_ | 2026-09-09 | _(no rule stated)_ | — |
| `ipos.listing_exchanges` | T | NSE | BSE · CG | _(searched, no matching label)_ | `["NSE","BSE"]` | _(no rule stated)_ | — |
| `ipos.face_value` | D | DOC | BSE · NSE | _(the source carries this field, but the only saved payload proving it belongs to a DIFFERENT IPO — nothing quoted)_ | `10` | pass | — |
| `ipos.allotment_date` | T | NSE | BSE · CG | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `ipos.company_description` | D | DOC | CG · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `ipos.lead_managers` | D | DOC | NSE · BSE | _(searched, no matching label)_ | `["Cumulative Capital Private Limited"]` | _(no rule stated)_ | — |
| `ipos.isin` | D | DOC | NSE · BSE | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `ipos.segment` | D | DOC | NSE · BSE | _(searched, no matching label)_ | `MAINBOARD` | _(no rule stated)_ | — |
| `ipos.offering_type` | D | DOC | BSE · CG | _(searched, no matching label)_ | `IPO` | _(no rule stated)_ | — |
| `ipos.scraper_locked` | I | ADMIN | — · — | _(not probed: an admin-only field has no external source to probe)_ | `false` | _(no rule stated)_ | — |
| `ipos.last_manual_edit_at` | I | — | — · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `ipos.objectives` | D | DOC | CG · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `ipos.bse_ipo_no` | I | BSE | — · — | _(searched, no matching label)_ | `7959` | _(no rule stated)_ | — |
| `ipos.bse_payload_lead_manager_count` | I | BSE | — · — | _(searched, no matching label)_ | `1` | _(no rule stated)_ | — |
| `ipos.company_website` | D | DOC | CG · — | _(searched, no matching label)_ | `https://www.veegaland.com` | _(no rule stated)_ | — |
| `ipos.verifier_url` | I | — | — · — | _(searched, no matching label)_ | `https://www.chittorgarh.com/ipo/veegaland-developers-ipo/...` | _(no rule stated)_ | — |
| `ipos.cin` | D | DOC | — · — | _(the source carries this field, but the only saved payload proving it belongs to a DIFFERENT IPO — nothing quoted)_ | `U45201KL2007PLC021107` | _(no rule stated)_ | — |
| `ipo_details.company_description` | D | DOC | CG · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `ipo_details.issue_type` | D | DOC | NSE · CG | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `ipo_details.fresh_issue` | D | DOC | BSE · CG | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `ipo_details.ofs_issue` | D | DOC | BSE · CG | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `ipo_details.face_value` | D | DOC | BSE · CG | _(the source carries this field, but the only saved payload proving it belongs to a DIFFERENT IPO — nothing quoted)_ | _(empty)_ | _(no rule stated)_ | — |
| `ipo_details.basis_of_allotment_date` | T | NSE | BSE · CG | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `ipo_details.initiation_of_refunds_date` | T | NSE | BSE · CG | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `ipo_details.credit_of_shares_date` | T | NSE | BSE · CG | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `ipo_details.exchanges` | D | DOC | NSE · BSE | _(searched, no matching label)_ | `["NSE","BSE"]` | _(no rule stated)_ | — |
| `ipo_details.data_source` | I | — | — · — | _(searched, no matching label)_ | `DRHP` | _(no rule stated)_ | — |
| `ipo_details.last_verified_at` | I | — | — · — | _(searched, no matching label)_ | 2026-09-08 | _(no rule stated)_ | — |
| `ipo_details.compliance_officer` | D | DOC | — · — | _(the source carries this field, but the only saved payload proving it belongs to a DIFFERENT IPO — nothing quoted)_ | _(empty)_ | _(no rule stated)_ | — |
| `ipo_details.compliance_officer_phone` | D | DOC | — · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `ipo_details.compliance_officer_email` | D | DOC | — · — | _(the source carries this field, but the only saved payload proving it belongs to a DIFFERENT IPO — nothing quoted)_ | _(empty)_ | _(no rule stated)_ | — |
| `ipo_details.upi_cutoff_time` | D | DOC | NSE · CG | _(the source carries this field, but the only saved payload proving it belongs to a DIFFERENT IPO — nothing quoted)_ | _(empty)_ | _(no rule stated)_ | — |
| `ipo_details.designated_exchange` | D | DOC | — · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `ipo_details.lot_multiple` | D | DOC | BSE · CG | _(the source carries this field, but the only saved payload proving it belongs to a DIFFERENT IPO — nothing quoted)_ | _(empty)_ | _(no rule stated)_ | — |
| `ipo_details.allocation_pct` | D | DOC | — · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `ipo_details.pre_ipo_placement` | D | DOC | — · — | _(the source carries this field, but the only saved payload proving it belongs to a DIFFERENT IPO — nothing quoted)_ | _(empty)_ | _(no rule stated)_ | — |
| `ipo_details.bid_windows` | D | DOC | NSE · CG | _(the source carries this field, but the only saved payload proving it belongs to a DIFFERENT IPO — nothing quoted)_ | _(empty)_ | _(no rule stated)_ | — |
| `ipo_details.promoter_shares_held` | D | DOC | — · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `ipo_details.sebi_regulation_cited` | D | DOC | — · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `ipo_details.promoter_group_transactions_since_drhp` | D | DOC | — · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `ipo_details.cut_off_price` | D | DOC | — · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `ipo_details.min_investment` | D | DOC | — · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `ipo_details.isin` | D | DOC | NSE · BSE | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `ipo_details.registrar_link` | D | DOC | — · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `ipo_details.lead_managers` | D | DOC | BSE · CG | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `ipo_details.company_address` | D | DOC | — · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `ipo_details.company_phone` | D | DOC | — · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `ipo_details.company_email` | D | DOC | — · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `ipo_details.company_city` | D | DOC | — · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `ipo_details.company_state` | D | DOC | — · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `ipo_details.company_pincode` | D | DOC | — · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `ipo_details.qib_shares_offered` | D | DOC | NSE · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `ipo_details.nii_shares_offered` | D | DOC | NSE · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `ipo_details.retail_shares_offered` | D | DOC | NSE · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `ipo_details.retail_max_allottees` | D | DOC | NSE · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `ipo_details.employee_shares_offered` | D | DOC | NSE · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `ipo_details.anchor_shares_offered` | D | DOC | NSE · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `ipo_details.max_retail_subscription` | D | DOC | NSE · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `ipo_details.max_employee_subscription` | D | DOC | NSE · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `ipo_details.employee_discount` | D | DOC | NSE · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `ipo_details.sponsor_banks` | D | DOC | NSE · BSE | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `ipo_details.tick_size` | D | DOC | NSE · BSE | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `ipo_details.ipo_market_timings` | D | DOC | NSE · BSE | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `ipo_details.category_details` | D | DOC | NSE · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `ipo_details.sub_categories_upi` | D | DOC | NSE · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `financial_data.revenue_fy2022` | D | DOC | CG · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `financial_data.revenue_fy2023` | D | DOC | CG · — | _(searched, no matching label)_ | `108.91` | _(no rule stated)_ | — |
| `financial_data.revenue_fy2024` | D | DOC | CG · — | _(searched, no matching label)_ | `110.77` | _(no rule stated)_ | — |
| `financial_data.profit_fy2022` | D | DOC | CG · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `financial_data.profit_fy2023` | D | DOC | CG · — | _(searched, no matching label)_ | `14.53` | _(no rule stated)_ | — |
| `financial_data.profit_fy2024` | D | DOC | CG · — | _(searched, no matching label)_ | `7.87` | _(no rule stated)_ | — |
| `financial_data.net_worth` | D | DOC | CG · — | _(searched, no matching label)_ | `266.90` | _(no rule stated)_ | — |
| `financial_data.eps` | D | DOC | CG · — | _(searched, no matching label)_ | `8.77` | _(no rule stated)_ | — |
| `financial_data.roe` | D | DOC | CG · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `financial_data.debt_to_equity` | D | DOC | CG · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `financial_data.reserves_and_surplus` | D | DOC | CG · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `financial_data.total_assets` | D | DOC | CG · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `financial_data.total_borrowing` | D | DOC | CG · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `financial_data.promoter_holding_pre_issue` | D | DOC | CG · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `financial_data.promoter_holding_post_issue` | D | DOC | CG · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `financial_data.market_cap` | D | DOC | CG · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `financial_data.pre_ipo_eps` | D | DOC | CG · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `financial_data.post_ipo_eps` | D | DOC | CG · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `financial_data.ronw` | D | DOC | CG · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `financial_data.pe_ratio` | D | DOC | — · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `financial_data.ebitda_fy2022` | D | DOC | CG · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `financial_data.ebitda_fy2023` | D | DOC | CG · — | _(searched, no matching label)_ | `24.22` | _(no rule stated)_ | — |
| `financial_data.ebitda_fy2024` | D | DOC | CG · — | _(searched, no matching label)_ | `16.72` | _(no rule stated)_ | — |
| `financial_data.total_income_fy2022` | D | DOC | CG · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `financial_data.total_income_fy2023` | D | DOC | CG · — | _(searched, no matching label)_ | `110.08` | _(no rule stated)_ | — |
| `financial_data.total_income_fy2024` | D | DOC | CG · — | _(searched, no matching label)_ | `114.61` | _(no rule stated)_ | — |
| `financial_data.current_ratio` | D | DOC | — · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `financial_data.quick_ratio` | D | DOC | — · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `financial_data.inventory_turnover` | D | DOC | — · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `financial_statements.fiscal_year` | D | DOC | CG · — | _(searched, no matching label)_ | `2023` | _(no rule stated)_ | — |
| `financial_statements.revenue` | D | DOC | CG · — | _(searched, no matching label)_ | `10891.16` | _(no rule stated)_ | — |
| `financial_statements.total_income` | D | DOC | CG · — | _(searched, no matching label)_ | `11008.31` | _(no rule stated)_ | — |
| `financial_statements.ebitda` | D | DOC | CG · — | _(searched, no matching label)_ | `2421.98` | _(no rule stated)_ | — |
| `financial_statements.pat` | D | DOC | CG · — | _(searched, no matching label)_ | `1453.06` | _(no rule stated)_ | — |
| `financial_statements.net_worth` | D | DOC | CG · — | _(searched, no matching label)_ | `3723.97` | _(no rule stated)_ | — |
| `financial_statements.basis` | D | DOC | CG · — | _(searched, no matching label)_ | `RESTATED` | _(no rule stated)_ | — |
| `financial_statements.unit` | D | DOC | CG · — | _(the source carries this field, but the only saved payload proving it belongs to a DIFFERENT IPO — nothing quoted)_ | `LAKH` | _(no rule stated)_ | — |
| `financial_statements.eps_basic` | D | DOC | — · — | _(searched, no matching label)_ | `5.81` | _(no rule stated)_ | — |
| `financial_statements.eps_diluted` | D | DOC | — · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `financial_statements.op_cash_flow` | D | DOC | — · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `financial_statements.dscr` | D | DOC | — · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `financial_statements.rent_expense` | D | DOC | — · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `ipo_valuation.price_floor` | D | DOC | NSE · BSE | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `ipo_valuation.price_cap` | D | DOC | NSE · BSE | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
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
| `ipo_intermediaries.role` | D | DOC | BSE · CG | _(searched, no matching label)_ | `BRLM` | _(no rule stated)_ | — |
| `ipo_intermediaries.name` | D | DOC | BSE · CG | _(searched, no matching label)_ | `Cumulative Capital Private Limited` | _(no rule stated)_ | — |
| `ipo_risk_factors.seq` | D | DOC | — · — | _(searched, no matching label)_ | `1` | _(no rule stated)_ | — |
| `ipo_risk_factors.heading` | D | DOC | — · — | _(searched, no matching label)_ | `Our business is entirely concentrated in the state of Ker...` | _(no rule stated)_ | — |
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
| `peer_companies.company_name` | D | DOC | CG · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `peer_companies.is_listed` | D | DOC | CG · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `peer_companies.pe_ratio` | D | DOC | CG · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `peer_companies.eps` | D | DOC | CG · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `peer_companies.diluted_eps` | D | DOC | CG · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `peer_companies.ronw` | D | DOC | CG · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `peer_companies.nav` | D | DOC | CG · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `peer_companies.pbv_ratio` | D | DOC | CG · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `peer_companies.data_source` | I | — | — · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `peer_companies.last_updated` | I | — | — · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `peer_companies.financial_statement_type` | D | DOC | — · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `anchor_investors.bid_date` | T | NSE | BSE · CG | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
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
| `subscriptions.timestamp` | I | — | — · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `subscriptions.qib_subscription` | X | NSE | BSE · CG | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `subscriptions.nii_subscription` | X | NSE | BSE · CG | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `subscriptions.retail_subscription` | X | NSE | BSE · CG | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `subscriptions.total_subscription` | X | NSE | BSE · CG | _(the source carries this field, but the only saved payload proving it belongs to a DIFFERENT IPO — nothing quoted)_ | _(empty)_ | _(no rule stated)_ | — |
| `subscriptions.employee_subscription` | X | NSE | BSE · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `subscriptions.b_nii_subscription` | X | NSE | BSE · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `subscriptions.s_nii_subscription` | X | NSE | BSE · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `subscriptions.total_shares_bid` | X | NSE | BSE · — | _(the source carries this field, but the only saved payload proving it belongs to a DIFFERENT IPO — nothing quoted)_ | _(empty)_ | _(no rule stated)_ | — |
| `subscriptions.shares_offered` | X | NSE | BSE · — | _(the source carries this field, but the only saved payload proving it belongs to a DIFFERENT IPO — nothing quoted)_ | _(empty)_ | _(no rule stated)_ | — |
| `subscriptions.scope` | I | — | — · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `gmp_records.timestamp` | I | — | — · — | _(searched, no matching label)_ | 2026-09-01 | _(no rule stated)_ | — |
| `gmp_records.gmp` | W | IG | CG · — | GMP | `14.00` | _(no rule stated)_ | `investorgain/gmp-live.json` |
| `gmp_records.source` | I | — | — · — | _(searched, no matching label)_ | `INVESTORGAIN_GMP` | _(no rule stated)_ | — |
| `gmp_records.gmp_percentage` | C | — | — · — | _(searched, no matching label)_ | `10.00` | _(no rule stated)_ | — |
| `listing_performance.listing_price` | M | NSE | BSE · CG | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `listing_performance.issue_price` | C | — | — · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `listing_performance.listing_gain_percent` | C | — | — · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `listing_performance.current_price` | M | NSE | BSE · CG | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `listing_performance.current_gain_percent` | C | — | — · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `listing_performance.last_updated` | I | — | — · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `listing_performance.current_price_bse` | M | BSE | — · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `listing_performance.current_price_nse` | M | NSE | — · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `listing_performance.symbol` | C | — | — · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `listing_performance.company_name` | C | — | — · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `listing_performance.listing_date` | C | — | — · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `listing_performance.data_source` | I | — | — · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `ipo_demand_graph.timestamp` | I | — | — · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `ipo_demand_graph.price_point` | X | NSE | BSE · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `ipo_demand_graph.is_cut_off` | X | NSE | BSE · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `ipo_demand_graph.cumulative_quantity` | X | NSE | BSE · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `ipo_demand_graph.exchange` | X | NSE | BSE · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
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

_Regenerate: `node docs/design/probes/walkthrough.mjs veegaland-developers-ltd`._


---

# The walk against the design, field by field

Everything above this line is generated by `docs/design/probes/walkthrough.mjs`. Everything below it
is the walk itself: the field plan of `docs/design/data-sourcing-pull-model.md` applied to this row
in field order, stopping at the FIRST rule that gives no answer. Numbers below are read from
production through the read-only tunnel on 2026-09-09 or from the generated table above; none are
typed from memory.

**Two things the generated table gets wrong for every IPO, stated once so no reader is misled:**

1. **Every date in the table is one day early.** `ipos.open_date` for this row reads
   `2026-09-10` in the database (`select open_date::text`), and the table prints
   `2026-09-09`. `node-pg` parses a PostgreSQL `date` as local midnight, and this machine runs
   IST (UTC+5:30), so `toISOString()` rolls it back a day. This affects the two walkthroughs
   published earlier as well — Asset Reconstruction opened on 2026-09-09, not the 2026-09-08 its
   file prints. Recorded as finding **F-104**.
2. **The `documents.*` rows read `_(empty)_` and that is a generator artefact, not a data gap.**
   `walkthrough.mjs` loads eleven child tables into `stored` and `documents` is not one of them, so
   every `documents.*` field renders empty. This IPO has five active document rows; they are
   listed in the header table above.


## Why this IPO was chosen

By query, in `docs/design/probes/pick-walkthrough-ipos.mjs`:

> every IPO with at least one active `CORRIGENDUM` document, most corrigenda first, then most documents

**One candidate on the whole of production.** §2.5.5 says a corrigendum exists on production; that is
now verified rather than trusted. Veegaland Developers Ltd. is the only IPO on production that has
one, so it is the only row against which §2.5.5's three rules can be walked at all.

## The document set this walk has to order

| Type | `filing_date` | stored `uploaded_at` | extraction | exchange | bytes |
|---|---|---|---|---|---:|
| `DRHP` | **null** | 2026-09-04 03:33:49.545 | COMPLETED | SEBI | 5,613,279 |
| `RHP` | 2026-08-31 | 2026-09-04 03:34:22.039 | COMPLETED | SEBI | 4,321,492 |
| `PRICE_BAND_AD` | **null** | 2026-09-08 13:31:01.484 | COMPLETED | BSE | 1,766,165 |
| `CORRIGENDUM` | **null** | 2026-09-08 13:31:02.276 | **PENDING** | BSE | 1,102,907 |
| `RATIOS_BASIS_ISSUE_PRICE` | **null** | 2026-09-08 15:01:02.664 | PENDING | NSE | 1,766,165 |

`uploaded_at` is a `timestamp without time zone` carrying the known IST-naive skew, so those values
are read as an ORDERING, not as a clock. The price band advertisement and the corrigendum are
**792 milliseconds apart** in that ordering. The corrigendum's URL names what it corrects:
`listing.bseindia.com/Download/8888888/PreAnchor/VDL_Corrigendum_Ad_20260908131930.pdf`.

## The walk, in field order

| # | Field | What the design says | Result |
|---:|---|---|---|
| 1 | `ipos.symbol` | §1.2 row 1: DOC · NSE · BSE, `^[A-Z0-9&-]{1,20}$` | stored `VEEGALAND`, passes |
| 2 | `ipos.company_name` | §1.2 row 2: legal-name form | stored `Veegaland Developers Ltd.`, passes |
| 3 | `ipos.issue_size` | §1.2 row 3: `fresh + OFS = total ±0.5%`, `shares_at_cap × cap ≈ total ±0.5%` | stored ₹210.00 crore; `fresh_issue` and `ofs_issue` are both **empty**, so neither identity can be evaluated — the §2.5.4 provisional rule covers this and it is not a stop |
| 4 | `ipos.lot_size` | §1.2 row 4: mainboard `₹10,000 ≤ lot × floor ≤ ₹15,000` | 107 × 130 = ₹13,910, passes |
| 5–8 | `open_date` … `status` | §1.2.1 E-1: NSE wins, then BSE | 2026-09-10 → 2026-09-15, listing 2026-09-18; `close ≥ open`, four working days, passes |
| 14 | `ipos.price_range_min` | §1.2 row 14: `floor < cap`, `cap ≤ 1.2 × floor` mainboard | 130 < 140, and 140 ≤ 156, passes |
| 15 | `ipos.price_range_max` | as 14 | passes |

**And then it stops — at field 14, and at every document-owned field after it.**

## THE STOP: §2.5.5, all three rules, order documents by a `filing_date` this corrigendum does not have

§2.5.5 states three rules and every one of them is keyed on `filing_date`:

- **Rule 1** — *"Two documents of the same type are ordered by `filing_date`."*
- **Rule 2** — the corrigendum's named fields are *"frozen against every **earlier** document of any
  type"*.
- **Rule 3** — *"A corrigendum whose `filing_date` is **after** the prospectus's … is treated as
  precedence 100 + 1"*; one whose date is before it *"is superseded by it in full"*.

**The only `CORRIGENDUM` on production has `filing_date = null`.** So does the price band
advertisement it corrects, and so does the DRHP. Measured across all 266 active documents on
production: **27 carry a filing date and 239 do not**, and by type it is **0 of 1 CORRIGENDUM,
0 of 13 PRICE_BAND_AD, 0 of 81 PROSPECTUS, 0 of 19 DRHP; only RHP has any (27 of 43)**.

**The question the design cannot answer:** what orders a corrigendum against the documents it amends
when it has no filing date? Rule 2's word *"earlier"* has no referent. §2.5.5 acknowledges the
population gap in its closing paragraph — *"`filing_date` is populated on 24 of 256 documents, so
ordering by filing date is a rule this design creates rather than one it inherits"* — but it treats
that as a backlog to fill, not as a rule that needs a stated fallback. There is no fallback. The
candidates a builder would have to choose between, none of them named in the design, are:

- `uploaded_at` — our own clock, which here separates the two BSE documents by 792 ms and would make
  the ordering an artefact of the order the downloader happened to fetch them in;
- the timestamp inside the BSE URL (`…_20260908131930`) — the exchange's own publication stamp, the
  only per-document date that actually exists for these two files;
- the date printed on the face of the advertisement, which requires the extraction that has not run.

**Rule and section named: §2.5.5 rules 1–3 (OD-30), "ordered by `filing_date`". Recorded as
finding F-99.**

## Continuing past the gap — everything below is PROVISIONAL on F-99

**The second thing this row exposes, which the first does not depend on.** Rule 2 says a corrigendum
*"overrides only the fields it explicitly names."* Knowing which fields it names requires reading it.
**This corrigendum's `extraction_status` is `PENDING`** and has been since it was fetched, while
the IPO opens on **2026-09-10** — tomorrow — with a 130–140 band on the page that this corrigendum
may exist to correct. Across production, **172 of 266 active documents are `PENDING`, 70 COMPLETED,
22 MANUAL_REVIEW, 2 FAILED.**

The design says nothing about the state of a field while a corrigendum naming it is unread. Two
readings are available and they are opposites:

- **Keep publishing the RHP/price-band value** — which is exactly the failure Rule 2 was written to
  stop, only earlier in time: not a re-extraction restoring the wrong number, but the wrong number
  never having been corrected.
- **Hold the fields the corrigendum might name** — impossible as stated, because "the fields it
  names" is unknown until it is read, so the only safe hold is *every* document-owned field, which
  would blank a live IPO's page.

The honest answer is a third one the design does not state: **an unread corrigendum on an OPEN or
UPCOMING IPO is a same-day escalation, not a queue item** — it is the one document type where
`PENDING` is itself the signal. Recorded as finding **F-100**.

**Third, and smaller: §1.1 and §2.5.5 order `PRICE_BAND_AD` against `CORRIGENDUM` differently.**
§1.1 line 437 gives, for price-dependent fields, `PRICE_BAND_AD / CORRIGENDUM > RHP > PROSPECTUS >
DRHP` — the two tied by a slash, no tiebreak. §2.5.5 quotes `DOCUMENT_PRECEDENCE` where
`CORRIGENDUM` is 80 and `PRICE_BAND_AD` is 70 — an order. On this IPO those are the two documents
that matter and they arrived within a second of each other, so the difference is not academic. The
numeric table resolves it (the corrigendum wins), so this is a wording conflict rather than a second
unanswerable rule, and it is noted here rather than filed separately.

## What a complete walk of this IPO would have needed

The corrigendum extracted; a stated fallback ordering for documents with no filing date; and
`fresh_issue` / `ofs_issue` populated so §1.2 row 3's two identities could actually run. Of the 240
fields, **184 are empty on production for this row today** and **2** have a rank-1 source backed by a
payload saved for this IPO.
