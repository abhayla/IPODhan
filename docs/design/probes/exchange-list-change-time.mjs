#!/usr/bin/env node
// docs/design/probes/exchange-list-change-time.mjs — the number behind OD-31's 09:45.
//
// WHY THIS EXISTS. The opening-day check (§2.1) has to run AFTER both exchanges have published the
// day's opening list and BEFORE the issue opens at 10:00. That is a fifteen-minute target, and
// nobody knows the real publication time — the 08:00 data job may precede it and the next job is at
// 14:00, so an IPO that opens at 10:00 could be invisible for four hours of its own bidding window.
// A time chosen by feel would be a guess dressed as a decision. This measures it.
//
// WHAT IT DOES. On a day when at least one IPO is due to open, it polls the two exchange list
// endpoints every five minutes from 08:30 to 10:00 IST and records, per exchange, the first poll at
// which the new row APPEARS (or its status changes to open). The check is then placed fifteen
// minutes after the later of the two medians.
//
// HONEST LIMIT, and it is the whole reason this file is committed unrun: one run of this probe
// takes a morning, on a day an IPO happens to open. This design round had neither. So:
//
//   * `--watch` runs the real poll loop and appends one observation to the output file.
//   * `--from-fixtures` derives what it can from payloads already saved under fixtures/nse and
//     fixtures/bse — which carry a fetch date but not a minute-resolution appearance time, so it
//     reports `insufficient` rather than a number, and says why.
//   * The design carries 09:45 as PROVISIONAL until three observations exist. That is written in
//     §2.1, not hidden here.
//
//   node docs/design/probes/exchange-list-change-time.mjs --watch          poll today, 08:30-10:00
//   node docs/design/probes/exchange-list-change-time.mjs --from-fixtures  what the saved payloads can say
//
// EXIT: 0 recorded (or honestly reported as insufficient) · 2 the probe itself failed.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, 'exchange-list-change-time.out.json');
const FIX = path.join(HERE, 'fixtures');

const NSE_LIST = 'https://www.nseindia.com/api/ipo-current-issue';
const BSE_LIST = 'https://api.bseindia.com/BseIndiaAPI/api/IPO_HomePageDetail/w';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

const nowIST = () => new Date(Date.now() + (5.5 * 60 - new Date().getTimezoneOffset()) * 60000)
  .toISOString().slice(11, 16);

async function poll(url) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), 20000);
  try {
    const r = await fetch(url, { headers: { 'user-agent': UA, accept: 'application/json' }, signal: c.signal });
    const body = await r.text();
    return { status: r.status, bytes: body.length, body };
  } catch (e) {
    return { status: 0, bytes: 0, body: '', error: String(e.message || e) };
  } finally {
    clearTimeout(t);
  }
}

function load() {
  if (!fs.existsSync(OUT)) {
    return {
      probe: 'exchange-list-change-time',
      question: 'At what IST time does each exchange first show an IPO that opens today, so the opening-day check (OD-31) can be placed 15 minutes after the later of the two?',
      method: 'poll both list endpoints every 5 minutes from 08:30 to 10:00 IST on a day an IPO is due to open; record the first poll at which the row appears',
      observations: [],
      verdict: null,
    };
  }
  return JSON.parse(fs.readFileSync(OUT, 'utf8'));
}

function verdict(out) {
  const done = out.observations.filter((o) => o.nse_first_seen && o.bse_first_seen);
  if (done.length < 3) {
    out.verdict = {
      state: 'insufficient',
      observations: done.length,
      needed: 3,
      design_uses: '09:45 IST, PROVISIONAL',
      why: `Three opening-day observations are needed before a time is a measurement rather than a guess; ${done.length} exist. The design states 09:45 and marks it provisional until this file says otherwise.`,
    };
    return;
  }
  const mins = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  const later = done.map((o) => Math.max(mins(o.nse_first_seen), mins(o.bse_first_seen))).sort((a, b) => a - b);
  const median = later[Math.floor(later.length / 2)] + 15;
  out.verdict = {
    state: 'measured',
    observations: done.length,
    place_check_at: `${String(Math.floor(median / 60)).padStart(2, '0')}:${String(median % 60).padStart(2, '0')} IST`,
    why: 'fifteen minutes after the median of the later of the two exchanges, across the recorded opening days',
  };
}

try {
  const out = load();

  if (process.argv.includes('--watch')) {
    const day = new Date().toISOString().slice(0, 10);
    const obs = { date: day, polls: [], nse_first_seen: null, bse_first_seen: null };
    let baselineNse = null, baselineBse = null;
    for (let i = 0; i < 19; i++) {                       // 08:30 -> 10:00 at 5-minute steps
      const t = nowIST();
      const [n, b] = await Promise.all([poll(NSE_LIST), poll(BSE_LIST)]);
      if (baselineNse === null) { baselineNse = n.bytes; baselineBse = b.bytes; }
      if (!obs.nse_first_seen && n.status === 200 && n.bytes !== baselineNse) obs.nse_first_seen = t;
      if (!obs.bse_first_seen && b.status === 200 && b.bytes !== baselineBse) obs.bse_first_seen = t;
      obs.polls.push({ t, nse: { status: n.status, bytes: n.bytes }, bse: { status: b.status, bytes: b.bytes } });
      console.log(`${t}  nse ${n.status}/${n.bytes}B  bse ${b.status}/${b.bytes}B`);
      if (obs.nse_first_seen && obs.bse_first_seen) break;
      await new Promise((r) => setTimeout(r, 5 * 60 * 1000));
    }
    out.observations.push(obs);
  } else {
    // --from-fixtures: say exactly what the saved payloads can and cannot answer.
    const have = ['nse/ipo-current-issue.json', 'bse/IPO_HomePageDetail.json']
      .filter((f) => fs.existsSync(path.join(FIX, f)));
    out.from_fixtures = {
      payloads_present: have,
      answer: 'insufficient',
      why: 'The saved payloads carry the DATE they were fetched, not the minute at which the exchange first published the row. Appearance time cannot be recovered from a single snapshot, and inventing one would be exactly the failure OD-25 exists to prevent.',
    };
  }

  verdict(out);
  out.generated_at = new Date().toISOString();
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n');
  console.log(`verdict: ${out.verdict.state}${out.verdict.place_check_at ? ' -> ' + out.verdict.place_check_at : ` (${out.verdict.observations}/${out.verdict.needed} observations)`}`);
  process.exit(0);
} catch (err) {
  console.error('exchange-list-change-time: the probe itself failed —', err.message);
  process.exit(2);
}
