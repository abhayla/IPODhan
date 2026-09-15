#!/usr/bin/env node
// docs/design/probes/bse-scrip-groups.mjs — can we read BSE's listed scrips WITH their GROUP,
// mechanically, without a browser?
//
// WHY THIS PROBE EXISTS. `scraper/src/scrapers/exchange-segment-oracle.ts` (merged in #646) can
// resolve an IPO's board from either exchange's listed-security master. The NSE half works and is
// wired (#650). The BSE half is fed an EMPTY list, because no BSE scrip-list fetcher exists in this
// repo — so every BSE-only company resolves to `no-source` and is refused.
//
// That is the whole blocker. Measured on staging 2026-09-16: all 29 unprovenanced IPO rows are
// BSE-listed (26 BSE-only, 3 NSE+BSE), and only the 4 carrying an ISIN resolve via NSE. The other
// 25 need BSE's GROUP column. Item 14 stays blocked until they can be sourced.
//
// WHAT WOULD MAKE THE FETCHER BUILDABLE. The oracle's BSE_GROUP_SME / BSE_GROUP_MAINBOARD sets were
// derived by tallying 187 already-provenanced production rows — that is how the MEANING of a group
// was evidenced. This probe does not re-derive that. It answers the prior question: can we obtain,
// for an arbitrary listed company, the group BSE currently assigns it — as data, not as a rendered
// page? The oracle's own header records that BSE's group-DEFINITION page is JS-rendered and returns
// a ~112-byte shell to a plain fetch, so the definitions cannot be cited mechanically. Whether the
// scrip LIST behaves the same way is exactly what is unknown, and guessing it would be the "format
// typed from memory" failure the defect-fix contract forbids in a parser brief.
//
// A NEGATIVE RESULT IS A RESULT. If none of these endpoints returns group data, this probe's output
// is the measurement behind an owner decision, not a failure to be retried differently.
//
// THE COMMITTED FIXTURE IS A TRIM, AND SAYS SO. The live feed is 5155 rows / 1.8 MB, too large to
// carry in the repo for no gain. `fixtures/bse/ListofScripData.sample.json` is 53 REAL rows taken
// from that response unmodified: every company the 25 unsourced staging rows depend on, plus up to
// three rows per group so all 15 groups the live feed actually returns are represented. Re-run this
// probe to regenerate the full payload; nothing here is hand-written.
//
// Read-only. Laptop-only. No database. No writes of any kind.

import { fetchWithRetry, saveFixture, saveOutput, nowStamp, causeOf, BROWSER_HEADERS } from './_lib.mjs';

const REFERER = 'https://www.bseindia.com/';

// Every candidate route to the same fact, so a single dead endpoint is not mistaken for
// "BSE does not publish this". Each is recorded with what it actually returned.
const CANDIDATES = [
  {
    label: 'ListOfScrips CSV (the public "List of Securities" download)',
    url: 'https://www.bseindia.com/downloads/ipo/ListOfScrips.csv',
    fixture: 'bse/ListOfScrips.csv',
    kind: 'csv',
  },
  {
    label: 'ListOfScripData API (segment=Equity, status=Active)',
    url: 'https://api.bseindia.com/BseIndiaAPI/api/ListofScripData/w?Group=&Scripcode=&industry=&segment=Equity&status=Active',
    fixture: 'bse/ListofScripData.json',
    sample: 'bse/ListofScripData.sample.json',
    kind: 'json',
  },
  {
    label: 'SME scrips (ListofScripData, segment=MainBoard vs SME is a Group filter)',
    url: 'https://api.bseindia.com/BseIndiaAPI/api/ListofScripData/w?Group=M&Scripcode=&industry=&segment=Equity&status=Active',
    // No fixture: this endpoint only confirms the Group filter works. Its rows are a subset of
    // the full feed, which the sample above already represents; saving 139 KB again proves nothing.
    fixture: null,
    kind: 'json',
  },
];

/** Does this payload actually carry a per-scrip GROUP? That is the only thing that matters. */
function inspect(kind, body) {
  const out = { records: null, keys: [], groupKey: null, groupSamples: [], distinctGroups: null };
  if (!body) return out;
  if (kind === 'json') {
    let parsed;
    try { parsed = JSON.parse(body); } catch { return { ...out, parseError: 'not JSON' }; }
    const rows = Array.isArray(parsed) ? parsed : parsed.Table || parsed.data || [parsed];
    if (!Array.isArray(rows) || rows.length === 0) return out;
    out.records = rows.length;
    out.keys = typeof rows[0] === 'object' && rows[0] ? Object.keys(rows[0]) : [];
    // Find the group column by name rather than by position, and say which one we used.
    out.groupKey = out.keys.find((k) => /^(group|group_name|scrip_group|GROUP)$/i.test(k))
      ?? out.keys.find((k) => /group/i.test(k))
      ?? null;
    if (out.groupKey) {
      const vals = rows.map((r) => String(r[out.groupKey] ?? '').trim()).filter(Boolean);
      out.distinctGroups = [...new Set(vals)].sort();
      out.groupSamples = rows.slice(0, 5).map((r) => ({
        name: r.Scrip_Name ?? r.SCRIP_NAME ?? r.scrip_name ?? r.Issuer_Name ?? null,
        isin: r.ISIN_NUMBER ?? r.ISIN ?? r.isin ?? null,
        group: r[out.groupKey] ?? null,
      }));
    }
    return out;
  }
  // csv
  const lines = body.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length === 0) return out;
  const header = lines[0].split(',').map((h) => h.trim());
  out.records = lines.length - 1;
  out.keys = header;
  const gi = header.findIndex((h) => /group/i.test(h));
  if (gi >= 0) {
    out.groupKey = header[gi];
    const vals = lines.slice(1).map((l) => (l.split(',')[gi] ?? '').trim()).filter(Boolean);
    out.distinctGroups = [...new Set(vals)].sort();
    out.groupSamples = lines.slice(1, 6).map((l) => {
      const c = l.split(',');
      return { raw: c.slice(0, 4).map((x) => x.trim()), group: (c[gi] ?? '').trim() };
    });
  }
  return out;
}

/** Companies the 25 unsourced staging rows depend on — kept in full, whatever their group. */
const MUST_KEEP = [
  'NET PIX SHORTS DIGITAL MEDIA LTD', 'SURYO FOODS  INDUSTRIES LTD', 'MARUTI INTERIOR PRODUCTS LTD',
  'SHIPWAVES ONLINE LIMITED', 'STANBIK AGRO LIMITED', 'WESTERN OVERSEAS STUDY ABROAD LIMITED',
  'TRAVELS  RENTALS LTD', 'H R Hygiene Products',
];
const normName = (v) => (v ?? '').toUpperCase().replace(/&/g, ' ').replace(/\([^)]*\)/g, ' ')
  .replace(/\b(LIMITED|LTD|PVT|PRIVATE|THE|CO|COMPANY|CORP|CORPORATION|AND|INDIA)\b/g, ' ')
  .replace(/[^A-Z0-9]/g, '');

function sampleOf(body) {
  const parsed = JSON.parse(body);
  const rows = Array.isArray(parsed) ? parsed : parsed.Table || parsed.data || [];
  const want = MUST_KEEP.map(normName);
  const keep = [], seen = new Set(), perGroup = {};
  for (const r of rows) {
    if (want.includes(normName(r.Scrip_Name)) && !seen.has(r.SCRIP_CD)) { keep.push(r); seen.add(r.SCRIP_CD); }
  }
  for (const r of rows) {
    const g = (r.GROUP ?? '').trim().toUpperCase();
    perGroup[g] = perGroup[g] ?? 0;
    if (perGroup[g] < 3 && !seen.has(r.SCRIP_CD)) { keep.push(r); seen.add(r.SCRIP_CD); perGroup[g] += 1; }
  }
  return keep;
}

const attempts = [];
for (const c of CANDIDATES) {
  const rec = { what: c.label, url: c.url, at: nowStamp() };
  try {
    const r = await fetchWithRetry(c.url, {
      headers: { ...BROWSER_HEADERS, Referer: REFERER },
      spacingMs: 15_000,
    });
    rec.status = r.status;
    rec.ok = r.ok;
    rec.bytes = r.size;
    rec.attempts = r.attempts;
    rec.error = r.error ?? null;
    if (r.ok && r.body) {
      Object.assign(rec, inspect(c.kind, r.body));
      // Save a TRIM of the real payload, never a hand-written one. The full equity feed is ~1.8 MB;
      // committing it buys nothing a representative sample does not. `sampleOf` takes real rows
      // unmodified: every company the unsourced staging rows depend on, plus up to three per group
      // so every group the live feed returns is represented.
      rec.fixture = c.sample
        ? saveFixture(c.sample, JSON.stringify(sampleOf(r.body), null, 2))
        : c.fixture
          ? saveFixture(c.fixture, r.body)
          : null;
      rec.fixtureIsTrim = Boolean(c.sample);
      // A ~100-byte body is the JS-shell signature the oracle header describes. Name it
      // explicitly so a tiny 200 is never read as a working endpoint.
      rec.looksLikeJsShell = r.size > 0 && r.size < 500;
    }
  } catch (err) {
    rec.ok = false;
    rec.error = causeOf(err);
  }
  rec.carriesGroup = Boolean(rec.groupKey && rec.distinctGroups && rec.distinctGroups.length > 0);
  attempts.push(rec);
}

const usable = attempts.filter((a) => a.ok && a.carriesGroup && !a.looksLikeJsShell);
const verdict = {
  question: 'Is BSE\'s listed-scrip list, WITH a per-scrip GROUP, reachable mechanically (no browser)?',
  answer: usable.length > 0 ? 'YES' : 'NO',
  usableEndpoints: usable.map((a) => ({ url: a.url, records: a.records, groupKey: a.groupKey, distinctGroups: a.distinctGroups })),
  // The oracle only has evidenced meanings for M/MT (SME) and A/B/T/XT/Z (mainboard). Any other
  // group present in a usable feed is a row the oracle will refuse until its meaning is evidenced.
  groupsWithNoEvidencedMeaning: usable.length
    ? (usable[0].distinctGroups ?? []).filter((g) => !['M', 'MT', 'A', 'B', 'T', 'XT', 'Z'].includes(g.toUpperCase()))
    : null,
  note: usable.length === 0
    ? 'No endpoint returned a per-scrip group. The BSE half of the oracle cannot be fed from this repo without a browser; that is an owner decision, not a retry.'
    : 'A fetcher is buildable against the usable endpoint(s) above. The fixture saved next to this output is the real payload a parser brief must be written against.',
};

saveOutput('bse-scrip-groups', { probedAt: nowStamp(), verdict, attempts });
console.log(JSON.stringify({ verdict, attempts: attempts.map((a) => ({ what: a.what, status: a.status, ok: a.ok, bytes: a.bytes, records: a.records, groupKey: a.groupKey, carriesGroup: a.carriesGroup, looksLikeJsShell: a.looksLikeJsShell, error: a.error })) }, null, 2));
