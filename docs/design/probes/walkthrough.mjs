#!/usr/bin/env node
// docs/design/probes/walkthrough.mjs — walk one real IPO through the whole design, field by field.
//
// WHY. A design can be internally consistent and still be wrong about the world. The only way to
// find that out short of building it is to take a real IPO that is open right now and ask, for every
// field the site publishes: which source would the plan choose, what does that source actually say
// today, would the value pass its check, what would be written, and do the verification sources
// agree. Doing that by hand for 240 fields, twice, would be 480 typed rows — and typed rows are
// exactly where invented values come from. So it is generated: every value in the output is read
// from a saved fixture or from the live row on production, and the row says which.
//
//   node docs/design/probes/walkthrough.mjs <slug> > docs/design/walkthroughs/<slug>-<date>.md
//
// Read-only. No network (the fixtures were already fetched), one read-only database connection.

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { openReadOnlyPool, HERE } from './_lib.mjs';

const slug = process.argv[2];
if (!slug) { console.error('usage: walkthrough.mjs <slug>'); process.exit(2); }

const SPEC = path.resolve(HERE, '../field-source-resolution.spec.mjs');
const { F, RESOLVE } = await import(pathToFileURL(SPEC).href);
const EV = JSON.parse(fs.readFileSync(path.resolve(HERE, '../evidence.json'), 'utf8')).fields;
const MAP = JSON.parse(fs.readFileSync(path.join(HERE, 'evidence-map.out.json'), 'utf8'));
const pairIndex = {};
for (const p of MAP.pairs) pairIndex[`${p.field}|${p.source}`] = p;

const pool = await openReadOnlyPool('ipodhan');
let ipo, docs, stored = {};
try {
  ipo = (await pool.query('select * from ipos where slug = $1', [slug])).rows[0];
  if (!ipo) { console.error(`no IPO with slug ${slug} on production`); process.exit(2); }
  docs = (await pool.query(
    `select type::text as type, extraction_status::text as extraction_status, url, sha256, filing_date
       from documents where ipo_id = $1 and is_active order by type`, [ipo.id])).rows;
  // Every child table the design publishes, as it stands today for this IPO.
  for (const [tbl, col] of [['ipo_details', 'ipo_id'], ['ipo_valuation', 'ipo_id'],
                            ['financial_data', 'ipo_id'], ['financial_statements', 'ipo_id'],
                            ['peer_companies', 'ipo_id'], ['promoters', 'ipo_id'],
                            ['anchor_investors', 'ipo_id'], ['ipo_intermediaries', 'ipo_id'],
                            ['ipo_risk_factors', 'ipo_id'], ['listing_performance', 'ipo_id'],
                            ['subscriptions', 'ipo_id'], ['gmp_records', 'ipo_id']]) {
    try {
      const r = await pool.query(`select * from ${tbl} where ${col} = $1 limit 1`, [ipo.id]);
      stored[tbl] = r.rows[0] || null;
    } catch { stored[tbl] = null; }
  }
} finally { await pool.end(); }

stored.ipos = ipo;

const type = ipo.segment === 'SME'
  ? ((ipo.listing_exchanges || []).includes('NSE') ? 'SME_NSE' : 'SME_BSE')
  : 'MAINBOARD';

// ---------------------------------------------------------------------------
// Plausibility rules — the ones §4 and the domain skill actually state. A walkthrough that reports
// a value without asking whether it is sane is a transcription, not a check.
// ---------------------------------------------------------------------------
const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));
const RULES = {
  'ipos.lot_size': (v) => { const n = num(v); return n === null ? null : (n >= 1 && n <= 20000 ? 'pass' : `FAIL: a lot of ${n} shares is outside 1..20,000`); },
  'ipos.face_value': (v) => { const n = num(v); return n === null ? null : ([1, 2, 5, 10].includes(n) ? 'pass' : `FAIL for an equity issue: face value ${n} is not one of 1/2/5/10 (correct for an NCD — see F-10, rules must be effective-dated and type-scoped)`); },
  'ipos.price_range_min': (v, r) => { const a = num(v), b = num(r.ipos?.price_range_max); return a === null ? null : (b !== null && a > b ? `FAIL: floor ${a} above cap ${b}` : 'pass'); },
  'ipos.price_range_max': (v, r) => { const a = num(r.ipos?.price_range_min), b = num(v); return b === null ? null : (a !== null && a > b ? `FAIL: cap ${b} below floor ${a}` : 'pass'); },
  'ipos.issue_size': (v) => {
    const n = num(v); if (n === null) return null;
    const cr = n / 1e7;
    return cr >= 1 && cr <= 30000 ? `pass — Rs ${cr.toFixed(2)} crore` :
      `FAIL: Rs ${cr.toFixed(2)} crore is outside 1..30,000 crore`;
  },
  // F-98. The most-read number on the page, reconciled against the exchange payloads rather than
  // merely range-checked. BSE's share count excludes the anchor portion, so "shares x price" from BSE
  // alone understates the issue by about a third; the identity that holds is total shares x CAP price.
  'ipos.issue_size_reconciliation': null,
  'ipos.open_date': (v, r) => { const a = v && new Date(v), b = r.ipos?.close_date && new Date(r.ipos.close_date); return !a ? null : (b && a > b ? 'FAIL: opens after it closes' : 'pass'); },
  'ipos.close_date': (v, r) => { const a = r.ipos?.open_date && new Date(r.ipos.open_date), b = v && new Date(v); return !b ? null : (a && a > b ? 'FAIL: closes before it opens' : 'pass'); },
  'ipos.listing_date': (v, r) => { const c = r.ipos?.close_date && new Date(r.ipos.close_date), l = v && new Date(v); return !l ? null : (c && l < c ? 'FAIL: lists before it closes' : 'pass'); },
};

const val = (t, c) => {
  const row = stored[t];
  if (!row) return { present: false, value: null };
  const key = c.replace(/_([a-z0-9])/g, (_, x) => x.toUpperCase());
  const v = row[c] !== undefined ? row[c] : row[key];
  return { present: v !== undefined && v !== null && v !== '', value: v };
};

const fmt = (v) => {
  if (v === null || v === undefined) return '_(empty)_';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = Array.isArray(v) ? JSON.stringify(v) : String(v);
  return '`' + (s.length > 60 ? s.slice(0, 57) + '...' : s).replace(/\|/g, '\\|') + '`';
};

// ---------------------------------------------------------------------------
const rows = [];
let counts = { applicable: 0, na: 0, rank1Evidenced: 0, storedEmpty: 0, ruleFail: 0, unknown: 0, otherIpo: 0 };

// A fixture belongs to this IPO when its path names this IPO. Extraction and Chittorgarh fixtures are
// named by slug; NSE payloads by symbol; the BSE detail payload by its IPO number. The shared list
// payloads - the current-issue board, the upcoming list, the BSE board, the grey-market report -
// legitimately cover every IPO at once and are allowed.
const SHARED = /ipo-current-issue|all-upcoming-issues|IPO_HomePageDetail|gmp-live/;
const ownFixture = (fx) => SHARED.test(fx)
  || fx.includes(ipo.slug)
  || (!!ipo.symbol && fx.toUpperCase().includes(String(ipo.symbol).toUpperCase()));

for (const f of F) {
  const col = `${f.t}.${f.c}`;
  const res = RESOLVE(f, type);
  if (res[0] === 'N/A') { counts.na++; continue; }
  counts.applicable++;
  const r1 = res[0];
  const ev = (EV[col] || {})[r1];
  const pair = pairIndex[`${col}|${r1}`];
  if (ev && pair && pair.fixture && ownFixture(pair.fixture)) counts.rank1Evidenced++;

  const cur = val(f.t, f.c);
  if (!cur.present) counts.storedEmpty++;

  let ruleResult = RULES[col] ? RULES[col](cur.value, stored) : null;
  if (ruleResult && ruleResult.startsWith('FAIL')) counts.ruleFail++;

  // The evidence map is keyed by (field, source) across EVERY IPO probed. A walkthrough must never
  // quote another company's payload. The first version of this file reported Vinod Texworld's rank-1
  // lot size as 107 and its band as 132 to 139 — those are Asset Reconstruction's numbers, out of
  // Asset Reconstruction's price band advertisement, and Vinod's own fixture returns null for all
  // three. That is §2.3.4's own warning, "a correct page still contains other companies' numbers",
  // reproduced inside the design's own evidence, and it graded an elevenfold disagreement as a pass.
  const mine = pair && pair.fixture ? ownFixture(pair.fixture) : false;
  const sourceSays = pair && pair.verdict === 'CARRIES'
    ? (mine
        ? `${pair.label}${pair.sample ? ' = ' + String(pair.sample).replace(/\|/g, '\\|').slice(0, 44) : ''}`
        : `_(the source carries this field, but the only saved payload proving it belongs to a DIFFERENT IPO — nothing quoted)_`)
    : (pair && pair.verdict === 'UNPROBED' ? `_(not probed: ${pair.why})_` : '_(searched, no matching label)_');
  if (!pair || pair.verdict !== 'CARRIES' || !mine) counts.unknown++;
  if (pair && pair.verdict === 'CARRIES' && !mine) counts.otherIpo++;

  const evShown = ev && mine ? '`' + String(ev.ref || ev).replace('fixtures/', '') + '`' : '—';
  rows.push(`| \`${col}\` | ${f.cls} | ${r1} | ${res[1]} · ${res[2]} | ${sourceSays} | ${fmt(cur.value)} | ${ruleResult || '_(no rule stated)_'} | ${evShown} |`);
}

const today = new Date().toISOString().slice(0, 10);
const out = [];
out.push(`# Walkthrough: ${ipo.company_name} (${ipo.symbol || 'no symbol'}) — ${today}`);
out.push('');
out.push('**Generated** by `docs/design/probes/walkthrough.mjs`. Every value in the "stored today" column is');
out.push('read from production through the read-only tunnel; every value in the "what the rank-1 source says"');
out.push('column is read from a payload saved under `docs/design/probes/fixtures/`. Nothing here is typed.');
out.push('');
out.push('| | |');
out.push('|---|---|');
out.push(`| slug | \`${ipo.slug}\` |`);
out.push(`| status / segment | ${ipo.status} / ${ipo.segment} |`);
out.push(`| resolved type for Appendix A | **${type}** |`);
out.push(`| listing exchanges | ${JSON.stringify(ipo.listing_exchanges)} |`);
out.push(`| open / close / listing | ${ipo.open_date ? new Date(ipo.open_date).toISOString().slice(0, 10) : 'not set'} / ${ipo.close_date ? new Date(ipo.close_date).toISOString().slice(0, 10) : 'not set'} / ${ipo.listing_date ? new Date(ipo.listing_date).toISOString().slice(0, 10) : 'not set'} |`);
out.push(`| documents on file | ${docs.map((d) => `${d.type} (${d.extraction_status})`).join(', ') || 'none'} |`);
out.push('');
out.push('## What this walk found, before the table');
out.push('');
out.push(`- **${counts.applicable} of ${F.length} fields apply** to a ${type} issue; ${counts.na} are N/A for this offering type.`);
out.push(`- **${counts.rank1Evidenced} of those have a rank-1 source backed by a payload saved for THIS IPO.** A further ${counts.otherIpo} rank-1 sources are known to carry the field, but only from another IPO's payload; those rows say so instead of borrowing the number. The rest are the honest gap: see §A.0's fifth verification round for what "no matching label" does and does not mean.`);
out.push(`- **${counts.storedEmpty} applicable fields are empty on production right now.** That is the number the pull model exists to move.`);
out.push(`- **${counts.ruleFail} stored values fail a stated plausibility rule.**`);
out.push('');

// The failures, named. A count is not a reading (signal-ownership R1).
const fails = rows.filter((r) => r.includes('| FAIL'));
if (fails.length) {
  out.push('### The values that fail a rule, named');
  out.push('');
  out.push('| Field | Cls | R1 | R2 · R3 | What the rank-1 source says | Stored today | Rule | Evidence |');
  out.push('|---|---|---|---|---|---|---|---|');
  out.push(...fails);
  out.push('');
}

out.push('## The job timeline for this IPO under the three-job cadence (§2.1)');
out.push('');
out.push('| When | Job | What it does for this IPO |');
out.push('|---|---|---|');
// A Date stringifies to "Wed Sep 09 2026 ..." and slicing ten characters off that gives "Wed Sep 09",
// which is not a date anybody can act on. ISO, always.
const iso = (d) => (d ? new Date(d).toISOString().slice(0, 10) : 'not set');
const open = iso(ipo.open_date), close = iso(ipo.close_date), list = iso(ipo.listing_date);
out.push(`| before ${open}, at 00:00 / 08:00 / 14:00 | Data job | discovers the IPO, downloads each document as it is filed, extracts it once on arrival, and walks the field plan. It never re-opens a document because time passed. |`);
out.push(`| ${open} to ${close}, every 30 min 10:00–18:30 | Live-figures job | subscription, demand graph and grey-market premium only. It touches no document, no plan row and no static field. |`);
out.push(`| ${open} to ${close}, at 00:00 / 08:00 / 14:00 | Data job | re-walks only fields whose plan row is still PENDING or due for verification; a newly filed corrigendum or price band advertisement is a new reason to read, and is read on the next data job rather than within the hour. |`);
out.push(`| ${close} to ${list} | Data job | the timetable family (E-1) is re-read from NSE then BSE, because a printed advertisement is never reissued when a window moves. |`);
out.push(`| after ${list} | Data job | listing performance; the documents stay on disk for the life of this row (OD-23), so this IPO never joins the closed backlog document-less. |`);
out.push(`| from the first night after ${close}, 22:00 | Closed-IPO job | eligible once \`close_date\` is in the past. Ten IPOs a night, newest close date first, this one marked done in \`closed_ipo_resourcing\` so it is never picked twice. |`);
out.push('');

out.push('## Every applicable field');
out.push('');
out.push('`R1` is the source the plan would ask first for a ' + type + ' issue. "What the rank-1 source says"');
out.push('is the label found in the saved payload and the value beside it — an empty cell means the payload was');
out.push('searched and no label matched, which is a rank to re-examine, not proof the source lacks the field.');
out.push('');
out.push('| Field | Cls | R1 | R2 · R3 | What the rank-1 source says | Stored today | Rule | Evidence |');
out.push('|---|---|---|---|---|---|---|---|');
out.push(...rows);
out.push('');
out.push('---');
out.push('');
out.push(`_Regenerate: \`node docs/design/probes/walkthrough.mjs ${slug}\`._`);

console.log(out.join('\n'));
