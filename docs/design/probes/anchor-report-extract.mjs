#!/usr/bin/env node
// docs/design/probes/anchor-report-extract.mjs — run the REAL anchor-allocation extractor on a
// REAL exchange letter.
//
// WHY. `anchor_investors` has no probe of its own — the extractor exists (`anchor-report-parser.ts`,
// W-39) but nothing in this design round had run it against a real letter. This downloads the
// ANCHOR_ALLOCATION_REPORT `documents.url` production already stores for a walkthrough IPO (a
// public NSE-archives ZIP, no VPS access needed), unzips it, and calls the REAL
// `extractPageTexts` + `parseAnchorReport` (via a thin `tsx` bridge, `_anchor-run.mts`, since the
// extractor is TypeScript and this harness is plain `.mjs`) — never a re-implementation.
//
// Read-only against the database (one query, to find the document URL production already
// resolved). The PDF itself is written to fixtures/pdf/ (gitignored — an evidence INPUT, not
// repository content); the extraction result is what gets committed.
//
//   node docs/design/probes/anchor-report-extract.mjs

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { openReadOnlyPool, fetchWithRetry, saveOutput, nowStamp, HERE } from './_lib.mjs';

const PDF_DIR = path.join(HERE, 'fixtures', 'pdf');
const REPO = path.resolve(HERE, '../../..');
// A linked worktree has no node_modules of its own (git worktrees never carry it) — `tsx` is
// resolved from whichever checkout on this machine already has it, same rule as `_lib.mjs`'s `req`.
const TSX_BIN_NAME = process.platform === 'win32' ? 'tsx.cmd' : 'tsx';
const TSX = [REPO, 'D:/Abhay/Ventures/IPODhan'].map((r) => path.join(r, 'node_modules', '.bin', TSX_BIN_NAME))
  .find((p) => fs.existsSync(p));
const RUNNER = path.join(HERE, '_anchor-run.mts');
fs.mkdirSync(PDF_DIR, { recursive: true });
if (!TSX) throw new Error('could not resolve tsx from any known node_modules root');

const pool = await openReadOnlyPool();
let docs;
try {
  // 29 IPOs on production carry an ANCHOR_ALLOCATION_REPORT; the walkthrough only needs one real
  // run to prove the extractor against a real letter, so this defaults to the walkthrough IPO
  // (asset-reconstruction-company-india-ltd, which has a bid) with an explicit override.
  const WALK = process.argv.slice(2).filter((a) => !a.startsWith('-'));
  docs = (await pool.query(
    `select i.slug, d.id, d.url, d.type::text as type from documents d join ipos i on i.id = d.ipo_id
     where d.type = 'ANCHOR_ALLOCATION_REPORT'
       and i.slug = any($1::text[])
     order by i.slug`,
    [WALK.length ? WALK : ['asset-reconstruction-company-india-ltd']]
  )).rows;
} finally {
  await pool.end();
}

const runs = [];
for (const d of docs) {
  const rec = { slug: d.slug, url: d.url };
  const zipPath = path.join(PDF_DIR, `${d.slug}-anchor.zip`);
  const dl = await fetchWithRetry(d.url, { binary: true, spacingMs: 20_000, timeoutMs: 120_000 });
  rec.download = { status: dl.status, ok: dl.ok, bytes: dl.size, error: dl.error };
  if (!dl.ok || !dl.body || dl.body.length < 500) {
    rec.result = `DOWNLOAD FAILED — ${dl.status}${dl.error ? ' ' + dl.error : ''}. Recorded as unreachable, not guessed.`;
    runs.push(rec); continue;
  }
  fs.writeFileSync(zipPath, dl.body);

  // Unzip. Windows-native (Expand-Archive) — no package added, per OD-25.
  const extractDir = path.join(PDF_DIR, `${d.slug}-anchor-extracted`);
  fs.rmSync(extractDir, { recursive: true, force: true });
  const unzip = spawnSync('powershell', ['-NoProfile', '-Command',
    `Expand-Archive -Path '${zipPath}' -DestinationPath '${extractDir}' -Force`], { encoding: 'utf8' });
  if (unzip.status !== 0) {
    rec.result = `UNZIP FAILED — ${unzip.stderr || unzip.error}`;
    runs.push(rec); continue;
  }
  const pdfName = fs.readdirSync(extractDir, { recursive: true }).find((f) => String(f).toLowerCase().endsWith('.pdf'));
  if (!pdfName) {
    rec.result = 'UNZIP OK but no .pdf inside the archive — recorded honestly, not guessed.';
    runs.push(rec); continue;
  }
  const pdfPath = path.join(extractDir, pdfName);
  rec.pdf = { name: pdfName, bytes: fs.statSync(pdfPath).size };

  // `shell: true` is required on Windows to invoke a `.cmd` shim via spawnSync (a direct exec
  // returns EINVAL). With shell:true, Windows' cmd.exe does the tokenizing, not node — so any
  // argument containing a space (every PDF filename here) MUST be quoted here, or cmd.exe splits
  // it into two arguments and the runner sees a truncated path (found the hard way: it silently
  // received "...\Arcil" with "Anchor Allocation...pdf" dropped).
  const q = (s) => `"${s}"`;
  const run = spawnSync(TSX, [q(RUNNER), q(pdfPath)], { encoding: 'utf8', cwd: REPO, timeout: 150_000, shell: true });
  if (run.status !== 0 && !run.stdout) {
    rec.result = `EXTRACTOR RUNNER FAILED (exit ${run.status}) — ${(run.stderr || '').slice(0, 2000)}`;
    runs.push(rec); continue;
  }
  let parsed;
  try { parsed = JSON.parse((run.stdout || '').trim().split('\n').pop()); }
  catch { rec.result = `RUNNER OUTPUT UNPARSEABLE — stdout: ${(run.stdout || '').slice(0, 500)} stderr: ${(run.stderr || '').slice(0, 500)}`; runs.push(rec); continue; }

  if (!parsed.ok) {
    rec.result = `extractPageTexts failed — kind=${parsed.kind} reason=${parsed.reason}`;
    runs.push(rec); continue;
  }
  rec.pageCount = parsed.pageCount;
  if (parsed.result.ok === false) {
    rec.result = `parseAnchorReport ran (${parsed.pageCount} pages of real text) but returned NO parse — reason="${parsed.result.reason}". Recorded honestly: fields_filled is empty, not guessed.`;
    rec.fields_filled = {};
    runs.push(rec); continue;
  }
  const r = parsed.result;
  // Which `anchor_investors` columns this real run actually filled.
  rec.fields_filled = {
    total_shares_offered: r.totalShares > 0,
    total_amount_raised: r.totalAmountRupees > 0,
    anchor_investors_count: r.rows.length > 0,
    investor_list: r.rows.length > 0,
    bid_date: !!r.letterDate,
    // lock_in dates are DERIVED (allotment_date + 30/90 days per OD spec), never extracted here.
    lock_in_50_percent_date: 'DERIVED elsewhere, not from this extractor',
    lock_in_remaining_date: 'DERIVED elsewhere, not from this extractor',
  };
  rec.result = `OK — ${r.rows.length} investor rows, bidPrice=${r.bidPrice}, totalShares=${r.totalShares}, ` +
    `printedCount=${r.printedCount}, pages=${parsed.pageCount}`;
  rec.sample_row = r.rows[0] || null;
  runs.push(rec);
}

const out = {
  probe: 'anchor-report-extract',
  generated_at: nowStamp(),
  method: 'download the real ANCHOR_ALLOCATION_REPORT ZIP from documents.url (public NSE archive), ' +
          'unzip, run the REAL extractPageTexts + parseAnchorReport via a thin tsx bridge.',
  runs,
};
saveOutput('anchor-report-extract', out);

for (const r of runs) console.log(`${r.slug}: ${r.result}`);
console.log('written: anchor-report-extract.out.json');
