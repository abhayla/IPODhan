#!/usr/bin/env node
// docs/design/probes/job-cost.mjs — OD-45's numerator.
//
// WHY THIS EXISTS. Owner, 2026-09-09: the running cost has to be measured, per job, against the box
// we actually have. Two cost surprises in one month (a GitHub Actions bill and a VPS disk fill)
// both came from a number nobody had ever computed.
//
// HOW IT COMPUTES, and what is measured versus derived — stated because the difference is the
// whole value of the number:
//
//   MEASURED — the byte size of every request this design makes is taken from the REAL payloads
//   saved under probes/fixtures/ (the exact responses the probes fetched from NSE, BSE,
//   Chittorgarh and InvestorGain on 2026-09-09), and the document sizes from
//   probes/document-store-size.out.json, which read `documents.file_size` on production.
//
//   DERIVED — the number of calls per day comes from the cadence in section 2.1 and the live-IPO
//   counts in the design (19 open/upcoming rows on production, 10 closed IPOs a night). Arithmetic
//   over measured inputs, never a guess at a total.
//
//   NOT MEASURED HERE — CPU seconds. A cycle's CPU is dominated by PDF extraction, which varies by
//   document; the design states the BUDGET (a 50-minute wake on 2 vCPU) rather than pretending to a
//   measurement this probe cannot take from the laptop. The place that number gets measured is a
//   staging cycle log, and the section says so.
//
//   node docs/design/probes/job-cost.mjs
//
// EXIT CODES: 0 computed · 2 an input fixture is missing.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(HERE, 'fixtures');
const OUT = path.join(HERE, 'job-cost.out.json');

const bytes = (p) => fs.statSync(path.join(FIX, p)).size;
const MB = (b) => +(b / 1024 / 1024).toFixed(2);
const GB = (b) => +(b / 1024 / 1024 / 1024).toFixed(2);

try {
  // --- measured request sizes, from the saved payloads themselves ---
  const size = {
    nse_list_current: bytes('nse/ipo-current-issue.json'),
    nse_list_upcoming: bytes('nse/all-upcoming-issues.json'),
    nse_detail: bytes('nse/ipo-detail-ARCIL.json'),
    nse_active_category: bytes('nse/ipo-active-category-ARCIL.json'),
    bse_list: bytes('bse/IPO_HomePageDetail.json'),
    bse_detail: bytes('bse/GetMkt_ISSUE_BBS_IPO-7950.json'),
    chittorgarh_detail: bytes('chittorgarh/vinod-texworld-ltd.html'),
    investorgain_gmp: bytes('investorgain/gmp-live.json'),
  };

  const store = JSON.parse(fs.readFileSync(path.join(HERE, 'document-store-size.out.json'), 'utf8'));
  const meanDocBytes = Math.round(store.measured.mean_mb_per_known_document * 1024 * 1024);

  // --- the cadence of section 2.1, and the population it runs over ---
  const LIVE_IPOS = 19;              // OPEN + UPCOMING on production, 2026-09-09 (design 2.3.3.1)
  const CLOSED_PER_NIGHT = 10;       // OD-19 cap
  const NEW_DOCS_PER_DAY = 3;        // 2-3 mainboard IPOs a week, ~10 filings each -> ~3/day (design 2.1)
  const BIDDING_WAKES = 18;          // every 30 min, 10:00-18:30
  const GMP_WAKES = 48;              // every 30 min, all day (OD-28)
  const PRICE_WAKES = 25;            // every 15 min inside exchange hours 09:15-15:30
  const LISTED_IN_WINDOW = 12;       // IPOs inside the 90-day post-listing window, typical

  const jobs = [];

  // Data job: 3 a day. Two exchange lists, then per live IPO a detail read on each exchange,
  // then the documents that are actually new.
  const dataCalls = 3 * (2 + LIVE_IPOS * 2);
  const dataBytes = 3 * (size.nse_list_current + size.bse_list + LIVE_IPOS * (size.nse_detail + size.bse_detail))
                  + NEW_DOCS_PER_DAY * meanDocBytes;
  jobs.push({ job: 'data job (00:00, 08:00, 14:00)', calls_per_day: dataCalls + NEW_DOCS_PER_DAY, bytes_per_day: dataBytes });

  // Opening-day check: two list reads, on days an IPO opens. Costed as if every day, which
  // overstates it — an overstated budget is the safe direction.
  jobs.push({ job: 'opening-day check (~09:45)', calls_per_day: 2, bytes_per_day: size.nse_list_upcoming + size.bse_list });

  // Live figures: subscription + demand graph, per live IPO, inside bidding hours.
  jobs.push({
    job: 'live figures (every 30 min, 10:00-18:30)',
    calls_per_day: BIDDING_WAKES * LIVE_IPOS,
    bytes_per_day: BIDDING_WAKES * LIVE_IPOS * size.nse_active_category,
  });

  // GMP: one page for every IPO at once, all day.
  jobs.push({ job: 'grey-market premium (every 30 min, all day)', calls_per_day: GMP_WAKES, bytes_per_day: GMP_WAKES * size.investorgain_gmp });

  // Post-listing price: one quote per IPO in the 90-day window, market hours only.
  jobs.push({
    job: 'post-listing price (every 15 min, market hours, 90 days)',
    calls_per_day: PRICE_WAKES * LISTED_IN_WINDOW,
    bytes_per_day: PRICE_WAKES * LISTED_IN_WINDOW * size.nse_active_category,
  });

  // Closed-IPO job: ten a night, each a Chittorgarh page plus whatever documents are re-sourced.
  jobs.push({
    job: 'closed-IPO job (22:00, 10 a night)',
    calls_per_day: CLOSED_PER_NIGHT * 2,
    bytes_per_day: CLOSED_PER_NIGHT * (size.chittorgarh_detail + meanDocBytes * 0.3),
  });

  const totalCalls = jobs.reduce((a, j) => a + j.calls_per_day, 0);
  const totalBytes = jobs.reduce((a, j) => a + j.bytes_per_day, 0);

  const plan = fs.existsSync(path.join(HERE, 'plan-limits.out.json'))
    ? JSON.parse(fs.readFileSync(path.join(HERE, 'plan-limits.out.json'), 'utf8'))
    : null;

  const out = {
    probe: 'job-cost',
    generated_at: new Date().toISOString(),
    measured_inputs: {
      payload_bytes: size,
      mean_document_bytes: meanDocBytes,
      mean_document_source: 'probes/document-store-size.out.json — production documents.file_size',
    },
    derived_inputs: {
      live_ipos: LIVE_IPOS,
      closed_per_night: CLOSED_PER_NIGHT,
      new_documents_per_day: NEW_DOCS_PER_DAY,
      bidding_wakes: BIDDING_WAKES,
      gmp_wakes: GMP_WAKES,
      price_wakes: PRICE_WAKES,
      listed_in_price_window: LISTED_IN_WINDOW,
    },
    jobs: jobs.map((j) => ({ ...j, mb_per_day: MB(j.bytes_per_day), gb_per_month: GB(j.bytes_per_day * 30) })),
    totals: {
      calls_per_day: totalCalls,
      mb_per_day: MB(totalBytes),
      gb_per_month: GB(totalBytes * 30),
    },
    against_plan: plan && {
      plan_bandwidth_gb_per_month: plan.limits.bandwidth_gb_per_month,
      scraper_budget_gb_per_month: plan.scraper_bandwidth_budget_gb_per_month,
      percent_of_plan: +((totalBytes * 30) / (plan.limits.bandwidth_mb_per_month * 1024 * 1024) * 100).toFixed(3),
    },
    paid_api_calls_per_day: 0,
  };

  fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n');
  for (const j of out.jobs) console.log(`${String(j.calls_per_day).padStart(6)} calls/day  ${String(j.mb_per_day).padStart(8)} MB/day  ${j.job}`);
  console.log(`\nTOTAL ${out.totals.calls_per_day} calls/day, ${out.totals.mb_per_day} MB/day, ${out.totals.gb_per_month} GB/month`);
  if (out.against_plan) console.log(`= ${out.against_plan.percent_of_plan}% of the plan's ${out.against_plan.plan_bandwidth_gb_per_month} GB/month`);
  process.exit(0);
} catch (err) {
  console.error('job-cost: the probe itself failed —', err.message);
  process.exit(2);
}
