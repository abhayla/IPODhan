# Walkthrough: Rays of Belief Limited- For Profit Social Enterprise (MOMSBELIEF) — 2026-09-09

**Generated** by `docs/design/probes/walkthrough.mjs`. Every value in the "stored today" column is
read from production through the read-only tunnel; every value in the "what the rank-1 source says"
column is read from a payload saved under `docs/design/probes/fixtures/`. Nothing here is typed.

| | |
|---|---|
| slug | `rays-of-belief-ltd` |
| status / segment | LISTED / MAINBOARD |
| resolved type for Appendix A | **MAINBOARD** |
| listing exchanges | ["NSE"] |
| open / close / listing | 2026-08-31 / 2026-09-02 / 2026-09-07 |
| documents on file | ANCHOR_ALLOCATION_REPORT (MANUAL_REVIEW), BIDDING_CENTERS (PENDING), RATIOS_BASIS_ISSUE_PRICE (PENDING), RHP (COMPLETED), SAMPLE_APPLICATION_FORMS (PENDING), SECURITY_PARAMS_POST_ANCHOR (PENDING), SECURITY_PARAMS_PRE_ANCHOR (PENDING) |

## What this walk found, before the table

- **240 of 240 fields apply** to a MAINBOARD issue; 0 are N/A for this offering type.
- **2 of those have a rank-1 source backed by a payload saved for THIS IPO.** A further 19 rank-1 sources are known to carry the field, but only from another IPO's payload; those rows say so instead of borrowing the number. The rest are the honest gap: see §A.0's fifth verification round for what "no matching label" does and does not mean.
- **182 applicable fields are empty on production right now.** That is the number the pull model exists to move.
- **0 stored values fail a stated plausibility rule.**

## The job timeline for this IPO under the three-job cadence (§2.1)

| When | Job | What it does for this IPO |
|---|---|---|
| before 2026-08-31, at 00:00 / 08:00 / 14:00 | Data job | discovers the IPO, downloads each document as it is filed, extracts it once on arrival, and walks the field plan. It never re-opens a document because time passed. |
| 2026-08-31 to 2026-09-02, every 30 min 10:00–18:30 | Live-figures job | subscription, demand graph and grey-market premium only. It touches no document, no plan row and no static field. |
| 2026-08-31 to 2026-09-02, at 00:00 / 08:00 / 14:00 | Data job | re-walks only fields whose plan row is still PENDING or due for verification; a newly filed corrigendum or price band advertisement is a new reason to read, and is read on the next data job rather than within the hour. |
| 2026-09-02 to 2026-09-07 | Data job | the timetable family (E-1) is re-read from NSE then BSE, because a printed advertisement is never reissued when a window moves. |
| after 2026-09-07 | Data job | listing performance; the documents stay on disk for the life of this row (OD-23), so this IPO never joins the closed backlog document-less. |
| from the first night after 2026-09-02, 22:00 | Closed-IPO job | eligible once `close_date` is in the past. Ten IPOs a night, newest close date first, this one marked done in `closed_ipo_resourcing` so it is never picked twice. |

## Every applicable field

`R1` is the source the plan would ask first for a MAINBOARD issue. "What the rank-1 source says"
is the label found in the saved payload and the value beside it — an empty cell means the payload was
searched and no label matched, which is a rank to re-examine, not proof the source lacks the field.

| Field | Cls | R1 | R2 · R3 | What the rank-1 source says | Stored today | Rule | Evidence |
|---|---|---|---|---|---|---|---|
| `ipos.symbol` | D | DOC | NSE · BSE | _(searched, no matching label)_ | `MOMSBELIEF` | _(no rule stated)_ | — |
| `ipos.company_name` | D | DOC | NSE · BSE | _(searched, no matching label)_ | `Rays of Belief Limited- For Profit Social Enterprise` | _(no rule stated)_ | — |
| `ipos.issue_size` | D | DOC | BSE · CG | _(searched, no matching label)_ | `749936590.00` | pass — Rs 74.99 crore | — |
| `ipos.lot_size` | D | DOC | BSE · NSE | _(the source carries this field, but the only saved payload proving it belongs to a DIFFERENT IPO — nothing quoted)_ | `62` | pass | — |
| `ipos.open_date` | T | NSE | BSE · CG | _(the source carries this field, but the only saved payload proving it belongs to a DIFFERENT IPO — nothing quoted)_ | 2026-08-31 | pass | — |
| `ipos.close_date` | T | NSE | BSE · CG | _(the source carries this field, but the only saved payload proving it belongs to a DIFFERENT IPO — nothing quoted)_ | 2026-09-02 | pass | — |
| `ipos.listing_date` | T | NSE | BSE · CG | _(searched, no matching label)_ | 2026-09-07 | pass | — |
| `ipos.status` | T | NSE | BSE · CG | status | `LISTED` | _(no rule stated)_ | `nse/ipo-current-issue.json` |
| `ipos.registrar` | D | DOC | NSE · BSE | _(searched, no matching label)_ | `Kfin Technologies Limited` | _(no rule stated)_ | — |
| `ipos.registrar_id` | C | — | — · — | _(searched, no matching label)_ | `0897d435-f4b2-4443-9121-26c84ee20f43` | _(no rule stated)_ | — |
| `ipos.rating_override` | I | ADMIN | — · — | _(not probed: an admin-only field has no external source to probe)_ | `false` | _(no rule stated)_ | — |
| `ipos.slug` | C | — | — · — | _(searched, no matching label)_ | `rays-of-belief-ltd` | _(no rule stated)_ | — |
| `ipos.sector` | D | DOC | CG · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `ipos.price_range_min` | D | DOC | NSE · BSE | _(searched, no matching label)_ | `227` | pass | — |
| `ipos.price_range_max` | D | DOC | NSE · BSE | _(searched, no matching label)_ | `239` | pass | — |
| `ipos.last_scraped_at` | I | — | — · — | _(searched, no matching label)_ | 2026-09-04 | _(no rule stated)_ | — |
| `ipos.listing_exchanges` | T | NSE | BSE · CG | _(searched, no matching label)_ | `["NSE"]` | _(no rule stated)_ | — |
| `ipos.face_value` | D | DOC | BSE · NSE | _(the source carries this field, but the only saved payload proving it belongs to a DIFFERENT IPO — nothing quoted)_ | `10` | pass | — |
| `ipos.allotment_date` | T | NSE | BSE · CG | _(searched, no matching label)_ | 2026-09-03 | _(no rule stated)_ | — |
| `ipos.company_description` | D | DOC | CG · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `ipos.lead_managers` | D | DOC | NSE · BSE | _(searched, no matching label)_ | `["Mefcom Capital Markets Limited"]` | _(no rule stated)_ | — |
| `ipos.isin` | D | DOC | NSE · BSE | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `ipos.segment` | D | DOC | NSE · BSE | _(searched, no matching label)_ | `MAINBOARD` | _(no rule stated)_ | — |
| `ipos.offering_type` | D | DOC | BSE · CG | _(searched, no matching label)_ | `IPO` | _(no rule stated)_ | — |
| `ipos.scraper_locked` | I | ADMIN | — · — | _(not probed: an admin-only field has no external source to probe)_ | `false` | _(no rule stated)_ | — |
| `ipos.last_manual_edit_at` | I | — | — · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `ipos.objectives` | D | DOC | CG · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `ipos.bse_ipo_no` | I | BSE | — · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `ipos.bse_payload_lead_manager_count` | I | BSE | — · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `ipos.company_website` | D | DOC | CG · — | _(searched, no matching label)_ | `https://www.momsbelief.com` | _(no rule stated)_ | — |
| `ipos.verifier_url` | I | — | — · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `ipos.cin` | D | DOC | — · — | _(the source carries this field, but the only saved payload proving it belongs to a DIFFERENT IPO — nothing quoted)_ | `U85110DL2017PLC322623` | _(no rule stated)_ | — |
| `ipo_details.company_description` | D | DOC | CG · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `ipo_details.issue_type` | D | DOC | NSE · CG | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `ipo_details.fresh_issue` | D | DOC | BSE · CG | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `ipo_details.ofs_issue` | D | DOC | BSE · CG | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `ipo_details.face_value` | D | DOC | BSE · CG | _(the source carries this field, but the only saved payload proving it belongs to a DIFFERENT IPO — nothing quoted)_ | _(empty)_ | _(no rule stated)_ | — |
| `ipo_details.basis_of_allotment_date` | T | NSE | BSE · CG | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `ipo_details.initiation_of_refunds_date` | T | NSE | BSE · CG | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `ipo_details.credit_of_shares_date` | T | NSE | BSE · CG | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `ipo_details.exchanges` | D | DOC | NSE · BSE | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `ipo_details.data_source` | I | — | — · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `ipo_details.last_verified_at` | I | — | — · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
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
| `financial_data.revenue_fy2023` | D | DOC | CG · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `financial_data.revenue_fy2024` | D | DOC | CG · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `financial_data.profit_fy2022` | D | DOC | CG · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `financial_data.profit_fy2023` | D | DOC | CG · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `financial_data.profit_fy2024` | D | DOC | CG · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `financial_data.net_worth` | D | DOC | CG · — | _(searched, no matching label)_ | `12102.08` | _(no rule stated)_ | — |
| `financial_data.eps` | D | DOC | CG · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
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
| `financial_data.ebitda_fy2023` | D | DOC | CG · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `financial_data.ebitda_fy2024` | D | DOC | CG · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `financial_data.total_income_fy2022` | D | DOC | CG · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `financial_data.total_income_fy2023` | D | DOC | CG · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `financial_data.total_income_fy2024` | D | DOC | CG · — | _(searched, no matching label)_ | `30.76` | _(no rule stated)_ | — |
| `financial_data.current_ratio` | D | DOC | — · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `financial_data.quick_ratio` | D | DOC | — · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `financial_data.inventory_turnover` | D | DOC | — · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `financial_statements.fiscal_year` | D | DOC | CG · — | _(searched, no matching label)_ | `2024` | _(no rule stated)_ | — |
| `financial_statements.revenue` | D | DOC | CG · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `financial_statements.total_income` | D | DOC | CG · — | _(searched, no matching label)_ | `307.57` | _(no rule stated)_ | — |
| `financial_statements.ebitda` | D | DOC | CG · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `financial_statements.pat` | D | DOC | CG · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `financial_statements.net_worth` | D | DOC | CG · — | _(searched, no matching label)_ | `119368.59` | _(no rule stated)_ | — |
| `financial_statements.basis` | D | DOC | CG · — | _(searched, no matching label)_ | `RESTATED` | _(no rule stated)_ | — |
| `financial_statements.unit` | D | DOC | CG · — | _(the source carries this field, but the only saved payload proving it belongs to a DIFFERENT IPO — nothing quoted)_ | `MILLION` | _(no rule stated)_ | — |
| `financial_statements.eps_basic` | D | DOC | — · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
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
| `ipo_intermediaries.name` | D | DOC | BSE · CG | _(searched, no matching label)_ | `Mefcom Capital Markets Limited` | _(no rule stated)_ | — |
| `ipo_risk_factors.seq` | D | DOC | — · — | _(searched, no matching label)_ | `14` | _(no rule stated)_ | — |
| `ipo_risk_factors.heading` | D | DOC | — · — | _(searched, no matching label)_ | `Our operations are subject to the compliance of certain a...` | _(no rule stated)_ | — |
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
| `subscriptions.timestamp` | I | — | — · — | _(searched, no matching label)_ | 2026-08-31 | _(no rule stated)_ | — |
| `subscriptions.qib_subscription` | X | NSE | BSE · CG | _(searched, no matching label)_ | `0.00` | _(no rule stated)_ | — |
| `subscriptions.nii_subscription` | X | NSE | BSE · CG | _(searched, no matching label)_ | `0.00` | _(no rule stated)_ | — |
| `subscriptions.retail_subscription` | X | NSE | BSE · CG | _(searched, no matching label)_ | `0.00` | _(no rule stated)_ | — |
| `subscriptions.total_subscription` | X | NSE | BSE · CG | _(the source carries this field, but the only saved payload proving it belongs to a DIFFERENT IPO — nothing quoted)_ | `0.00` | _(no rule stated)_ | — |
| `subscriptions.employee_subscription` | X | NSE | BSE · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `subscriptions.b_nii_subscription` | X | NSE | BSE · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `subscriptions.s_nii_subscription` | X | NSE | BSE · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `subscriptions.total_shares_bid` | X | NSE | BSE · — | _(the source carries this field, but the only saved payload proving it belongs to a DIFFERENT IPO — nothing quoted)_ | `0` | _(no rule stated)_ | — |
| `subscriptions.shares_offered` | X | NSE | BSE · — | _(the source carries this field, but the only saved payload proving it belongs to a DIFFERENT IPO — nothing quoted)_ | `0` | _(no rule stated)_ | — |
| `subscriptions.scope` | I | — | — · — | _(searched, no matching label)_ | _(empty)_ | _(no rule stated)_ | — |
| `gmp_records.timestamp` | I | — | — · — | _(searched, no matching label)_ | 2026-08-26 | _(no rule stated)_ | — |
| `gmp_records.gmp` | W | IG | CG · — | GMP | `18.00` | _(no rule stated)_ | `investorgain/gmp-live.json` |
| `gmp_records.source` | I | — | — · — | _(searched, no matching label)_ | `INVESTORGAIN_GMP` | _(no rule stated)_ | — |
| `gmp_records.gmp_percentage` | C | — | — · — | _(searched, no matching label)_ | `7.53` | _(no rule stated)_ | — |
| `listing_performance.listing_price` | M | NSE | BSE · CG | _(searched, no matching label)_ | `228.34` | _(no rule stated)_ | — |
| `listing_performance.issue_price` | C | — | — · — | _(searched, no matching label)_ | `239.00` | _(no rule stated)_ | — |
| `listing_performance.listing_gain_percent` | C | — | — · — | _(searched, no matching label)_ | `-4.46` | _(no rule stated)_ | — |
| `listing_performance.current_price` | M | NSE | BSE · CG | _(searched, no matching label)_ | `228.25` | _(no rule stated)_ | — |
| `listing_performance.current_gain_percent` | C | — | — · — | _(searched, no matching label)_ | `-4.50` | _(no rule stated)_ | — |
| `listing_performance.last_updated` | I | — | — · — | _(searched, no matching label)_ | 2026-09-09 | _(no rule stated)_ | — |
| `listing_performance.current_price_bse` | M | BSE | — · — | _(searched, no matching label)_ | `228.25` | _(no rule stated)_ | — |
| `listing_performance.current_price_nse` | M | NSE | — · — | _(searched, no matching label)_ | `228.34` | _(no rule stated)_ | — |
| `listing_performance.symbol` | C | — | — · — | _(searched, no matching label)_ | `MOMSBELIEF` | _(no rule stated)_ | — |
| `listing_performance.company_name` | C | — | — · — | _(searched, no matching label)_ | `Rays of Belief Limited- For Profit Social Enterprise` | _(no rule stated)_ | — |
| `listing_performance.listing_date` | C | — | — · — | _(searched, no matching label)_ | 2026-09-07 | _(no rule stated)_ | — |
| `listing_performance.data_source` | I | — | — · — | _(searched, no matching label)_ | `SCRAPER` | _(no rule stated)_ | — |
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

_Regenerate: `node docs/design/probes/walkthrough.mjs rays-of-belief-ltd`._


---

# The walk against the design, field by field

Everything above this line is generated by `docs/design/probes/walkthrough.mjs`. Everything below it
is the walk itself: the field plan of `docs/design/data-sourcing-pull-model.md` applied to this row
in field order, stopping at the FIRST rule that gives no answer. Numbers below are read from
production through the read-only tunnel on 2026-09-09; none are typed from memory.

**Two things the generated table gets wrong for every IPO, stated once so no reader is misled:**

1. **Every date in the table is one day early.** `ipos.open_date` for this row reads `2026-09-01`
   in the database (`select open_date::text`); the table prints `2026-08-31`. `node-pg` parses a
   PostgreSQL `date` as local midnight and this machine runs IST (UTC+5:30), so `toISOString()`
   rolls it back a day. The two walkthroughs published earlier carry the same error. Recorded as
   finding **F-104**.
2. **The `documents.*` rows read `_(empty)_` and that is a generator artefact, not a data gap.**
   `walkthrough.mjs` loads eleven child tables into `stored` and `documents` is not one of them.
   This row has seven active document rows; they are listed in the header table above.


## Why this IPO was chosen — and what the query the design ASKED for actually returned

§2.3.3.2 does not merely allow a probe here, it **owes one**:

> **The test this rule owes** is a REAL rename pair, not a synthetic one: a company whose draft and
> its RHP carry different names, found by probe over `documents` and `ipos` on production. If no such
> pair exists in our data, the test uses the pair the probe found on the exchange and the finding
> says so.

So `docs/design/probes/pick-walkthrough-ipos.mjs` now runs exactly that query, and a second one, and
reports both.

**Query 3a — the draft-vs-filing rename the design asked for.** Fold `ipos.company_name` and the
`DRHP` document's title to significant words (lowercase, strip punctuation, delete
`limited ltd private pvt company co corporation corp incorporated inc india indian and the of drhp
rhp udrhp prospectus draft red herring` as whole words) and keep the rows where the two differ.

**Result: no genuine rename exists on production.** All 19 active `DRHP` documents were compared. The
query returns two rows and neither is a rename:

| slug | `company_name` folded | DRHP title | title folded |
|---|---|---|---|
| `karamtara-engineering-ltd` | `karamtara engineering` | `Prospectus GID` | `gid` |
| `rentomojo-ltd` | `rentomojo` | `Prospectus GID` | `gid` |

Both are documents fetched from `listing.bseindia.com/…/PreAnchor/…RHP_2026090718….pdf` and stored
under type `DRHP` with the generic BSE title *"Prospectus GID"*. That is a document-typing and
titling defect, not a company changing its name. **Every one of the other 17 DRHP titles folds to the
same key as its IPO's `company_name`.**

**So the design's owed test has its answer, and it is the "if no such pair exists" branch: there is
no draft-vs-RHP rename on production today.** Recorded as finding **F-102** because §2.3.3.2 says the
finding must say so.

**Query 3b — the pair production actually holds.** Reached from the other side: rows sharing one CIN
under two different `company_name` values.

> IPOs sharing one CIN with another row that carries a DIFFERENT `company_name` — one company, two
> names, two rows; the row with the exchange documents first

**Exactly one group on all 330 production IPOs**, and it is this one:

| slug | `company_name` | symbol | status | `issue_size` | band | open | docs | subs rows | GMP rows |
|---|---|---|---|---:|---|---|---:|---:|---:|
| `rays-of-belief-ltd` | `Rays of Belief Limited- For Profit Social Enterprise` | `MOMSBELIEF` | LISTED | ₹74.99 cr | 227–239 | 2026-09-01 | 7 | 146 | 167 |
| `rays-of-belief-ltd-o` | `Rays of Belief Ltd.` | *(none)* | LISTED | **₹125.00 cr** | 227–239 | 2026-09-01 | 2 | 18 | 110 |

Same CIN `U85110DL2017PLC322623`. Same band. Same open, close and listing dates. **Two names, two
rows, two issue sizes 67% apart, and the company's own filings split across both**: the NSE bundle
(RHP, anchor report, ratios, bidding centres, forms, both security-parameter files) sits on the first
row; the SEBI `DRHP` and the SEBI `RHP` sit on the second. Both rows have their own
`listing_performance` row, and both have been accumulating live subscription and grey-market rows for
the whole window.

This is the same shape the rename rule exists to handle — one company, more than one name, filings
that do not all bind to the same place — reached through the identifier the design ranks first
instead of through the document title.

## The walk stops before field 1

A field-by-field walk needs a row to walk. This company has two, and the design's own rules disagree
about whether that is possible.

## THE STOP: §2.3.3.1 point 3 — "converging identifiers mean a merge, not an alert" has no trigger for a convergence that is already in the data

§2.3.3.1 states the rule in four parts. Parts 2 and 3 are the ones this row tests:

> 2. **Every time a stronger identifier arrives, check it against every other row.**
> 3. **Converging identifiers mean a merge, not an alert.** Two rows sharing one symbol, one CIN or
>    one ISIN are the same IPO by definition. The merge is automatic …

**Both of these rows already carry the CIN.** Neither is waiting for an identifier to arrive: both
are `LISTED`, the offering is over, and no stronger identifier will ever be assigned to the second row
— it has no symbol and no ISIN and never will. Part 3 says they are *"the same IPO by definition"*.
Part 2 is the only place a check is scheduled, and its trigger — *"every time a stronger identifier
arrives"* — **has already happened and did not fire**, because when the CIN was written the loop that
would have compared it did not exist.

**The question the design cannot answer:** what runs the convergence check over rows whose
identifiers are already present and already equal? There is no sweep. §2.3.3 places de-duplication
*"at discovery"* — *"Duplicate detection is a check that runs at discovery, on a deliberately
stricter key than the binding key"* — and discovery for both of these rows happened in August, before
either had a CIN, on names that the stricter key does not fold together either. Applying §2.3.3's own
published key by hand:

```
Rays of Belief Limited- For Profit Social Enterprise -> raysbeliefforprofitsocialenterprise
Rays of Belief Ltd.                                  -> raysbelief
```

They do not match. The `for profit social enterprise` tail is a SEBI category descriptor carried into
the exchange's company field, and no list of corporate-form words removes it.

**And that makes a sentence in §2.3.3 a false all-clear.** The design reports, of the same key:
*"After the merge, across all 329 production IPOs it produces 329 distinct keys: zero false
merges."* Distinct keys were read as evidence that no duplicate remains. This pair is a duplicate the
key cannot see — which is precisely the trap §2.3.3 itself names one paragraph earlier
(*"Zero collisions does not mean the matching is safe"*), recurring one level up, against the fix
rather than against the original normaliser.

**Rule and section named: §2.3.3.1 point 3, "converging identifiers mean a merge", and §2.3.3's
"at discovery" placement of the duplicate check. Recorded as finding F-103.**

## Continuing past the gap — everything below is PROVISIONAL on F-103

**The second rule with no answer, which only appears once you accept the merge should happen.**
§2.3.3.1 part 3 says the merge *"keeps the union of populated fields"*. A union is defined when one
row has a value and the other does not. Here **both rows have `issue_size` populated and they
disagree**: ₹74,99,36,590 against ₹1,25,00,00,000. The union rule gives no answer, §2.3.3.3's merge
log records both but does not choose, and the two candidate reconciliations point in opposite
directions (₹125 cr is the shape of a total issue; ₹74.99 cr is the shape of a fresh-issue or
post-anchor component). The same is true of `company_name` itself — the surviving name is a choice
the design never makes, and one of the two candidates does not even satisfy §1.2 row 2's own check,
*"legal-name form (ends Limited/Ltd)"*.

**Third, the field-order walk of the row that was chosen** (`rays-of-belief-ltd`, the one with the
exchange documents), for completeness, all of it provisional on which row survives:

| # | Field | Design | Result on this row |
|---:|---|---|---|
| 1 | `ipos.symbol` | §1.2 row 1 | `MOMSBELIEF`, passes |
| 2 | `ipos.company_name` | §1.2 row 2: *"legal-name form (ends Limited/Ltd)"*; *"Disagreement on the legal suffix is not a conflict; a different entity is"* | `Rays of Belief Limited- For Profit Social Enterprise` — **does not end in Limited/Ltd**, so it fails its own check; and the disagreement with the other row is neither a suffix difference nor a different entity, the only two cases the rule names |
| 3 | `ipos.issue_size` | §1.2 row 3 | ₹74.99 cr passes the range bound; the disagreement above is invisible to it because the check never compares rows |
| 4 | `ipos.lot_size` | §1.2 row 4 | 62 × 227 = ₹14,074, inside `₹10,000 ≤ lot × floor ≤ ₹15,000`, passes |
| 14–15 | price band | §1.2 rows 14–15 | 227 < 239, and 239 ≤ 272.4, passes |
| 17 | `ipos.listing_exchanges` | §1.2 row 17 | `["NSE"]` on a MAINBOARD row — legal, and the reason this row's rank 2/3 resolve to NSE first |
| 22 | `ipos.isin` | §1.2 row 22 | empty on a LISTED row, which §1.2 row 22 allows only pre-listing; after listing an empty ISIN is a gap, and it is the identifier that would have caught this duplicate for free |

Of the 240 fields, **182 are empty on production for this row**, and **2** have a rank-1 source backed
by a payload saved for this IPO. The other row's 240 are a second, separate set of gaps for the same
company.
